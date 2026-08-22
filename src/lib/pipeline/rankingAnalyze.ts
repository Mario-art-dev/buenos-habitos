import fs from "fs";
import { getAIProvider } from "@/lib/ai/provider";
import { config } from "@/lib/config";
import type { TranscriptSegment } from "./transcribe";
import type { TimeSpan } from "./silence";
import { extractFrameAt } from "./clip";
import { candidateThumbPath } from "@/lib/storagePaths";

export interface CandidateMoment {
  index: number;
  startSec: number;
  endSec: number;
  transcriptExcerpt: string;
  thumbnailPath: string;
}

export interface ClassifiedMoment extends CandidateMoment {
  include: boolean;
  category: string;
  label: string;
  description: string;
  score: number;
}

export interface RankingGroup {
  category: string;
  items: ClassifiedMoment[]; // ordenados por score desc, item[0] = mejor (posición 1)
}

// Pedido explícito: "quiero los máximos short posibles con diferentes clips" — un vídeo de
// recopilación largo (1h+) puede tener bastantes más de 90 segmentos por silencio; subirlo permite
// clasificar más material y sacar más categorías (= más vídeos de ranking distintos) del mismo vídeo.
const MAX_CANDIDATES = 200;

function transcriptExcerptFor(segments: TranscriptSegment[], span: TimeSpan): string {
  return segments
    .filter((s) => s.end > span.start && s.start < span.end)
    .map((s) => s.text)
    .join(" ")
    .trim();
}

export async function buildCandidateMoments(
  jobId: string,
  sourcePath: string,
  spans: TimeSpan[],
  segments: TranscriptSegment[]
): Promise<CandidateMoment[]> {
  const limited = spans.slice(0, MAX_CANDIDATES);
  const candidates: CandidateMoment[] = [];

  for (let i = 0; i < limited.length; i++) {
    const span = limited[i];
    const thumbPath = candidateThumbPath(jobId, i);
    const midpoint = (span.start + span.end) / 2;
    try {
      await extractFrameAt(sourcePath, midpoint, thumbPath);
    } catch {
      continue; // segmento sin fotograma válido (p.ej. al final del vídeo), se descarta
    }
    candidates.push({
      index: i,
      startSec: span.start,
      endSec: span.end,
      transcriptExcerpt: transcriptExcerptFor(segments, span),
      thumbnailPath: thumbPath,
    });
  }

  return candidates;
}

const SYSTEM_PROMPT = `Eres un editor experto en vídeos de recopilación viral para el canal "${config.channel.name}"
(${config.channel.niche}). El contenido de origen puede ser CUALQUIER COSA — clips de un streamer, un directo,
un vídeo de gaming, deporte, reacciones, entrevistas, lo que sea — no solo compilaciones de fails o momentos
graciosos. Analizas fotogramas y transcripción de fragmentos de un vídeo largo para decidir cuáles merece la pena
usar en vídeos de ranking tipo "TOP 5" y en qué categoría temática encajan.
Respondes EXCLUSIVAMENTE con JSON válido, sin texto adicional.`;

function buildBatchPrompt(batch: CandidateMoment[], contentLanguage: string): string {
  const items = batch
    .map(
      (c, i) =>
        `Candidato ${i + 1} (índice real ${c.index}, ${c.startSec.toFixed(1)}s-${c.endSec.toFixed(1)}s):\n` +
        `Transcripción de ese tramo: "${c.transcriptExcerpt || "(sin diálogo/silencio)"}"\n` +
        `La imagen adjunta número ${i + 1} corresponde a este candidato.`
    )
    .join("\n\n");

  return `Aquí tienes ${batch.length} fragmentos candidatos de un vídeo de recopilación, cada uno con su fotograma
representativo y la transcripción de ese tramo.

${items}

Para cada candidato decide:
- "include": true si es un momento claro y usable, sea del tipo que sea — gracioso, impactante, tenso, hábil,
  emotivo, una buena jugada, una reacción, un momento con gancho... CUALQUIER cosa que un espectador pararía a
  ver, no solo caídas o momentos graciosos. false si es un tramo de transición, introducción, publicidad, o no
  pasa nada relevante.
- "category": UNA sola palabra en ${contentLanguage} (excepcionalmente dos si de verdad hace falta) que
  describa el tema del candidato, para agrupar los parecidos en un mismo vídeo de ranking Y para mostrarse en
  pantalla dentro de la plantilla fija "Ranking Funniest {category} Moments" — tiene que sonar bien ahí metida tal
  cual. Usa la categoría que MEJOR describa el contenido real (puede ser de cualquier tema: un juego concreto,
  un tipo de reacción, un deporte, una temática de streaming... no la fuerces a encajar en "fails" o "gracioso"
  si no es lo que es). Sé consistente para que candidatos del mismo tipo caigan en la MISMA categoría exacta
  (mismo singular/plural, misma capitalización).
- "label": texto muy corto (máx 6 palabras) en ${contentLanguage} para mostrar en pantalla como título de ese
  puesto del ranking.
- "description": 1 frase en ${contentLanguage} describiendo qué pasa.
- "score": 0-100, qué tan viral/entretenido es este momento comparado con el resto (da igual si es gracioso,
  impactante, hábil o cualquier otra cosa — puntúa por lo interesante que es de ver, no por un tipo de contenido
  concreto).

Devuelve SOLO este JSON, con un elemento por candidato EN EL MISMO ORDEN (usa el "index" real indicado arriba):
{"moments": [{"index": number, "include": boolean, "category": "string", "label": "string", "description": "string", "score": number}]}`;
}

export async function classifyCandidates(
  candidates: CandidateMoment[],
  contentLanguage: string
): Promise<ClassifiedMoment[]> {
  const provider = getAIProvider();
  const classified: ClassifiedMoment[] = [];
  // Cada fotograma cuesta bastantes tokens: en capas gratuitas con poco margen por minuto se
  // mandan de dos en dos para no superar el límite (configurable con AI_VISION_BATCH_SIZE).
  const batchSize = Math.max(1, config.ai.visionBatchSize);
  const totalBatches = Math.ceil(candidates.length / batchSize);
  let failedBatches = 0;
  let lastError: Error | null = null;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const images = batch.map((c) => ({
      base64: fs.readFileSync(c.thumbnailPath).toString("base64"),
      mediaType: "image/jpeg" as const,
    }));

    try {
      const raw = await provider.chatJson({
        system: SYSTEM_PROMPT,
        prompt: buildBatchPrompt(batch, contentLanguage),
        images,
        // Margen extra: los modelos con razonamiento (p.ej. Qwen3 en Groq) gastan parte del
        // presupuesto de tokens en su razonamiento interno aunque se oculte del resultado final,
        // y aquí cada imagen ya cuesta ~1600 tokens de por sí.
        maxTokens: 4000,
      });
      const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
      const parsed = JSON.parse(cleaned) as {
        moments: { index: number; include: boolean; category: string; label: string; description: string; score: number }[];
      };

      for (const m of parsed.moments) {
        const candidate = candidates.find((c) => c.index === m.index);
        if (!candidate) continue;
        classified.push({
          ...candidate,
          include: !!m.include,
          category: (m.category || "otros").trim().toLowerCase(),
          label: m.label || "Momento destacado",
          description: m.description || "",
          score: Math.max(0, Math.min(100, Math.round(m.score ?? 0))),
        });
      }
    } catch (err) {
      // Si un lote falla, se descartan esos candidatos y se sigue con el resto — PERO si TODOS
      // los lotes fallan (p.ej. el modelo de visión configurado no existe/no responde, o se agotó
      // el cupo diario en todos los proveedores), no puede quedar en silencio: eso es justo lo que
      // dejaba "classified" vacío y el vídeo entero acababa con el mensaje engañoso de "no hay
      // contenido aprovechable" aunque el vídeo tuviera de sobra material real (ver la conversación
      // con un vídeo de 1h45 de IlloJuan que no era el problema real). Se guarda el último error
      // para poder fallar el job con el motivo real de la IA en vez de uno genérico.
      failedBatches++;
      lastError = err as Error;
      continue;
    }
  }

  if (classified.length === 0 && totalBatches > 0 && failedBatches === totalBatches) {
    throw new Error(
      `La IA no pudo clasificar ningún momento del vídeo (fallaron los ${totalBatches} lotes): ${
        lastError?.message ?? "fallo desconocido"
      }`
    );
  }

  return classified;
}

// Etiqueta genérica para el ranking "de sobras" (ver más abajo) cuando no hay ninguna categoría
// concreta que agrupe lo que queda — en el idioma REAL detectado del vídeo (o inglés por
// defecto, igual que CHANNEL_LANGUAGE), nunca en un idioma fijo distinto al del contenido.
function genericCategoryLabel(languageCode: string | null): string {
  return languageCode === "es" ? "Mejores Momentos" : "Best Moments";
}

export function groupIntoRankings(classified: ClassifiedMoment[], languageCode: string | null): RankingGroup[] {
  const included = classified.filter((c) => c.include);
  const byCategory = new Map<string, ClassifiedMoment[]>();

  for (const item of included) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }

  const groups: RankingGroup[] = [];
  const usedIndexes = new Set<number>();

  for (const [category, items] of byCategory) {
    if (items.length < config.ranking.minItems) continue;
    const sorted = items.sort((a, b) => b.score - a.score);
    let picked = sorted.slice(0, config.ranking.maxItems);

    // Un vídeo de ranking tiene que durar al menos config.ranking.minDurationSec de verdad (no
    // solo tener el nº mínimo de momentos) — si con maxItems no llega, se añaden más momentos de
    // la MISMA categoría (por orden de score) hasta llegar a la duración mínima o agotar la lista.
    let totalDuration = picked.reduce((sum, i) => sum + (i.endSec - i.startSec), 0);
    let extra = config.ranking.maxItems;
    while (totalDuration < config.ranking.minDurationSec && extra < sorted.length) {
      picked = sorted.slice(0, extra + 1);
      totalDuration += sorted[extra].endSec - sorted[extra].startSec;
      extra++;
    }
    if (totalDuration < config.ranking.minDurationSec) continue;

    groups.push({ category, items: picked });
    for (const p of picked) usedIndexes.add(p.index);
  }

  // Pedido explícito: bajo ninguna circunstancia un vídeo con momentos usables debe acabar sin
  // NINGÚN ranking solo porque la IA los repartió en demasiadas categorías pequeñas (p.ej.
  // "Fortnite", "sustos", "rage" con 1-2 clips cada una, ninguna llega al mínimo por sí sola).
  // En vez de fallar, se juntan TODOS los momentos que se quedaron sueltos — de categorías que no
  // llegaron al mínimo, y sobrantes de categorías que sí formaron grupo pero no cupieron por
  // maxItems — en una categoría genérica "inventada", y se monta el máximo de ranking(s) extra
  // posible con ellos. Mismo criterio de duración mínima que arriba; nunca menos de 2 momentos
  // (una cuenta atrás no tiene sentido con solo uno).
  let leftover = included.filter((i) => !usedIndexes.has(i.index)).sort((a, b) => b.score - a.score);
  const genericLabel = genericCategoryLabel(languageCode);
  while (leftover.length >= 2) {
    let picked = leftover.slice(0, config.ranking.maxItems);
    let totalDuration = picked.reduce((sum, i) => sum + (i.endSec - i.startSec), 0);
    let extra = picked.length;
    while (totalDuration < config.ranking.minDurationSec && extra < leftover.length) {
      picked = leftover.slice(0, extra + 1);
      totalDuration += leftover[extra].endSec - leftover[extra].startSec;
      extra++;
    }
    if (totalDuration < config.ranking.minDurationSec || picked.length < 2) break;

    groups.push({ category: genericLabel, items: picked });
    const pickedIndexes = new Set(picked.map((p) => p.index));
    leftover = leftover.filter((i) => !pickedIndexes.has(i.index));
  }

  return groups.sort((a, b) => b.items.length - a.items.length);
}
