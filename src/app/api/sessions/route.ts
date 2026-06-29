/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import TranslationSessionManager from "@/lib/translation-session-manager";

// POST /api/sessions — Create a new broadcast session
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const organizerName = body.organizerName || "organizer";
    const password = body.password;
    const eventId = body.eventId;

    const expectedPassword = process.env.BROADCAST_PASSWORD;
    if (expectedPassword && password !== expectedPassword) {
      return NextResponse.json(
        { error: "Incorrect password" },
        { status: 401 }
      );
    }

    let sessionId: string;
    if (eventId && typeof eventId === "string" && eventId.trim().length > 0) {
      // Sanitize: lowercase, replace spaces/special chars with hyphens, allow alphanumeric, -, _
      sessionId = eventId
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "");

      if (sessionId.length === 0) {
        sessionId = uuidv4().slice(0, 8);
      }
    } else {
      sessionId = uuidv4().slice(0, 8); // Short, readable ID
    }

    const organizerIdentity = `organizer-${organizerName}`;

    const manager = TranslationSessionManager.getInstance();
    
    // Clean up any stale translations/livekit rooms or translator bots from previous sessions under the same ID
    if (manager.getSession(sessionId)) {
      console.log(`[SessionsAPI] Overwriting existing session ${sessionId}. Tearing down previous bridges...`);
      await manager.removeAllTranslations(sessionId);
    }

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
