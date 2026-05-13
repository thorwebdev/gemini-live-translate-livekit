import { NextRequest, NextResponse } from "next/server";
import TranslationSessionManager from "@/lib/translation-session-manager";

// POST /api/translate/unsubscribe — Decrement subscriber count for a language
// Uses POST because navigator.sendBeacon only supports POST
export async function POST(req: NextRequest) {
  try {
    const { sessionId, targetLanguage } = await req.json();

    if (!sessionId || !targetLanguage) {
      return NextResponse.json(
        { error: "Missing sessionId or targetLanguage" },
        { status: 400 }
      );
    }

    const manager = TranslationSessionManager.getInstance();
    await manager.unsubscribe(sessionId, targetLanguage);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error unsubscribing:", error);
    return NextResponse.json(
      { error: "Failed to unsubscribe" },
      { status: 500 }
    );
  }
}
