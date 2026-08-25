import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { autoApplyRecommendedMusic } from "@/lib/pipeline/musicApply";

export const dynamic = "force-dynamic";

/**
 * "Aplicar la sugerencia automáticamente": busca ella misma en YouTube la canción que recomendó
 * la IA (clip.musicQuery) y la aplica en el minuto sugerido (musicSuggestedSection), sin que el
 * usuario tenga que buscarla ni pegar ningún enlace — ver autoApplyRecommendedMusic.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const clip = await db.clip.findUnique({ where: { id: params.id } });
  if (!clip) {
    return NextResponse.json({ error: "Clip no encontrado" }, { status: 404 });
  }

  try {
    await autoApplyRecommendedMusic(clip.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
