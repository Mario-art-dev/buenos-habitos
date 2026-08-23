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

// Secciones que el usuario pide expresamente antes de generar (ver Job.manualCategories) — "TOPIC"
// usa la plantilla "Ranking Funniest {name} Moments", "YOUTUBER" usa "Best 5 {name} Clips".
export interface ManualCategory {
  name: string;
  type: "TOPIC" | "YOUTUBER";
}

export interface RankingGroup {
  category: string;
  templateType: "TOPIC" | "YOUTUBER";
  items: ClassifiedMoment[]; // ordenados por score desc, item[0] = mejor (posición 1)
}

// Pedido explícito: "quiero los máximos short posibles con diferentes clips" — un vídeo de
// recopilación largo (1h+) puede tener bastantes más de 90 segmentos por silencio. Cuántos se
// clasifican de verdad depende del proveedor de IA activo (config.ai.maxVisionCandidates): la capa
// gratuita de Groq limita a 200.000 tokens AL DÍA en total y cada fotograma cuesta ~1.600 tokens
// solo de imagen, así que clasificar 200 fotogramas (~320.000 tokens) agota el cupo diario ENTERO
// solo en esta fase — un vídeo real de 1h45 (IlloJuan) lo confirmó: la clasificación se quedaba sin
// cupo a mitad y TODOS los lotes restantes fallaban con el mismo error de cupo diario agotado.
// Gemini/Anthropic/OpenAI tienen presupuesto real mucho mayor, así que ahí se mantiene alto.

function transcriptExcerptFor(segments: TranscriptSegment[], span: TimeSpan): string {
  return segments
    .filter((s) => s.end > span.start && s.start < span.end)
    .map((s) => s.text)
    .join(" ")
    .trim();
}

/**
 * Si hay más tramos de los que se pueden clasificar, se toma una muestra REPARTIDA a lo largo de
 * todo el vídeo (no los primeros N) — coger siempre los primeros dejaba fuera la mayor parte de un
 * vídeo largo (con cortes frecuentes, un vídeo de 1h45 puede tener 400-800+ tramos: los primeros
 * 200 solo cubrían los primeros 25-35 minutos), lo que explica candidatos "insuficientes" en
 * categorías que en realidad son abundantes pero aparecen sobre todo en la segunda mitad del vídeo.
 */
function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max || max <= 0) return items;
  const step = items.length / max;
  const picked: T[] = [];
  for (let i = 0; i < max; i++) {
    picked.push(items[Math.floor(i * step)]);
  }
  return picked;
}

export async function buildCandidateMoments(
  jobId: string,
  sourcePath: string,
  spans: TimeSpan[],
  segments: TranscriptSegment[]
): Promise<CandidateMoment[]> {
  const limited = sampleEvenly(spans, config.ai.maxVisionCandidates);
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

// Etiqueta genérica para un ranking "de sobras" (fallbackMomentsForBatch, y el cubo de leftover en
// groupIntoRankings más abajo) cuando no hay ninguna categoría concreta que lo describa — en el
// idioma REAL detectado del vídeo (o inglés por defecto, igual que CHANNEL_LANGUAGE), nunca en un
// idioma fijo distinto al del contenido.
function genericCategoryLabel(): string {
  // La tarjeta de intro es SIEMPRE en inglés fijo, "Ranking Funniest {category} Moments" (ver
  // rankingIntroCard.ts, decisión ya tomada a partir de una captura de referencia real) — la
  // palabra de categoría que se use aquí tiene que sonar bien metida tal cual ahí (nunca "...
  // Moments Moments"), así que se usa una sola palabra en inglés fija sea cual sea el idioma real
  // del vídeo, igual que se le pide a la IA para las categorías que detecta ella sola.
  return "Viral";
}

interface RawMoment {
  index: number;
  include: boolean;
  category: string;
  label: string;
  description: string;
  score: number;
}

/**
 * Recupera los campos de cada "momento" con expresiones regulares directamente sobre el texto
 * crudo, sin depender de que el JSON entero sea estrictamente válido. Un proveedor de repuesto más
 * débil (ver la cadena de FALLBACK_ORDER en provider.ts: si Groq/Gemini se quedan sin cupo, entra
 * en juego Cerebras/Mistral/el modelo local) a veces deja una comilla sin escapar dentro de un
 * campo de texto ("label" o "description"), lo que rompe el parseo estricto de TODO el lote
 * aunque el resto de campos estén perfectamente bien — visto en real: 17 de 18 lotes fallando con
 * "Expected ',' or ']' after array element" con un vídeo que sí tenía material de sobra. Como se
 * conoce el esquema exacto que se pide, se puede recuperar campo a campo en vez de descartar el
 * lote entero por un solo carácter suelto.
 */
function parseMomentsLoosely(raw: string): RawMoment[] {
  const results: RawMoment[] = [];
  // Cada objeto de "moments" empieza por su "index" (un número, no puede llevar comillas sin
  // escapar dentro) — se usa como ancla fiable para trocear el texto en un fragmento por
  // candidato, y luego se extrae cada campo dentro de su propio fragmento.
  const chunks = raw.split(/(?=\{\s*"index"\s*:)/g).filter((c) => /"index"\s*:\s*\d+/.test(c));
  for (const chunk of chunks) {
    const indexMatch = chunk.match(/"index"\s*:\s*(\d+)/);
    if (!indexMatch) continue;
    const includeMatch = chunk.match(/"include"\s*:\s*(true|false)/);
    const categoryMatch = chunk.match(/"category"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const labelMatch = chunk.match(/"label"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const descriptionMatch = chunk.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const scoreMatch = chunk.match(/"score"\s*:\s*(\d+(?:\.\d+)?)/);
    results.push({
      index: Number(indexMatch[1]),
      include: includeMatch ? includeMatch[1] === "true" : true,
      category: categoryMatch ? categoryMatch[1] : "otros",
      label: labelMatch ? labelMatch[1] : "Momento destacado",
      description: descriptionMatch ? descriptionMatch[1] : "",
      score: scoreMatch ? Number(scoreMatch[1]) : 50,
    });
  }
  return results;
}

/** JSON estricto primero; si falla, recuperación campo a campo con parseMomentsLoosely — nunca se
 *  descarta un lote entero solo porque un carácter suelto rompió el parseo estricto. */
function parseMomentsResponse(raw: string): RawMoment[] {
  try {
    const parsed = JSON.parse(raw) as { moments?: RawMoment[] };
    if (Array.isArray(parsed.moments)) return parsed.moments;
  } catch {
    // sigue con la recuperación campo a campo
  }
  return parseMomentsLoosely(raw);
}

/**
 * Último recurso cuando ni el JSON estricto ni la recuperación campo a campo (parseMomentsLoosely)
 * encuentran NADA reconocible en la respuesta — visto en real con el modelo local de repuesto
 * (Ollama/moondream, el último eslabón de FALLBACK_ORDER cuando todos los proveedores en la nube
 * se quedan sin cupo el mismo día): un modelo tan pequeño a veces ni sigue el esquema pedido ni
 * menciona el "index", inventándose su propio JSON sin relación con el prompt. Pedido explícito:
 * mejor incluir el lote como momentos genéricos sin etiquetar que perderlo del todo — con miles de
 * candidatos reales de vídeo de por medio, es mucho peor un vídeo sin ranking que uno con
 * categorías/etiquetas menos finas.
 */
function fallbackMomentsForBatch(batch: CandidateMoment[], languageCode: string | null): RawMoment[] {
  const category = genericCategoryLabel();
  const label = languageCode === "es" ? "Momento destacado" : "Featured moment";
  return batch.map((c) => ({
    index: c.index,
    include: true,
    category,
    label,
    description: "",
    score: 40,
  }));
}

export interface ClassifyResult {
  items: ClassifiedMoment[];
  totalBatches: number;
  failedBatches: number;
  // Lotes en los que la IA respondió (sin error de red/cupo) pero con algo irreconocible del todo
  // — se recuperaron igual como momentos genéricos vía fallbackMomentsForBatch, no se perdieron.
  unrecognizedBatches: number;
  lastErrorMessage: string | null;
}

export async function classifyCandidates(
  candidates: CandidateMoment[],
  contentLanguage: string,
  // Código ISO del idioma real del vídeo (o null) — solo para el texto de fallbackMomentsForBatch
  // (distinto de contentLanguage, que es el nombre del idioma en español tipo "inglés"/"español").
  languageCode: string | null = null
): Promise<ClassifyResult> {
  const provider = await getAIProvider();
  const classified: ClassifiedMoment[] = [];
  // Cada fotograma cuesta bastantes tokens: en capas gratuitas con poco margen por minuto se
  // mandan de dos en dos para no superar el límite (configurable con AI_VISION_BATCH_SIZE).
  const batchSize = Math.max(1, config.ai.visionBatchSize);
  const totalBatches = Math.ceil(candidates.length / batchSize);
  let failedBatches = 0;
  let unrecognizedBatches = 0;
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
      let moments = parseMomentsResponse(cleaned);
      if (moments.length === 0) {
        // La IA respondió (no fue un fallo de red/cupo) pero con algo sin relación alguna con el
        // esquema pedido — no se descarta el lote, se recupera como momentos genéricos.
        moments = fallbackMomentsForBatch(batch, languageCode);
        unrecognizedBatches++;
      }

      for (const m of moments) {
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

  return { items: classified, totalBatches, failedBatches, unrecognizedBatches, lastErrorMessage: lastError?.message ?? null };
}

function pickBestRemaining(pool: ClassifiedMoment[], maxItems: number): ClassifiedMoment[] {
  return [...pool].sort((a, b) => b.score - a.score).slice(0, maxItems);
}

// Coincidencia laxa por palabra clave entre el nombre de una sección pedida a mano ("Enfados") y la
// categoría/etiqueta/descripción que puso la IA a cada momento — no hace falta que coincidan exacto,
// basta con que una contenga a la otra en cualquier dirección.
function matchesManualCategory(item: ClassifiedMoment, nameLower: string): boolean {
  const cat = item.category.toLowerCase();
  if (cat.includes(nameLower) || nameLower.includes(cat)) return true;
  return item.label.toLowerCase().includes(nameLower) || item.description.toLowerCase().includes(nameLower);
}

/**
 * Agrupa los momentos clasificados en vídeos de ranking. Antes que nada procesa las secciones que
 * el usuario pidió a mano (`manualCategories`, ver Job.manualCategories): cada una se GARANTIZA su
 * propio ranking (relajando los mínimos de duración/nº de items normales a solo "al menos 2 clips
 * libres"), por delante de cualquier agrupación automática por categoría de la IA. Si el usuario no
 * pidió ninguna sección y la IA tampoco deja NINGÚN grupo aprovechable (categorías demasiado
 * pequeñas incluso para el cubo genérico de sobras), como último recurso se monta un ranking con
 * los mejores clips sueltos: "Best 5 clips of {youtuberFallbackName}" si se conoce el nombre del
 * canal/creador de origen, o el título genérico si no.
 */
export function groupIntoRankings(
  classified: ClassifiedMoment[],
  languageCode: string | null,
  manualCategories: ManualCategory[] = [],
  youtuberFallbackName?: string | null
): RankingGroup[] {
  const included = classified.filter((c) => c.include);
  const groups: RankingGroup[] = [];
  const usedIndexes = new Set<number>();

  for (const manual of manualCategories) {
    const name = manual.name.trim();
    const nameLower = name.toLowerCase();
    if (!nameLower) continue;
    const unused = included.filter((i) => !usedIndexes.has(i.index));
    let pool: ClassifiedMoment[];
    if (manual.type === "YOUTUBER") {
      // Una sección "los mejores clips de tal creador" no se busca por palabra clave (la IA no
      // etiqueta nombres de creador en "category") — se cogen directamente los mejores clips
      // libres de todo el vídeo, que es justo lo que pide este tipo de sección.
      pool = unused;
    } else {
      const matched = unused.filter((i) => matchesManualCategory(i, nameLower));
      pool = matched.length >= 2 ? matched : unused;
    }
    const picked = pickBestRemaining(pool, config.ranking.maxItems);
    if (picked.length < 2) continue; // no quedan ni 2 clips libres en todo el vídeo: imposible garantizar esta sección
    groups.push({ category: name, templateType: manual.type, items: picked });
    for (const p of picked) usedIndexes.add(p.index);
  }

  const remainingForAuto = included.filter((i) => !usedIndexes.has(i.index));
  const byCategory = new Map<string, ClassifiedMoment[]>();
  for (const item of remainingForAuto) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }

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

    groups.push({ category, templateType: "TOPIC", items: picked });
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
  const genericLabel = genericCategoryLabel();
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

    groups.push({ category: genericLabel, templateType: "TOPIC", items: picked });
    const pickedIndexes = new Set(picked.map((p) => p.index));
    leftover = leftover.filter((i) => !pickedIndexes.has(i.index));
    for (const p of picked) usedIndexes.add(p.index);
  }

  // Último recurso: si tras TODO lo anterior sigue sin salir ni un solo ranking (categorías
  // demasiado pequeñas incluso para el cubo genérico de sobras) pero sí hay al menos 2 momentos
  // usables en el vídeo, no se falla el job — se monta un ranking con los mejores clips sueltos.
  if (groups.length === 0) {
    const picked = pickBestRemaining(included, config.ranking.maxItems);
    if (picked.length >= 2) {
      if (youtuberFallbackName && youtuberFallbackName.trim()) {
        groups.push({ category: youtuberFallbackName.trim(), templateType: "YOUTUBER", items: picked });
      } else {
        groups.push({ category: genericLabel, templateType: "TOPIC", items: picked });
      }
    }
  }

  return groups.sort((a, b) => b.items.length - a.items.length);
}
