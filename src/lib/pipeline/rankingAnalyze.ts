import fs from "fs";
import { getAIProvider } from "@/lib/ai/provider";
import { config } from "@/lib/config";
import { contentLanguageName } from "@/lib/lang";
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

const MAX_CANDIDATES = 90;

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

const SYSTEM_PROMPT = `Eres un editor experto en vídeos de recopilación viral (compilaciones de fails, momentos
graciosos, hazañas, etc.) para el canal "${config.channel.name}" (${config.channel.niche}).
Analizas fotogramas y transcripción de fragmentos de un vídeo largo para decidir cuáles merece la pena
usar en vídeos de ranking tipo "TOP 5" y en qué categoría temática encajan.
Respondes EXCLUSIVAMENTE con JSON válido, sin texto adicional.`;

function buildBatchPrompt(batch: CandidateMoment[]): string {
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
- "include": true solo si es un momento claro y usable (algo ocurre: una caída, una acrobacia, un susto, algo
  gracioso o impactante). false si es un tramo de transición, introducción, publicidad, o no pasa nada relevante.
- "category": UNA sola palabra en ${contentLanguageName()} (excepcionalmente dos si de verdad hace falta) que
  describa el tema del candidato, para agrupar los parecidos en un mismo vídeo de ranking Y para mostrarse en
  pantalla dentro de la plantilla fija "Ranking Funniest {category} Moments" — tiene que sonar bien ahí metida tal
  cual (ejemplos: "Dogs", "Girls", "Flips", "Skate", "Fails", "Pranks", "Gym", "Cats", "Cars"...). Elige la que
  mejor describa el contenido real del candidato, sé consistente para que candidatos del mismo tipo caigan en la
  MISMA categoría exacta (mismo singular/plural, misma capitalización).
- "label": texto muy corto (máx 6 palabras) en ${contentLanguageName()} para mostrar en pantalla como título de ese
  puesto del ranking.
- "description": 1 frase en ${contentLanguageName()} describiendo qué pasa.
- "score": 0-100, qué tan gracioso/impactante/viral es este momento comparado con el resto.

Devuelve SOLO este JSON, con un elemento por candidato EN EL MISMO ORDEN (usa el "index" real indicado arriba):
{"moments": [{"index": number, "include": boolean, "category": "string", "label": "string", "description": "string", "score": number}]}`;
}

export async function classifyCandidates(candidates: CandidateMoment[]): Promise<ClassifiedMoment[]> {
  const provider = getAIProvider();
  const classified: ClassifiedMoment[] = [];
  // Cada fotograma cuesta bastantes tokens: en capas gratuitas con poco margen por minuto se
  // mandan de dos en dos para no superar el límite (configurable con AI_VISION_BATCH_SIZE).
  const batchSize = Math.max(1, config.ai.visionBatchSize);

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const images = batch.map((c) => ({
      base64: fs.readFileSync(c.thumbnailPath).toString("base64"),
      mediaType: "image/jpeg" as const,
    }));

    try {
      const raw = await provider.chatJson({
        system: SYSTEM_PROMPT,
        prompt: buildBatchPrompt(batch),
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
          category: (m.category || "otros fails").trim().toLowerCase(),
          label: m.label || "Momento destacado",
          description: m.description || "",
          score: Math.max(0, Math.min(100, Math.round(m.score ?? 0))),
        });
      }
    } catch {
      // si un lote falla, se descartan esos candidatos y se sigue con el resto
      continue;
    }
  }

  return classified;
}

export function groupIntoRankings(classified: ClassifiedMoment[]): RankingGroup[] {
  const included = classified.filter((c) => c.include);
  const byCategory = new Map<string, ClassifiedMoment[]>();

  for (const item of included) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }

  const groups: RankingGroup[] = [];
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
  }

  return groups.sort((a, b) => b.items.length - a.items.length);
}
