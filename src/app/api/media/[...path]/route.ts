import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { resolveMediaPath, STORAGE_ROOT } from "@/lib/storagePaths";

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const filePath = resolveMediaPath(params.path);
  const resolved = path.resolve(filePath);

  if (!resolved.startsWith(path.resolve(STORAGE_ROOT))) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 400 });
  }
  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const stat = fs.statSync(resolved);
  const range = req.headers.get("range");

  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    const start = match ? Number(match[1]) : 0;
    const end = match && match[2] ? Number(match[2]) : stat.size - 1;
    const chunkSize = end - start + 1;

    const stream = fs.createReadStream(resolved, { start, end });
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunkSize),
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const stream = fs.createReadStream(resolved);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
