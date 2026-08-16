import fs from "fs";
import type { TranscriptSegment } from "./transcribe";
import { probeVideo, type VerticalResolution } from "./probe";
import { cutVerticalClip, renderTitleCard, concatClips, mixBackgroundMusic, extractThumbnail, extractAudioSegment } from "./clip";
import { renderCommentaryCard } from "./commentaryCards";
import { getTTSProvider } from "@/lib/tts/provider";
import {
  candidateSubClipPath,
  candidateCardPath,
  clipAssembledPath,
  clipVideoPath,
  clipThumbnailPath,
  srtPath,
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

function srtTime(sec: number): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rem = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(rem).padStart(3, "0")}`;
}

function buildSrt(segments: TranscriptSegment[], itemStart: number, itemEnd: number): string | null {
  const overlapping = segments
    .filter((s) => s.end > itemStart && s.start < itemEnd)
    .map((s) => ({ start: Math.max(0, s.start - itemStart), end: Math.min(itemEnd - itemStart, s.end - itemStart), text: s.text.trim() }))
    .filter((s) => s.text && s.end > s.start);

  if (overlapping.length === 0) return null;

  return overlapping
    .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`)
    .join("\n");
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
  overallTitle: string;
  overallIntroCommentary?: string | null;
  overallOutroCommentary?: string | null;
  items: RenderRankingItem[]; // ya ordenados de mejor a peor (position 1..N)
  transcriptSegments: TranscriptSegment[];
  resolution: VerticalResolution;
}): Promise<string> {
  const { jobId, clipId, sourcePath, overallTitle, items, transcriptSegments, resolution } = params;
  const playOrder = [...items].sort((a, b) => b.position - a.position); // peor -> mejor

  const segmentPaths: string[] = [];

  // Tarjeta de título, narrada con el comentario de intro si el comentario está activado.
  const introPath = candidateCardPath(jobId, clipId, "intro");
  if (params.overallIntroCommentary) {
    const introAudioPath = narrationAudioPath(jobId, clipId, "intro");
    await getTTSProvider().synthesize(params.overallIntroCommentary, introAudioPath);
    await renderTitleCard(introPath, overallTitle, 2, resolution, introAudioPath);
  } else {
    await renderTitleCard(introPath, overallTitle, 2, resolution);
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
    const srtContent = buildSrt(transcriptSegments, item.startSec, item.endSec);
    let subtitlesFile: string | undefined;
    if (srtContent) {
      subtitlesFile = srtPath(jobId, clipId, item.position);
      fs.writeFileSync(subtitlesFile, srtContent);
    }

    await cutVerticalClip({
      sourcePath,
      outPath: subPath,
      startSec: item.startSec,
      endSec: item.endSec,
      resolution,
      label: `#${item.position}`,
      subtitlesPath: subtitlesFile,
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
