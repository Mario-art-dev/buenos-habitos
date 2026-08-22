import fs from "fs";
import { db } from "@/lib/db";
import { getTTSProvider } from "@/lib/tts/provider";
import type { VerticalResolution } from "./probe";
import {
  renderImageSegment,
  renderProductVideoSegment,
  renderTitleCard,
  concatClips,
  extractThumbnail,
  applyCustomTextOverlay,
} from "./clip";
import { buildCustomTextAss, type CustomTextElement } from "./bigCaptions";
import {
  clipVideoPath,
  clipThumbnailPath,
  narrationAudioPath,
  productSegmentPath,
  customTextPath as customTextAssPath,
} from "@/lib/storagePaths";

const SEGMENT_MIN_DURATION_SEC = 3;
const RESOLUTION: VerticalResolution = { width: 1080, height: 1920 };

/**
 * Reconstruye un clip de PRODUCT: vuelve a montar el vídeo (gancho + una escena Ken Burns/vídeo
 * narrado por cada foto/vídeo del producto + llamada a la acción) a partir del guion ya generado
 * (productScript, guardado al crear el clip) y las fotos/vídeos ya guardados (productAssets) — no
 * repite la llamada a la IA que escribe el guion, así que el contenido no cambia entre
 * regeneraciones. El texto personalizado se quema como pasada final sobre el vídeo ya montado. No
 * admite recorte ni subtítulos independientes (la narración ya lleva su propio texto en pantalla,
 * ver script.segmentScripts) ni portada (PRODUCT nunca ha tenido).
 */
export async function regenerateProductClip(clipId: string): Promise<void> {
  const clip = await db.clip.findUniqueOrThrow({ where: { id: clipId }, include: { job: { include: { productAssets: true } } } });
  const jobId = clip.jobId;
  if (!clip.productScript) {
    throw new Error("Este vídeo se generó antes de guardar el guion — no se puede regenerar (haz uno nuevo para poder editarlo).");
  }
  const assets = clip.job.productAssets.slice().sort((a, b) => a.order - b.order);
  if (assets.length === 0) {
    throw new Error("Este trabajo ya no tiene fotos/vídeos del producto guardados, no se puede regenerar.");
  }

  const script: { hook: string; segmentScripts: string[]; cta: string } = JSON.parse(clip.productScript);
  const tts = getTTSProvider();
  const segmentPaths: string[] = [];

  const outPath = clipVideoPath(jobId, clip.id);
  const thumbPath = clipThumbnailPath(jobId, clip.id);
  const customTexts: CustomTextElement[] = JSON.parse(clip.customTexts || "[]");
  const customTextFilePath = customTextAssPath(jobId, clip.id);

  try {
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
      const segOutPath = productSegmentPath(jobId, clip.id, `seg${i}`);

      if (asset.type === "image") {
        await renderImageSegment({
          imagePath: asset.filePath,
          outPath: segOutPath,
          durationSec: SEGMENT_MIN_DURATION_SEC,
          resolution: RESOLUTION,
          caption: narration,
          audioPath,
          zoomDirection: i % 2 === 0 ? "in" : "out",
        });
      } else {
        await renderProductVideoSegment({
          sourcePath: asset.filePath,
          outPath: segOutPath,
          resolution: RESOLUTION,
          narrationAudioPath: audioPath,
        });
      }
      segmentPaths.push(segOutPath);
    }

    const ctaAudioPath = narrationAudioPath(jobId, clip.id, "cta");
    await tts.synthesize(script.cta, ctaAudioPath);
    const ctaCardPath = productSegmentPath(jobId, clip.id, "cta");
    await renderTitleCard(ctaCardPath, script.cta, SEGMENT_MIN_DURATION_SEC, RESOLUTION, ctaAudioPath, 11);
    segmentPaths.push(ctaCardPath);

    await concatClips(segmentPaths, outPath);

    const ass = customTexts.length > 0 ? buildCustomTextAss(customTexts, RESOLUTION) : null;
    if (ass) {
      fs.writeFileSync(customTextFilePath, ass, "utf-8");
      const withTextPath = `${outPath}.withtext.mp4`;
      await applyCustomTextOverlay(outPath, withTextPath, customTextFilePath);
      fs.renameSync(withTextPath, outPath);
    }

    await extractThumbnail(outPath, thumbPath);
    await db.clip.update({
      where: { id: clip.id },
      data: { filePath: outPath, thumbnailPath: thumbPath, status: "READY", error: null },
    });
  } finally {
    for (const p of [...segmentPaths, customTextFilePath]) {
      try {
        fs.rmSync(p, { force: true });
      } catch {
        // ignorar
      }
    }
  }
}
