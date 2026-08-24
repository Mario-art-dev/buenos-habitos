import fs from "fs";
import { config } from "@/lib/config";
import { run } from "./exec";
import type { VerticalResolution } from "./probe";

// Mismos colores/fuente de marca que antes en rankingIntroCard.ts (pedidos a partir de una
// captura real de referencia) — se mantienen para el título, ver buildTitleLines.
const WHITE_BGR = "&HFFFFFF&";
const RED_BGR = "&H0000FF&";
const YELLOW_BGR = "&H00D4FF&";
const FONT_NAME = "Anton";

// Colores llamativos por puesto (1..5), pedidos a partir de una captura real de referencia de un
// ranking (números en amarillo/verde/naranja/magenta/cian) — se repiten en bucle si hubiera más
// de 5 puestos (no debería pasar con RANKING_MAX_ITEMS=5, ver config.ts).
const POSITION_COLORS = ["&H00D4FF&", "&H5FE739&", "&H00A5FF&", "&HA63DFF&", "&HFFE122&"];

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

// "TOPIC" (gracioso/temática): "Ranking Funniest {Category} Moments". "YOUTUBER": "Best 5 {Name}
// Clips", para cuando la sección pedida es "los mejores clips de tal creador" en vez de una
// temática — mismo estilo (fuente/colores), solo cambia qué palabras van fijas y cuál es la
// variable (ver rankingAnalyze.ts groupIntoRankings / Job.manualCategories).
export type RankingOverlayTemplate = "TOPIC" | "YOUTUBER";

export interface RankingListItem {
  position: number; // 1 = mejor, se muestra ARRIBA de la lista
  label: string;
  // Segundo del vídeo YA MONTADO en el que empieza el clip de este puesto — a partir de ahí se
  // añade su etiqueta junto al número; antes solo se ve el número suelto (ya en su color vivo).
  revealAtSec: number;
}

function buildTitleLines(category: string, template: RankingOverlayTemplate, totalDurationSec: number, resolution: VerticalResolution): string[] {
  const { width, height } = resolution;
  const fontSize = Math.round(width / 7);
  const outline = Math.max(2, Math.round(fontSize / 11));
  const lineGap = Math.round(fontSize * 0.12);
  const line1Y = Math.round(height * 0.08);
  const line2Y = line1Y + fontSize + lineGap;
  const cx = Math.round(width / 2);
  const categoryLabel = category
    .split(/\s+/)
    .filter(Boolean)
    .map(titleCase)
    .join(" ");
  const look = `\\an5\\3c&H000000&\\bord${outline}\\shad2`;

  if (template === "YOUTUBER") {
    return [
      `Dialogue: 1,${assTime(0)},${assTime(totalDurationSec)},Base,,0,0,0,,{${look}\\fs${fontSize}\\pos(${cx},${line1Y})\\c${WHITE_BGR}}Best {\\c${RED_BGR}}5`,
      `Dialogue: 1,${assTime(0)},${assTime(totalDurationSec)},Base,,0,0,0,,{${look}\\fs${fontSize}\\pos(${cx},${line2Y})\\c${YELLOW_BGR}}${escapeAssText(
        categoryLabel
      )} {\\c${WHITE_BGR}}Clips`,
    ];
  }
  return [
    `Dialogue: 1,${assTime(0)},${assTime(totalDurationSec)},Base,,0,0,0,,{${look}\\fs${fontSize}\\pos(${cx},${line1Y})\\c${WHITE_BGR}}Ranking {\\c${RED_BGR}}Funniest`,
    `Dialogue: 1,${assTime(0)},${assTime(totalDurationSec)},Base,,0,0,0,,{${look}\\fs${fontSize}\\pos(${cx},${line2Y})\\c${YELLOW_BGR}}${escapeAssText(
      categoryLabel
    )} {\\c${WHITE_BGR}}Moments`,
  ];
}

function buildListLines(items: RankingListItem[], totalDurationSec: number, resolution: VerticalResolution): string[] {
  const { width, height } = resolution;
  // Tamaño del número fijo (no depende de cuántas filas haya) — pedido explícito: los números se
  // quedan grandes, lo que se aprieta es el hueco ENTRE filas. La etiqueta va más pequeña que el
  // número, en el mismo color, pegada justo detrás en la misma línea (mismo \pos, mismo \an4).
  const numberFontSize = Math.max(50, Math.round(height * 0.075));
  const labelFontSize = Math.max(34, Math.round(numberFontSize * 0.6));
  // Pedido explícito: filas más juntas — la altura de línea ya no reparte todo el hueco disponible
  // entre pocas filas, es justo lo que ocupa el número más un margen pequeño.
  const lineHeight = Math.round(numberFontSize * 1.08);
  const listTop = height * 0.3;
  const outline = Math.max(3, Math.round(numberFontSize / 9));
  const labelOutline = Math.max(2, Math.round(labelFontSize / 9));
  const x = Math.round(width * 0.05);

  const lines: string[] = [];
  const sorted = [...items].sort((a, b) => a.position - b.position);
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const color = POSITION_COLORS[i % POSITION_COLORS.length];
    const y = Math.round(listTop + i * lineHeight + lineHeight / 2);
    const revealAt = Math.max(0, Math.min(item.revealAtSec, totalDurationSec));
    // Sin caja de fondo (BorderStyle 1, solo contorno+sombra) — pedido explícito: nada de "barra"
    // detrás del texto. El número sale SIEMPRE en su color vivo desde el segundo 0; lo único que
    // cambia al revelarse es que se le añade la etiqueta al lado, más pequeña.
    const numberTag = `\\an4\\3c&H000000&\\bord${outline}\\shad3\\fs${numberFontSize}\\pos(${x},${y})\\c${color}`;
    const bareText = `{${numberTag}}${item.position}.-`;
    const revealedText = `{${numberTag}}${item.position}.- {\\fs${labelFontSize}\\bord${labelOutline}}${escapeAssText(item.label)}`;

    if (revealAt > 0.05) {
      lines.push(`Dialogue: 0,${assTime(0)},${assTime(revealAt)},Base,,0,0,0,,${bareText}`);
    }
    lines.push(`Dialogue: 0,${assTime(revealAt)},${assTime(totalDurationSec)},Base,,0,0,0,,${revealedText}`);
  }
  return lines;
}

function buildRankingOverlayAss(
  category: string,
  template: RankingOverlayTemplate,
  items: RankingListItem[],
  totalDurationSec: number,
  resolution: VerticalResolution
): string {
  const { width, height } = resolution;
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Base,${FONT_NAME},${Math.round(width / 10)},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,2,5,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const titleLines = buildTitleLines(category, template, totalDurationSec, resolution);
  const listLines = buildListLines(items, totalDurationSec, resolution);
  return header + [...titleLines, ...listLines].join("\n") + "\n";
}

/**
 * Quema el título del ranking ("Ranking Funniest {Category} Moments" / "Best 5 {Name} Clips") y
 * la lista numerada de puestos (1.-, 2.-, 3.-…) como UNA sola capa PERSISTENTE encima del vídeo YA
 * montado entero — pedido explícito: ambos se quedan en pantalla todo el vídeo (no una tarjeta de
 * título aparte al principio), en letra grande, y cada número ya sale en su color vivo desde el
 * segundo 0, revelando su etiqueta (misma familia de colores) en el segundo exacto en que empieza
 * su propio clip. Sin caja de fondo detrás del texto (solo contorno+sombra) para que no parezca
 * subrayado. Devuelve el vídeo con ambas capas ya quemadas.
 */
export async function burnRankingOverlay(
  inputPath: string,
  outputPath: string,
  category: string,
  template: RankingOverlayTemplate,
  items: RankingListItem[],
  totalDurationSec: number,
  resolution: VerticalResolution
): Promise<void> {
  const assPath = `${outputPath}.ass`;
  fs.writeFileSync(assPath, buildRankingOverlayAss(category, template, items, totalDurationSec, resolution), "utf-8");

  try {
    await run(config.ffmpegPath, [
      "-y",
      "-i",
      inputPath,
      "-vf",
      `subtitles=${escapeSubtitlesPath(assPath)}`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
  } finally {
    fs.rmSync(assPath, { force: true });
  }
}
