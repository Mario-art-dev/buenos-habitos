import fs from "fs";
import type { TranscriptSegment } from "./transcribe";
import { probeVideo, type VerticalResolution } from "./probe";
import { cutVerticalClip, concatClips, mixBackgroundMusic, extractThumbnail, extractAudioSegment, renderTitleCard } from "./clip";
import { burnRankingOverlay, type RankingListItem, type RankingOverlayTemplate } from "./rankingListOverlay";
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
 * Monta el vídeo de ranking completo: los clips en orden (del peor al mejor), cada uno con
 * subtítulos quemados — sin tarjeta de título aparte al principio. El título del ranking y la
 * lista numerada de puestos (1.-, 2.-…) se queman APARTE, como una sola capa persistente encima
 * de TODO el vídeo ya montado (ver burnRankingOverlay) — pedido explícito: ambos se quedan fijos
 * en pantalla durante todo el vídeo, encima de los propios clips, en vez de una tarjeta de título
 * en negro al principio.
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
  // "TOPIC" (por defecto) -> "Ranking Funniest {category} Moments"; "YOUTUBER" -> "Best 5 {category}
  // Clips" (ver rankingAnalyze.ts groupIntoRankings / Job.manualCategories).
  templateType?: RankingOverlayTemplate;
}): Promise<string> {
  const { jobId, clipId, sourcePath, category, items, transcriptSegments, resolution } = params;
  const captionsEnabled = params.captionsEnabled ?? true;
  const templateType = params.templateType ?? "TOPIC";
  const playOrder = [...items].sort((a, b) => b.position - a.position); // peor -> mejor

  const segmentPaths: string[] = [];
  // Segundo (dentro del vídeo YA montado) en el que empieza el clip de cada puesto — se usa para
  // saber cuándo revelar su etiqueta en la lista persistente (burnRankingOverlay).
  const listItems: RankingListItem[] = [];
  let cursorSec = 0;

  // Comentario narrado de intro (opcional, ENABLE_COMMENTARY): tarjeta muda de audio (sin texto
  // visible — el título/lista persistentes ya se queman después encima de todo el vídeo, incluido
  // este tramo) para que se oiga la narración antes de que empiece el primer clip.
  if (config.commentary.enabled && params.overallIntroCommentary) {
    const introAudioPath = narrationAudioPath(jobId, clipId, "intro");
    await getTTSProvider().synthesize(params.overallIntroCommentary, introAudioPath);
    const introBlankPath = candidateCardPath(jobId, clipId, "introblank");
    await renderTitleCard(introBlankPath, "", 0.1, resolution, introAudioPath);
    segmentPaths.push(introBlankPath);
    cursorSec += (await probeVideo(introBlankPath)).durationSec;
  }

  for (const item of playOrder) {
    // Comentario narrado por puesto (opcional, ENABLE_COMMENTARY): tarjeta muda de audio (sin
    // texto visible, ya no hace falta — el número/etiqueta de este puesto los pone la lista
    // persistente) justo antes de su clip, para que se oiga la narración antes de que se vea.
    if (item.commentary) {
      const itemAudioPath = narrationAudioPath(jobId, clipId, `pos${item.position}`);
      await getTTSProvider().synthesize(item.commentary, itemAudioPath);
      const cardPath = candidateCardPath(jobId, clipId, `pos${item.position}`);
      await renderTitleCard(cardPath, "", 0.1, resolution, itemAudioPath);
      segmentPaths.push(cardPath);
      cursorSec += (await probeVideo(cardPath)).durationSec;
    }

    listItems.push({ position: item.position, label: item.label, revealAtSec: cursorSec });

    const subPath = candidateSubClipPath(jobId, clipId, item.position);
    const assContent = captionsEnabled ? buildBigCaptionsAss(transcriptSegments, item.startSec, item.endSec, resolution) : null;
    let bigCaptionsFile: string | undefined;
    if (assContent) {
      bigCaptionsFile = bigCaptionsPath(jobId, clipId, item.position);
      fs.writeFileSync(bigCaptionsFile, assContent);
    }

    // Nunca zoom/recorte en Rankings — pedido explícito: el clip se ve siempre en horizontal
    // completo (con relleno desenfocado), sin "punch-ins" (ver buildVerticalFilter en clip.ts).
    await cutVerticalClip({
      sourcePath,
      outPath: subPath,
      startSec: item.startSec,
      endSec: item.endSec,
      resolution,
      bigCaptionsPath: bigCaptionsFile,
      dynamicZoom: false,
    });
    segmentPaths.push(subPath);
    cursorSec += (await probeVideo(subPath)).durationSec;
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
    cursorSec += (await probeVideo(outroPath)).durationSec;
  }

  const assembledPath = clipAssembledPath(jobId, clipId);
  await concatClips(segmentPaths, assembledPath);

  // limpieza de archivos temporales de este clip
  for (const p of segmentPaths) {
    fs.rmSync(p, { force: true });
  }

  const overlaidPath = `${assembledPath}.overlay.mp4`;
  await burnRankingOverlay(assembledPath, overlaidPath, category, templateType, listItems, cursorSec, resolution);
  fs.renameSync(overlaidPath, assembledPath);

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
