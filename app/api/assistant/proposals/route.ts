import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  loadAssistantWorkflowById,
  updateAssistantProposalResults,
} from "@/lib/assistant-workflow-store";
import { getUserFacingError } from "@/lib/user-facing-error";
import { getCanonicalPendingProposals } from "@/lib/assistant-workflow";

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
      { error: "Sign in before changing a proposal." },
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
      { error: getUserFacingError(error, "The proposal could not be changed.") },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authResult = await getAuthenticatedUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown;
    proposalId?: unknown;
    workflowId?: unknown;
  };
  const workflowId =
    typeof body.workflowId === "string" ? body.workflowId.trim() : "";
  const proposalId =
    typeof body.proposalId === "string" ? body.proposalId.trim() : "";

  if (body.action !== "reject" || !workflowId || !proposalId) {
    return NextResponse.json(
      { error: "Send a workflowId, proposalId, and reject action." },
      { status: 400 },
    );
  }

  const loaded = await loadAssistantWorkflowById(
    authResult.supabase,
    authResult.userId,
    workflowId,
  );
  if (loaded.error || !loaded.data) {
    return NextResponse.json(
      { error: "The persisted workflow could not be loaded." },
      { status: loaded.error ? 500 : 404 },
    );
  }
  const proposal = getCanonicalPendingProposals(
    loaded.data.workflow,
    loaded.data.proposals,
  ).find((candidate) => candidate.id === proposalId);
  if (!proposal || proposal.approvalStatus !== "pending") {
    return NextResponse.json(
      { error: "That proposal is missing or has already been handled." },
      { status: 409 },
    );
  }

  const updated = await updateAssistantProposalResults(
    authResult.supabase,
    loaded.data.workflow,
    [{ approvalStatus: "rejected", proposalId }],
  );
  console.info("assistant_workflow", {
    event: "proposal_rejected",
    persistenceResult: updated.error ? "failed" : "persisted",
    proposalId,
    workflowId,
  });
  if (updated.error || !updated.data) {
    return NextResponse.json(
      { error: "The proposal could not be removed from the review queue." },
      { status: 500 },
    );
  }

  return NextResponse.json(updated.data);
}
