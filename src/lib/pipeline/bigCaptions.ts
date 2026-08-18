import type { TranscriptSegment } from "./transcribe";

const PAUSE_BREAK_SEC = 0.35; // una pausa natural al hablar corta el golpe, no solo el conteo de palabras
const MIN_CUE_SEC = 0.35;

const BASE_COLOR_HEX = "FFFFFF"; // blanco, pedido explícito ("los subtítulos... blancos")
const HIGHLIGHT_COLOR_HEX = "00FF66"; // verde de marca, el mismo que ya se usaba en la paleta anterior
const HIGHLIGHT_SCALE_PCT = 125; // "se haga un poco más grande" mientras se dice esa palabra

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

interface CueWord {
  start: number;
  end: number;
  text: string;
}

interface Cue {
  start: number;
  end: number;
  words: CueWord[];
}

/**
 * Agrupa en golpes de hasta `maxWordsPerGroup` palabras, cortando por pausa natural al hablar
 * (no solo por conteo fijo) para que el ritmo siga la cadencia real de la voz.
 */
function groupIntoPhrases(words: CueWord[], maxWordsPerGroup: number): Cue[] {
  const cues: Cue[] = [];
  let group: CueWord[] = [];

  const flush = () => {
    if (group.length === 0) return;
    const start = group[0].start;
    const end = Math.max(group[group.length - 1].end, start + MIN_CUE_SEC);
    cues.push({ start, end, words: group });
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

export interface BigCaptionsStyle {
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
 * Caption grande del centro: 2-4 palabras por golpe, en blanco, y la palabra exacta que se está
 * diciendo en ese instante cambia a verde y se agranda un poco — al terminar de decirse, vuelve a
 * blanco y tamaño normal (estilo "karaoke" pedido explícitamente). Fuente redondeada (Comic Neue),
 * contorno + desenfoque tipo "brillo/neón" — estilo pedido a partir de capturas reales de
 * referencia (MrBeastClips).
 *
 * Va en .ass (no .srt) porque necesita color/tamaño distintos dentro de la misma línea, algo que
 * un .srt plano no soporta: cada Dialogue cubre la ventana exacta en la que UNA palabra del golpe
 * está activa (o ninguna, en el hueco entre palabras), con esa palabra resaltada dentro del texto
 * completo del golpe vía tags inline — así el resto de palabras se ven en su sitio todo el rato y
 * solo la activa cambia. La posición va con `\pos()` explícito, no con `MarginV` del Style: con
 * `Alignment=5` (centro) libass no siempre respeta `MarginV` para desplazar verticalmente.
 */
export function buildBigCaptionsAssFromStyle(
  segments: TranscriptSegment[],
  start: number,
  end: number,
  resolution: { width: number; height: number },
  style: BigCaptionsStyle
): string | null {
  const rawWords = segments.flatMap((s) => s.words ?? []);
  const source = rawWords.length > 0 ? rawWords : segments.map((s) => ({ start: s.start, end: s.end, text: s.text }));

  const words = source
    .filter((w) => w.end > start && w.start < end)
    .map((w) => ({
      start: Math.max(0, w.start - start),
      end: Math.min(end - start, w.end - start),
      text: escapeAssText(style.uppercase ? w.text.toUpperCase() : w.text),
    }))
    .filter((w) => w.text && w.end > w.start);

  if (words.length === 0) return null;

  const cues = groupIntoPhrases(words, style.maxWordsPerGroup);
  if (cues.length === 0) return null;

  const { width, height } = resolution;
  const baseFill = rgbToAssColor(BASE_COLOR_HEX);
  const highlightFill = rgbToAssColor(HIGHLIGHT_COLOR_HEX);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Big,${style.fontName},${style.fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,${style.outline},0,5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const posAndLook = `\\an5\\pos(${style.posX},${style.posY})\\3c&H${style.outlineColorHex}&\\bord${style.outline}\\blur${style.blur}`;

  const lines: string[] = [];

  for (const cue of cues) {
    // Ventanas de tiempo dentro del golpe: cada palabra activa mientras se dice, y huecos "sin
    // palabra activa" (todo en blanco) entre una palabra y la siguiente si hay una pequeña pausa.
    type Window = { start: number; end: number; activeIndex: number | null };
    const windows: Window[] = [];
    let cursor = cue.start;
    cue.words.forEach((w, i) => {
      if (w.start > cursor) windows.push({ start: cursor, end: w.start, activeIndex: null });
      windows.push({ start: w.start, end: w.end, activeIndex: i });
      cursor = w.end;
    });
    if (cursor < cue.end) windows.push({ start: cursor, end: cue.end, activeIndex: null });

    for (const win of windows) {
      if (win.end <= win.start) continue;
      const text = cue.words
        .map((w, i) => {
          if (i === win.activeIndex) {
            return `{\\c${highlightFill}\\fscx${HIGHLIGHT_SCALE_PCT}\\fscy${HIGHLIGHT_SCALE_PCT}}${w.text}{\\c${baseFill}\\fscx100\\fscy100}`;
          }
          return w.text;
        })
        .join(" ");
      lines.push(`Dialogue: 0,${assTime(win.start)},${assTime(win.end)},Big,,0,0,0,,{${posAndLook}}${text}`);
    }
  }

  return header + lines.join("\n") + "\n";
}

export function buildBigCaptionsAss(
  segments: TranscriptSegment[],
  start: number,
  end: number,
  resolution: { width: number; height: number }
): string | null {
  const { width, height } = resolution;
  // "un poco más grande" y "la letra más gorda" que la versión anterior (width/18) — pedido
  // explícito tras ver el resultado en vídeo real.
  const fontSize = Math.round(width / 14);
  return buildBigCaptionsAssFromStyle(segments, start, end, resolution, {
    fontName: "Comic Neue",
    fontSize,
    outline: Math.max(1, Math.round(fontSize / 13)),
    outlineColorHex: "101010",
    blur: 3,
    posX: Math.round(width / 2),
    posY: Math.round(height * 0.62),
    maxWordsPerGroup: 4,
    uppercase: true,
  });
}
