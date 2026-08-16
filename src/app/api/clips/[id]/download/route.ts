import fs from "fs";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const clip = await db.clip.findUnique({ where: { id: params.id } });
  if (!clip || !clip.filePath || !fs.existsSync(clip.filePath)) {
    return NextResponse.json({ error: "El short todavía no está listo" }, { status: 404 });
  }

  const stat = fs.statSync(clip.filePath);
  const filename = `${slugify(clip.title) || "short"}.mp4`;
  const stream = fs.createReadStream(clip.filePath);

  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
