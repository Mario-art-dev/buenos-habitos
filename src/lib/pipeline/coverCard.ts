import fs from "fs";
import path from "path";
import { config } from "@/lib/config";
import { run } from "./exec";
import { extractCoverFrameAt, escapeDrawtext, wrapText, CONCAT_FPS, CONCAT_AUDIO_SAMPLE_RATE, CONCAT_AUDIO_CHANNELS } from "./clip";
import { probeAudioDurationSec, type VerticalResolution } from "./probe";

const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

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
  // Si se indica, se usa esta imagen (subida a mano desde la fototeca) en vez de extraer un
  // fotograma del vídeo — el resto (sonido de marca, título quemado encima) no cambia.
  customImagePath?: string | null;
}

/**
 * Genera la "portada" del short: un fotograma del propio vídeo (a máxima calidad, no el pequeño
 * de clasificación por IA), o una imagen propia si el usuario la ha subido desde el editor, con
 * el título quemado encima al estilo de una miniatura real de creador de contenido — texto grande
 * en negrita con contorno, sobre una franja oscura abajo para que se lea bien encima de cualquier
 * imagen. Se congela esa imagen durante lo que dure el sonido de marca
 * (assets/audio/brand_sting.wav), que es el audio de esta tarjeta.
 *
 * Pedido explícito: la portada solo va al FINAL del short (antes se ponía también al principio;
 * se quitó porque no quedaba bien empezar el vídeo con una pantalla estática).
 */
export async function renderCoverCard(params: RenderCoverCardParams): Promise<void> {
  const { sourcePath, frameAtSec, title, outPath, resolution, customImagePath } = params;
  const { width, height } = resolution;

  const framePath = `${outPath}.frame.jpg`;
  if (customImagePath) {
    fs.copyFileSync(customImagePath, framePath);
  } else {
    await extractCoverFrameAt(sourcePath, frameAtSec, framePath);
  }

  try {
    const stingDuration = await getStingDurationSec();
    const fontSize = Math.round(width / 9);
    const wrapped = wrapText(title, 18);
    const bottomMargin = Math.round(height * 0.09);

    const filter =
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[bg];` +
      // Degradado inferior a base de varias bandas semitransparentes apiladas (drawbox no hace
      // gradiente real, es la aproximación más cercana con un filtro estándar ya probado en el
      // resto del pipeline) para que el texto se lea bien sin tapar la imagen de golpe.
      `[bg]drawbox=x=0:y=ih*0.50:w=iw:h=ih*0.14:color=black@0.12:t=fill,` +
      `drawbox=x=0:y=ih*0.64:w=iw:h=ih*0.12:color=black@0.32:t=fill,` +
      `drawbox=x=0:y=ih*0.76:w=iw:h=ih*0.12:color=black@0.55:t=fill,` +
      `drawbox=x=0:y=ih*0.88:w=iw:h=ih*0.12:color=black@0.78:t=fill[dark];` +
      `[dark]drawtext=text='${escapeDrawtext(wrapped)}':fontfile=${FONT_BOLD}:` +
      `fontcolor=white:fontsize=${fontSize}:borderw=9:bordercolor=black@0.95:` +
      `x=(w-text_w)/2:y=h-text_h-${bottomMargin}:line_spacing=14[v]`;

    // "-r"/"-ar"/"-ac" fuerzan los mismos parámetros que el cuerpo del clip y las tarjetas (ver
    // CONCAT_FPS en clip.ts) — si no coinciden, la concatenación por copia de flujo con el cuerpo
    // del short queda corrupta (sonido que desaparece, vídeo pareciendo ir a cámara lenta).
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
      "-r",
      String(CONCAT_FPS),
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
      "-ar",
      String(CONCAT_AUDIO_SAMPLE_RATE),
      "-ac",
      String(CONCAT_AUDIO_CHANNELS),
      "-shortest",
      outPath,
    ]);
  } finally {
    fs.rmSync(framePath, { force: true });
  }
}
