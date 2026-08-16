import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { applyMusicFromYouTube } from "@/lib/pipeline/rankingRender";

export const dynamic = "force-dynamic";

const musicSchema = z.object({
  musicSourceUrl: z.string().url("Pega un enlace de YouTube válido"),
  musicStartSec: z.number().min(0).default(0),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const parsed = musicSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }

  const clip = await db.clip.findUnique({ where: { id: params.id } });
  if (!clip) {
    return NextResponse.json({ error: "Clip no encontrado" }, { status: 404 });
  }

  try {
    const { filePath, thumbnailPath } = await applyMusicFromYouTube({
      jobId: clip.jobId,
      clipId: clip.id,
      musicSourceUrl: parsed.data.musicSourceUrl,
      startSec: parsed.data.musicStartSec,
    });

    await db.clip.update({
      where: { id: clip.id },
      data: {
        musicSourceUrl: parsed.data.musicSourceUrl,
        musicStartSec: parsed.data.musicStartSec,
        filePath,
        thumbnailPath,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
