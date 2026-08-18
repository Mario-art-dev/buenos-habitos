import { config } from "@/lib/config";
import { run } from "./exec";

export interface MediaInfo {
  durationSec: number;
  width: number;
  height: number;
}

function ffprobePath(): string {
  return config.ffmpegPath.replace(/ffmpeg$/, "ffprobe");
}

export async function probeVideo(filePath: string): Promise<MediaInfo> {
  const { stdout } = await run(ffprobePath(), [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height:format=duration",
    "-of",
    "csv=p=0",
    filePath,
  ]);

  const lines = stdout.trim().split("\n").map((l) => l.trim());
  const [width, height] = (lines[0] ?? "").split(",").map(Number);
  const durationLine = lines.find((l) => /^[\d.]+$/.test(l) && !l.includes(","));
  const durationSec = Number(durationLine ?? lines[1] ?? 0);

  return {
    width: width || 1920,
    height: height || 1080,
    durationSec: durationSec || 0,
  };
}

/** Duración de un archivo de solo audio (probeVideo pide un stream de vídeo, que aquí no hay). */
export async function probeAudioDurationSec(filePath: string): Promise<number> {
  const { stdout } = await run(ffprobePath(), [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    filePath,
  ]);
  return Number(stdout.trim()) || 0;
}

export interface VerticalResolution {
  width: number;
  height: number;
}

/** Elige la mayor resolución vertical razonable sin superar la calidad real del vídeo fuente. */
export function pickVerticalResolution(source: { width: number; height: number }): VerticalResolution {
  const sourceMax = Math.max(source.width, source.height);
  if (sourceMax >= 3840) return { width: 2160, height: 3840 };
  if (sourceMax >= 2560) return { width: 1440, height: 2560 };
  return { width: 1080, height: 1920 };
}
