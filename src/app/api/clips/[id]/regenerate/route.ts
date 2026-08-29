import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { regenerateClip } from "@/lib/pipeline/regenerateClip";

export const dynamic = "force-dynamic";

/**
 * Reconstruye el vídeo del clip con los subtítulos/textos guardados en ese momento (ver el editor
 * en /clips/[id]/edit). Regenerar de verdad (ffmpeg completo: subtítulos, portada, para RANKING
 * también concatenar los 5 tramos y mezclar música...) puede tardar más de lo que aguanta abierta
 * una sola petición el túnel gratuito de Cloudflare — si el navegador esperaba aquí mismo a que
 * terminase, a mitad de camino llegaba un "Load failed" (visto en real, mismo problema que ya se
 * arregló para publicar en TikTok/YouTube). Por eso esta ruta responde AL INSTANTE en cuanto
 * arranca, y el render de verdad sigue en segundo plano; el editor pregunta el resultado con GET
 * /api/clips/[id] (campo renderPending) en vez de depender de mantener esta petición abierta.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const clip = await db.clip.findUnique({ where: { id: params.id } });
  if (!clip) {
    return NextResponse.json({ error: "Clip no encontrado" }, { status: 404 });
  }

  await db.clip.update({ where: { id: params.id }, data: { renderPending: true } });

  regenerateClip(params.id)
    .catch(async (err) => {
      const message = (err as Error).message;
      await db.clip.update({ where: { id: params.id }, data: { error: message } }).catch(() => {});
    })
    .finally(() => {
      db.clip.update({ where: { id: params.id }, data: { renderPending: false } }).catch(() => {});
    });

  return NextResponse.json({ started: true });
}
