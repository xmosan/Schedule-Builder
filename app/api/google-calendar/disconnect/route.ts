import { NextRequest, NextResponse } from "next/server";
import {
  disconnectGoogleCalendarForUser,
  getAuthenticatedGoogleCalendarUser,
  getGoogleCalendarErrorMessage,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { serviceClient, userId } =
      await getAuthenticatedGoogleCalendarUser(request);

    await disconnectGoogleCalendarForUser(serviceClient, userId);

    return NextResponse.json({ disconnected: true });
  } catch (error) {
    return NextResponse.json(
      { error: getGoogleCalendarErrorMessage(error) },
      { status: 500 },
    );
  }
}
