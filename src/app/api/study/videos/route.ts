import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const videos = await db.studyVideo.findMany({ orderBy: [{ subject: "asc" }, { createdAt: "asc" }, { order: "asc" }] });
  return NextResponse.json(videos);
}
