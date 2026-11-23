import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json()) as { seen?: boolean; liked?: boolean };
  const data: { seen?: boolean; liked?: boolean } = {};
  if (typeof body.seen === "boolean") data.seen = body.seen;
  if (typeof body.liked === "boolean") data.liked = body.liked;
  const video = await db.studyVideo.update({ where: { id: params.id }, data });
  return NextResponse.json(video);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await db.studyVideo.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
