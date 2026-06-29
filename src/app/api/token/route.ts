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
import { AccessToken } from "livekit-server-sdk";
import TranslationSessionManager from "@/lib/translation-session-manager";

// GET /api/token — Generate a LiveKit access token
export async function GET(req: NextRequest) {
  const room = req.nextUrl.searchParams.get("room");
  const identity = req.nextUrl.searchParams.get("identity");
  const role = req.nextUrl.searchParams.get("role") || "attendee";

  if (!room || !identity) {
    return NextResponse.json(
      { error: "Missing room or identity parameter" },
      { status: 400 }
    );
  }

  const isOrganizer = role === "organizer";

  // Check if session exists in the manager for attendees
  if (!isOrganizer) {
    const manager = TranslationSessionManager.getInstance();
    const session = manager.getSession(room);
    console.log(`[TokenAPI] Checking session for room "${room}". Found session:`, session);
    if (!session) {
      return NextResponse.json(
        { error: "Broadcast session has not started yet or has ended" },
        { status: 404 }
      );
    }
  }

  const expectedPassword = process.env.BROADCAST_PASSWORD;
  if (isOrganizer && expectedPassword) {
    const password = req.nextUrl.searchParams.get("password");
    if (password !== expectedPassword) {
      return NextResponse.json(
        { error: "Incorrect password" },
        { status: 401 }
      );
    }
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: "LiveKit credentials not configured" },
      { status: 500 }
    );
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name: identity,
    ttl: "4h",
  });

  at.addGrant({
    roomJoin: true,
    room,
    canPublish: isOrganizer,
    canSubscribe: true,
    canPublishData: isOrganizer,
    canUpdateOwnMetadata: true,
  });

  const token = await at.toJwt();
  const serverUrl = process.env.LIVEKIT_URL || "ws://localhost:7880";

  return NextResponse.json({ token, serverUrl });
}
