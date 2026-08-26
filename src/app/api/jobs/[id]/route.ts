import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { jobDir, toMediaUrl, sourceVideoPath, bottomVideoPath, uploadPartPath } from "@/lib/storagePaths";

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
      coverImageUrl: toMediaUrl(job.coverImagePath),
      clips: job.clips.map((clip) => ({
        ...clip,
        hashtags: JSON.parse(clip.hashtags || "[]"),
        videoUrl: toMediaUrl(clip.filePath),
        thumbnailUrl: toMediaUrl(clip.thumbnailPath),
      })),
    },
  });
}

/**
 * Borrado "de papelera": la X junto al estado (ver JobList.tsx) o el botón Eliminar del detalle
 * borran los archivos de disco del trabajo (libera espacio) pero NO la fila de la base de datos —
 * se marca deletedAt en su lugar, para que deje de salir en todas las listas normales pero siga
 * apareciendo en /deleted como registro de lo que se ha borrado. Vale para cualquier estado
 * (listo, error o todavía en proceso) — pedido explícito.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const job = await db.job.findUnique({ where: { id: params.id } });
  if (!job) {
    return NextResponse.json({ error: "Job no encontrado" }, { status: 404 });
  }
  fs.rmSync(jobDir(params.id), { recursive: true, force: true });
  const updated = await db.job.update({
    where: { id: params.id },
    data: { deletedAt: new Date(), sourceFilePath: null, bottomVideoFilePath: null, coverImagePath: null },
  });
  return NextResponse.json({ ok: true, job: updated });
}

const UPLOAD_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

const manualCategorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(["TOPIC", "YOUTUBER"]),
});

const editJobSchema = z.object({
  sourceUrl: z.string().url().optional(),
  // Vídeo (o vídeo de arriba en modo DOUBLE) subido de nuevo desde el editor — ver
  // /api/jobs/upload/chunk. Sustituye al que hubiera antes (enlace o archivo).
  sourceUploadId: z.string().regex(UPLOAD_ID_RE).optional(),
  bottomVideoUrl: z.string().url().optional(),
  // Vídeo de ABAJO (modo DOUBLE) subido de nuevo — mismo mecanismo que sourceUploadId.
  bottomVideoUploadId: z.string().regex(UPLOAD_ID_RE).optional(),
  songUrl: z.string().url().optional(),
  customTitle: z.string().max(200).optional(),
  splitDurationSec: z.number().int().min(5).max(600).optional(),
  doublePartsCount: z.number().int().min(1).max(50).optional(),
  productName: z.string().max(200).optional(),
  productLink: z.string().url().optional(),
  referenceAdUrl: z.string().url().optional(),
  // Solo modo RANKING: secciones pedidas a mano (ver Job.manualCategories). Array vacío = quitar
  // todas las secciones y volver a que la IA elija las categorías sola.
  manualCategories: z.array(manualCategorySchema).max(20).optional(),
});

/** Mueve un archivo ya subido en trozos (ver /api/jobs/upload/chunk) a su ruta final dentro del job. */
function consumeUpload(uploadId: string, destPath: string): void {
  const partPath = uploadPartPath(uploadId);
  if (!fs.existsSync(partPath)) {
    throw new Error("No se recibió ningún trozo de vídeo para esa subida");
  }
  fs.renameSync(partPath, destPath);
}

/**
 * Edita la información de un trabajo TODAVÍA EN COLA (no vale para uno ya DONE — sus clips ya se
 * generaron con la info de entonces, cambiarla ahora no tendría ningún efecto y solo confundiría).
 * Pedido explícito: poder corregir cualquier campo (vídeo por enlace O por archivo subido, título,
 * secciones de ranking, etc.) antes de que le toque procesarse, o tras un error.
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
  const { sourceUploadId, bottomVideoUploadId, manualCategories, ...rest } = parsed.data;

  const data: Record<string, unknown> = { ...rest };
  if (manualCategories) {
    data.manualCategories = manualCategories.length > 0 ? JSON.stringify(manualCategories) : null;
  }
  // Editar un trabajo en error se entiende como "ya lo corregí, vuelve a intentarlo" — se manda
  // otra vez a la cola en vez de dejarlo en FAILED con el error viejo hasta que alguien pulse
  // Reintentar aparte.
  if (job.status === "FAILED") {
    data.status = "PENDING";
    data.error = null;
    data.statusMessage = "En cola tras editarlo…";
  }

  try {
    // Sustituir por un archivo subido de nuevo: se borra el anterior (si lo había) para no dejar
    // vídeos huérfanos ocupando espacio, y se limpia el enlace (si lo hubiera) para que
    // resolveSourceVideo() use el archivo nuevo y no el enlace viejo.
    if (sourceUploadId) {
      if (job.sourceFilePath) fs.rmSync(job.sourceFilePath, { force: true });
      const dest = sourceVideoPath(job.id);
      consumeUpload(sourceUploadId, dest);
      data.sourceFilePath = dest;
      data.sourceUrl = null;
      data.sourceTitle = "Vídeo subido";
    } else if (rest.sourceUrl && job.sourceFilePath) {
      // Sustituir un archivo subido por un enlace: se borra el archivo viejo, ya no se va a usar.
      fs.rmSync(job.sourceFilePath, { force: true });
      data.sourceFilePath = null;
    }

    if (bottomVideoUploadId) {
      if (job.bottomVideoFilePath) fs.rmSync(job.bottomVideoFilePath, { force: true });
      const dest = bottomVideoPath(job.id);
      consumeUpload(bottomVideoUploadId, dest);
      data.bottomVideoFilePath = dest;
      data.bottomVideoUrl = null;
    } else if (rest.bottomVideoUrl && job.bottomVideoFilePath) {
      fs.rmSync(job.bottomVideoFilePath, { force: true });
      data.bottomVideoFilePath = null;
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const updated = await db.job.update({ where: { id: params.id }, data });
  return NextResponse.json({ job: updated });
}
