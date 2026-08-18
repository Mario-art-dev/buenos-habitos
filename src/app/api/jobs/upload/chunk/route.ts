import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { uploadPartPath } from "@/lib/storagePaths";

export const dynamic = "force-dynamic";

const UPLOAD_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;
const INDEX_RE = /^\d+$/;
const CHUNK_SIZE = 20 * 1024 * 1024; // debe coincidir con CHUNK_SIZE de UrlForm.tsx

/**
 * Recibe un trozo de un vídeo que se está subiendo en partes (ver /api/jobs/upload/finalize).
 * Cada trozo se añade al final del archivo en curso; el cliente debe enviarlos en orden.
 *
 * El cliente reintenta solo si la respuesta se pierde por un fallo de red (túnel "frío"), lo que
 * puede pasar DESPUÉS de que el servidor ya haya escrito el trozo. Por eso este endpoint es
 * idempotente: si el archivo ya tiene bytes suficientes para este índice, no se vuelve a escribir.
 */
export async function POST(req: NextRequest) {
  const uploadId = req.nextUrl.searchParams.get("uploadId") ?? "";
  const indexParam = req.nextUrl.searchParams.get("index") ?? "";
  if (!UPLOAD_ID_RE.test(uploadId) || !INDEX_RE.test(indexParam)) {
    return NextResponse.json({ error: "uploadId o index inválido" }, { status: 400 });
  }

  const buffer = Buffer.from(await req.arrayBuffer());
  if (buffer.length === 0) {
    return NextResponse.json({ error: "Trozo vacío" }, { status: 400 });
  }

  const partPath = uploadPartPath(uploadId);
  const expectedStart = Number(indexParam) * CHUNK_SIZE;
  const currentSize = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;

  if (currentSize <= expectedStart) {
    fs.appendFileSync(partPath, buffer);
  }

  return NextResponse.json({ ok: true, bytesReceived: buffer.length });
}
