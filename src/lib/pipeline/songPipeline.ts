import fs from "fs";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { downloadSourceVideo, downloadAudioOnly, resolveSourceVideo } from "./download";
import { probeVideo, pickVerticalResolution } from "./probe";
import { detectContentSegments } from "./silence";
import { buildCandidateMoments, classifyCandidates } from "./rankingAnalyze";
import { contentLanguageName } from "@/lib/lang";
import { detectBeats, beatsToCutPoints } from "./beats";
import { cutVerticalClip, concatClips, replaceAudioTrack, extractThumbnail } from "./clip";
import { composeSongEdit } from "./songCompose";
import { setStatus } from "./status";
import {
  sourceVideoPath,
  songAudioPath,
  songSegmentPath,
  songSilentAssemblyPath,
  clipVideoPath,
  clipThumbnailPath,
  tmpDir,
} from "@/lib/storagePaths";

const FALLBACK_SEGMENT_SEC = 2;

/** Genera duraciones de segmento a partir de los beats de la canción, limitadas a la duración máxima. */
function computeSegmentDurations(beatTimes: number[], maxDurationSec: number): number[] {
  const cutPoints = beatsToCutPoints(beatTimes).filter((t) => t <= maxDurationSec);
  if (cutPoints.length === 0 || cutPoints[cutPoints.length - 1] !== maxDurationSec) {
    cutPoints.push(maxDurationSec);
  }

  const durations: number[] = [];
  for (let i = 0; i < cutPoints.length - 1; i++) {
    const d = cutPoints[i + 1] - cutPoints[i];
    if (d > 0.3) durations.push(d);
  }

  if (durations.length === 0) {
    for (let t = 0; t < maxDurationSec; t += FALLBACK_SEGMENT_SEC) {
      durations.push(Math.min(FALLBACK_SEGMENT_SEC, maxDurationSec - t));
    }
  }

  return durations;
}

/**
 * Vuelve a montar un vídeo de recopilación existente al ritmo de una canción elegida por el
 * usuario: detecta los golpes (beats) de la canción, elige los mejores momentos del vídeo
 * fuente con IA, corta cada uno para que el cambio de plano caiga en el beat, y sustituye el
 * audio original por la canción.
 */
export async function processSongJob(jobId: string): Promise<void> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (!job.sourceUrl && !job.sourceFilePath) {
    throw new Error("Este trabajo no tiene ni URL ni archivo para el vídeo de recopilación.");
  }
  const songPath = songAudioPath(jobId);
  if (!job.songUrl && !fs.existsSync(songPath)) {
    throw new Error("Este trabajo no tiene ni enlace ni archivo para la canción.");
  }

  try {
    await setStatus(jobId, "DOWNLOADING", "Preparando el vídeo de recopilación…");
    const srcPath = sourceVideoPath(jobId);
    const { title: sourceTitle, durationSec: sourceDurationSec } = await resolveSourceVideo(job, srcPath);
    await db.job.update({
      where: { id: jobId },
      data: { sourceTitle, sourceDurationSec, sourceFilePath: srcPath },
    });

    // Si songUrl no está (se subió un archivo directamente, ver /api/jobs/song), songAudioPath ya
    // existe en disco de antes (lo dejó la ruta de subida) — no hace falta descargar nada.
    let songTitle = "Canción subida";
    if (job.songUrl) {
      await setStatus(jobId, "DOWNLOADING", "Descargando el audio de la canción…");
      songTitle = (await downloadAudioOnly(job.songUrl, songPath)).title;
    }

    await setStatus(jobId, "ANALYZING", "Analizando el ritmo de la canción…");
    const { beatTimes } = await detectBeats(songPath);
    const segmentDurations = computeSegmentDurations(beatTimes, config.song.maxDurationSec);

    await setStatus(jobId, "ANALYZING", "La IA está eligiendo los mejores momentos del vídeo…");
    const spans = await detectContentSegments(srcPath, sourceDurationSec);
    const candidates = await buildCandidateMoments(jobId, srcPath, spans, []);
    // SONG no transcribe diálogo (solo detecta el ritmo de la canción elegida), así que no hay
    // idioma de vídeo que detectar aquí: se usa el idioma configurado del canal.
    const classified = (await classifyCandidates(candidates, contentLanguageName())).items;

    const included = classified.filter((c) => c.include).sort((a, b) => b.score - a.score);
    const usableCount = Math.min(segmentDurations.length, included.length);
    if (usableCount === 0) {
      throw new Error("No se encontraron suficientes momentos aprovechables en el vídeo de recopilación.");
    }

    const chosen = included.slice(0, usableCount).sort((a, b) => a.startSec - b.startSec);
    const durations = segmentDurations.slice(0, usableCount);
    // Los tramos elegidos se guardan (startSec/endSec ya recortados a la duración real del vídeo)
    // para poder regenerar el clip desde el editor sin repetir la detección de momentos ni el
    // análisis de ritmo — ver songRegenerateClip.ts.
    const segments = chosen.map((moment, i) => {
      const duration = Math.min(durations[i], Math.max(0.5, sourceDurationSec - moment.startSec));
      return { startSec: moment.startSec, endSec: moment.startSec + duration };
    });

    await setStatus(jobId, "CLIPPING", "Montando los cortes al ritmo de la canción…");
    const sourceInfo = await probeVideo(srcPath);
    const resolution = pickVerticalResolution(sourceInfo);

    const clip = await db.clip.create({
      data: {
        jobId,
        rank: 1,
        startSec: chosen[0].startSec,
        endSec: chosen[chosen.length - 1].endSec,
        title: sourceTitle,
        description: "",
        viralityScore: 50,
        viralityReason: "",
        hashtags: "[]",
        musicQuery: songTitle,
        songSegments: JSON.stringify(segments),
        status: "RENDERING",
      },
    });

    try {
      const segmentPaths: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const outPath = songSegmentPath(jobId, clip.id, i);
        await cutVerticalClip({
          sourcePath: srcPath,
          outPath,
          startSec: segments[i].startSec,
          endSec: segments[i].endSec,
          resolution,
          muted: true,
        });
        segmentPaths.push(outPath);
      }

      const silentPath = songSilentAssemblyPath(jobId, clip.id);
      await concatClips(segmentPaths, silentPath);

      const outPath = clipVideoPath(jobId, clip.id);
      await replaceAudioTrack(silentPath, songPath, outPath, 0);

      const composition = await composeSongEdit({ sourceTitle, songTitle, clipCount: chosen.length });

      const thumbPath = clipThumbnailPath(jobId, clip.id);
      await extractThumbnail(outPath, thumbPath);

      await db.clip.update({
        where: { id: clip.id },
        data: {
          status: "READY",
          filePath: outPath,
          thumbnailPath: thumbPath,
          title: composition.title,
          description: composition.description,
          hashtags: JSON.stringify(composition.hashtags),
          viralityScore: composition.viralityScore,
          viralityReason: composition.viralityReason,
        },
      });
    } catch (err) {
      await db.clip.update({
        where: { id: clip.id },
        data: { status: "FAILED", error: (err as Error).message },
      });
      throw err;
    }

    await setStatus(jobId, "DONE", "¡Listo! Revisa tu vídeo al ritmo de la canción.");
  } catch (err) {
    const message = (err as Error).message;
    await db.job.update({ where: { id: jobId }, data: { status: "FAILED", error: message } });
    throw err;
  } finally {
    try {
      fs.rmSync(songAudioPath(jobId), { force: true });
      fs.rmSync(tmpDir(jobId), { recursive: true, force: true });
    } catch {
      // ignorar
    }
  }
}
