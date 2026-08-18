import { NextRequest, NextResponse } from "next/server";
import { getTikTokAuthUrl } from "@/lib/social/tiktok";
import { getRequestOrigin } from "@/lib/requestOrigin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = getRequestOrigin(req);
  const { url, state, codeVerifier } = getTikTokAuthUrl(`${origin}/api/auth/tiktok/callback`);
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
