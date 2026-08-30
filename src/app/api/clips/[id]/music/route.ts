import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { applyMusicToClip } from "@/lib/pipeline/musicApply";

export const dynamic = "force-dynamic";

const musicSchema = z.object({
  musicSourceUrl: z.string().url("Pega un enlace de YouTube válido"),
  musicStartSec: z.number().min(0).default(0),
});

/**
 * Añadir/cambiar música vuelve a mezclar el audio sobre una versión limpia del vídeo — para
 * SINGLE/SPLIT eso pasa por regenerateClip() por dentro (el mismo render completo de ffmpeg), más
 * la descarga de la canción. Igual que ya se arregló para publicar y para "Guardar y regenerar"
 * del editor, puede tardar más de lo que aguanta abierta una sola petición el túnel gratuito, así
 * que esta ruta responde AL INSTANTE y el trabajo de verdad sigue en segundo plano — el cliente
 * pregunta el resultado con GET /api/clips/[id] (campo renderPending) en vez de esperar aquí.
 */
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

  await db.clip.update({ where: { id: params.id }, data: { renderPending: true } });

  applyMusicToClip(clip.id, {
    musicSourceUrl: parsed.data.musicSourceUrl,
    musicStartSec: parsed.data.musicStartSec,
  })
    .catch(async (err) => {
      await db.clip.update({ where: { id: params.id }, data: { error: (err as Error).message } }).catch(() => {});
    })
    .finally(() => {
      db.clip.update({ where: { id: params.id }, data: { renderPending: false } }).catch(() => {});
    });

  return NextResponse.json({ started: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const clip = await db.clip.findUnique({ where: { id: params.id } });
  if (!clip) {
    return NextResponse.json({ error: "Clip no encontrado" }, { status: 404 });
  }

  await db.clip.update({ where: { id: params.id }, data: { renderPending: true } });

  applyMusicToClip(clip.id, null)
    .catch(async (err) => {
      await db.clip.update({ where: { id: params.id }, data: { error: (err as Error).message } }).catch(() => {});
    })
    .finally(() => {
      db.clip.update({ where: { id: params.id }, data: { renderPending: false } }).catch(() => {});
    });

  return NextResponse.json({ started: true });
}
