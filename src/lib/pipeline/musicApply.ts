import fs from "fs";
import { db } from "@/lib/db";
import { mixBackgroundMusic, extractAudioSegment, extractThumbnail } from "./clip";
import { probeVideo } from "./probe";
import { regenerateClip } from "./regenerateClip";
import { downloadAudioOnly } from "./download";
import { clipVideoPath, clipThumbnailPath, clipAssembledPath, musicSegmentPath } from "@/lib/storagePaths";

export interface ApplyMusicParams {
  musicSourceUrl: string;
  musicStartSec: number;
}

interface CleanBase {
  jobId: string;
  finalPath: string;
  thumbPath: string;
  basePath: string;
}

/**
 * Deja lista una versión LIMPIA (sin música) del clip sobre la que mezclar — nunca se mezcla
 * sobre el resultado de una mezcla anterior, para poder cambiar de canción cuantas veces se
 * quiera sin que se vaya acumulando sobre sí misma:
 * - RANKING ya guarda esa versión limpia de forma persistente (`clipAssembledPath`, montada antes
 *   de mezclar música — ver rankingPipeline.ts).
 * - SINGLE/SPLIT no tienen ese archivo intermedio guardado (regenerateClip.ts no deja rastros
 *   temporales), así que la forma correcta de conseguir una base limpia es regenerar el clip desde
 *   cero (regenerateClip ya reconstruye exactamente el clip sin música, a partir de lo guardado).
 */
async function resolveCleanBase(clipId: string): Promise<CleanBase> {
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
    await regenerateClip(clipId);
    basePath = finalPath;
  }

  return { jobId, finalPath, thumbPath, basePath };
}

/** Recorta el tramo de audio ya descargado, lo mezcla de fondo y guarda el resultado en el clip. */
async function mixDownloadedAudioIntoClip(
  clipId: string,
  base: CleanBase,
  rawAudioPath: string,
  startSec: number,
  sourceUrlToStore: string
): Promise<{ filePath: string; thumbnailPath: string }> {
  const { jobId, finalPath, thumbPath, basePath } = base;
  const { durationSec } = await probeVideo(basePath);
  const segmentPath = musicSegmentPath(jobId, clipId);
  await extractAudioSegment(rawAudioPath, startSec, durationSec, segmentPath);

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
      musicSourceUrl: sourceUrlToStore,
      musicStartSec: startSec,
      filePath: finalPath,
      thumbnailPath: thumbPath,
    },
  });

  return { filePath: finalPath, thumbnailPath: thumbPath };
}

/**
 * Aplica (o quita) música de fondo a un clip YA generado, de cualquier modo — no solo Rankings.
 * La música es siempre opt-in: nunca se queda pegada si el usuario la desactiva.
 */
export async function applyMusicToClip(
  clipId: string,
  params: ApplyMusicParams | null
): Promise<{ filePath: string; thumbnailPath: string }> {
  const base = await resolveCleanBase(clipId);
  const { finalPath, thumbPath, basePath, jobId } = base;

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

  // downloadAudioOnly (no una llamada suelta a yt-dlp) porque YouTube bloquea las peticiones
  // "a pelo" desde la IP de datacenter del runner igual que bloqueaba la descarga del vídeo
  // fuente (ver ytExtractorArgs/runYtdlpWithRetry en download.ts) — bug real: este enlace de
  // música nunca llevó esa protección, así que fallaba en el servidor aunque funcionara en local.
  const rawAudioPath = `${musicSegmentPath(jobId, clipId)}.source.mp3`;
  await downloadAudioOnly(params.musicSourceUrl, rawAudioPath);

  return mixDownloadedAudioIntoClip(clipId, base, rawAudioPath, params.musicStartSec, params.musicSourceUrl);
}

/** "1:15" o "1:15-2:00" (se coge solo el primer número) -> segundos. */
function parseSuggestedStartSec(section: string | null | undefined): number {
  if (!section) return 0;
  const match = section.match(/(\d+):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * "Aplicar la sugerencia automáticamente": en vez de que el usuario tenga que buscar la canción
 * que recomendó la IA y pegar el enlace a mano, se busca ella misma en YouTube (con yt-dlp, el
 * mismo motor que ya usa toda la app — no hace falta ninguna cuenta ni API de pago tipo Spotify,
 * cuya API tampoco permite descargar canciones completas por sus condiciones de uso) y se aplica
 * con el minuto que la IA ya sugirió (musicSuggestedSection). Pedido explícito: "que tú cojas la
 * canción, en qué minuto y todo". "ytsearch1:" ya descarga el mejor resultado en la misma llamada
 * (no hace falta una búsqueda aparte y luego otra descarga), y downloadAudioOnly devuelve el
 * enlace real del vídeo elegido (resolvedUrl) para guardarlo como si se hubiera pegado a mano.
 */
export async function autoApplyRecommendedMusic(clipId: string): Promise<{ filePath: string; thumbnailPath: string }> {
  const clip = await db.clip.findUniqueOrThrow({ where: { id: clipId } });
  if (!clip.musicQuery) {
    throw new Error("Este clip no tiene ninguna canción recomendada por la IA.");
  }

  const base = await resolveCleanBase(clipId);
  const rawAudioPath = `${musicSegmentPath(base.jobId, clipId)}.source.mp3`;

  // El primer resultado de búsqueda a veces está bloqueado para descargar (subidas oficiales de
  // discográficas con protecciones extra, restricción de región/edad...) aunque la canción exista
  // de sobra en YouTube en otra subida — pedido explícito: que casi nunca se quede el short sin
  // música. Se prueban varias reformulaciones de la búsqueda en orden hasta que una se pueda
  // descargar de verdad, en vez de rendirse en cuanto falla la primera.
  const queryVariants = [
    `${clip.musicQuery} official audio`,
    `${clip.musicQuery} audio`,
    `${clip.musicQuery} lyrics`,
    clip.musicQuery,
  ];

  let result: Awaited<ReturnType<typeof downloadAudioOnly>> | null = null;
  let lastError: Error | null = null;
  for (const query of queryVariants) {
    try {
      const attempt = await downloadAudioOnly(`ytsearch1:${query}`, rawAudioPath);
      if (attempt.resolvedUrl) {
        result = attempt;
        break;
      }
    } catch (err) {
      lastError = err as Error;
      fs.rmSync(rawAudioPath, { force: true });
    }
  }
  if (!result?.resolvedUrl) {
    throw new Error(
      `No se pudo descargar ninguna versión de "${clip.musicQuery}" desde YouTube${lastError ? `: ${lastError.message}` : ""}.`
    );
  }

  const startSec = parseSuggestedStartSec(clip.musicSuggestedSection);
  return mixDownloadedAudioIntoClip(clipId, base, rawAudioPath, startSec, result.resolvedUrl);
}
