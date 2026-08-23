import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sourceVideoPath, uploadPartPath } from "@/lib/storagePaths";

export const dynamic = "force-dynamic";

// Solo modo RANKING: secciones que el usuario pide expresamente antes de generar (ver
// Job.manualCategories / rankingAnalyze.ts groupIntoRankings).
const manualCategorySchema = z.array(z.object({ name: z.string().trim().min(1).max(60), type: z.enum(["TOPIC", "YOUTUBER"]) })).max(20);

const UPLOAD_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;
// Generoso: de sobra para una recopilación larga a calidad razonable, subida en trozos.
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Junta los trozos ya recibidos en /api/jobs/upload/chunk y crea el job SINGLE o RANKING
 * correspondiente — alternativa a pegar un enlace cuando YouTube bloquea la descarga desde la
 * IP del servidor. Al trocear la subida se esquiva el límite de ~100MB por petición del túnel
 * gratuito, así que sí caben vídeos largos (p.ej. una recopilación de una hora).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  }

  const { uploadId, mode, filename, splitDurationSec, manualCategories } = body as {
    uploadId?: string;
    mode?: string;
    filename?: string;
    splitDurationSec?: number;
    manualCategories?: { name: string; type: "TOPIC" | "YOUTUBER" }[];
  };

  if (!uploadId || !UPLOAD_ID_RE.test(uploadId)) {
    return NextResponse.json({ error: "uploadId inválido" }, { status: 400 });
  }
  if (mode !== "SINGLE" && mode !== "RANKING" && mode !== "SPLIT") {
    return NextResponse.json({ error: "Modo no válido" }, { status: 400 });
  }
  if (mode === "SPLIT" && splitDurationSec != null && (splitDurationSec < 15 || splitDurationSec > 600)) {
    return NextResponse.json({ error: "Duración de trozo no válida" }, { status: 400 });
  }
  const parsedManualCategories = mode === "RANKING" && manualCategories ? manualCategorySchema.safeParse(manualCategories) : null;
  if (parsedManualCategories && !parsedManualCategories.success) {
    return NextResponse.json({ error: "Secciones de ranking no válidas" }, { status: 400 });
  }

  const partPath = uploadPartPath(uploadId);
  if (!fs.existsSync(partPath)) {
    return NextResponse.json({ error: "No se recibió ningún trozo de vídeo para esta subida" }, { status: 400 });
  }

  const { size } = fs.statSync(partPath);
  if (size === 0) {
    fs.rmSync(partPath, { force: true });
    return NextResponse.json({ error: "El vídeo subido está vacío" }, { status: 400 });
  }
  if (size > MAX_FILE_BYTES) {
    fs.rmSync(partPath, { force: true });
    return NextResponse.json(
      { error: `El vídeo supera el tamaño máximo (~${Math.floor(MAX_FILE_BYTES / 1024 / 1024 / 1024)}GB)` },
      { status: 400 }
    );
  }

  const job = await db.job.create({
    data: {
      mode,
      sourceTitle: filename || "Vídeo subido",
      status: "PENDING",
      ...(mode === "SPLIT" && { splitDurationSec: splitDurationSec ?? 60 }),
      ...(parsedManualCategories?.success &&
        parsedManualCategories.data.length > 0 && { manualCategories: JSON.stringify(parsedManualCategories.data) }),
    },
  });

  const outPath = sourceVideoPath(job.id);
  fs.renameSync(partPath, outPath);

  const updated = await db.job.update({ where: { id: job.id }, data: { sourceFilePath: outPath } });

  return NextResponse.json({ job: updated }, { status: 201 });
}
