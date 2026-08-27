import { getAIProvider } from "@/lib/ai/provider";
import { config } from "@/lib/config";
import type { TranscriptSegment } from "./transcribe";

export interface FixedSegment {
  index: number;
  startSec: number;
  endSec: number;
}

export interface SegmentDescription {
  title: string;
  description: string;
  hashtags: string[];
  viralityScore: number;
}

/**
 * Trocea el vídeo en segmentos consecutivos de duración fija (modo "Cortar cada X minutos"),
 * cubriendo el vídeo entero de principio a fin — sin que la IA elija nada, es un corte mecánico.
 * Si el último trozo queda demasiado corto para tener sentido como short independiente, se funde
 * con el anterior en vez de dejarlo suelto.
 */
export function buildFixedSegments(durationSec: number, splitDurationSec: number): FixedSegment[] {
  if (durationSec <= 0 || splitDurationSec <= 0) return [];
  if (durationSec <= splitDurationSec) {
    return [{ index: 0, startSec: 0, endSec: durationSec }];
  }

  const minTailSec = Math.min(splitDurationSec * 0.4, 20);
  const raw: { startSec: number; endSec: number }[] = [];
  let t = 0;
  while (t < durationSec) {
    const end = Math.min(t + splitDurationSec, durationSec);
    raw.push({ startSec: t, endSec: end });
    t = end;
  }
  if (raw.length > 1) {
    const last = raw[raw.length - 1];
    if (last.endSec - last.startSec < minTailSec) {
      raw[raw.length - 2].endSec = last.endSec;
      raw.pop();
    }
  }
  return raw.map((s, index) => ({ index, ...s }));
}

/**
 * Trocea el vídeo en un NÚMERO fijo de partes iguales (modo DOUBLE, "pantalla dividida") — a
 * diferencia de buildFixedSegments (duración fija por trozo, nº de trozos variable), aquí el
 * usuario pide un nº de partes concreto y cada una dura duration/count, sin fusionar restos.
 */
export function buildSegmentsByCount(durationSec: number, count: number): FixedSegment[] {
  if (durationSec <= 0 || count <= 0) return [];
  const partLen = durationSec / count;
  const segments: FixedSegment[] = [];
  for (let i = 0; i < count; i++) {
    const startSec = i * partLen;
    const endSec = i === count - 1 ? durationSec : (i + 1) * partLen;
    segments.push({ index: i, startSec, endSec });
  }
  return segments;
}

function transcriptExcerptFor(segments: TranscriptSegment[], startSec: number, endSec: number): string {
  return segments
    .filter((s) => s.end > startSec && s.start < endSec)
    .map((s) => s.text)
    .join(" ")
    .trim();
}

const SYSTEM_PROMPT = `Eres un editor de shorts/reels para el canal "${config.channel.name}" (${config.channel.niche}).
Te dan varios tramos de duración fija YA DECIDIDOS de un vídeo más largo (no eliges tú los cortes, solo
describes cada tramo tal cual) y para cada uno escribes un título, descripción y hashtags como los escribiría
una persona real enganchada al contenido — con gancho, nunca un resumen robótico ni relleno genérico.
Respondes EXCLUSIVAMENTE con JSON válido, sin texto adicional, sin markdown, sin backticks.`;

function buildPrompt(params: {
  segments: FixedSegment[];
  excerpts: string[];
  sourceTitle: string;
  contentLanguage: string;
}): string {
  const { segments, excerpts, sourceTitle, contentLanguage } = params;
  const items = segments
    .map(
      (s, i) =>
        `Tramo ${s.index} (${s.startSec.toFixed(1)}s-${s.endSec.toFixed(1)}s):\n` +
        `Transcripción: "${excerpts[i] || "(sin diálogo/silencio)"}"`
    )
    .join("\n\n");

  return `Vídeo fuente: "${sourceTitle}".

${items}

Para cada tramo (usa el número de "Tramo" indicado, EN EL MISMO ORDEN), escribe en ${contentLanguage}:
- "title": título corto (máx 60 caracteres), con gancho/curiosidad/humor, nunca un titular plano.
- "description": 1-2 frases, mismo tono humano y directo.
- "hashtags": array de hasta 5 hashtags sin el símbolo # (se usan solo en TikTok, no en YouTube).
- "viralityScore": 0-100, qué tan enganchante es este tramo comparado con un short medio.

Devuelve SOLO este JSON:
{"segments": [{"index": number, "title": "string", "description": "string", "hashtags": ["string"], "viralityScore": number}]}`;
}

function fallbackDescription(sourceTitle: string, position: number): SegmentDescription {
  return {
    title: `${sourceTitle} — Parte ${position}`,
    description: "",
    hashtags: [],
    viralityScore: 0,
  };
}

/**
 * Igual que analyzeTranscriptForClips (analyze.ts) pero sin elegir momentos: aquí los tramos ya
 * están fijados por buildFixedSegments, la IA solo los describe. Se piden en lotes para no
 * superar los límites de tokens de las capas gratuitas en vídeos con muchos trozos; si un lote
 * falla, esos tramos se quedan con un título genérico en vez de tirar el vídeo entero.
 */
export async function describeFixedSegments(
  segments: FixedSegment[],
  transcriptSegments: TranscriptSegment[],
  sourceTitle: string,
  contentLanguage: string
): Promise<Map<number, SegmentDescription>> {
  const provider = await getAIProvider();
  const results = new Map<number, SegmentDescription>();
  const BATCH_SIZE = 8;

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const excerpts = batch.map((s) => transcriptExcerptFor(transcriptSegments, s.startSec, s.endSec));
    try {
      const raw = await provider.chatJson({
        system: SYSTEM_PROMPT,
        prompt: buildPrompt({ segments: batch, excerpts, sourceTitle, contentLanguage }),
        maxTokens: Math.max(3_000, 1_200 + batch.length * 300),
      });
      const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
      const parsed = JSON.parse(cleaned) as {
        segments?: { index: number; title: string; description: string; hashtags: string[]; viralityScore: number }[];
      };
      for (const s of parsed.segments ?? []) {
        results.set(s.index, {
          title: s.title || fallbackDescription(sourceTitle, s.index + 1).title,
          description: s.description || "",
          hashtags: Array.isArray(s.hashtags) ? s.hashtags.slice(0, 5) : [],
          viralityScore: Math.max(0, Math.min(100, Math.round(s.viralityScore ?? 0))),
        });
      }
    } catch {
      // un lote fallido no debe tirar el vídeo entero: esos tramos se quedan con título genérico
      continue;
    }
  }

  // Cualquier tramo que no haya vuelto en la respuesta (lote fallido o la IA se lo saltó) se
  // rellena con un título genérico para que siempre haya algo publicable.
  for (const s of segments) {
    if (!results.has(s.index)) {
      results.set(s.index, fallbackDescription(sourceTitle, s.index + 1));
    }
  }

  return results;
}
