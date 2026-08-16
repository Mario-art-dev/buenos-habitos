import { config } from "@/lib/config";
import { run } from "./exec";

export interface CutClipOptions {
  sourcePath: string;
  outPath: string;
  startSec: number;
  endSec: number;
}

/**
 * Corta el segmento y lo recompone a formato vertical 9:16 (1080x1920) estilo short:
 * fondo desenfocado ampliado + vídeo original centrado sin recortar el encuadre.
 */
export async function cutVerticalClip({ sourcePath, outPath, startSec, endSec }: CutClipOptions): Promise<void> {
  const duration = Math.max(0.5, endSec - startSec);
  const filter =
    "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=20[bg];" +
    "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg];" +
    "[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto,format=yuv420p[v]";

  await run(config.ffmpegPath, [
    "-y",
    "-ss",
    String(startSec),
    "-i",
    sourcePath,
    "-t",
    String(duration),
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outPath,
  ]);
}

export async function extractThumbnail(clipPath: string, outPath: string): Promise<void> {
  await run(config.ffmpegPath, ["-y", "-ss", "0.3", "-i", clipPath, "-frames:v", "1", "-q:v", "3", outPath]);
}
