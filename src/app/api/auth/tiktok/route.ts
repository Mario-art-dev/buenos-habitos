import { NextResponse } from "next/server";
import { getTikTokAuthUrl } from "@/lib/social/tiktok";

export async function GET() {
  const { url, state } = getTikTokAuthUrl();
  const res = NextResponse.redirect(url);
  res.cookies.set("tiktok_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
