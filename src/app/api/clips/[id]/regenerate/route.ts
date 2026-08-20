import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toMediaUrl } from "@/lib/storagePaths";
import { regenerateClip } from "@/lib/pipeline/regenerateClip";

export const dynamic = "force-dynamic";

/** Reconstruye el vídeo del clip con los subtítulos/textos guardados en ese momento (ver el editor en /clips/[id]/edit). */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const clip = await db.clip.findUnique({ where: { id: params.id } });
  if (!clip) {
    return NextResponse.json({ error: "Clip no encontrado" }, { status: 404 });
  }

  try {
    await regenerateClip(params.id);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  const updated = await db.clip.findUniqueOrThrow({ where: { id: params.id } });
  return NextResponse.json({
    videoUrl: toMediaUrl(updated.filePath),
    thumbnailUrl: toMediaUrl(updated.thumbnailPath),
  });
}
