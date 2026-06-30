import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { parseAssistantConversationSnapshot } from "@/lib/assistant-conversation";

export const dynamic = "force-dynamic";

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
}

function createAuthenticatedSupabaseClient(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function getAuthenticatedUser(request: NextRequest) {
  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return null;
  }

  const supabase = createAuthenticatedSupabaseClient(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user) {
    return null;
  }

  return { supabase, userId: data.user.id };
}

function isMissingConversationTable(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: string; message?: string };
  return (
    candidate.code === "42P01" ||
    candidate.code === "PGRST205" ||
    candidate.message?.includes("assistant_threads") === true
  );
}

async function getActiveThread(supabase: SupabaseClient, userId: string) {
  return supabase
    .from("assistant_threads")
    .select("id, snapshot, updated_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Sign in to restore this conversation." }, { status: 401 });
  }

  const result = await getActiveThread(auth.supabase, auth.userId);

  if (result.error) {
    if (isMissingConversationTable(result.error)) {
      return NextResponse.json({ available: false, snapshot: null });
    }

    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({
    available: true,
    snapshot: result.data?.snapshot ?? null,
  });
}

export async function PUT(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Sign in to save this conversation." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { snapshot?: unknown } | null;
  const snapshot = parseAssistantConversationSnapshot(body?.snapshot);

  if (!snapshot) {
    return NextResponse.json({ error: "Conversation snapshot is invalid." }, { status: 400 });
  }

  const activeResult = await getActiveThread(auth.supabase, auth.userId);

  if (activeResult.error) {
    if (isMissingConversationTable(activeResult.error)) {
      return NextResponse.json({ available: false });
    }

    return NextResponse.json({ error: activeResult.error.message }, { status: 500 });
  }

  const threadId = activeResult.data?.id ?? snapshot.threadId;
  const persistedSnapshot = { ...snapshot, threadId };
  const result = await auth.supabase.from("assistant_threads").upsert(
    {
      id: threadId,
      user_id: auth.userId,
      status: "active",
      snapshot: persistedSnapshot,
    },
    { onConflict: "id" },
  );

  if (result.error) {
    if (isMissingConversationTable(result.error)) {
      return NextResponse.json({ available: false });
    }

    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ available: true, snapshot: persistedSnapshot });
}

export async function DELETE(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Sign in to clear this conversation." }, { status: 401 });
  }

  const result = await auth.supabase
    .from("assistant_threads")
    .delete()
    .eq("user_id", auth.userId)
    .eq("status", "active");

  if (result.error && !isMissingConversationTable(result.error)) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ available: !result.error, cleared: true });
}
