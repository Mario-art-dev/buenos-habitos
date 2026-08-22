import fs from "fs";
import { db } from "@/lib/db";
import {
  sourceVideoPath,
  bottomVideoPath,
  audioPath,
  clipVideoPath,
  clipThumbnailPath,
  tmpDir,
} from "@/lib/storagePaths";
import { resolveSourceVideo, downloadSourceVideo } from "./download";
import { extractAudio, transcribeAudio } from "./transcribe";
import { buildSegmentsByCount, describeFixedSegments } from "./splitAnalyze";
import { cutSplitScreenClip, extractThumbnail } from "./clip";
import { probeVideo, pickVerticalResolution } from "./probe";
import { setStatus } from "./status";
import { normalizeLanguageCode, resolveContentLanguage } from "@/lib/lang";

const DEFAULT_PARTS_COUNT = 4;

/**
 * Resuelve el vídeo de ABAJO (fijo/decorativo, p.ej. gameplay de coche) igual que
 * resolveSourceVideo resuelve el de arriba: archivo subido si lo hay, si no lo descarga de la URL.
 */
async function resolveBottomVideo(
  job: { bottomVideoUrl: string | null; bottomVideoFilePath: string | null },
  outputPath: string
): Promise<{ durationSec: number }> {
  if (job.bottomVideoFilePath) {
    const info = await probeVideo(job.bottomVideoFilePath);
    return { durationSec: info.durationSec };
  }
  if (!job.bottomVideoUrl) {
    throw new Error("Este trabajo no tiene ni URL ni archivo para el vídeo de abajo.");
  }
  const { durationSec } = await downloadSourceVideo(job.bottomVideoUrl, outputPath);
  return { durationSec };
}

/**
 * Modo "Doble" (pantalla dividida): corta el vídeo de ARRIBA en un número fijo de partes elegido
 * por el usuario, y compone cada parte con un tramo del vídeo de ABAJO (fijo, p.ej. gameplay de
 * coche) que avanza de forma continua parte tras parte, en bucle si hace falta. Cada parte lleva
 * un texto "Parte N" fijo arriba durante todo el vídeo, para que se sepa el orden viéndolas sueltas.
 */
export async function processDoubleJob(jobId: string): Promise<void> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (!job.sourceUrl && !job.sourceFilePath) {
    throw new Error("Este trabajo no tiene ni URL ni archivo para el vídeo de arriba.");
  }
  if (!job.bottomVideoUrl && !job.bottomVideoFilePath) {
    throw new Error("Este trabajo no tiene ni URL ni archivo para el vídeo de abajo.");
  }

  try {
    await setStatus(jobId, "DOWNLOADING", "Preparando el vídeo de arriba…");
    const topPath = sourceVideoPath(jobId);
    const { title, durationSec: topDurationSec } = await resolveSourceVideo(job, topPath);
    await db.job.update({
      where: { id: jobId },
      data: { sourceTitle: title, sourceDurationSec: topDurationSec, sourceFilePath: topPath },
    });

    await setStatus(jobId, "DOWNLOADING", "Preparando el vídeo de abajo…");
    const bottomPath = bottomVideoPath(jobId);
    const { durationSec: bottomDurationSec } = await resolveBottomVideo(job, bottomPath);
    if (bottomDurationSec <= 0) {
      throw new Error("No se pudo leer la duración del vídeo de abajo.");
    }
    await db.job.update({ where: { id: jobId }, data: { bottomVideoFilePath: bottomPath } });

    await setStatus(jobId, "TRANSCRIBING", "Transcribiendo el audio del vídeo de arriba…");
    const audioOut = audioPath(jobId);
    await extractAudio(topPath, audioOut);
    const transcript = await transcribeAudio(audioOut);
    const languageCode = normalizeLanguageCode(transcript.language);
    const contentLanguage = resolveContentLanguage(languageCode);
    await db.job.update({
      where: { id: jobId },
      data: { transcript: transcript.text, contentLanguage: languageCode },
    });

    await setStatus(jobId, "ANALYZING", "Cortando el vídeo en partes y describiéndolas…");
    const partsCount = job.doublePartsCount ?? DEFAULT_PARTS_COUNT;
    const segments = buildSegmentsByCount(topDurationSec, partsCount);
    if (segments.length === 0) {
      throw new Error("El vídeo de arriba es demasiado corto para cortarlo en partes.");
    }
    const descriptions = await describeFixedSegments(segments, transcript.segments, title, contentLanguage);

    const clips = await Promise.all(
      segments.map((seg) => {
        const desc = descriptions.get(seg.index)!;
        return db.clip.create({
          data: {
            jobId,
            rank: seg.index + 1,
            startSec: seg.startSec,
            endSec: seg.endSec,
            title: desc.title,
            description: desc.description,
            viralityScore: desc.viralityScore,
            viralityReason: "",
            hashtags: JSON.stringify(desc.hashtags),
            status: "PENDING",
          },
        });
      })
    );

    await setStatus(jobId, "CLIPPING", `Generando ${clips.length} shorts en pantalla dividida…`);
    const sourceInfo = await probeVideo(topPath);
    const resolution = pickVerticalResolution(sourceInfo);

    // El vídeo de abajo avanza de forma continua a lo largo de TODAS las partes (parte 2 empieza
    // donde terminó la parte 1, no vuelve a 0), en vez de reiniciarse en cada parte — módulo su
    // propia duración, para que el punto de arranque siempre caiga dentro del archivo real (el
    // bucle -stream_loop de cutSplitScreenClip se encarga de seguir más allá del final si hace falta).
    let bottomCursorSec = 0;

    for (const clip of clips) {
      const bottomStartSec = bottomCursorSec % bottomDurationSec;
      bottomCursorSec += clip.endSec - clip.startSec;
      try {
        // Se guarda el punto de arranque del vídeo de abajo usado para esta parte, para poder
        // regenerarla (tras recortar el vídeo de arriba o añadir texto) sin romper la
        // continuidad del vídeo de fondo entre partes — ver doubleRegenerateClip.ts.
        await db.clip.update({
          where: { id: clip.id },
          data: { status: "RENDERING", doubleBottomStartSec: bottomStartSec },
        });
        const outPath = clipVideoPath(jobId, clip.id);
        const thumbPath = clipThumbnailPath(jobId, clip.id);

        await cutSplitScreenClip({
          topSourcePath: topPath,
          topStartSec: clip.startSec,
          topEndSec: clip.endSec,
          bottomSourcePath: bottomPath,
          bottomStartSec,
          label: `Parte ${clip.rank}`,
          outPath,
          resolution,
        });

        await extractThumbnail(outPath, thumbPath);
        await db.clip.update({
          where: { id: clip.id },
          data: { status: "READY", filePath: outPath, thumbnailPath: thumbPath, captionCues: "[]" },
        });
      } catch (err) {
        await db.clip.update({
          where: { id: clip.id },
          data: { status: "FAILED", error: (err as Error).message },
        });
      }
    }

    await setStatus(jobId, "DONE", "¡Listo! Revisa tus shorts en pantalla dividida.");
  } catch (err) {
    const message = (err as Error).message;
    await db.job.update({ where: { id: jobId }, data: { status: "FAILED", error: message } });
    throw err;
  } finally {
    try {
      fs.rmSync(audioPath(jobId), { force: true });
      fs.rmSync(tmpDir(jobId), { recursive: true, force: true });
    } catch {
      // ignorar
    }
  }
}
