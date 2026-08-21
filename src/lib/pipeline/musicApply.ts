import fs from "fs";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { run } from "./exec";
import { mixBackgroundMusic, extractAudioSegment, extractThumbnail } from "./clip";
import { probeVideo } from "./probe";
import { regenerateClip } from "./regenerateClip";
import { clipVideoPath, clipThumbnailPath, clipAssembledPath, musicSegmentPath } from "@/lib/storagePaths";

export interface ApplyMusicParams {
  musicSourceUrl: string;
  musicStartSec: number;
}

/**
 * Aplica (o quita) música de fondo a un clip YA generado, de cualquier modo — no solo Rankings.
 * La música es siempre opt-in: nunca se queda pegada si el usuario la desactiva, y se puede
 * cambiar cuantas veces se quiera sin que se vaya acumulando sobre sí misma, porque siempre se
 * mezcla sobre una versión LIMPIA (sin música) del clip, no sobre el resultado de la vez anterior:
 * - RANKING ya guarda esa versión limpia de forma persistente (`clipAssembledPath`, montada antes
 *   de mezclar música — ver rankingPipeline.ts).
 * - SINGLE/SPLIT no tienen ese archivo intermedio guardado (regenerateClip.ts no deja rastros
 *   temporales), así que la forma correcta de conseguir una base limpia es regenerar el clip desde
 *   cero (regenerateClip ya reconstruye exactamente el clip sin música, a partir de lo guardado).
 */
export async function applyMusicToClip(
  clipId: string,
  params: ApplyMusicParams | null
): Promise<{ filePath: string; thumbnailPath: string }> {
  const clip = await db.clip.findUniqueOrThrow({ where: { id: clipId }, include: { job: true } });
  const jobId = clip.jobId;
  const finalPath = clipVideoPath(jobId, clipId);
  const thumbPath = clipThumbnailPath(jobId, clipId);

  let basePath: string;
  if (clip.job.mode === "RANKING") {
    basePath = clipAssembledPath(jobId, clipId);
    if (!fs.existsSync(basePath)) {
      throw new Error("El vídeo de ranking todavía no está montado.");
    }
  } else {
    // regenerateClip ya deja finalPath limpio (sin música) y actualizada la base de datos.
    await regenerateClip(clipId);
    basePath = finalPath;
  }

  if (!params) {
    if (basePath !== finalPath) {
      fs.copyFileSync(basePath, finalPath);
      await extractThumbnail(finalPath, thumbPath, 2.2);
    }
    await db.clip.update({
      where: { id: clipId },
      data: { musicEnabled: false, musicSourceUrl: null, musicStartSec: null, filePath: finalPath, thumbnailPath: thumbPath },
    });
    return { filePath: finalPath, thumbnailPath: thumbPath };
  }

  const rawAudioPath = `${musicSegmentPath(jobId, clipId)}.source.m4a`;
  await run(config.ytdlpPath, [
    params.musicSourceUrl,
    "-f",
    "bestaudio",
    "--extract-audio",
    "--audio-format",
    "m4a",
    "-o",
    rawAudioPath,
  ]);

  const { durationSec } = await probeVideo(basePath);
  const segmentPath = musicSegmentPath(jobId, clipId);
  await extractAudioSegment(rawAudioPath, params.musicStartSec, durationSec, segmentPath);

  // Se mezcla siempre a un archivo temporal distinto del de entrada — en SINGLE/SPLIT basePath y
  // finalPath son la MISMA ruta, y hacer que ffmpeg lea y escriba el mismo archivo a la vez lo
  // corrompe (o falla directamente).
  const mixedTmpPath = `${finalPath}.music_tmp.mp4`;
  await mixBackgroundMusic(basePath, segmentPath, mixedTmpPath);
  fs.renameSync(mixedTmpPath, finalPath);

  fs.rmSync(rawAudioPath, { force: true });
  fs.rmSync(segmentPath, { force: true });

  await extractThumbnail(finalPath, thumbPath, 2.2);

  await db.clip.update({
    where: { id: clipId },
    data: {
      musicEnabled: true,
      musicSourceUrl: params.musicSourceUrl,
      musicStartSec: params.musicStartSec,
      filePath: finalPath,
      thumbnailPath: thumbPath,
    },
  });

  return { filePath: finalPath, thumbnailPath: thumbPath };
}
