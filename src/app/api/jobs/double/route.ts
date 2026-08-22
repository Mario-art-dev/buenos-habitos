import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sourceVideoPath, bottomVideoPath, uploadPartPath } from "@/lib/storagePaths";

export const dynamic = "force-dynamic";

const UPLOAD_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

const createDoubleJobSchema = z
  .object({
    topUrl: z.string().url().optional(),
    topUploadId: z.string().regex(UPLOAD_ID_RE).optional(),
    bottomUrl: z.string().url().optional(),
    bottomUploadId: z.string().regex(UPLOAD_ID_RE).optional(),
    partsCount: z.number().int().min(2).max(50),
  })
  .refine((d) => d.topUrl || d.topUploadId, { message: "Falta el vídeo de arriba (enlace o archivo subido)" })
  .refine((d) => d.bottomUrl || d.bottomUploadId, { message: "Falta el vídeo de abajo (enlace o archivo subido)" });

/** Mueve un archivo ya subido en trozos (ver /api/jobs/upload/chunk) a su ruta final dentro del job. */
function consumeUpload(uploadId: string, destPath: string): void {
  const partPath = uploadPartPath(uploadId);
  if (!fs.existsSync(partPath)) {
    throw new Error("No se recibió ningún trozo de vídeo para esa subida");
  }
  fs.renameSync(partPath, destPath);
}

/** Crea un job del modo Doble (pantalla dividida): vídeo de arriba a cortar + vídeo de abajo fijo. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createDoubleJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const { topUrl, topUploadId, bottomUrl, bottomUploadId, partsCount } = parsed.data;

  const job = await db.job.create({
    data: {
      mode: "DOUBLE",
      sourceUrl: topUploadId ? null : topUrl,
      bottomVideoUrl: bottomUploadId ? null : bottomUrl,
      doublePartsCount: partsCount,
      status: "PENDING",
    },
  });

  try {
    const data: { sourceFilePath?: string; bottomVideoFilePath?: string; sourceTitle?: string } = {};
    if (topUploadId) {
      const dest = sourceVideoPath(job.id);
      consumeUpload(topUploadId, dest);
      data.sourceFilePath = dest;
      data.sourceTitle = "Vídeo subido";
    }
    if (bottomUploadId) {
      const dest = bottomVideoPath(job.id);
      consumeUpload(bottomUploadId, dest);
      data.bottomVideoFilePath = dest;
    }
    const updated = Object.keys(data).length > 0 ? await db.job.update({ where: { id: job.id }, data }) : job;
    return NextResponse.json({ job: updated }, { status: 201 });
  } catch (err) {
    await db.job.delete({ where: { id: job.id } }).catch(() => {});
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
