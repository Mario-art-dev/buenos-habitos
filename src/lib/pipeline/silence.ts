import { config } from "@/lib/config";
import { run } from "./exec";

export interface TimeSpan {
  start: number;
  end: number;
}

/** Detecta los tramos de silencio del vídeo/audio (ffmpeg silencedetect). */
async function detectSilences(filePath: string): Promise<TimeSpan[]> {
  const { stderr } = await run(config.ffmpegPath, [
    "-i",
    filePath,
    "-af",
    "silencedetect=noise=-30dB:d=0.4",
    "-f",
    "null",
    "-",
  ]);

  const silences: TimeSpan[] = [];
  let currentStart: number | null = null;

  for (const line of stderr.split("\n")) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    if (startMatch) {
      currentStart = Number(startMatch[1]);
      continue;
    }
    const endMatch = line.match(/silence_end:\s*([\d.]+)/);
    if (endMatch && currentStart !== null) {
      silences.push({ start: currentStart, end: Number(endMatch[1]) });
      currentStart = null;
    }
  }

  return silences;
}

/**
 * A partir de los silencios, devuelve los tramos "con contenido" entre ellos:
 * candidatos a ser momentos independientes (útil para vídeos de recopilación
 * tipo fails, donde cada clip suele venir separado por un corte/silencio).
 */
export async function detectContentSegments(filePath: string, totalDurationSec: number): Promise<TimeSpan[]> {
  const silences = await detectSilences(filePath);
  const minLen = config.ranking.minSegmentSeconds;

  const boundaries: number[] = [0];
  for (const s of silences) {
    boundaries.push(s.start, s.end);
  }
  boundaries.push(totalDurationSec);
  boundaries.sort((a, b) => a - b);

  const raw: TimeSpan[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    if (end - start >= minLen) {
      raw.push({ start, end });
    }
  }

  // Si apenas hay silencios detectados (vídeo continuo sin cortes claros),
  // recae en una segmentación fija por bloques de ~8s como red de seguridad.
  if (raw.length < 3) {
    const fallback: TimeSpan[] = [];
    const blockLen = Math.max(minLen, 8);
    for (let t = 0; t < totalDurationSec; t += blockLen) {
      fallback.push({ start: t, end: Math.min(totalDurationSec, t + blockLen) });
    }
    return fallback;
  }

  return raw;
}
