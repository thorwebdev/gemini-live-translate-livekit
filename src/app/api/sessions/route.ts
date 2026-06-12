import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import TranslationSessionManager from "@/lib/translation-session-manager";

// POST /api/sessions — Create a new broadcast session
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const organizerName = body.organizerName || "organizer";
    const password = body.password;

    const expectedPassword = process.env.BROADCAST_PASSWORD;
    if (expectedPassword && password !== expectedPassword) {
      return NextResponse.json(
        { error: "Incorrect password" },
        { status: 401 }
      );
    }

    const sessionId = uuidv4().slice(0, 8); // Short, readable ID
    const organizerIdentity = `organizer-${organizerName}`;

    const manager = TranslationSessionManager.getInstance();
    manager.createSession(sessionId, organizerIdentity);

    // Build the attendee join URL
    const protocol = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host") || "localhost:3000";
    const joinUrl = `${protocol}://${host}/session/${sessionId}/watch`;

    return NextResponse.json({
      sessionId,
      organizerIdentity,
      joinUrl,
      broadcastUrl: `${protocol}://${host}/session/${sessionId}/broadcast`,
    });
  } catch (error) {
    console.error("Error creating session:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}

// GET /api/sessions — List all active sessions
export async function GET() {
  const manager = TranslationSessionManager.getInstance();
  const sessions = manager.getAllSessions();
  return NextResponse.json({ sessions });
}
