import type { TranscriptSegment } from "./transcribe";
import { buildColoredCaptionsAss } from "./bigCaptions";

/**
 * Subtítulo normal de abajo: una palabra a la vez, tamaño pequeño/normal, con un contorno negro
 * fino (sin desenfoque/brillo — eso se deja para el caption grande del centro). Cada palabra sale
 * en un color distinto de la misma paleta que el caption grande, para que la lectura sea
 * interactiva y llame la atención según se va leyendo, en vez de un bloque de texto blanco fijo —
 * pedido explícito del usuario. Usa el mismo motor que bigCaptions.ts, solo cambia el tamaño, la
 * posición (pegado abajo) y que agrupa de una en una palabra en vez de en golpes de varias.
 */
export function buildBottomCaptionsAss(
  segments: TranscriptSegment[],
  start: number,
  end: number,
  resolution: { width: number; height: number }
): string | null {
  const { width, height } = resolution;
  const fontSize = Math.round(height / 38);
  return buildColoredCaptionsAss(segments, start, end, resolution, {
    fontName: "Liberation Sans",
    fontSize,
    outline: Math.max(1, Math.round(fontSize / 20)),
    outlineColorHex: "000000",
    blur: 0,
    posX: Math.round(width / 2),
    posY: Math.round(height * 0.88),
    maxWordsPerGroup: 1,
    uppercase: false,
  });
}
