import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const createDoubleJobSchema = z.object({
  topUrl: z.string().url("Introduce la URL del vídeo de arriba"),
  bottomUrl: z.string().url("Introduce la URL del vídeo de abajo"),
  partsCount: z.number().int().min(2).max(50),
});

/** Crea un job del modo Doble (pantalla dividida): vídeo de arriba a cortar + vídeo de abajo fijo. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createDoubleJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }

  const job = await db.job.create({
    data: {
      mode: "DOUBLE",
      sourceUrl: parsed.data.topUrl,
      bottomVideoUrl: parsed.data.bottomUrl,
      doublePartsCount: parsed.data.partsCount,
      status: "PENDING",
    },
  });

  return NextResponse.json({ job }, { status: 201 });
}
