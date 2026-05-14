import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedGoogleCalendarUser,
  getGoogleCalendarErrorMessage,
  markGoogleCalendarNeedsReconnect,
  syncGoogleCalendarForUser,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { serviceClient, userId } =
      await getAuthenticatedGoogleCalendarUser(request);
    const result = await syncGoogleCalendarForUser(serviceClient, userId);

    return NextResponse.json({
      importedCount: result.events.length,
      rangeEnd: result.range.endIso,
      rangeStart: result.range.startIso,
      skippedDuplicates: result.skippedDuplicates,
    });
  } catch (error) {
    const message = getGoogleCalendarErrorMessage(error);

    try {
      const { serviceClient, userId } =
        await getAuthenticatedGoogleCalendarUser(request);
      await markGoogleCalendarNeedsReconnect(serviceClient, userId, message);
    } catch {
      // Keep the original error response if auth/config also fails.
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
