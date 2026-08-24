import crypto from "crypto";
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
  const clean = rgbHex.replace(/^#/, "");
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H${b}${g}${r}&`;
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, "").replace(/[{}]/g, "").trim();
}

export interface CueWord {
  start: number;
  end: number;
  text: string;
}

/** Estilo propio de un golpe de subtítulo, editable desde el editor — cualquier campo que no se
 *  indique usa el valor por defecto de todo el clip (ver `defaultBigCaptionsStyle`). */
export interface CueStyle {
  fontName?: string;
  fontSize?: number;
  colorHex?: string; // "RRGGBB", sin # ni &H — color base (sin resaltar) de este golpe
  xPct?: number; // 0-100, centro horizontal
  yPct?: number; // 0-100, centro vertical
}

/**
 * Un golpe de subtítulo tal y como se guarda en la base de datos (`Clip.captionCues`), para poder
 * editarlo/borrarlo desde el editor y volver a generar el vídeo después. `words` conserva el
 * timestamp por palabra original (para el resaltado "karaoke"); si el usuario edita el texto del
 * golpe, `editedText` manda y ese golpe se renderiza en blanco fijo, sin resaltado por palabra
 * (los timestamps originales ya no se corresponden con el texto nuevo). `style` permite cambiar el
 * tamaño/posición/color/tipo de letra de ESE golpe en concreto, sin afectar al resto del clip.
 */
export interface StoredCue {
  id: string;
  start: number;
  end: number;
  words: CueWord[];
  editedText?: string | null;
  deleted?: boolean;
  style?: CueStyle;
}

/**
 * Agrupa en golpes de hasta `maxWordsPerGroup` palabras, cortando por pausa natural al hablar
 * (no solo por conteo fijo) para que el ritmo siga la cadencia real de la voz. Genera un `id`
 * estable por golpe para poder editarlo/borrarlo después desde el editor.
 */
function groupIntoPhrases(words: CueWord[], maxWordsPerGroup: number): StoredCue[] {
  const cues: StoredCue[] = [];
  let group: CueWord[] = [];

  const flush = () => {
    if (group.length === 0) return;
    const start = group[0].start;
    const end = Math.max(group[group.length - 1].end, start + MIN_CUE_SEC);
    cues.push({ id: crypto.randomUUID(), start, end, words: group });
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

/**
 * Deriva los golpes de subtítulo (con timestamps relativos al inicio del clip) a partir de la
 * transcripción completa — el primer paso de `buildBigCaptionsAss`, expuesto aparte para poder
 * guardar el resultado en `Clip.captionCues` justo después de generarlo (ver runPipeline.ts).
 */
export function cuesFromTranscript(
  segments: TranscriptSegment[],
  start: number,
  end: number,
  maxWordsPerGroup: number,
  uppercase: boolean
): StoredCue[] {
  const rawWords = segments.flatMap((s) => s.words ?? []);
  const source = rawWords.length > 0 ? rawWords : segments.map((s) => ({ start: s.start, end: s.end, text: s.text }));

  const words = source
    .filter((w) => w.end > start && w.start < end)
    .map((w) => ({
      start: Math.max(0, w.start - start),
      end: Math.min(end - start, w.end - start),
      text: escapeAssText(uppercase ? w.text.toUpperCase() : w.text),
    }))
    .filter((w) => w.text && w.end > w.start);

  if (words.length === 0) return [];
  return groupIntoPhrases(words, maxWordsPerGroup);
}

export interface BigCaptionsStyle {
  fontName: string;
  fontSize: number;
  outline: number;
  outlineColorHex: string; // "RRGGBB", sin # ni &H
  blur: number;
  posX: number;
  posY: number;
  // Color base (sin resaltar) y de resaltado "karaoke" de este estilo — si no se indican, usan los
  // valores por defecto de toda la app (BASE_COLOR_HEX/HIGHLIGHT_COLOR_HEX). Solo modos SPLIT/
  // DOUBLE los cambian de momento (ver defaultSplitDoubleCaptionsStyle), el resto sigue con blanco/
  // verde de siempre.
  baseColorHex?: string;
  highlightColorHex?: string;
}

function defaultBigCaptionsStyle(resolution: { width: number; height: number }): BigCaptionsStyle {
  const { width, height } = resolution;
  // "un poco más grande" y "la letra más gorda" que versiones anteriores (antes width/18) — pedido
  // explícito tras ver el resultado en vídeo real.
  const fontSize = Math.round(width / 14);
  return {
    fontName: "Comic Neue",
    fontSize,
    outline: Math.max(1, Math.round(fontSize / 13)),
    outlineColorHex: "101010",
    blur: 3,
    posX: Math.round(width / 2),
    posY: Math.round(height * 0.62),
  };
}

/**
 * Estilo de subtítulos SOLO para los modos SPLIT ("cortar en shorts") y DOUBLE ("doble") — pedido
 * explícito a partir de una captura de referencia (vídeo estilo "MI NOMBRE ES"): tipografía y
 * tamaño distintos del resto de modos, colores blanco/amarillo (en vez de blanco/verde), y
 * posicionados abajo del todo — "justo debajo del clip" en SPLIT, "justo debajo del clip de abajo"
 * en DOUBLE (que, al ocupar el mismo alto total de fotograma que SPLIT, cae igual de abajo en
 * ambos: dentro/pegado al borde inferior de la mitad de abajo). Ningún otro modo usa este estilo.
 */
export function defaultSplitDoubleCaptionsStyle(resolution: { width: number; height: number }): BigCaptionsStyle {
  const { width, height } = resolution;
  const fontSize = Math.round(width / 16);
  return {
    fontName: "Anton",
    fontSize,
    outline: Math.max(1, Math.round(fontSize / 12)),
    outlineColorHex: "101010",
    blur: 2,
    posX: Math.round(width / 2),
    posY: Math.round(height * 0.9),
    baseColorHex: "FFFFFF",
    highlightColorHex: "FFD400",
  };
}

/**
 * Renderiza el `.ass` del caption grande del centro a partir de golpes YA agrupados (`StoredCue[]`)
 * — usado tanto por `buildBigCaptionsAss` (con los golpes recién derivados de la transcripción)
 * como por el editor al regenerar un clip (con los golpes guardados, ya editados/con algunos
 * borrados). Un golpe sin `editedText` se resalta palabra a palabra en verde según se va diciendo
 * (estilo "karaoke"); un golpe con `editedText` (el usuario cambió el texto) se muestra en blanco
 * fijo sin resaltado, porque los timestamps por palabra ya no corresponden al texto nuevo. Los
 * golpes con `deleted: true` no se renderizan.
 *
 * Va en `.ass` (no `.srt`) porque necesita color/tamaño distintos dentro de la misma línea, algo
 * que un `.srt` plano no soporta. La posición va con `\pos()` explícito, no con `MarginV` del
 * Style: con `Alignment=5` (centro) libass no siempre respeta `MarginV` para desplazar verticalmente.
 */
export function buildBigCaptionsAssFromCues(
  cues: StoredCue[],
  resolution: { width: number; height: number },
  style: BigCaptionsStyle = defaultBigCaptionsStyle(resolution)
): string | null {
  const visible = cues.filter((c) => !c.deleted && c.end > c.start);
  if (visible.length === 0) return null;

  const { width, height } = resolution;
  const highlightFill = rgbToAssColor(style.highlightColorHex || HIGHLIGHT_COLOR_HEX);

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

  // Cada golpe puede llevar su propio tamaño/posición/color/tipo de letra (editable desde el
  // editor) — si no lo indica, usa el estilo por defecto de todo el clip. Se calcula tag por tag
  // en vez de compartir un único Style de ASS, porque cada golpe puede necesitar valores distintos.
  function tagsFor(cue: StoredCue): { tags: string; baseFill: string } {
    const s = cue.style;
    const fontName = s?.fontName || style.fontName;
    const fontSize = s?.fontSize || style.fontSize;
    const outline = Math.max(1, Math.round(fontSize / 13));
    const xPct = s?.xPct ?? (style.posX / width) * 100;
    const yPct = s?.yPct ?? (style.posY / height) * 100;
    const x = Math.round((xPct / 100) * width);
    const y = Math.round((yPct / 100) * height);
    const baseFill = rgbToAssColor(s?.colorHex || style.baseColorHex || BASE_COLOR_HEX);
    const tags =
      `\\an5\\pos(${x},${y})\\fn${fontName}\\fs${fontSize}\\3c&H${style.outlineColorHex}&\\bord${outline}\\blur${style.blur}`;
    return { tags, baseFill };
  }

  const lines: string[] = [];

  for (const cue of visible) {
    const { tags, baseFill } = tagsFor(cue);

    if (cue.editedText != null) {
      const text = escapeAssText(cue.editedText);
      if (!text) continue;
      lines.push(`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Big,,0,0,0,,{${tags}\\c${baseFill}}${text}`);
      continue;
    }

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
      lines.push(`Dialogue: 0,${assTime(win.start)},${assTime(win.end)},Big,,0,0,0,,{${tags}\\c${baseFill}}${text}`);
    }
  }

  if (lines.length === 0) return null;
  return header + lines.join("\n") + "\n";
}

export function buildBigCaptionsAss(
  segments: TranscriptSegment[],
  start: number,
  end: number,
  resolution: { width: number; height: number }
): string | null {
  const cues = cuesFromTranscript(segments, start, end, 4, true);
  if (cues.length === 0) return null;
  return buildBigCaptionsAssFromCues(cues, resolution);
}

/** Texto que el usuario añade a mano en el editor, con su propia fuente/color/tamaño/posición. */
export interface CustomTextElement {
  id: string;
  text: string;
  start: number;
  end: number;
  xPct: number; // 0-100, centro del texto (horizontal)
  yPct: number; // 0-100, centro del texto (vertical)
  fontName: string;
  fontSize: number; // px, a la resolución real del vídeo
  colorHex: string; // "RRGGBB", sin # ni &H
  uppercase?: boolean;
}

/**
 * Capa de texto libre añadida a mano por el usuario en el editor (distinta del caption automático
 * de arriba) — cada elemento lleva su propia fuente/tamaño/color como tags `\fn`/`\fs`/`\c` inline,
 * ya que aquí cada Dialogue puede tener un estilo completamente distinto al de al lado (no tiene
 * sentido compartir un único Style de ASS como en `buildBigCaptionsAssFromCues`).
 */
export function buildCustomTextAss(
  texts: CustomTextElement[],
  resolution: { width: number; height: number }
): string | null {
  const visible = texts.filter((t) => t.text.trim() && t.end > t.start);
  if (visible.length === 0) return null;

  const { width, height } = resolution;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Custom,Arial,60,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines = visible.map((t) => {
    const text = escapeAssText(t.uppercase ? t.text.toUpperCase() : t.text);
    const x = Math.round((t.xPct / 100) * width);
    const y = Math.round((t.yPct / 100) * height);
    const fill = rgbToAssColor(t.colorHex);
    const outline = Math.max(1, Math.round(t.fontSize / 12));
    const tags = `{\\an5\\pos(${x},${y})\\fn${t.fontName}\\fs${t.fontSize}\\c${fill}\\3c&H000000&\\bord${outline}}`;
    return `Dialogue: 0,${assTime(t.start)},${assTime(t.end)},Custom,,0,0,0,,${tags}${text}`;
  });

  return header + lines.join("\n") + "\n";
}
