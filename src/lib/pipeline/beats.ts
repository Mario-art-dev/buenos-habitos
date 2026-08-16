import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { config } from "@/lib/config";
import { run } from "./exec";

export interface BeatInfo {
  bpm: number;
  beatTimes: number[];
}

/** Analiza el tempo y los tiempos de los golpes de una canción, para sincronizar los cortes de vídeo. */
export async function detectBeats(audioPath: string): Promise<BeatInfo> {
  const scriptPath = path.resolve(process.cwd(), "scripts", "beat_detect.py");
  const outFile = path.join(os.tmpdir(), `beats_${crypto.randomUUID()}.json`);

  try {
    await run(config.transcription.pythonPath, [scriptPath, audioPath, outFile]);
    const raw = fs.readFileSync(outFile, "utf-8");
    return JSON.parse(raw) as BeatInfo;
  } finally {
    fs.rmSync(outFile, { force: true });
  }
}

/**
 * A partir de los tiempos de los golpes, propone puntos de corte espaciados por el ritmo:
 * agrupa golpes cada `beatsPerCut` para que los cambios de plano caigan en el compás,
 * sin generar cortes más cortos que `minCutSeconds`.
 */
export function beatsToCutPoints(beatTimes: number[], beatsPerCut = 4, minCutSeconds = 1.2): number[] {
  const points: number[] = [0];
  for (let i = beatsPerCut; i < beatTimes.length; i += beatsPerCut) {
    const t = beatTimes[i];
    if (t - points[points.length - 1] >= minCutSeconds) {
      points.push(t);
    }
  }
  return points;
}
