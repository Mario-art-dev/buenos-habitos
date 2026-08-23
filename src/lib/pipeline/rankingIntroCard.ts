import fs from "fs";
import { config } from "@/lib/config";
import { run } from "./exec";
import { CONCAT_FPS, CONCAT_AUDIO_SAMPLE_RATE, CONCAT_AUDIO_CHANNELS } from "./clip";
import { probeVideo, type VerticalResolution } from "./probe";

// Plantilla fija pedida a partir de una captura real de referencia: "Ranking Funniest {Category}
// Moments", con estos colores exactos por palabra y fuente Anton (impact, mayúsculas/negrita) —
// lo único que cambia entre vídeos de ranking es la palabra de la categoría.
const WHITE_BGR = "&HFFFFFF&";
const RED_BGR = "&H0000FF&"; // RGB FF0000 -> BGR
const YELLOW_BGR = "&H00D4FF&"; // RGB FFD400 -> BGR (mismo amarillo de marca que coverCard.ts)
const FONT_NAME = "Anton";

function assTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.round((clamped - Math.floor(clamped)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, "").replace(/[{}]/g, "").trim();
}

function escapeSubtitlesPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function titleCase(word: string): string {
  return word.length === 0 ? word : word[0].toUpperCase() + word.slice(1).toLowerCase();
}

// "TOPIC" (gracioso/temática): plantilla fija de siempre "Ranking Funniest {Category} Moments".
// "YOUTUBER": plantilla paralela "Best 5 {Name} Clips" para cuando la sección pedida es "los
// mejores clips de tal creador" en vez de una temática — mismo estilo (fuente/colores), solo
// cambia qué palabras van fijas y cuál es la variable.
export type RankingIntroTemplate = "TOPIC" | "YOUTUBER";

function buildRankingIntroAss(
  category: string,
  durationSec: number,
  resolution: VerticalResolution,
  template: RankingIntroTemplate = "TOPIC"
): string {
  const { width, height } = resolution;
  const fontSize = Math.round(width / 10);
  const outline = Math.max(1, Math.round(fontSize / 12));
  const lineGap = Math.round(fontSize * 0.15);
  const line1Y = Math.round(height * 0.14);
  const line2Y = line1Y + fontSize + lineGap;
  const cx = Math.round(width / 2);

  const categoryLabel = category
    .split(/\s+/)
    .filter(Boolean)
    .map(titleCase)
    .join(" ");

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: RankIntro,${FONT_NAME},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,${outline},0,5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const look = `\\an5\\3c&H000000&\\bord${outline}`;
  let line1: string;
  let line2: string;
  if (template === "YOUTUBER") {
    line1 = `Dialogue: 0,${assTime(0)},${assTime(durationSec)},RankIntro,,0,0,0,,{${look}\\pos(${cx},${line1Y})\\c${WHITE_BGR}}Best {\\c${RED_BGR}}5`;
    line2 = `Dialogue: 0,${assTime(0)},${assTime(durationSec)},RankIntro,,0,0,0,,{${look}\\pos(${cx},${line2Y})\\c${YELLOW_BGR}}${escapeAssText(
      categoryLabel
    )} {\\c${WHITE_BGR}}Clips`;
  } else {
    line1 = `Dialogue: 0,${assTime(0)},${assTime(durationSec)},RankIntro,,0,0,0,,{${look}\\pos(${cx},${line1Y})\\c${WHITE_BGR}}Ranking {\\c${RED_BGR}}Funniest`;
    line2 = `Dialogue: 0,${assTime(0)},${assTime(durationSec)},RankIntro,,0,0,0,,{${look}\\pos(${cx},${line2Y})\\c${YELLOW_BGR}}${escapeAssText(
      categoryLabel
    )} {\\c${WHITE_BGR}}Moments`;
  }

  return header + line1 + "\n" + line2 + "\n";
}

/**
 * Tarjeta de intro de un vídeo de ranking: fondo negro con el texto "Ranking Funniest {Category}
 * Moments" quemado encima, en la fuente/colores exactos pedidos a partir de una captura de
 * referencia real. Si se pasa `audioPath` (narración de IA), la tarjeta dura lo que dure ese
 * audio; si no, lleva una pista de audio silenciosa (mismo motivo que en `renderTitleCard`: todos
 * los tramos que se concatenan después necesitan el mismo número de pistas).
 */
export async function renderRankingIntroCard(
  outPath: string,
  category: string,
  durationSec: number,
  resolution: VerticalResolution,
  audioPath?: string,
  // Imagen propia subida desde la fototeca del editor, en vez del fondo negro por defecto — se
  // recorta/escala a pantalla completa como fondo detrás del texto de la plantilla.
  backgroundImagePath?: string | null,
  template: RankingIntroTemplate = "TOPIC"
): Promise<void> {
  let finalDuration = durationSec;
  if (audioPath) {
    const { durationSec: audioDurationSec } = await probeVideo(audioPath);
    finalDuration = Math.max(durationSec, audioDurationSec + 0.4);
  }

  const assPath = `${outPath}.ass`;
  fs.writeFileSync(assPath, buildRankingIntroAss(category, finalDuration, resolution, template), "utf-8");

  const args = ["-y"];
  if (backgroundImagePath) {
    args.push("-loop", "1", "-t", String(finalDuration), "-i", backgroundImagePath);
  } else {
    args.push("-f", "lavfi", "-i", `color=c=black:s=${resolution.width}x${resolution.height}:d=${finalDuration}`);
  }

  if (audioPath) {
    args.push("-i", audioPath);
  } else {
    args.push("-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=44100:d=${finalDuration}`);
  }

  // Una imagen propia puede venir en cualquier tamaño/proporción: se recorta a pantalla completa
  // (igual que la portada de marca) antes de quemar el texto encima — el fondo negro por defecto
  // ya sale a la resolución exacta y no necesita este paso.
  const videoFilter = backgroundImagePath
    ? `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=increase,crop=${resolution.width}:${resolution.height},subtitles=${escapeSubtitlesPath(assPath)}`
    : `subtitles=${escapeSubtitlesPath(assPath)}`;

  args.push(
    "-vf",
    videoFilter,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-r",
    String(CONCAT_FPS),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    String(CONCAT_AUDIO_SAMPLE_RATE),
    "-ac",
    String(CONCAT_AUDIO_CHANNELS),
    "-shortest",
    outPath
  );

  try {
    await run(config.ffmpegPath, args);
  } finally {
    fs.rmSync(assPath, { force: true });
  }
}

