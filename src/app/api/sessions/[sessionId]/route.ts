import { NextRequest, NextResponse } from "next/server";
import TranslationSessionManager from "@/lib/translation-session-manager";

// GET /api/sessions/:sessionId — Get session info
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const manager = TranslationSessionManager.getInstance();
  const session = manager.getSession(sessionId);

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const translations = manager.getActiveTranslations(sessionId);

  return NextResponse.json({
    ...session,
    translations,
  });
}

// DELETE /api/sessions/:sessionId — End a session and clean up all bridges
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const manager = TranslationSessionManager.getInstance();

  await manager.removeAllTranslations(sessionId);

  return NextResponse.json({ success: true });
}
