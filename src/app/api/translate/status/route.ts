import { NextRequest, NextResponse } from "next/server";
import TranslationSessionManager from "@/lib/translation-session-manager";

// GET /api/translate/status — List active translations for a session
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing sessionId parameter" },
      { status: 400 }
    );
  }

  const manager = TranslationSessionManager.getInstance();
  const translations = manager.getActiveTranslations(sessionId);

  return NextResponse.json({ translations });
}
