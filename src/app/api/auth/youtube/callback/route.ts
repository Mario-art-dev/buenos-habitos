import { NextRequest, NextResponse } from "next/server";
import { handleYouTubeOAuthCallback } from "@/lib/social/youtube";
import { getRequestOrigin } from "@/lib/requestOrigin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = getRequestOrigin(req);
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(`${origin}/settings?error=youtube_${error ?? "no_code"}`);
  }

  try {
    // El redirect_uri tiene que ser EXACTAMENTE el mismo que se usó al pedir el login, si no
    // Google lo rechaza — por eso se deriva igual (misma petición, mismo origen).
    await handleYouTubeOAuthCallback(code, `${origin}/api/auth/youtube/callback`);
    return NextResponse.redirect(`${origin}/settings?connected=youtube`);
  } catch (err) {
    return NextResponse.redirect(
      `${origin}/settings?error=${encodeURIComponent((err as Error).message)}`
    );
  }
}
