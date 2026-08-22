import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobCoverImagePath, toMediaUrl } from "@/lib/storagePaths";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 15 * 1024 * 1024;

function extFromMime(mime: string): string | null {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  return null;
}

/**
 * Sube la foto de portada del trabajo (al crear el vídeo, antes de que existan los clips): se
 * hereda como portada por defecto de TODOS los shorts que se generen a partir de este vídeo (con
 * el sonido de marca), en vez de un fotograma del propio vídeo — pedido explícito. Solo aplica a
 * los modos con portada de marca (SINGLE/SPLIT/RANKING); en los demás modos se guarda igualmente
 * (por si el trabajo cambia de modo) pero no se usa.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const job = await db.job.findUnique({ where: { id: params.id } });
  if (!job) {
    return NextResponse.json({ error: "Trabajo no encontrado" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Sube una imagen" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "La imagen pesa demasiado (máximo 15 MB)" }, { status: 400 });
  }
  const ext = extFromMime(file.type);
  if (!ext) {
    return NextResponse.json({ error: "Formato de imagen no soportado (usa JPG, PNG o WebP)" }, { status: 400 });
  }

  const outPath = jobCoverImagePath(job.id, ext);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(outPath, buffer);

  const updated = await db.job.update({ where: { id: job.id }, data: { coverImagePath: outPath } });
  return NextResponse.json({ coverImagePath: outPath, coverImageUrl: toMediaUrl(updated.coverImagePath) });
}

/** Quita la foto de portada del trabajo: los shorts que se generen a partir de ahora vuelven a usar un fotograma del propio vídeo. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const job = await db.job.findUnique({ where: { id: params.id } });
  if (!job) {
    return NextResponse.json({ error: "Trabajo no encontrado" }, { status: 404 });
  }
  if (job.coverImagePath) {
    fs.rmSync(job.coverImagePath, { force: true });
  }
  await db.job.update({ where: { id: job.id }, data: { coverImagePath: null } });
  return NextResponse.json({ ok: true });
}
