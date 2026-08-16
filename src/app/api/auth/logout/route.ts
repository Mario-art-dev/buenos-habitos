import { NextResponse } from "next/server";
import { sessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(sessionCookie.name);
  return res;
}
