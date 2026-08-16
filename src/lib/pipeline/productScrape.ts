import fs from "fs";
import { productAssetPath } from "@/lib/storagePaths";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Extrae URLs de imagen candidatas de un HTML: primero og:image / twitter:image, luego <img src>. */
function extractImageUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];

  const metaRegex = /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/gi;
  for (const match of html.matchAll(metaRegex)) {
    const contentMatch = match[0].match(/content=["']([^"']+)["']/i);
    if (contentMatch) urls.push(contentMatch[1]);
  }

  const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  for (const match of html.matchAll(imgRegex)) {
    urls.push(match[1]);
  }

  const resolved: string[] = [];
  for (const raw of urls) {
    try {
      const abs = new URL(raw, baseUrl).toString();
      if (abs.startsWith("http") && !resolved.includes(abs)) resolved.push(abs);
    } catch {
      // URL inválida, se ignora
    }
  }
  return resolved;
}

function looksLikeRealProductImage(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.endsWith(".svg")) return false;
  if (/(icon|logo|sprite|favicon|pixel|blank|1x1|spinner)/.test(lower)) return false;
  return true;
}

export interface ScrapedAsset {
  filePath: string;
  order: number;
}

/**
 * Intenta extraer fotos del producto a partir de su página web (best-effort, sin dependencias de
 * parsing HTML: usa regex sobre las etiquetas og:image/twitter:image e <img>). Se usa como
 * alternativa cuando el usuario no ha subido fotos/vídeos propios del producto.
 */
export async function scrapeProductImages(
  jobId: string,
  productUrl: string,
  maxImages = 5
): Promise<ScrapedAsset[]> {
  const pageRes = await fetch(productUrl, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!pageRes.ok) {
    throw new Error(`No se pudo abrir el enlace del producto (HTTP ${pageRes.status}).`);
  }
  const html = await pageRes.text();
  const candidates = extractImageUrls(html, productUrl).filter(looksLikeRealProductImage);

  if (candidates.length === 0) {
    throw new Error("No se encontraron imágenes en el enlace del producto.");
  }

  const assets: ScrapedAsset[] = [];
  let order = 0;
  for (const url of candidates) {
    if (assets.length >= maxImages) break;
    try {
      const imgRes = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!imgRes.ok) continue;
      const contentType = imgRes.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) continue;
      const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      if (buffer.byteLength < 4000) continue; // probablemente icono/pixel de tracking

      const outPath = productAssetPath(jobId, order, ext);
      fs.writeFileSync(outPath, buffer);
      assets.push({ filePath: outPath, order });
      order++;
    } catch {
      // fallo puntual descargando una imagen concreta: se ignora y se sigue con la siguiente
    }
  }

  if (assets.length === 0) {
    throw new Error("No se pudieron descargar imágenes válidas del enlace del producto.");
  }

  return assets;
}
