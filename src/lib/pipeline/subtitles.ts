import type { TranscriptSegment } from "./transcribe";
import { buildColoredCaptionsAss } from "./bigCaptions";

/**
 * Subtítulo normal de abajo: una palabra a la vez, con contorno negro grueso/impactante y un
 * ligero desenfoque tipo brillo (menos intenso que el caption grande del centro, pero visible —
 * pedido explícito a partir de un ejemplo de referencia). Cada palabra sale en un color distinto
 * de la misma paleta que el caption grande, para que la lectura sea interactiva y llame la
 * atención según se va leyendo, en vez de un bloque de texto blanco fijo. Usa el mismo motor que
 * bigCaptions.ts, solo cambia el tamaño, la posición (pegado abajo) y que agrupa de una en una
 * palabra en vez de en golpes de varias.
 */
export function buildBottomCaptionsAss(
  segments: TranscriptSegment[],
  start: number,
  end: number,
  resolution: { width: number; height: number }
): string | null {
  const { width, height } = resolution;
  // Antes height/38: se subió a petición expresa ("un pelín más grande").
  const fontSize = Math.round(height / 30);
  return buildColoredCaptionsAss(segments, start, end, resolution, {
    fontName: "Liberation Sans",
    fontSize,
    // Contorno más grueso (antes /20) para la letra "más gorda e impactante" pedida, y desenfoque
    // ligero (antes 0) para el efecto "brillante" — menos que el caption grande (blur 3) porque
    // esta capa es más pequeña y sigue siendo la secundaria/más discreta de las dos.
    outline: Math.max(1, Math.round(fontSize / 12)),
    outlineColorHex: "000000",
    blur: 2,
    posX: Math.round(width / 2),
    posY: Math.round(height * 0.88),
    maxWordsPerGroup: 1,
    uppercase: false,
  });
}
