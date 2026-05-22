import { NextRequest, NextResponse } from "next/server";
import {
  AccessToken,
  RoomConfiguration,
  RoomAgentDispatch,
} from "livekit-server-sdk";

// Session caps (mirrors src/lib/config.ts on the client). Hardcoded here to
// avoid a runtime import cycle; keep these in sync if you change them in one place.
const SESSION_TTL_SECONDS = 4 * 60 * 60; // 4h hard cap per grill Q21
const EMPTY_ROOM_TIMEOUT = 60; // close empty rooms after 60s
const DEPARTURE_TIMEOUT = 30; // close after last person leaves
const MAX_PARTICIPANTS = 8; // room cap per grill Q21
// Must match agent_name in translator/src/agent.py. Using "gemini-translator"
// instead of the generic "translator" to avoid colliding with stale Cloud
// Agents that may already be registered under "translator".
const TRANSLATOR_AGENT_NAME = "gemini-translator";

export async function GET(req: NextRequest) {
  const room = req.nextUrl.searchParams.get("room");
  const identity = req.nextUrl.searchParams.get("identity");
  const displayName =
    req.nextUrl.searchParams.get("name")?.trim() || identity || "";

  if (!room || !identity) {
    return NextResponse.json(
      { error: "Missing room or identity parameter" },
      { status: 400 },
    );
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const serverUrl = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !serverUrl) {
    return NextResponse.json(
      { error: "LiveKit credentials not configured" },
      { status: 500 },
    );
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name: displayName,
    ttl: SESSION_TTL_SECONDS,
  });

  // Peer model (grill Q7): every participant can publish audio + video and
  // subscribe; can update their own attributes (used to broadcast their
  // chosen language to the agent + other peers).
  at.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
    canUpdateOwnMetadata: true,
  });

  // Dispatch the Python translator agent when the room is created (grill Q9).
  // RoomConfiguration is only applied on first creation; subsequent token
  // mints for an existing room are ignored by LiveKit. So idempotent.
  at.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: TRANSLATOR_AGENT_NAME,
        metadata: JSON.stringify({ sessionId: room }),
      }),
    ],
    emptyTimeout: EMPTY_ROOM_TIMEOUT,
    departureTimeout: DEPARTURE_TIMEOUT,
    maxParticipants: MAX_PARTICIPANTS,
  });

  const token = await at.toJwt();

  return NextResponse.json({ token, serverUrl });
}
