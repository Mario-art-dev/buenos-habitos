import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { productAssetPath } from "@/lib/storagePaths";
import { assertStorageNotBlocked } from "@/lib/storageQuota";

export const dynamic = "force-dynamic";

const MAX_FILES = 8;
const MAX_FILE_BYTES = 60 * 1024 * 1024;

function extFromMime(mime: string, fallbackName: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "video/mp4") return "mp4";
  if (mime === "video/quicktime") return "mov";
  const fromName = fallbackName.split(".").pop();
  return fromName && fromName.length <= 5 ? fromName.toLowerCase() : "bin";
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Crea un job del modo Producto (multipart): nombre + enlace de afiliado opcional + fotos/vídeos subidos. */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  }

  const productName = String(form.get("productName") ?? "").trim();
  const productLink = String(form.get("productLink") ?? "").trim() || null;
  const referenceAdUrl = String(form.get("referenceAdUrl") ?? "").trim() || null;

  if (!productName) {
    return NextResponse.json({ error: "Indica el nombre del producto" }, { status: 400 });
  }
  if (productLink && !isValidUrl(productLink)) {
    return NextResponse.json({ error: "El enlace del producto no es una URL válida" }, { status: 400 });
  }
  if (referenceAdUrl && !isValidUrl(referenceAdUrl)) {
    return NextResponse.json({ error: "El enlace del anuncio de referencia no es una URL válida" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0 && !productLink) {
    return NextResponse.json(
      { error: "Sube al menos una foto/vídeo del producto o indica el enlace del producto" },
      { status: 400 }
    );
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Máximo ${MAX_FILES} archivos` }, { status: 400 });
  }
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `"${f.name}" supera el tamaño máximo (60MB)` }, { status: 400 });
    }
    if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) {
      return NextResponse.json({ error: `"${f.name}" no es una imagen ni un vídeo` }, { status: 400 });
    }
  }

  try {
    await assertStorageNotBlocked();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 507 });
  }

  const job = await db.job.create({
    data: { mode: "PRODUCT", productName, productLink, referenceAdUrl, status: "PENDING" },
  });

  let order = 0;
  for (const file of files) {
    const ext = extFromMime(file.type, file.name);
    const outPath = productAssetPath(job.id, order, ext);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(outPath, buffer);
    await db.productAsset.create({
      data: {
        jobId: job.id,
        filePath: outPath,
        type: file.type.startsWith("video/") ? "video" : "image",
        order,
      },
    });
    order++;
  }

  return NextResponse.json({ job }, { status: 201 });
}
