import fs from "fs";
import path from "path";
import { config } from "@/lib/config";
import { run } from "./exec";
import { extractCoverFrameAt, escapeDrawtext, wrapText } from "./clip";
import { probeAudioDurationSec, type VerticalResolution } from "./probe";

const STING_PATH = path.resolve(process.cwd(), "assets", "audio", "brand_sting.wav");

let cachedStingDurationSec: number | null = null;
async function getStingDurationSec(): Promise<number> {
  if (cachedStingDurationSec === null) {
    cachedStingDurationSec = await probeAudioDurationSec(STING_PATH);
  }
  return cachedStingDurationSec;
}

export interface RenderCoverCardParams {
  sourcePath: string;
  frameAtSec: number;
  title: string;
  outPath: string;
  resolution: VerticalResolution;
}

/**
 * Genera la "portada" del short: un fotograma del propio vídeo (a máxima calidad, no el pequeño
 * de clasificación por IA) con el título quemado encima al estilo de una miniatura real de
 * creador de contenido — texto grande en negrita con contorno, sobre una franja oscura abajo para
 * que se lea bien encima de cualquier imagen. Se congela ese fotograma durante lo que dure el
 * sonido de marca (assets/audio/brand_sting.wav), que es el audio de esta tarjeta.
 *
 * Pedido explícito: la MISMA portada se usa al principio Y al final del short (solo se renderiza
 * una vez por clip; el llamador reutiliza el archivo de salida dos veces al montar el vídeo final).
 */
export async function renderCoverCard(params: RenderCoverCardParams): Promise<void> {
  const { sourcePath, frameAtSec, title, outPath, resolution } = params;
  const { width, height } = resolution;

  const framePath = `${outPath}.frame.jpg`;
  await extractCoverFrameAt(sourcePath, frameAtSec, framePath);

  try {
    const stingDuration = await getStingDurationSec();
    const fontSize = Math.round(width / 11);
    const wrapped = wrapText(title, 22);
    const bottomMargin = Math.round(height * 0.08);

    const filter =
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[bg];` +
      `[bg]drawbox=x=0:y=ih*0.58:w=iw:h=ih*0.42:color=black@0.55:t=fill[dark];` +
      `[dark]drawtext=text='${escapeDrawtext(wrapped)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:` +
      `fontcolor=0xFFD400:fontsize=${fontSize}:borderw=7:bordercolor=black@0.9:` +
      `x=(w-text_w)/2:y=h-text_h-${bottomMargin}:line_spacing=12[v]`;

    await run(config.ffmpegPath, [
      "-y",
      "-loop",
      "1",
      "-i",
      framePath,
      "-i",
      STING_PATH,
      "-t",
      String(stingDuration),
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      outPath,
    ]);
  } finally {
    fs.rmSync(framePath, { force: true });
  }
}
