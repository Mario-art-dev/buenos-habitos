import { NextRequest, NextResponse } from "next/server";
import { handleTikTokOAuthCallback } from "@/lib/social/tiktok";
import { config } from "@/lib/config";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const savedState = req.cookies.get("tiktok_oauth_state")?.value;

  if (error || !code) {
    return NextResponse.redirect(`${config.appUrl}/settings?error=tiktok_${error ?? "no_code"}`);
  }
  if (!state || state !== savedState) {
    return NextResponse.redirect(`${config.appUrl}/settings?error=tiktok_estado_invalido`);
  }

  try {
    await handleTikTokOAuthCallback(code);
    const res = NextResponse.redirect(`${config.appUrl}/settings?connected=tiktok`);
    res.cookies.delete("tiktok_oauth_state");
    return res;
  } catch (err) {
    return NextResponse.redirect(
      `${config.appUrl}/settings?error=${encodeURIComponent((err as Error).message)}`
    );
  }
}
