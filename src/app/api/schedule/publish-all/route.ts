import { NextResponse } from "next/server";
import { scheduleAllReadyClips } from "@/lib/schedule/scheduler";

export const dynamic = "force-dynamic";

/**
 * Botón "Configurar horarios" de la Galería: programa TODOS los shorts listos y aún no
 * publicados, repartidos equitativamente entre las 24 horas del día según cuántos haya ahora
 * mismo en la galería, en las plataformas conectadas — ver scheduleAllReadyClips en scheduler.ts.
 */
export async function POST() {
  try {
    const result = await scheduleAllReadyClips();
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
