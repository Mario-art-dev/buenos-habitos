import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const createSongJobSchema = z.object({
  sourceUrl: z.string().url("Introduce la URL del vídeo de recopilación a remontar"),
  songUrl: z.string().url("Introduce la URL de YouTube de la canción"),
});

/** Crea un job del modo Canción: recopilación existente + canción con la que resincronizar los cortes. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createSongJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }

  const job = await db.job.create({
    data: {
      mode: "SONG",
      sourceUrl: parsed.data.sourceUrl,
      songUrl: parsed.data.songUrl,
      status: "PENDING",
    },
  });

  return NextResponse.json({ job }, { status: 201 });
}
