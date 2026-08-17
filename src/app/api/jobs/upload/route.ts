import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sourceVideoPath } from "@/lib/storagePaths";

export const dynamic = "force-dynamic";

// El túnel gratuito (Cloudflare, sin cuenta) corta las subidas en torno a 100MB.
const MAX_FILE_BYTES = 95 * 1024 * 1024;

/**
 * Crea un job SINGLE o RANKING a partir de un vídeo subido directamente desde el dispositivo,
 * sin pasar por yt-dlp — alternativa cuando YouTube bloquea las descargas desde la IP del
 * servidor ("Sign in to confirm you're not a bot").
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  }

  const mode = String(form.get("mode") ?? "SINGLE");
  if (mode !== "SINGLE" && mode !== "RANKING") {
    return NextResponse.json({ error: "Modo no válido" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Sube un archivo de vídeo" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `El vídeo supera el tamaño máximo (~${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB)` },
      { status: 400 }
    );
  }
  if (!file.type.startsWith("video/")) {
    return NextResponse.json({ error: "El archivo no es un vídeo" }, { status: 400 });
  }

  const job = await db.job.create({
    data: { mode, sourceTitle: file.name, status: "PENDING" },
  });

  const outPath = sourceVideoPath(job.id);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(outPath, buffer);

  const updated = await db.job.update({ where: { id: job.id }, data: { sourceFilePath: outPath } });

  return NextResponse.json({ job: updated }, { status: 201 });
}
