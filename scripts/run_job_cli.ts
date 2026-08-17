/**
 * Entrada sin servidor para GitHub Actions: crea un job directamente en la base de datos
 * local y ejecuta el mismo pipeline que usa la web (src/lib/pipeline/runPipeline.ts), sin
 * necesitar Next.js ni un servidor encendido. Al terminar, copia los vídeos y sus metadatos
 * a ./output para que el workflow los suba como artifact descargable.
 */
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { processJob } from "@/lib/pipeline/runPipeline";
import { productAssetPath } from "@/lib/storagePaths";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

async function downloadToFile(url: string, outPath: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get("content-type");
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buffer);
  return contentType;
}

function extFromUrlOrType(url: string, contentType: string | null): string {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  if (contentType?.includes("mp4")) return "mp4";
  if (contentType?.includes("quicktime")) return "mov";
  const match = url.split("?")[0].match(/\.([a-zA-Z0-9]{2,5})$/);
  return match ? match[1].toLowerCase() : "jpg";
}

async function buildJobData(): Promise<Record<string, unknown>> {
  const mode = env("JOB_MODE") || "SINGLE";

  if (mode === "SINGLE" || mode === "RANKING") {
    const sourceUrl = env("SOURCE_URL");
    if (!sourceUrl) throw new Error(`Falta SOURCE_URL para el modo ${mode}.`);
    return { mode, sourceUrl, status: "PENDING" };
  }

  if (mode === "SONG") {
    const sourceUrl = env("SOURCE_URL");
    const songUrl = env("SONG_URL");
    if (!sourceUrl || !songUrl) throw new Error("Faltan SOURCE_URL y/o SONG_URL para el modo SONG.");
    return { mode, sourceUrl, songUrl, status: "PENDING" };
  }

  if (mode === "PRODUCT") {
    const productName = env("PRODUCT_NAME");
    if (!productName) throw new Error("Falta PRODUCT_NAME para el modo PRODUCT.");
    return {
      mode,
      productName,
      productLink: env("PRODUCT_LINK") || null,
      referenceAdUrl: env("REFERENCE_AD_URL") || null,
      status: "PENDING",
    };
  }

  throw new Error(`Modo desconocido: "${mode}". Usa SINGLE, RANKING, PRODUCT o SONG.`);
}

async function attachProductImageUrls(jobId: string): Promise<void> {
  const raw = env("PRODUCT_IMAGE_URLS");
  const urls = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      const tmpPath = path.join(process.cwd(), `_tmp_asset_${i}`);
      const contentType = await downloadToFile(url, tmpPath);
      const ext = extFromUrlOrType(url, contentType);
      const finalPath = productAssetPath(jobId, i, ext);
      fs.renameSync(tmpPath, finalPath);
      const type = ext === "mp4" || ext === "mov" ? "video" : "image";
      await db.productAsset.create({ data: { jobId, filePath: finalPath, type, order: i } });
      console.log(`[cli] Foto/vídeo de producto ${i + 1}/${urls.length} descargada.`);
    } catch (err) {
      console.error(`[cli] No se pudo descargar "${url}": ${(err as Error).message}`);
    }
  }
}

function writeOutputs(outDir: string, clips: Awaited<ReturnType<typeof db.clip.findMany>>): number {
  let written = 0;
  for (const clip of clips) {
    if (clip.status !== "READY" || !clip.filePath) continue;
    const baseName = `clip_${clip.rank}`;
    fs.copyFileSync(clip.filePath, path.join(outDir, `${baseName}.mp4`));
    if (clip.thumbnailPath && fs.existsSync(clip.thumbnailPath)) {
      fs.copyFileSync(clip.thumbnailPath, path.join(outDir, `${baseName}.jpg`));
    }

    let hashtags: string[] = [];
    try {
      hashtags = JSON.parse(clip.hashtags || "[]");
    } catch {
      hashtags = [];
    }

    const lines = [
      `Título: ${clip.title}`,
      "",
      "Descripción:",
      clip.description,
      "",
      `Hashtags: ${hashtags.map((h) => `#${h}`).join(" ")}`,
      "",
      `Probabilidad de viralidad: ${clip.viralityScore}/100`,
      `Por qué: ${clip.viralityReason}`,
    ];
    if (clip.affiliateLink) lines.push("", `Enlace de afiliado (añádelo en la descripción): ${clip.affiliateLink}`);
    if (clip.commentaryIntro) lines.push("", `Comentario intro narrado: "${clip.commentaryIntro}"`);
    if (clip.commentaryOutro) lines.push(`Comentario cierre narrado: "${clip.commentaryOutro}"`);

    fs.writeFileSync(path.join(outDir, `${baseName}.txt`), lines.join("\n"), "utf-8");
    written++;
  }
  return written;
}

async function main(): Promise<void> {
  const jobData = await buildJobData();
  const job = await db.job.create({ data: jobData as never });
  console.log(`[cli] Job creado: ${job.id} (modo ${job.mode})`);

  if (job.mode === "PRODUCT") {
    await attachProductImageUrls(job.id);
  }

  await processJob(job.id);

  const finished = await db.job.findUniqueOrThrow({ where: { id: job.id }, include: { clips: true } });

  const outDir = path.resolve(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const written = writeOutputs(outDir, finished.clips);

  if (finished.status === "FAILED") {
    fs.writeFileSync(path.join(outDir, "ERROR.txt"), finished.error ?? "Error desconocido", "utf-8");
    console.error(`[cli] El trabajo falló: ${finished.error}`);
  }

  console.log(`[cli] Listo. ${written} clip(s) escritos en ./output.`);
  if (written === 0 && finished.status !== "FAILED") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[cli] Error fatal:", err);
  process.exitCode = 1;
});
