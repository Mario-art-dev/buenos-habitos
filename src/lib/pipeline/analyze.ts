import { getAIProvider } from "@/lib/ai/provider";
import { config } from "@/lib/config";
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

const SYSTEM_PROMPT = `Eres un productor experto en contenido viral de shorts/reels para YouTube Shorts, TikTok e Instagram Reels.
Trabajas para el canal "${config.channel.name}", cuyo contenido es: ${config.channel.niche}.
Tu único objetivo es maximizar las visualizaciones, la retención y por tanto los ingresos publicitarios de cada short.
Respondes EXCLUSIVAMENTE con JSON válido, sin texto adicional, sin markdown, sin backticks.`;

function buildPrompt(segments: TranscriptSegment[], sourceTitle: string, durationSec: number): string {
  const maxClips = config.pipeline.maxClipsPerJob;
  const minLen = config.pipeline.clipMinSeconds;
  const maxLen = config.pipeline.clipMaxSeconds;

  return `Vídeo fuente: "${sourceTitle}" (duración total: ${Math.round(durationSec)}s).

Transcripción con marcas de tiempo en segundos [inicio-fin]:
"""
${formatTranscript(segments)}
"""

Tarea: identifica hasta ${maxClips} de los MEJORES momentos de este vídeo para convertir en shorts virales
(los más divertidos, sorprendentes, polémicos, emotivos o con mayor "gancho" en los primeros 2 segundos).
Cada clip debe durar entre ${minLen} y ${maxLen} segundos, empezar y acabar en un punto natural (no cortar una frase a la mitad),
y no solaparse con otros clips elegidos.

Para cada clip, evalúa su probabilidad de hacerse viral (0-100) considerando: fuerza del gancho inicial,
sorpresa/emoción, ritmo, si funciona sin contexto previo, y si genera comentarios o ganas de compartir.

Devuelve SOLO este JSON (sin texto extra):
{
  "clips": [
    {
      "startSec": number,
      "endSec": number,
      "title": "título corto y estratégico (máx 60 caracteres, con gancho, en español, pensado para YouTube Shorts/TikTok, sin comillas ni emojis excesivos)",
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

export async function analyzeTranscriptForClips(
  segments: TranscriptSegment[],
  sourceTitle: string,
  durationSec: number
): Promise<MomentCandidate[]> {
  const provider = getAIProvider();
  const raw = await provider.chatJson({
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(segments, sourceTitle, durationSec),
    maxTokens: 8000,
  });

  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  let parsed: { clips: MomentCandidate[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`La IA no devolvió un JSON válido al analizar el vídeo: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed.clips)) {
    throw new Error("La IA no devolvió una lista de clips válida.");
  }

  return parsed.clips
    .filter((c) => Number.isFinite(c.startSec) && Number.isFinite(c.endSec) && c.endSec > c.startSec)
    .slice(0, config.pipeline.maxClipsPerJob);
}
