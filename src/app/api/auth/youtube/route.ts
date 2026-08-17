import { NextResponse } from "next/server";
import { getYouTubeAuthUrl } from "@/lib/social/youtube";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  // Sin GOOGLE_CLIENT_ID/SECRET, Google devuelve un error críptico suyo ("Missing required
  // parameter: client_id") en vez de que nuestra web explique qué falta configurar.
  if (!config.google.clientId || !config.google.clientSecret) {
    return NextResponse.redirect(`${config.appUrl}/settings?error=youtube_sin_credenciales`);
  }
  return NextResponse.redirect(getYouTubeAuthUrl());
}
