import fs from "fs";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobDir, toMediaUrl } from "@/lib/storagePaths";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const job = await db.job.findUnique({
    where: { id: params.id },
    include: {
      clips: {
        orderBy: { rank: "asc" },
        include: { publications: true, rankingItems: { orderBy: { position: "desc" } } },
      },
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Job no encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    job: {
      ...job,
      clips: job.clips.map((clip) => ({
        ...clip,
        hashtags: JSON.parse(clip.hashtags || "[]"),
        videoUrl: toMediaUrl(clip.filePath),
        thumbnailUrl: toMediaUrl(clip.thumbnailPath),
      })),
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await db.job.delete({ where: { id: params.id } });
  fs.rmSync(jobDir(params.id), { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}
