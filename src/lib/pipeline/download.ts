import fs from "fs";
import { config } from "@/lib/config";
import { run } from "./exec";
import { probeVideo } from "./probe";

export interface DownloadResult {
  title: string;
  durationSec: number;
  // Nombre del canal/creador que subió el vídeo (yt-dlp %(uploader)s) — solo modo RANKING lo usa,
  // como último recurso para nombrar el ranking "Best 5 clips of {uploader}" cuando el usuario no
  // pidió ninguna sección a mano y la IA tampoco detectó ninguna categoría concreta (ver
  // rankingAnalyze.ts groupIntoRankings). undefined si el vídeo se subió como archivo directo
  // (sin pasar por yt-dlp, no hay forma de saberlo).
  uploader?: string;
  // URL real del vídeo resuelto (yt-dlp %(webpage_url)s) — solo lo devuelve downloadAudioOnly.
  // Necesario cuando la "url" de entrada es una búsqueda ("ytsearch1:...", ver musicApply.ts
  // autoApplyRecommendedMusic) para poder guardar un enlace de verdad en vez de la búsqueda.
  resolvedUrl?: string;
}

// El cliente "web" por defecto de YouTube exige ahora resolver un reto en JavaScript y es el
// que más sufre el bloqueo "Sign in to confirm you're not a bot" en IPs de datacenter (como las
// de GitHub Actions/Oracle). El cliente "android" no necesita ese reto.
// Aun así, YouTube puede seguir bloqueando por reputación de la IP en sí (no del cliente), así
// que además se pasa el proveedor de tokens de origen bgutil-ytdlp-pot-provider (servicio local,
// sin cuenta ni cookies) para que la petición parezca legítima aunque la IP esté marcada.
function ytExtractorArgs(): string[] {
  return [
    "--extractor-args",
    "youtube:player_client=android,web",
    "--extractor-args",
    `youtubepot-bgutilhttp:base_url=${config.ytdlpPotProviderBaseUrl}`,
  ];
}

// YouTube devuelve 429 ("Too Many Requests") o el aviso de "Sign in to confirm you're not a bot"
// cuando ve demasiadas peticiones seguidas desde la misma IP — normal en un runner compartido de
// GitHub Actions, sobre todo tras mucho uso el mismo día. Casi siempre es temporal (segundos a
// pocos minutos), así que merece la pena esperar y reintentar antes de rendirse, en vez de fallar
// el trabajo entero a la primera. No se reintenta ningún otro tipo de error (URL inválida, vídeo
// privado, etc. no se arreglan esperando).
const RETRYABLE_PATTERN = /HTTP Error 429|Too Many Requests|Sign in to confirm you.?re not a bot/i;

async function runYtdlpWithRetry(args: string[], maxAttempts = 3): Promise<{ stdout: string; stderr: string }> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await run(config.ytdlpPath, args);
    } catch (err) {
      const error = err as Error;
      if (!RETRYABLE_PATTERN.test(error.message) || attempt === maxAttempts - 1) {
        throw error;
      }
      lastError = error;
      const waitMs = (attempt + 1) * 15_000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError ?? new Error("yt-dlp falló sin detalle");
}

/**
 * Descarga el vídeo fuente (YouTube o cualquier URL soportada por yt-dlp) a la ruta indicada, en
 * mp4 <=1080p para acelerar el procesado posterior. Una sola llamada a yt-dlp (descarga + imprime
 * título/duración con --print after_move:..., que se ejecuta tras mover el archivo final a su
 * sitio) en vez de dos separadas — la segunda llamada solo para metadatos era una petición extra
 * a YouTube por cada vídeo, sin necesidad, que solo aumentaba el riesgo de toparse con el 429.
 */
export async function downloadSourceVideo(url: string, outputPath: string): Promise<DownloadResult> {
  const { stdout } = await runYtdlpWithRetry([
    url,
    "-f",
    "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
    ...ytExtractorArgs(),
    "--merge-output-format",
    "mp4",
    "--no-playlist",
    "-o",
    outputPath,
    "--print",
    "after_move:%(title)s|||%(duration)s|||%(uploader)s",
  ]);

  const [title, durationRaw, uploaderRaw] = stdout.trim().split("|||");
  return {
    title: title || "Vídeo sin título",
    durationSec: Number(durationRaw) || 0,
    uploader: uploaderRaw && uploaderRaw !== "NA" ? uploaderRaw : undefined,
  };
}

/**
 * Descarga solo el audio (mp3) de un vídeo de YouTube, p.ej. para usar una canción como banda
 * sonora. `url` acepta tanto un enlace normal como una búsqueda de yt-dlp (p.ej. "ytsearch1:algo
 * official audio"), en cuyo caso resolvedUrl devuelve el enlace real del vídeo elegido — ver
 * autoApplyRecommendedMusic en musicApply.ts.
 */
export async function downloadAudioOnly(url: string, outputPath: string): Promise<DownloadResult> {
  const outNoExt = outputPath.replace(/\.mp3$/i, "");
  const { stdout } = await runYtdlpWithRetry([
    url,
    "-x",
    "--audio-format",
    "mp3",
    ...ytExtractorArgs(),
    "--no-playlist",
    "-o",
    `${outNoExt}.%(ext)s`,
    "--print",
    "after_move:%(title)s|||%(duration)s|||%(webpage_url)s",
  ]);

  const [title, durationRaw, resolvedUrl] = stdout.trim().split("|||");
  return {
    title: title || "Canción sin título",
    durationSec: Number(durationRaw) || 0,
    resolvedUrl: resolvedUrl || undefined,
  };
}

/**
 * Resuelve el vídeo fuente de un job: si ya se subió un archivo directamente (sin pasar por
 * YouTube), simplemente lo usa tal cual; si no, lo descarga con yt-dlp desde `sourceUrl`.
 * Útil como alternativa cuando yt-dlp no puede descargar (p.ej. bloqueo de IP de datacenter).
 *
 * `sourceFilePath` puede apuntar a un archivo que ya no existe en disco: los vídeos fuente suelen
 * pesar más de 95MB y el respaldo por checkpoints (rama git gallery-data) excluye los archivos que
 * superan ese tamaño, así que tras un reinicio de sesión la fila del job sobrevive pero el archivo
 * no. Si hay `sourceUrl` de todas formas se puede volver a descargar; si el vídeo se subió a mano
 * (sin URL), no hay forma de recuperarlo y hay que decirlo claro en vez de dejar que reviente
 * ffprobe con un "No such file or directory" críptico.
 */
export async function resolveSourceVideo(
  job: { sourceUrl: string | null; sourceFilePath: string | null; sourceTitle: string | null },
  outputPath: string
): Promise<DownloadResult> {
  if (job.sourceFilePath && fs.existsSync(job.sourceFilePath)) {
    const info = await probeVideo(job.sourceFilePath);
    return { title: job.sourceTitle ?? "Vídeo subido", durationSec: info.durationSec };
  }
  if (!job.sourceUrl) {
    if (job.sourceFilePath) {
      throw new Error(
        "El vídeo que subiste se perdió al reiniciarse la sesión (no se pudo respaldar por su tamaño) y no tiene un enlace de origen para volver a descargarlo. Elimina este trabajo y vuelve a subir el vídeo en uno nuevo."
      );
    }
    throw new Error("Este trabajo no tiene ni URL ni archivo de vídeo fuente.");
  }
  return downloadSourceVideo(job.sourceUrl, outputPath);
}
