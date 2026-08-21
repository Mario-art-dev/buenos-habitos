import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { coverImageUploadPath, toMediaUrl } from "@/lib/storagePaths";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 15 * 1024 * 1024;

function extFromMime(mime: string): string | null {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  return null;
}

/** Sube una imagen propia (fototeca) para usarla como portada del clip, en vez del fotograma del vídeo. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const clip = await db.clip.findUnique({ where: { id: params.id } });
  if (!clip) {
    return NextResponse.json({ error: "Clip no encontrado" }, { status: 404 });
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

  const outPath = coverImageUploadPath(clip.jobId, clip.id, ext);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(outPath, buffer);

  const updated = await db.clip.update({ where: { id: clip.id }, data: { coverImagePath: outPath } });
  return NextResponse.json({ coverImagePath: outPath, coverImageUrl: toMediaUrl(updated.coverImagePath) });
}

/** Quita la imagen propia de portada: vuelve a usar el fotograma del vídeo por defecto. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const clip = await db.clip.findUnique({ where: { id: params.id } });
  if (!clip) {
    return NextResponse.json({ error: "Clip no encontrado" }, { status: 404 });
  }
  if (clip.coverImagePath) {
    fs.rmSync(clip.coverImagePath, { force: true });
  }
  await db.clip.update({ where: { id: clip.id }, data: { coverImagePath: null } });
  return NextResponse.json({ ok: true });
}
