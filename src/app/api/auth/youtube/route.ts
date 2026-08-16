import { NextResponse } from "next/server";
import { getYouTubeAuthUrl } from "@/lib/social/youtube";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.redirect(getYouTubeAuthUrl());
}
