import { NextRequest, NextResponse } from "next/server";
import { getYouTubeAuthUrl } from "@/lib/social/youtube";
import { config } from "@/lib/config";
import { getRequestOrigin } from "@/lib/requestOrigin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = getRequestOrigin(req);
  // Sin GOOGLE_CLIENT_ID/SECRET, Google devuelve un error críptico suyo ("Missing required
  // parameter: client_id") en vez de que nuestra web explique qué falta configurar.
  if (!config.google.clientId || !config.google.clientSecret) {
    return NextResponse.redirect(`${origin}/settings?error=youtube_sin_credenciales`);
  }
  return NextResponse.redirect(getYouTubeAuthUrl(`${origin}/api/auth/youtube/callback`));
}
