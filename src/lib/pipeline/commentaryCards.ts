import { getTTSProvider } from "@/lib/tts/provider";
import { renderTitleCard, wrapText } from "./clip";
import { candidateCardPath, narrationAudioPath } from "@/lib/storagePaths";
import type { VerticalResolution } from "./probe";

const COMMENTARY_FONT_DIVISOR = 16;
const COMMENTARY_MAX_CHARS_PER_LINE = 24;
const COMMENTARY_MIN_DURATION_SEC = 2;

/**
 * Sintetiza la narración de un texto de comentario y renderiza una tarjeta con ese texto
 * envuelto en varias líneas, lista para concatenar junto al clip. Se usa para los tramos de
 * intro/cierre narrados en modo SINGLE y RANKING.
 */
export async function renderCommentaryCard(params: {
  jobId: string;
  clipId: string;
  key: string;
  text: string;
  resolution: VerticalResolution;
}): Promise<string> {
  const tts = getTTSProvider();
  const audioPath = narrationAudioPath(params.jobId, params.clipId, params.key);
  await tts.synthesize(params.text, audioPath);

  const cardPath = candidateCardPath(params.jobId, params.clipId, params.key);
  const wrapped = wrapText(params.text, COMMENTARY_MAX_CHARS_PER_LINE);
  await renderTitleCard(
    cardPath,
    wrapped,
    COMMENTARY_MIN_DURATION_SEC,
    params.resolution,
    audioPath,
    COMMENTARY_FONT_DIVISOR
  );
  return cardPath;
}

/** Sintetiza narración para un texto y la añade a una tarjeta ya diseñada (p.ej. "#5\nEtiqueta"). */
export async function narrateExistingCard(params: {
  jobId: string;
  clipId: string;
  key: string;
  narrationText: string;
  cardText: string;
  durationSec: number;
  resolution: VerticalResolution;
  outPath: string;
}): Promise<void> {
  const tts = getTTSProvider();
  const audioPath = narrationAudioPath(params.jobId, params.clipId, params.key);
  await tts.synthesize(params.narrationText, audioPath);
  await renderTitleCard(params.outPath, params.cardText, params.durationSec, params.resolution, audioPath);
}
