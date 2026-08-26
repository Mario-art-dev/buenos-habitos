import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toMediaUrl } from "@/lib/storagePaths";

export const dynamic = "force-dynamic";

export async function GET() {
  const clips = await db.clip.findMany({
    // job.deletedAt: null — un clip cuyo trabajo se borró con la X (ver JobList.tsx/DELETE
    // /api/jobs/[id]) no debe seguir saliendo aquí; sus archivos ya no existen en disco.
    where: { status: "READY", job: { deletedAt: null } },
    orderBy: { createdAt: "desc" },
    include: {
      publications: true,
      rankingItems: { orderBy: { position: "desc" } },
      job: { select: { sourceTitle: true, mode: true } },
    },
  });

  return NextResponse.json({
    clips: clips.map((clip) => ({
      ...clip,
      hashtags: JSON.parse(clip.hashtags || "[]"),
      videoUrl: toMediaUrl(clip.filePath),
      thumbnailUrl: toMediaUrl(clip.thumbnailPath),
    })),
  });
}
