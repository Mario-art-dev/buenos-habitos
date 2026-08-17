import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { uploadPartPath } from "@/lib/storagePaths";

export const dynamic = "force-dynamic";

const UPLOAD_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

/**
 * Recibe un trozo de un vídeo que se está subiendo en partes (ver /api/jobs/upload/finalize).
 * Cada trozo se añade al final del archivo en curso; el cliente debe enviarlos en orden.
 */
export async function POST(req: NextRequest) {
  const uploadId = req.nextUrl.searchParams.get("uploadId") ?? "";
  if (!UPLOAD_ID_RE.test(uploadId)) {
    return NextResponse.json({ error: "uploadId inválido" }, { status: 400 });
  }

  const buffer = Buffer.from(await req.arrayBuffer());
  if (buffer.length === 0) {
    return NextResponse.json({ error: "Trozo vacío" }, { status: 400 });
  }

  fs.appendFileSync(uploadPartPath(uploadId), buffer);

  return NextResponse.json({ ok: true, bytesReceived: buffer.length });
}
