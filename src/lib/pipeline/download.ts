import { config } from "@/lib/config";
import { run } from "./exec";
import { probeVideo } from "./probe";

export interface DownloadResult {
  title: string;
  durationSec: number;
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

/**
 * Descarga el vídeo fuente (YouTube o cualquier URL soportada por yt-dlp) a
 * la ruta indicada, en mp4 <=1080p para acelerar el procesado posterior.
 */
export async function downloadSourceVideo(url: string, outputPath: string): Promise<DownloadResult> {
  await run(config.ytdlpPath, [
    url,
    "-f",
    "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
    ...ytExtractorArgs(),
    "--merge-output-format",
    "mp4",
    "--no-playlist",
    "-o",
    outputPath,
  ]);

  const { stdout } = await run(config.ytdlpPath, [
    url,
    ...ytExtractorArgs(),
    "--no-playlist",
    "--print",
    "%(title)s|||%(duration)s",
    "--skip-download",
  ]);

  const [title, durationRaw] = stdout.trim().split("|||");
  return {
    title: title || "Vídeo sin título",
    durationSec: Number(durationRaw) || 0,
  };
}

/** Descarga solo el audio (mp3) de un vídeo de YouTube, p.ej. para usar una canción como banda sonora. */
export async function downloadAudioOnly(url: string, outputPath: string): Promise<DownloadResult> {
  const outNoExt = outputPath.replace(/\.mp3$/i, "");
  await run(config.ytdlpPath, [
    url,
    "-x",
    "--audio-format",
    "mp3",
    ...ytExtractorArgs(),
    "--no-playlist",
    "-o",
    `${outNoExt}.%(ext)s`,
  ]);

  const { stdout } = await run(config.ytdlpPath, [
    url,
    ...ytExtractorArgs(),
    "--no-playlist",
    "--print",
    "%(title)s|||%(duration)s",
    "--skip-download",
  ]);

  const [title, durationRaw] = stdout.trim().split("|||");
  return {
    title: title || "Canción sin título",
    durationSec: Number(durationRaw) || 0,
  };
}

/**
 * Resuelve el vídeo fuente de un job: si ya se subió un archivo directamente (sin pasar por
 * YouTube), simplemente lo usa tal cual; si no, lo descarga con yt-dlp desde `sourceUrl`.
 * Útil como alternativa cuando yt-dlp no puede descargar (p.ej. bloqueo de IP de datacenter).
 */
export async function resolveSourceVideo(
  job: { sourceUrl: string | null; sourceFilePath: string | null; sourceTitle: string | null },
  outputPath: string
): Promise<DownloadResult> {
  if (job.sourceFilePath) {
    const info = await probeVideo(job.sourceFilePath);
    return { title: job.sourceTitle ?? "Vídeo subido", durationSec: info.durationSec };
  }
  if (!job.sourceUrl) {
    throw new Error("Este trabajo no tiene ni URL ni archivo de vídeo fuente.");
  }
  return downloadSourceVideo(job.sourceUrl, outputPath);
}
