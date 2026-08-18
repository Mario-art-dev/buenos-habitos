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

const SYSTEM_PROMPT = `Eres un editor y productor de shorts/reels virales con 20 años de experiencia real en canales
grandes de YouTube Shorts, TikTok e Instagram Reels — el tipo de editor que contrataría un canal del nivel
de MrBeast. Trabajas para el canal "${config.channel.name}", cuyo contenido es: ${config.channel.niche}.
Tu único objetivo es maximizar la retención (que el espectador aguante más de los primeros 5 segundos, que
es cuando la plataforma empieza a contar la visualización de verdad) y por tanto los ingresos publicitarios.
Escribes títulos y descripciones como los escribiría una persona real enganchada al contenido, no como un
resumen robótico ni un anuncio: con gancho, intriga, humor o tensión — nunca genéricos ni con relleno.
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

Tarea: identifica ${maxClips} momentos de este fragmento para convertir en shorts virales (los más divertidos,
sorprendentes, polémicos, emotivos o con mayor "gancho" en los primeros 2 segundos, capaces de retener al
espectador más allá del segundo 5). El canal necesita cantidad Y calidad: intenta encontrar los ${maxClips},
aunque no todos sean igual de espectaculares — prefiere elegir el mejor momento disponible en vez de forzar
un corte a media frase. Solo devuelve menos si el fragmento es literalmente silencio, transición o publicidad
sin ni un solo momento aprovechable.
Escribe TODO el texto que generes (título, descripción, gancho, razón de viralidad, hashtags) en
${contentLanguageName()}, sea cual sea el idioma del vídeo fuente: el audio original del clip nunca se
traduce ni se dobla, se usa tal cual; solo el texto que tú escribes va en ${contentLanguageName()}.
IMPORTANTE — obligatorio, no orientativo: cada clip debe durar ENTRE ${minLen} Y ${maxLen} SEGUNDOS, sin
excepción. Un clip de menos de ${minLen}s no cuenta como visualización monetizable en TikTok/YouTube, así
que un candidato corto no vale nada aunque el momento sea buenísimo — si el mejor gancho dura poco, AMPLÍA
el clip con el contexto natural de alrededor (antes y/o después) hasta llegar al mínimo, sin cortar una
frase a la mitad. No solapes clips entre sí.

Para cada clip, evalúa su probabilidad de hacerse viral (0-100) considerando: fuerza del gancho inicial,
sorpresa/emoción, ritmo, si funciona sin contexto previo, y si genera comentarios o ganas de compartir.

Devuelve SOLO este JSON (sin texto extra):
{
  "clips": [
    {
      "startSec": number,
      "endSec": number,
      "title": "título corto (máx 60 caracteres) en ${contentLanguageName()}, escrito como lo escribiría una
        persona real enganchada al vídeo (curiosidad, tensión, humor o sorpresa) — NUNCA un resumen plano tipo
        titular de noticia ni relleno genérico; sin comillas ni emojis excesivos, pensado para YouTube
        Shorts/TikTok",
      "description": "descripción corta (1-2 frases) en ${contentLanguageName()}, con el mismo tono humano y
        directo que el título — que dé ganas de quedarse a ver qué pasa, adaptada al canal ${config.channel.name}",
      "hook": "la frase o momento exacto que engancha en el segundo 0-2",
      "viralityScore": number entre 0 y 100,
      "viralityReason": "explicación breve (1 frase) de por qué puede volverse viral",
      "hashtags": ["array de 6 a 10 hashtags SIN el símbolo #, relevantes para el nicho y la plataforma"]
    }
  ]
}

Ordena el array "clips" de mayor a menor viralityScore.`;
}

/**
 * La IA no siempre respeta la duración pedida en el prompt (se ha visto en real: clips de 20s
 * pedidos de 60-180s), y un clip por debajo del mínimo no cuenta como visualización monetizable
 * en TikTok/YouTube — así que aquí se fuerza de verdad, no se confía solo en el prompt:
 * los que se quedan cortos se descartan (mejor menos clips que clips que no valen para nada), y
 * los que se pasan de largo simplemente se recortan al máximo en vez de descartarse.
 */
function parseClips(raw: string): MomentCandidate[] {
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  const parsed = JSON.parse(cleaned) as { clips?: MomentCandidate[] };
  if (!Array.isArray(parsed.clips)) {
    throw new Error("La IA no devolvió una lista de clips válida.");
  }

  const minLen = config.pipeline.clipMinSeconds;
  const maxLen = config.pipeline.clipMaxSeconds;
  const clips: MomentCandidate[] = [];

  for (const c of parsed.clips) {
    if (!Number.isFinite(c.startSec) || !Number.isFinite(c.endSec) || c.endSec <= c.startSec) continue;
    const endSec = c.endSec - c.startSec > maxLen ? c.startSec + maxLen : c.endSec;
    if (endSec - c.startSec < minLen) continue;
    clips.push({ ...c, endSec });
  }

  return clips;
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
  // Cuántos clips se buscan depende de la duración del vídeo (aprox. 1 cada 2 minutos), no de un
  // número fijo: un vídeo de 50 min apunta a ~25, uno de 10 min a ~5. MAX_CLIPS_PER_JOB actúa como
  // techo (para no disparar el número de peticiones/render en vídeos muy largos).
  const maxClips = Math.max(3, Math.min(config.pipeline.maxClipsPerJob, Math.round(durationSec / 120)));
  const chunks = chunkSegments(segments, config.ai.maxTranscriptChars);

  // Con muchas partes se piden menos clips por parte, para no acabar con cientos de candidatos.
  // Se limita también a un máximo por petición (aunque haya una sola parte): pedir de golpe los
  // ${maxClips} clips que el usuario quiera en total en una única respuesta arriesga a que la IA
  // corte el JSON a medias, así que nunca se piden más de 8 en la misma llamada.
  const clipsPerChunk = Math.max(2, Math.min(8, Math.ceil((maxClips * 1.5) / Math.max(chunks.length, 1))));
  // El presupuesto de tokens de salida crece con cuántos clips se piden en la petición, para que
  // la respuesta quepa entera y no se corte a medias (rompiendo la validación de JSON). El suelo
  // (3000, antes 5500) se pudo bajar al cambiar el modelo de texto a gpt-oss-20b con
  // reasoning_effort:"low", que gasta bastante menos "pensando" que el modelo de razonamiento
  // anterior — necesario porque con trozos más grandes (menos peticiones repitiendo el mismo
  // texto de sistema) un vídeo de 1 hora cabe de verdad en el cupo diario de Groq.
  const chunkMaxTokens = Math.max(3_000, 1_200 + clipsPerChunk * 300);

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
        maxTokens: chunkMaxTokens,
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
