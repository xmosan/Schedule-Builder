import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedGoogleCalendarUser,
  getGoogleCalendarErrorMessage,
} from "@/lib/google-calendar";
import {
  getImportedCalendarSourceRemovalCopy,
  isManageableImportedCalendarSource,
} from "@/lib/imported-calendar";

export const dynamic = "force-dynamic";

type RemoveImportedCalendarSourceBody = {
  source?: unknown;
};

function getFriendlyRemovalError(error: unknown) {
  const message = getGoogleCalendarErrorMessage(error);

  if (/sign in|session/i.test(message)) {
    return message;
  }

  return "Imported events could not be removed. Refresh and try again.";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RemoveImportedCalendarSourceBody;
    const source = typeof body.source === "string" ? body.source : "";

    if (!isManageableImportedCalendarSource(source)) {
      return NextResponse.json(
        { error: "Choose a supported imported calendar to remove." },
        { status: 400 },
      );
    }

    const { serviceClient, userId } =
      await getAuthenticatedGoogleCalendarUser(request);
    const { data, error } = await serviceClient
      .from("imported_calendar_events")
      .delete()
      .eq("user_id", userId)
      .eq("source", source)
      .select("id");

    if (error) {
      throw error;
    }

    const deletedCount = data?.length ?? 0;
    const copy = getImportedCalendarSourceRemovalCopy(source);

    return NextResponse.json({
      deletedCount,
      message: deletedCount > 0 ? copy.successMessage : copy.emptyMessage,
      source,
    });
  } catch (error) {
    const message = getFriendlyRemovalError(error);

    return NextResponse.json(
      { error: message },
      { status: message.includes("Sign in") ? 401 : 500 },
    );
  }
}
