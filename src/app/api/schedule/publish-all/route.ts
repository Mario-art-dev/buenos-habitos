import { NextResponse } from "next/server";
import { scheduleAllReadyClips } from "@/lib/schedule/scheduler";

export const dynamic = "force-dynamic";

/**
 * Botón "Publicar todos" de la Galería: programa TODOS los shorts listos y aún no publicados,
 * repartidos cada hora en punto (2 por hora) en las plataformas conectadas — ver
 * scheduleAllReadyClips en scheduler.ts.
 */
export async function POST() {
  try {
    const result = await scheduleAllReadyClips();
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
