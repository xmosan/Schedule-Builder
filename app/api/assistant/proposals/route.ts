import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  loadAssistantWorkflowByBatchId,
  loadAssistantWorkflowById,
  persistAssistantWorkflow,
  updateAssistantProposalResults,
} from "@/lib/assistant-workflow-store";
import { getUserFacingError } from "@/lib/user-facing-error";
import {
  createCanonicalProposal,
  getCanonicalPendingProposals,
} from "@/lib/assistant-workflow";
import type { AssistantSuggestion } from "@/lib/assistant";
import { validateSemanticTitle } from "@/lib/assistant-semantics";

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

export async function GET(request: NextRequest) {
  const authResult = await getAuthenticatedUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const batchId = request.nextUrl.searchParams.get("batchId")?.trim() ?? "";
  if (!batchId) {
    return NextResponse.json(
      { error: "Send a proposal batch ID." },
      { status: 400 },
    );
  }

  const loaded = await loadAssistantWorkflowByBatchId(
    authResult.supabase,
    authResult.userId,
    batchId,
  );

  if (loaded.error) {
    return NextResponse.json(
      { error: "The review plan could not be loaded." },
      { status: 500 },
    );
  }

  if (!loaded.data || loaded.data.batch?.id !== batchId) {
    return NextResponse.json(
      { error: "This review plan is unavailable or no longer exists." },
      { status: 404 },
    );
  }

  return NextResponse.json(loaded.data);
}

export async function PATCH(request: NextRequest) {
  const authResult = await getAuthenticatedUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown;
    proposalId?: unknown;
    suggestion?: unknown;
    workflowId?: unknown;
  };
  const workflowId =
    typeof body.workflowId === "string" ? body.workflowId.trim() : "";
  const proposalId =
    typeof body.proposalId === "string" ? body.proposalId.trim() : "";

  if (
    (body.action !== "reject" && body.action !== "update") ||
    !workflowId ||
    !proposalId
  ) {
    return NextResponse.json(
      { error: "Send a workflowId, proposalId, and a supported action." },
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

  if (body.action === "update") {
    if (typeof body.suggestion !== "object" || body.suggestion === null) {
      return NextResponse.json(
        { error: "Send the updated proposal details." },
        { status: 400 },
      );
    }
    let candidateSuggestion = {
      ...(body.suggestion as AssistantSuggestion),
      batchId: proposal.batchId ?? undefined,
      id: proposal.id,
      workflowId,
    };
    if (candidateSuggestion.type === "suggested_weekly_block") {
      const title = validateSemanticTitle(
        candidateSuggestion.projectName ?? candidateSuggestion.title,
        loaded.data.workflow.context?.semanticRequest,
      );
      if (!title) {
        return NextResponse.json(
          { error: "Use a title that describes the activity, not a scheduling command." },
          { status: 400 },
        );
      }
      candidateSuggestion = {
        ...candidateSuggestion,
        projectName: title,
        title,
      };
    }
    const rebuilt = createCanonicalProposal(candidateSuggestion);
    if (!rebuilt) {
      return NextResponse.json(
        { error: "The edited proposal is incomplete or invalid." },
        { status: 400 },
      );
    }
    const updatedProposal = {
      ...rebuilt,
      approvalStatus: proposal.approvalStatus,
      batchId: proposal.batchId,
      createdAt: proposal.createdAt,
    };
    const context = loaded.data.workflow.context;
    const timeBlock = updatedProposal.timeBlock;
    const nextWorkflow = {
      ...loaded.data.workflow,
      context:
        context && timeBlock
          ? {
              ...context,
              pendingProposal:
                context.pendingProposal?.id === proposalId
                  ? {
                      ...context.pendingProposal,
                      date: timeBlock.date,
                      details: timeBlock.details ?? "",
                      durationMinutes: timeBlock.durationMinutes,
                      selectedWindowEnd: timeBlock.endTime,
                      startTime: timeBlock.startTime,
                      title: timeBlock.title,
                    }
                  : context.pendingProposal,
              pendingProposals: context.pendingProposals.map((pending) =>
                pending.id === proposalId
                  ? {
                      ...pending,
                      date: timeBlock.date,
                      details: timeBlock.details ?? "",
                      durationMinutes: timeBlock.durationMinutes,
                      selectedWindowEnd: timeBlock.endTime,
                      startTime: timeBlock.startTime,
                      title: timeBlock.title,
                    }
                  : pending,
              ),
            }
          : context,
      lastUpdatedAt: new Date().toISOString(),
    };
    const persisted = await persistAssistantWorkflow(
      authResult.supabase,
      nextWorkflow,
      loaded.data.proposals.map((candidate) =>
        candidate.id === proposalId ? updatedProposal : candidate,
      ),
      loaded.data.batch,
    );
    console.info("assistant_workflow", {
      event: "proposal_updated",
      persistenceResult: persisted.error ? "failed" : "persisted",
      proposalId,
      workflowId,
    });
    if (persisted.error || !persisted.data) {
      return NextResponse.json(
        { error: "The edited proposal could not be saved." },
        { status: 500 },
      );
    }
    return NextResponse.json(persisted.data);
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
