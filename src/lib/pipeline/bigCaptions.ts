import type { TranscriptSegment } from "./transcribe";

const PAUSE_BREAK_SEC = 0.35; // una pausa natural al hablar corta el golpe, no solo el conteo de palabras
const MIN_CUE_SEC = 0.35;

// Paleta compartida por las dos capas de subtítulo (centro grande y abajo pequeño): verde neón,
// blanco, amarillo, naranja — un color distinto cada vez que aparece una palabra/golpe nuevo,
// para que la lectura se sienta viva e interactiva en vez de un bloque de texto plano.
const PALETTE_RGB = ["00FF66", "FFFFFF", "FFD400", "FF7A1A"];

function assTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.round((clamped - Math.floor(clamped)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** "RRGGBB" -> color inline de ASS/libass, que va en orden BGR ("&HBBGGRR&"). */
function rgbToAssColor(rgbHex: string): string {
  const r = rgbHex.slice(0, 2);
  const g = rgbHex.slice(2, 4);
  const b = rgbHex.slice(4, 6);
  return `&H${b}${g}${r}&`;
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, "").replace(/[{}]/g, "").trim();
}

interface Cue {
  start: number;
  end: number;
  text: string;
}

/**
 * Agrupa en golpes de hasta `maxWordsPerGroup` palabras, cortando por pausa natural al hablar
 * (no solo por conteo fijo) para que el ritmo siga la cadencia real de la voz. Con
 * `maxWordsPerGroup=1` da un cue por palabra suelta.
 */
function groupIntoPhrases(words: { start: number; end: number; text: string }[], maxWordsPerGroup: number): Cue[] {
  const cues: Cue[] = [];
  let group: typeof words = [];

  const flush = () => {
    if (group.length === 0) return;
    const start = group[0].start;
    const end = Math.max(group[group.length - 1].end, start + MIN_CUE_SEC);
    cues.push({ start, end, text: group.map((w) => w.text).join(" ") });
    group = [];
  };

  for (const word of words) {
    const prev = group[group.length - 1];
    if (prev && word.start - prev.end > PAUSE_BREAK_SEC) flush();
    group.push(word);
    if (group.length >= maxWordsPerGroup) flush();
  }
  flush();

  return cues;
}

export interface ColoredCaptionsStyle {
  fontName: string;
  fontSize: number;
  outline: number;
  outlineColorHex: string; // "RRGGBB", sin # ni &H
  blur: number;
  posX: number;
  posY: number;
  maxWordsPerGroup: number;
  uppercase: boolean;
}

/**
 * Motor compartido de subtítulos "de colores": cada golpe de texto (palabra suelta o grupo corto,
 * según `style.maxWordsPerGroup`) sale en un color distinto de la paleta, con su contorno, para
 * que la lectura sea vistosa e interactiva en vez de un bloque de texto estático. Lo usan tanto
 * el caption grande del centro (bigCaptions.ts) como el subtítulo normal de abajo
 * (subtitles.ts) — mismo motor, distinto tamaño/posición/agrupación.
 *
 * Va en .ass (no .srt) porque un .srt plano no soporta color por línea. Devuelve null si no hay
 * marcas de tiempo por palabra Y el tramo tampoco tiene segmentos con texto (fallback a frase
 * entera cuando faltan las marcas de palabra, igual que antes).
 */
export function buildColoredCaptionsAss(
  segments: TranscriptSegment[],
  start: number,
  end: number,
  resolution: { width: number; height: number },
  style: ColoredCaptionsStyle
): string | null {
  const rawWords = segments.flatMap((s) => s.words ?? []);
  const source = rawWords.length > 0 ? rawWords : segments.map((s) => ({ start: s.start, end: s.end, text: s.text }));

  const words = source
    .filter((w) => w.end > start && w.start < end)
    .map((w) => ({
      start: Math.max(0, w.start - start),
      end: Math.min(end - start, w.end - start),
      text: escapeAssText(w.text),
    }))
    .filter((w) => w.text && w.end > w.start);

  if (words.length === 0) return null;

  const cues = groupIntoPhrases(words, style.maxWordsPerGroup);
  if (cues.length === 0) return null;

  const { width, height } = resolution;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Colored,${style.fontName},${style.fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,${style.outline},0,5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines = cues.map((cue, i) => {
    const color = PALETTE_RGB[i % PALETTE_RGB.length];
    const fill = rgbToAssColor(color);
    const text = style.uppercase ? cue.text.toUpperCase() : cue.text;
    const tags = `{\\an5\\pos(${style.posX},${style.posY})\\c${fill}\\3c&H${style.outlineColorHex}&\\bord${style.outline}\\blur${style.blur}}`;
    return `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Colored,,0,0,0,,${tags}${text}`;
  });

  return header + lines.join("\n") + "\n";
}

/**
 * Caption grande del centro: 2-4 palabras por golpe, fuente redondeada (Comic Neue), contorno +
 * desenfoque tipo "brillo/neón" — estilo pedido a partir de capturas reales de referencia
 * (MrBeastClips). Un poco por debajo del centro de la pantalla.
 */
export function buildBigCaptionsAss(
  segments: TranscriptSegment[],
  start: number,
  end: number,
  resolution: { width: number; height: number }
): string | null {
  const { width, height } = resolution;
  const fontSize = Math.round(width / 18);
  return buildColoredCaptionsAss(segments, start, end, resolution, {
    fontName: "Comic Neue",
    fontSize,
    outline: Math.max(1, Math.round(fontSize / 16)),
    outlineColorHex: "101010",
    blur: 3,
    posX: Math.round(width / 2),
    posY: Math.round(height * 0.62),
    maxWordsPerGroup: 4,
    uppercase: true,
  });
}
