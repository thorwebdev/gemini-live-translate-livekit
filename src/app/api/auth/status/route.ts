import { NextResponse } from "next/server";

export async function GET() {
  const passwordRequired = !!process.env.BROADCAST_PASSWORD;
  return NextResponse.json({ passwordRequired });
}
