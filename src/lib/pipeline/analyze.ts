import { getAIProvider } from "@/lib/ai/provider";
import { config } from "@/lib/config";
import { contentLanguageName } from "@/lib/lang";
import type { TranscriptSegment } from "./transcribe";

export interface MomentCandidate {
  startSec: number;
  endSec: number;
  title: string;
  description: string;
  hook: string;
  viralityScore: number;
  viralityReason: string;
  hashtags: string[];
}

function formatTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
    .join("\n");
}

/**
 * Parte la transcripción en trozos que quepan en una sola petición. Las capas gratuitas de IA
 * limitan los tokens por minuto, y la transcripción de un vídeo de una hora los supera de
 * largo, así que los vídeos largos se analizan por partes y luego se juntan los resultados.
 */
function chunkSegments(segments: TranscriptSegment[], maxChars: number): TranscriptSegment[][] {
  const chunks: TranscriptSegment[][] = [];
  let current: TranscriptSegment[] = [];
  let currentChars = 0;

  for (const segment of segments) {
    const segmentChars = segment.text.length + 24; // + las marcas de tiempo
    if (currentChars + segmentChars > maxChars && current.length > 0) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(segment);
    currentChars += segmentChars;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

const SYSTEM_PROMPT = `Eres un productor experto en contenido viral de shorts/reels para YouTube Shorts, TikTok e Instagram Reels.
Trabajas para el canal "${config.channel.name}", cuyo contenido es: ${config.channel.niche}.
Tu único objetivo es maximizar las visualizaciones, la retención y por tanto los ingresos publicitarios de cada short.
Respondes EXCLUSIVAMENTE con JSON válido, sin texto adicional, sin markdown, sin backticks.`;

function buildPrompt(params: {
  segments: TranscriptSegment[];
  sourceTitle: string;
  durationSec: number;
  maxClips: number;
  partIndex: number;
  partCount: number;
}): string {
  const minLen = config.pipeline.clipMinSeconds;
  const maxLen = config.pipeline.clipMaxSeconds;
  const { segments, sourceTitle, durationSec, maxClips, partIndex, partCount } = params;

  const partNote =
    partCount > 1
      ? `\nEsta es la PARTE ${partIndex + 1} de ${partCount} de un vídeo largo: analiza SOLO el fragmento que se te da
(sus marcas de tiempo ya son las del vídeo completo, úsalas tal cual).`
      : "";

  return `Vídeo fuente: "${sourceTitle}" (duración total: ${Math.round(durationSec)}s).${partNote}

Transcripción con marcas de tiempo en segundos [inicio-fin]:
"""
${formatTranscript(segments)}
"""

Tarea: identifica hasta ${maxClips} de los MEJORES momentos de este fragmento para convertir en shorts virales
(los más divertidos, sorprendentes, polémicos, emotivos o con mayor "gancho" en los primeros 2 segundos).
Escribe TODO el texto que generes (título, descripción, gancho, razón de viralidad, hashtags) en
${contentLanguageName()}, sea cual sea el idioma del vídeo fuente: el audio original del clip nunca se
traduce ni se dobla, se usa tal cual; solo el texto que tú escribes va en ${contentLanguageName()}.
Cada clip debe durar entre ${minLen} y ${maxLen} segundos, empezar y acabar en un punto natural (no cortar una frase a la mitad),
y no solaparse con otros clips elegidos. Si en este fragmento no hay nada realmente bueno, devuelve menos clips (o ninguno).

Para cada clip, evalúa su probabilidad de hacerse viral (0-100) considerando: fuerza del gancho inicial,
sorpresa/emoción, ritmo, si funciona sin contexto previo, y si genera comentarios o ganas de compartir.

Devuelve SOLO este JSON (sin texto extra):
{
  "clips": [
    {
      "startSec": number,
      "endSec": number,
      "title": "título corto y estratégico (máx 60 caracteres, con gancho, en ${contentLanguageName()}, pensado para YouTube Shorts/TikTok, sin comillas ni emojis excesivos)",
      "description": "descripción corta (1-2 frases) de qué pasa en el clip, adaptada al canal ${config.channel.name}",
      "hook": "la frase o momento exacto que engancha en el segundo 0-2",
      "viralityScore": number entre 0 y 100,
      "viralityReason": "explicación breve (1 frase) de por qué puede volverse viral",
      "hashtags": ["array de 6 a 10 hashtags SIN el símbolo #, relevantes para el nicho y la plataforma"]
    }
  ]
}

Ordena el array "clips" de mayor a menor viralityScore.`;
}

function parseClips(raw: string): MomentCandidate[] {
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  const parsed = JSON.parse(cleaned) as { clips?: MomentCandidate[] };
  if (!Array.isArray(parsed.clips)) {
    throw new Error("La IA no devolvió una lista de clips válida.");
  }
  return parsed.clips.filter(
    (c) => Number.isFinite(c.startSec) && Number.isFinite(c.endSec) && c.endSec > c.startSec
  );
}

/** Descarta clips que se solapen con otro ya elegido de mayor puntuación. */
function dropOverlapping(clips: MomentCandidate[]): MomentCandidate[] {
  const kept: MomentCandidate[] = [];
  for (const clip of clips) {
    const overlaps = kept.some((k) => clip.startSec < k.endSec && k.startSec < clip.endSec);
    if (!overlaps) kept.push(clip);
  }
  return kept;
}

export async function analyzeTranscriptForClips(
  segments: TranscriptSegment[],
  sourceTitle: string,
  durationSec: number,
  onProgress?: (partIndex: number, partCount: number) => Promise<void> | void
): Promise<MomentCandidate[]> {
  const provider = getAIProvider();
  const maxClips = config.pipeline.maxClipsPerJob;
  const chunks = chunkSegments(segments, config.ai.maxTranscriptChars);

  // Con muchas partes se piden menos clips por parte, para no acabar con cientos de candidatos.
  const clipsPerChunk = chunks.length > 1 ? Math.max(2, Math.ceil((maxClips * 1.5) / chunks.length)) : maxClips;

  const all: MomentCandidate[] = [];
  const errors: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    await onProgress?.(i, chunks.length);
    try {
      const raw = await provider.chatJson({
        system: SYSTEM_PROMPT,
        prompt: buildPrompt({
          segments: chunks[i],
          sourceTitle,
          durationSec,
          maxClips: clipsPerChunk,
          partIndex: i,
          partCount: chunks.length,
        }),
        // Margen extra: los modelos con razonamiento (p.ej. Qwen3 en Groq) gastan parte del
        // presupuesto de tokens en su razonamiento interno aunque se oculte del resultado final,
        // así que 2000 se quedaba corto y cortaba el JSON a medias.
        maxTokens: 3_500,
      });
      all.push(...parseClips(raw));
    } catch (err) {
      // Una parte fallida no debe tirar el vídeo entero: se anota y se sigue con las demás.
      errors.push(`parte ${i + 1}: ${(err as Error).message}`);
    }
  }

  if (all.length === 0) {
    throw new Error(
      errors.length > 0
        ? `La IA no pudo analizar el vídeo (${errors.join(" | ")})`
        : "La IA no encontró momentos aprovechables en este vídeo."
    );
  }

  const ranked = all.sort((a, b) => b.viralityScore - a.viralityScore);
  return dropOverlapping(ranked).slice(0, maxClips);
}
