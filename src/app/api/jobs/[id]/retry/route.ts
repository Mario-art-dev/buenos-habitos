import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Botón "Reintentar" de un trabajo en FAILED: lo vuelve a PENDING (limpiando el error) para que
 * el worker lo recoja de cero — mismo mecanismo que ya usa worker/index.ts al arrancar para
 * recuperar trabajos atascados a media sesión, aquí disparado a mano en vez de automáticamente.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const job = await db.job.findUnique({ where: { id: params.id } });
  if (!job) {
    return NextResponse.json({ error: "Job no encontrado" }, { status: 404 });
  }
  if (job.status !== "FAILED") {
    return NextResponse.json({ error: "Este trabajo no está en estado de error" }, { status: 400 });
  }

  const updated = await db.job.update({
    where: { id: params.id },
    data: { status: "PENDING", error: null, statusMessage: "Reintentando…" },
  });

  return NextResponse.json({ job: updated });
}
