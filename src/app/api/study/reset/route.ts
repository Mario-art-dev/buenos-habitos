import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// «Para ti» ya enseñó todos los vídeos una vez: se empieza una vuelta nueva.
export async function POST() {
  await db.studyVideo.updateMany({ data: { seen: false } });
  return NextResponse.json({ ok: true });
}
