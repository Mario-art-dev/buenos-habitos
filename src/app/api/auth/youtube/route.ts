import { NextResponse } from "next/server";
import { getYouTubeAuthUrl } from "@/lib/social/youtube";

export async function GET() {
  return NextResponse.redirect(getYouTubeAuthUrl());
}
