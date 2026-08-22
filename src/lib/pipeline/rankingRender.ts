import fs from "fs";
import type { TranscriptSegment } from "./transcribe";
import { probeVideo, type VerticalResolution } from "./probe";
import { cutVerticalClip, renderTitleCard, concatClips, mixBackgroundMusic, extractThumbnail, extractAudioSegment } from "./clip";
import { renderRankingIntroCard } from "./rankingIntroCard";
import { renderCommentaryCard } from "./commentaryCards";
import { buildBigCaptionsAss } from "./bigCaptions";
import { getTTSProvider } from "@/lib/tts/provider";
import {
  candidateSubClipPath,
  candidateCardPath,
  clipAssembledPath,
  clipVideoPath,
  clipThumbnailPath,
  bigCaptionsPath,
  musicSegmentPath,
  narrationAudioPath,
} from "@/lib/storagePaths";
import { run } from "./exec";
import { config } from "@/lib/config";

export interface RenderRankingItem {
  position: number; // 1 = mejor
  startSec: number;
  endSec: number;
  label: string;
  commentary?: string | null;
}

/**
 * Monta el vídeo de ranking completo: tarjeta de título + por cada puesto (del peor al mejor)
 * una tarjeta con el número y el clip correspondiente con subtítulos quemados.
 * Devuelve la ruta del vídeo montado SIN música (clipAssembledPath).
 */
export async function assembleRankingVideo(params: {
  jobId: string;
  clipId: string;
  sourcePath: string;
  category: string;
  overallIntroCommentary?: string | null;
  overallOutroCommentary?: string | null;
  items: RenderRankingItem[]; // ya ordenados de mejor a peor (position 1..N)
  transcriptSegments: TranscriptSegment[];
  resolution: VerticalResolution;
  // Subtítulos grandes por puesto: activados por defecto, editable desde el editor (regenerar).
  captionsEnabled?: boolean;
  // Imagen propia subida desde la fototeca para la tarjeta de intro, en vez del fondo negro.
  coverImagePath?: string | null;
}): Promise<string> {
  const { jobId, clipId, sourcePath, category, items, transcriptSegments, resolution } = params;
  const captionsEnabled = params.captionsEnabled ?? true;
  const playOrder = [...items].sort((a, b) => b.position - a.position); // peor -> mejor

  const segmentPaths: string[] = [];

  // Tarjeta de intro con la plantilla fija "Ranking Funniest {Category} Moments" (fuente/colores
  // pedidos a partir de una captura real de referencia) — se añade SIEMPRE, a diferencia de la
  // vieja tarjeta de título libre de la IA, que solo se añadía con el comentario activado porque
  // un título corto/en minúsculas podía verse como una palabra suelta gigante sobre negro. Esa
  // plantilla es fija y controlada, así que ese riesgo ya no existe.
  const introPath = candidateCardPath(jobId, clipId, "intro");
  if (config.commentary.enabled && params.overallIntroCommentary) {
    const introAudioPath = narrationAudioPath(jobId, clipId, "intro");
    await getTTSProvider().synthesize(params.overallIntroCommentary, introAudioPath);
    await renderRankingIntroCard(introPath, category, 2, resolution, introAudioPath, params.coverImagePath);
  } else {
    await renderRankingIntroCard(introPath, category, 2, resolution, undefined, params.coverImagePath);
  }
  segmentPaths.push(introPath);

  for (const item of playOrder) {
    const cardPath = candidateCardPath(jobId, clipId, `pos${item.position}`);
    const cardText = `#${item.position}\n${item.label}`;
    if (item.commentary) {
      const itemAudioPath = narrationAudioPath(jobId, clipId, `pos${item.position}`);
      await getTTSProvider().synthesize(item.commentary, itemAudioPath);
      await renderTitleCard(cardPath, cardText, 1.4, resolution, itemAudioPath);
    } else {
      await renderTitleCard(cardPath, cardText, 1.4, resolution);
    }
    segmentPaths.push(cardPath);

    const subPath = candidateSubClipPath(jobId, clipId, item.position);
    const assContent = captionsEnabled ? buildBigCaptionsAss(transcriptSegments, item.startSec, item.endSec, resolution) : null;
    let bigCaptionsFile: string | undefined;
    if (assContent) {
      bigCaptionsFile = bigCaptionsPath(jobId, clipId, item.position);
      fs.writeFileSync(bigCaptionsFile, assContent);
    }

    // El número de puesto ya se ve en la tarjeta "#N" que precede a este segmento (arriba);
    // repetirlo en grande sobre el propio vídeo quedaba fuera de lugar y no aportaba nada.
    await cutVerticalClip({
      sourcePath,
      outPath: subPath,
      startSec: item.startSec,
      endSec: item.endSec,
      resolution,
      bigCaptionsPath: bigCaptionsFile,
      dynamicZoom: config.dynamicZoom.enabled,
    });
    segmentPaths.push(subPath);
  }

  // Tarjeta de cierre narrada con la opinión final, si el comentario está activado.
  if (params.overallOutroCommentary) {
    const outroPath = await renderCommentaryCard({
      jobId,
      clipId,
      key: "outro",
      text: params.overallOutroCommentary,
      resolution,
    });
    segmentPaths.push(outroPath);
  }

  const assembledPath = clipAssembledPath(jobId, clipId);
  await concatClips(segmentPaths, assembledPath);

  // limpieza de archivos temporales de este clip
  for (const p of segmentPaths) {
    fs.rmSync(p, { force: true });
  }

  return assembledPath;
}

/** Copia el vídeo montado como archivo final descargable/publicable (sin música). */
export async function finalizeWithoutMusic(jobId: string, clipId: string): Promise<{ filePath: string; thumbnailPath: string }> {
  const assembledPath = clipAssembledPath(jobId, clipId);
  const finalPath = clipVideoPath(jobId, clipId);
  fs.copyFileSync(assembledPath, finalPath);
  const thumbPath = clipThumbnailPath(jobId, clipId);
  await extractThumbnail(finalPath, thumbPath, 2.2);
  return { filePath: finalPath, thumbnailPath: thumbPath };
}

/**
 * Descarga el vídeo de YouTube que contiene la canción elegida, extrae el fragmento indicado,
 * y remezcla el vídeo de ranking ya montado con esa música de fondo.
 */
export async function applyMusicFromYouTube(params: {
  jobId: string;
  clipId: string;
  musicSourceUrl: string;
  startSec: number;
}): Promise<{ filePath: string; thumbnailPath: string }> {
  const { jobId, clipId, musicSourceUrl, startSec } = params;
  const assembledPath = clipAssembledPath(jobId, clipId);
  if (!fs.existsSync(assembledPath)) {
    throw new Error("El vídeo de ranking todavía no está montado.");
  }

  const rawAudioPath = `${musicSegmentPath(jobId, clipId)}.source.m4a`;
  await run(config.ytdlpPath, [
    musicSourceUrl,
    "-f",
    "bestaudio",
    "--extract-audio",
    "--audio-format",
    "m4a",
    "-o",
    rawAudioPath,
  ]);

  const finalPath = clipVideoPath(jobId, clipId);
  const { durationSec } = await probeVideo(assembledPath);
  const segmentPath = musicSegmentPath(jobId, clipId);
  await extractAudioSegment(rawAudioPath, startSec, durationSec, segmentPath);
  await mixBackgroundMusic(assembledPath, segmentPath, finalPath);

  fs.rmSync(rawAudioPath, { force: true });

  const thumbPath = clipThumbnailPath(jobId, clipId);
  await extractThumbnail(finalPath, thumbPath, 2.2);
  return { filePath: finalPath, thumbnailPath: thumbPath };
}
