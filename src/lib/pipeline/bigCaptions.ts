import type { TranscriptSegment } from "./transcribe";

const MAX_WORDS_PER_GROUP = 4;
const PAUSE_BREAK_SEC = 0.35; // una pausa natural al hablar corta el golpe, no solo el conteo de palabras
const MIN_CUE_SEC = 0.35;

// Paleta inspirada en el ejemplo real que pidió el usuario (MrBeastClips): verde neón, blanco,
// amarillo, naranja — un color distinto por golpe de texto para que se sienta vivo, no plano.
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
 * Agrupa en golpes de 2-4 palabras, cortando por pausa natural al hablar (no solo por conteo
 * fijo) para que el ritmo siga la cadencia real de la voz en vez de sentirse mecánico.
 */
function groupIntoPhrases(words: { start: number; end: number; text: string }[]): Cue[] {
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
    if (group.length >= MAX_WORDS_PER_GROUP) flush();
  }
  flush();

  return cues;
}

/**
 * Genera un .ass (no .srt: hace falta para poder dar un color/brillo distinto a cada golpe de
 * texto, cosa que un .srt plano no soporta) con el estilo "caption grande" tipo MrBeastClips que
 * pidió el usuario: 2-4 palabras por golpe, en el centro de la pantalla, con un color distinto
 * cada vez y un contorno + desenfoque que da un efecto de brillo. Es una capa APARTE del
 * subtítulo pequeño de abajo (ver subtitles.ts): se queman los dos a la vez, uno en el centro y
 * otro pegado abajo, igual que en el vídeo de referencia. Devuelve null si no hay marcas de
 * tiempo por palabra (no se puede agrupar en golpes cortos sin ellas) o si el tramo está en
 * silencio, igual que hace buildSrt.
 */
export function buildBigCaptionsAss(
  segments: TranscriptSegment[],
  start: number,
  end: number,
  resolution: { width: number; height: number }
): string | null {
  const words = segments
    .flatMap((s) => s.words ?? [])
    .filter((w) => w.end > start && w.start < end)
    .map((w) => ({
      start: Math.max(0, w.start - start),
      end: Math.min(end - start, w.end - start),
      text: escapeAssText(w.text),
    }))
    .filter((w) => w.text && w.end > w.start);

  if (words.length === 0) return null;

  const cues = groupIntoPhrases(words);
  if (cues.length === 0) return null;

  const { width, height } = resolution;
  // La mitad de grande que antes (antes width/9) a petición expresa del usuario.
  const fontSize = Math.round(width / 18);
  const outline = Math.max(1, Math.round(fontSize / 16));
  // Posición fija con \pos() en vez de fiarse de MarginV: con Alignment=5 (centro) libass no
  // siempre respeta MarginV para desplazar verticalmente, así que \pos() es la única forma
  // fiable de ponerlo "un poco más abajo del centro" como se pidió, no en el centro exacto.
  const posX = Math.round(width / 2);
  const posY = Math.round(height * 0.62);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Big,Comic Neue,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,${outline},0,5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines = cues.map((cue, i) => {
    const color = PALETTE_RGB[i % PALETTE_RGB.length];
    const fill = rgbToAssColor(color);
    // Contorno oscuro + blur: aproximación estándar de libass para un efecto "brillo/neón" sin
    // dibujar una segunda capa desenfocada aparte. \an5\pos fija la posición exacta (ver arriba).
    const tags = `{\\an5\\pos(${posX},${posY})\\c${fill}\\3c&H101010&\\bord${outline}\\blur3}`;
    return `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Big,,0,0,0,,${tags}${cue.text.toUpperCase()}`;
  });

  return header + lines.join("\n") + "\n";
}
