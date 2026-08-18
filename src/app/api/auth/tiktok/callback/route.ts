import { NextRequest, NextResponse } from "next/server";
import { handleTikTokOAuthCallback } from "@/lib/social/tiktok";
import { getRequestOrigin } from "@/lib/requestOrigin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = getRequestOrigin(req);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const savedState = req.cookies.get("tiktok_oauth_state")?.value;
  const codeVerifier = req.cookies.get("tiktok_oauth_verifier")?.value;

  if (error || !code) {
    return NextResponse.redirect(`${origin}/settings?error=tiktok_${error ?? "no_code"}`);
  }
  if (!state || state !== savedState) {
    return NextResponse.redirect(`${origin}/settings?error=tiktok_estado_invalido`);
  }
  if (!codeVerifier) {
    return NextResponse.redirect(`${origin}/settings?error=tiktok_sesion_expirada`);
  }

  try {
    // El redirect_uri tiene que ser EXACTAMENTE el mismo que se usó al pedir el login, si no
    // TikTok lo rechaza — por eso se deriva igual (misma petición, mismo origen).
    await handleTikTokOAuthCallback(code, codeVerifier, `${origin}/api/auth/tiktok/callback`);
    const res = NextResponse.redirect(`${origin}/settings?connected=tiktok`);
    res.cookies.delete("tiktok_oauth_state");
    res.cookies.delete("tiktok_oauth_verifier");
    return res;
  } catch (err) {
    return NextResponse.redirect(
      `${origin}/settings?error=${encodeURIComponent((err as Error).message)}`
    );
  }
}
