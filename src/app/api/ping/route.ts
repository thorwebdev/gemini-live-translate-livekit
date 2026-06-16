import { NextResponse } from "next/server";

// GET /api/ping — Lightweight keep-alive endpoint used by the broadcaster client
// to prevent Google Cloud Run from scaling down to zero during an active session.
export async function GET() {
  return new NextResponse("ok", { status: 200 });
}
