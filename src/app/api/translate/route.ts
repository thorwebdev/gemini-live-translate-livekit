import { NextRequest, NextResponse } from "next/server";
import TranslationSessionManager from "@/lib/translation-session-manager";

// POST /api/translate — Request a translation stream for a language
export async function POST(req: NextRequest) {
  try {
    const { sessionId, targetLanguage, previousLanguage } = await req.json();

    if (!sessionId || !targetLanguage) {
      return NextResponse.json(
        { error: "Missing sessionId or targetLanguage" },
        { status: 400 }
      );
    }

    const manager = TranslationSessionManager.getInstance();
    const session = manager.getSession(sessionId);

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    // Unsubscribe from the previous language if switching
    if (previousLanguage && previousLanguage !== "original") {
      await manager.unsubscribe(sessionId, previousLanguage);
    }

    // Skip translation for the original language (no bridge needed)
    if (targetLanguage === "original") {
      return NextResponse.json({
        translatorIdentity: null,
        status: "original",
        message: "Using original audio",
      });
    }

    // Get or create the translation bridge
    const bridge = await manager.getOrCreate(
      sessionId,
      targetLanguage,
      session.organizerIdentity
    );

    return NextResponse.json({
      translatorIdentity: bridge.identity,
      status: bridge.status,
      targetLanguage: bridge.targetLanguage,
    });
  } catch (error) {
    console.error("Error requesting translation:", error);
    return NextResponse.json(
      { error: "Failed to start translation: " + (error as Error).message },
      { status: 500 }
    );
  }
}

// DELETE /api/translate — Unsubscribe from a translation (e.g. on disconnect)
export async function DELETE(req: NextRequest) {
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
