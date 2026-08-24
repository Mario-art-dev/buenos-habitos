import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sourceVideoPath, songAudioPath, uploadPartPath } from "@/lib/storagePaths";
import { assertStorageNotBlocked } from "@/lib/storageQuota";

export const dynamic = "force-dynamic";

const UPLOAD_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

const createSongJobSchema = z
  .object({
    sourceUrl: z.string().url().optional(),
    sourceUploadId: z.string().regex(UPLOAD_ID_RE).optional(),
    songUrl: z.string().url().optional(),
    songUploadId: z.string().regex(UPLOAD_ID_RE).optional(),
  })
  .refine((d) => d.sourceUrl || d.sourceUploadId, {
    message: "Falta el vídeo de recopilación (enlace o archivo subido)",
  })
  .refine((d) => d.songUrl || d.songUploadId, { message: "Falta la canción (enlace o archivo subido)" });

/** Mueve un archivo ya subido en trozos (ver /api/jobs/upload/chunk) a su ruta final dentro del job. */
function consumeUpload(uploadId: string, destPath: string): void {
  const partPath = uploadPartPath(uploadId);
  if (!fs.existsSync(partPath)) {
    throw new Error("No se recibió ningún trozo de vídeo para esa subida");
  }
  fs.renameSync(partPath, destPath);
}

/** Crea un job del modo Canción: recopilación existente + canción con la que resincronizar los cortes. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createSongJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const { sourceUrl, sourceUploadId, songUrl, songUploadId } = parsed.data;

  try {
    await assertStorageNotBlocked();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 507 });
  }

  const job = await db.job.create({
    data: {
      mode: "SONG",
      sourceUrl: sourceUploadId ? null : sourceUrl,
      // songUrl subido como archivo: se guarda solo el archivo (más abajo), songUrl se deja vacío
      // porque songPipeline.ts espera una URL de YouTube ahí (descarga solo audio con yt-dlp) —
      // un archivo subido ya es un vídeo/audio local, se guarda directamente como songAudioPath.
      songUrl: songUploadId ? null : songUrl,
      status: "PENDING",
    },
  });

  try {
    const data: { sourceFilePath?: string; sourceTitle?: string } = {};
    if (sourceUploadId) {
      const dest = sourceVideoPath(job.id);
      consumeUpload(sourceUploadId, dest);
      data.sourceFilePath = dest;
      data.sourceTitle = "Vídeo subido";
    }
    if (songUploadId) {
      consumeUpload(songUploadId, songAudioPath(job.id));
    }
    const updated = Object.keys(data).length > 0 ? await db.job.update({ where: { id: job.id }, data }) : job;
    return NextResponse.json({ job: updated }, { status: 201 });
  } catch (err) {
    await db.job.delete({ where: { id: job.id } }).catch(() => {});
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
