import { NextRequest, NextResponse } from "next/server";
import { handleYouTubeOAuthCallback } from "@/lib/social/youtube";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(`${config.appUrl}/settings?error=youtube_${error ?? "no_code"}`);
  }

  try {
    await handleYouTubeOAuthCallback(code);
    return NextResponse.redirect(`${config.appUrl}/settings?connected=youtube`);
  } catch (err) {
    return NextResponse.redirect(
      `${config.appUrl}/settings?error=${encodeURIComponent((err as Error).message)}`
    );
  }
}
