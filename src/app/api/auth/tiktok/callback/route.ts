import { NextRequest, NextResponse } from "next/server";
import { handleTikTokOAuthCallback } from "@/lib/social/tiktok";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const savedState = req.cookies.get("tiktok_oauth_state")?.value;
  const codeVerifier = req.cookies.get("tiktok_oauth_verifier")?.value;

  if (error || !code) {
    return NextResponse.redirect(`${config.appUrl}/settings?error=tiktok_${error ?? "no_code"}`);
  }
  if (!state || state !== savedState) {
    return NextResponse.redirect(`${config.appUrl}/settings?error=tiktok_estado_invalido`);
  }
  if (!codeVerifier) {
    return NextResponse.redirect(`${config.appUrl}/settings?error=tiktok_sesion_expirada`);
  }

  try {
    await handleTikTokOAuthCallback(code, codeVerifier);
    const res = NextResponse.redirect(`${config.appUrl}/settings?connected=tiktok`);
    res.cookies.delete("tiktok_oauth_state");
    res.cookies.delete("tiktok_oauth_verifier");
    return res;
  } catch (err) {
    return NextResponse.redirect(
      `${config.appUrl}/settings?error=${encodeURIComponent((err as Error).message)}`
    );
  }
}
