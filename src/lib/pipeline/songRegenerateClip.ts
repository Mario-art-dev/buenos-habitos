import fs from "fs";
import { db } from "@/lib/db";
import {
  sourceVideoPath,
  songAudioPath,
  songSegmentPath,
  songSilentAssemblyPath,
  clipVideoPath,
  clipThumbnailPath,
  customTextPath as customTextAssPath,
} from "@/lib/storagePaths";
import { cutVerticalClip, concatClips, replaceAudioTrack, applyCustomTextOverlay, extractThumbnail } from "./clip";
import { buildCustomTextAss, type CustomTextElement } from "./bigCaptions";
import { probeVideo, pickVerticalResolution } from "./probe";

/**
 * Reconstruye un clip de SONG (montaje al ritmo de una canción): vuelve a cortar los mismos
 * tramos ya elegidos (guardados en songSegments al generar por primera vez, no hace falta repetir
 * la detección de momentos ni el análisis de ritmo) y sustituye el audio por la canción guardada.
 * El texto personalizado se quema como pasada final sobre el resultado ya montado. No admite
 * recorte (los tramos están sincronizados a los golpes de la canción; acortarlos rompería el
 * ritmo) ni subtítulos (el audio original del vídeo se sustituye por la canción).
 */
export async function regenerateSongClip(clipId: string): Promise<void> {
  const clip = await db.clip.findUniqueOrThrow({ where: { id: clipId }, include: { job: true } });
  const jobId = clip.jobId;
  const srcPath = clip.job.sourceFilePath ?? sourceVideoPath(jobId);
  const songPath = songAudioPath(jobId);
  if (!fs.existsSync(srcPath) || !fs.existsSync(songPath)) {
    throw new Error(
      "El vídeo o la canción ya no están disponibles en el servidor (puede haberse reiniciado la sesión). No se puede regenerar este clip."
    );
  }
  if (!clip.songSegments) {
    throw new Error("Este montaje se generó antes de guardar los tramos — no se puede regenerar (haz uno nuevo para poder editarlo).");
  }

  const segments: { startSec: number; endSec: number }[] = JSON.parse(clip.songSegments);
  const sourceInfo = await probeVideo(srcPath);
  const resolution = pickVerticalResolution(sourceInfo);

  const outPath = clipVideoPath(jobId, clip.id);
  const thumbPath = clipThumbnailPath(jobId, clip.id);
  const silentPath = songSilentAssemblyPath(jobId, clip.id);
  const customTexts: CustomTextElement[] = JSON.parse(clip.customTexts || "[]");
  const customTextFilePath = customTextAssPath(jobId, clip.id);
  const segmentPaths: string[] = segments.map((_, i) => songSegmentPath(jobId, clip.id, i));

  try {
    for (let i = 0; i < segments.length; i++) {
      await cutVerticalClip({
        sourcePath: srcPath,
        outPath: segmentPaths[i],
        startSec: segments[i].startSec,
        endSec: segments[i].endSec,
        resolution,
        muted: true,
      });
    }

    await concatClips(segmentPaths, silentPath);
    await replaceAudioTrack(silentPath, songPath, outPath, 0);

    const ass = customTexts.length > 0 ? buildCustomTextAss(customTexts, resolution) : null;
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
    for (const p of [...segmentPaths, silentPath, customTextFilePath]) {
      try {
        fs.rmSync(p, { force: true });
      } catch {
        // ignorar
      }
    }
  }
}
