import fs from "fs";
import { db } from "@/lib/db";
import { getTTSProvider } from "@/lib/tts/provider";
import type { VerticalResolution } from "./probe";
import { renderImageSegment, renderProductVideoSegment, renderTitleCard, concatClips, extractThumbnail } from "./clip";
import { generateProductScript, type ProductAssetInput } from "./productCompose";
import { scrapeProductImages } from "./productScrape";
import { setStatus } from "./status";
import { clipVideoPath, clipThumbnailPath, tmpDir, narrationAudioPath, productSegmentPath } from "@/lib/storagePaths";

const SEGMENT_MIN_DURATION_SEC = 3;
const RESOLUTION: VerticalResolution = { width: 1080, height: 1920 };

/**
 * Monta un vídeo publicitario corto de un producto: fotos/vídeos subidos por el usuario (o
 * extraídos por scraping del enlace del producto si no sube nada), cada uno narrado por IA con
 * efecto Ken Burns en las fotos, envuelto en un gancho inicial y una llamada a la acción final
 * que menciona el enlace de afiliado.
 */
export async function processProductJob(jobId: string): Promise<void> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { productAssets: true } });
  if (!job.productName) throw new Error("Este trabajo no tiene nombre de producto.");

  try {
    let assets: ProductAssetInput[] = job.productAssets
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((a) => ({ filePath: a.filePath, type: a.type as "image" | "video", order: a.order }));

    if (assets.length === 0) {
      if (!job.productLink) {
        throw new Error("Sube fotos/vídeos del producto o indica un enlace del producto para extraer imágenes.");
      }
      await setStatus(jobId, "DOWNLOADING", "Buscando fotos del producto en el enlace…");
      const scraped = await scrapeProductImages(jobId, job.productLink);
      await db.productAsset.createMany({
        data: scraped.map((s) => ({ jobId, filePath: s.filePath, type: "image", order: s.order })),
      });
      assets = scraped.map((s) => ({ filePath: s.filePath, type: "image" as const, order: s.order }));
    }

    await setStatus(jobId, "ANALYZING", "La IA está escribiendo el guion del anuncio…");
    const script = await generateProductScript({
      jobId,
      productName: job.productName,
      productLink: job.productLink,
      referenceAdUrl: job.referenceAdUrl,
      assets,
    });

    const clip = await db.clip.create({
      data: {
        jobId,
        rank: 1,
        startSec: 0,
        endSec: 0,
        title: script.title,
        description: script.description,
        viralityScore: script.viralityScore,
        viralityReason: script.viralityReason,
        hashtags: JSON.stringify(script.hashtags),
        affiliateLink: job.productLink,
        // Se guarda el guion (hook/narración por foto/CTA) para poder regenerar el vídeo desde el
        // editor (tras añadir texto personalizado) sin volver a llamar a la IA — ver
        // productRegenerateClip.ts.
        productScript: JSON.stringify({ hook: script.hook, segmentScripts: script.segmentScripts, cta: script.cta }),
        status: "RENDERING",
      },
    });

    try {
      await setStatus(jobId, "CLIPPING", "Montando el vídeo publicitario…");
      const tts = getTTSProvider();
      const segmentPaths: string[] = [];

      const hookAudioPath = narrationAudioPath(jobId, clip.id, "hook");
      await tts.synthesize(script.hook, hookAudioPath);
      const hookCardPath = productSegmentPath(jobId, clip.id, "hook");
      await renderTitleCard(hookCardPath, script.hook, SEGMENT_MIN_DURATION_SEC, RESOLUTION, hookAudioPath, 11);
      segmentPaths.push(hookCardPath);

      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        const narration = script.segmentScripts[i] ?? "";
        const audioPath = narrationAudioPath(jobId, clip.id, `seg${i}`);
        await tts.synthesize(narration, audioPath);
        const outPath = productSegmentPath(jobId, clip.id, `seg${i}`);

        if (asset.type === "image") {
          await renderImageSegment({
            imagePath: asset.filePath,
            outPath,
            durationSec: SEGMENT_MIN_DURATION_SEC,
            resolution: RESOLUTION,
            caption: narration,
            audioPath,
            zoomDirection: i % 2 === 0 ? "in" : "out",
          });
        } else {
          await renderProductVideoSegment({
            sourcePath: asset.filePath,
            outPath,
            resolution: RESOLUTION,
            narrationAudioPath: audioPath,
          });
        }
        segmentPaths.push(outPath);
      }

      const ctaAudioPath = narrationAudioPath(jobId, clip.id, "cta");
      await tts.synthesize(script.cta, ctaAudioPath);
      const ctaCardPath = productSegmentPath(jobId, clip.id, "cta");
      await renderTitleCard(ctaCardPath, script.cta, SEGMENT_MIN_DURATION_SEC, RESOLUTION, ctaAudioPath, 11);
      segmentPaths.push(ctaCardPath);

      const outPath = clipVideoPath(jobId, clip.id);
      const thumbPath = clipThumbnailPath(jobId, clip.id);
      await concatClips(segmentPaths, outPath);
      await extractThumbnail(outPath, thumbPath);

      await db.clip.update({
        where: { id: clip.id },
        data: { status: "READY", filePath: outPath, thumbnailPath: thumbPath },
      });
    } catch (err) {
      await db.clip.update({
        where: { id: clip.id },
        data: { status: "FAILED", error: (err as Error).message },
      });
      throw err;
    }

    await setStatus(jobId, "DONE", "¡Listo! Revisa tu vídeo publicitario.");
  } catch (err) {
    const message = (err as Error).message;
    await db.job.update({ where: { id: jobId }, data: { status: "FAILED", error: message } });
    throw err;
  } finally {
    try {
      fs.rmSync(tmpDir(jobId), { recursive: true, force: true });
    } catch {
      // ignorar
    }
  }
}
