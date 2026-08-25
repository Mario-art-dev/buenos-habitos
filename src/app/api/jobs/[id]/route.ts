import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { jobDir, toMediaUrl } from "@/lib/storagePaths";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const job = await db.job.findUnique({
    where: { id: params.id },
    include: {
      clips: {
        orderBy: { rank: "asc" },
        include: { publications: true, rankingItems: { orderBy: { position: "desc" } } },
      },
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Job no encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    job: {
      ...job,
      clips: job.clips.map((clip) => ({
        ...clip,
        hashtags: JSON.parse(clip.hashtags || "[]"),
        videoUrl: toMediaUrl(clip.filePath),
        thumbnailUrl: toMediaUrl(clip.thumbnailPath),
      })),
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await db.job.delete({ where: { id: params.id } });
  fs.rmSync(jobDir(params.id), { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}

const editJobSchema = z.object({
  sourceUrl: z.string().url().optional(),
  bottomVideoUrl: z.string().url().optional(),
  songUrl: z.string().url().optional(),
  customTitle: z.string().max(200).optional(),
  splitDurationSec: z.number().int().min(5).max(600).optional(),
  doublePartsCount: z.number().int().min(1).max(50).optional(),
  productName: z.string().max(200).optional(),
  productLink: z.string().url().optional(),
  referenceAdUrl: z.string().url().optional(),
});

/**
 * Edita la información de un trabajo TODAVÍA EN COLA (no vale para uno ya DONE — sus clips ya se
 * generaron con la info de entonces, cambiarla ahora no tendría ningún efecto y solo confundiría).
 * Pedido explícito: poder corregir un enlace/título mal puesto antes de que le toque procesarse.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const job = await db.job.findUnique({ where: { id: params.id } });
  if (!job) {
    return NextResponse.json({ error: "Job no encontrado" }, { status: 404 });
  }
  if (job.status === "DONE") {
    return NextResponse.json({ error: "Este trabajo ya está terminado, no se puede editar" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = editJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }

  const updated = await db.job.update({ where: { id: params.id }, data: parsed.data });
  return NextResponse.json({ job: updated });
}
