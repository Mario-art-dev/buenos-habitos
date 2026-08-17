import { NextResponse } from "next/server";
import { getTikTokAuthUrl } from "@/lib/social/tiktok";

export const dynamic = "force-dynamic";

export async function GET() {
  const { url, state, codeVerifier } = getTikTokAuthUrl();
  const res = NextResponse.redirect(url);
  res.cookies.set("tiktok_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  res.cookies.set("tiktok_oauth_verifier", codeVerifier, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
