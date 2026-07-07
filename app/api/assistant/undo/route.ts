import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import type { AssistantUndoResponse } from "@/lib/assistant";
import { resolveAssistantWorkflowStatus } from "@/lib/assistant-automation";
import { loadReceiptForDecision } from "@/lib/assistant-automation-store";
import { loadAssistantWorkflowById } from "@/lib/assistant-workflow-store";
import { getUserFacingError } from "@/lib/user-facing-error";

export const dynamic = "force-dynamic";

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
}

function createAuthenticatedSupabaseClient(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Supabase environment variables are not configured.");
  }
  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function getAuthenticatedUser(
  request: NextRequest,
): Promise<{ supabase: SupabaseClient; userId: string } | NextResponse> {
  const accessToken = getBearerToken(request);
  if (!accessToken) {
    return NextResponse.json(
      { error: "Sign in before undoing an automated action." },
      { status: 401 },
    );
  }
  try {
    const supabase = createAuthenticatedSupabaseClient(accessToken);
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user) {
      return NextResponse.json(
        { error: "Your session expired. Sign in again." },
        { status: 401 },
      );
    }
    return { supabase, userId: data.user.id };
  } catch (error) {
    return NextResponse.json(
      { error: getUserFacingError(error, "Undo could not be authenticated.") },
      { status: 500 },
    );
  }
}

type UndoRpcResult = {
  decision_id: string;
  reversed_records: Array<{
    block_id: string;
    project_name: string;
    scheduled_date: string | null;
    start_time: string | null;
  }>;
  status: "undone";
  workflow_id: string;
};

function formatRecord(record: UndoRpcResult["reversed_records"][number]) {
  const date = record.scheduled_date ?? "saved date";
  const time = record.start_time?.slice(0, 5);
  return `- ${date}${time ? ` at ${time}` : ""}`;
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => ({}))) as {
    decisionRecordId?: unknown;
  };
  const decisionRecordId =
    typeof body.decisionRecordId === "string"
      ? body.decisionRecordId.trim()
      : "";
  if (!decisionRecordId) {
    return NextResponse.json(
      { error: "Send the automated decision to undo." },
      { status: 400 },
    );
  }

  const result = await auth.supabase.rpc("undo_assistant_decision", {
    p_decision_id: decisionRecordId,
  });
  if (result.error || !result.data) {
    const changed = /changed after application|no longer reversible|expired/i.test(
      result.error?.message ?? "",
    );
    return NextResponse.json(
      {
        error: changed
          ? "I couldn’t safely undo that because one or more created blocks changed afterward. Review them manually in Weekly Plan."
          : "I couldn’t safely undo that automated action.",
      },
      { status: changed ? 409 : 500 },
    );
  }

  const undo = result.data as UndoRpcResult;
  const [workflowResult, receiptResult] = await Promise.all([
    loadAssistantWorkflowById(auth.supabase, auth.userId, undo.workflow_id),
    loadReceiptForDecision(auth.supabase, auth.userId, decisionRecordId),
  ]);
  if (
    workflowResult.error ||
    !workflowResult.data ||
    receiptResult.error ||
    !receiptResult.data
  ) {
    return NextResponse.json(
      {
        error:
          "The blocks were reversed, but I couldn’t reload the updated automation receipt.",
      },
      { status: 500 },
    );
  }

  const lines = undo.reversed_records.map(formatRecord);
  const message = `Undone. I removed ${undo.reversed_records.length} automatically scheduled block${undo.reversed_records.length === 1 ? "" : "s"}.${lines.length ? `\n\n${lines.join("\n")}` : ""}`;
  const response: AssistantUndoResponse = {
    automationReceipt: receiptResult.data,
    message,
    reversedRecords: undo.reversed_records,
    workflow: workflowResult.data.workflow,
    workflowStatus: resolveAssistantWorkflowStatus({
      workflow: workflowResult.data.workflow,
    }),
  };
  return NextResponse.json(response);
}
