import type { TranscriptSegment } from "./transcribe";

function srtTime(sec: number): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rem = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(rem).padStart(3, "0")}`;
}

/** Genera el contenido de un .srt para el tramo [start, end] de un vídeo, con tiempos relativos a ese tramo. */
export function buildSrt(segments: TranscriptSegment[], start: number, end: number): string | null {
  const overlapping = segments
    .filter((s) => s.end > start && s.start < end)
    .map((s) => ({ start: Math.max(0, s.start - start), end: Math.min(end - start, s.end - start), text: s.text.trim() }))
    .filter((s) => s.text && s.end > s.start);

  if (overlapping.length === 0) return null;

  return overlapping
    .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`)
    .join("\n");
}
