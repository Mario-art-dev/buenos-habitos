import { getAIProvider } from "@/lib/ai/provider";
import { config } from "@/lib/config";
import type { RankingGroup } from "./rankingAnalyze";

export interface RankingComposition {
  title: string;
  description: string;
  hashtags: string[];
  viralityScore: number;
  viralityReason: string;
  musicRecommended: boolean;
  musicQuery: string;
  musicSuggestedSection: string | null;
  commentaryIntro: string;
  commentaryOutro: string;
  itemCommentary: string[]; // mismo orden que group.items (mejor puesto primero)
}

// Campos de placeholder cuando el comentario en off está desactivado (ENABLE_COMMENTARY=false,
// el valor por defecto real del servidor) — nunca se usan (ver rankingPipeline.ts: solo se
// guardan si commentaryOn), así que ni siquiera se piden a la IA (ver composeRanking): con la capa
// gratuita de Groq compartiendo un cupo diario entre TODOS los trabajos del día, pedir y generar
// texto que luego se descarta es tirar tokens reales a la basura sin que sirvan para nada.
function placeholderCommentary(itemCount: number): Pick<RankingComposition, "commentaryIntro" | "commentaryOutro" | "itemCommentary"> {
  return {
    commentaryIntro: "",
    commentaryOutro: "",
    itemCommentary: new Array(itemCount).fill(""),
  };
}

function buildSystemPrompt(contentLanguage: string): string {
  return `Eres la voz y la personalidad del canal "${config.channel.name}" (${config.channel.niche}),
experto en vídeos de ranking/cuenta atrás virales ("TOP 5...", "TOP 10..."). Grabas comentarios cortos en off,
en ${contentLanguage}, con tu propio punto de vista sobre cada puesto — esto es lo que convierte el vídeo en
contenido propio y no en una simple copia de los clips originales. Tono cercano, natural, como hablando a cámara.
El audio original de los clips nunca se traduce ni se dobla, se usa tal cual venga; solo lo que tú escribes va
en ${contentLanguage}. Respondes EXCLUSIVAMENTE con JSON válido, sin markdown.`;
}

export async function composeRanking(
  group: RankingGroup,
  sourceTitle: string,
  contentLanguage: string,
  commentaryEnabled: boolean = config.commentary.enabled,
  usedTitles: string[] = []
): Promise<RankingComposition> {
  const provider = await getAIProvider();
  const itemsList = group.items
    .map((item, i) => `${i + 1}. ${item.label} — ${item.description} (impacto ${item.score}/100)`)
    .join("\n");

  // Varios grupos del mismo job pueden compartir categoría (p.ej. el cubo genérico de sobras de
  // groupIntoRankings) y acaban pidiendo un título a la IA con un prompt casi idéntico salvo por
  // los puestos concretos — sin esta lista la IA repite el mismo título tipo "TOP 5 GRACIOSO..."
  // en 2 o más vídeos del mismo job. Pedido explícito: nunca debe repetirse el título entre clips.
  const avoidTitlesBlock =
    usedTitles.length > 0
      ? `\nEstos títulos ya se han usado en OTROS vídeos de este mismo ranking — no repitas ninguno ni generes uno
casi idéntico (ni con las mismas palabras clave en el mismo orden), aunque la categoría sea la misma. Busca un
ángulo o gancho distinto para este vídeo en concreto:\n${usedTitles.map((t) => `- "${t}"`).join("\n")}\n`
      : "";

  const commentaryFields = commentaryEnabled
    ? `- "commentaryIntro": 1 frase corta (máx 15 palabras) que digas en off ANTES de empezar la cuenta atrás,
  presentando el ranking con tu propio gancho.
- "commentaryOutro": 1 frase corta (máx 15 palabras) que digas en off AL FINAL, con tu conclusión u opinión
  sobre el ranking completo.
- "itemCommentary": array de ${group.items.length} frases cortas (máx 12 palabras cada una), UNA POR CADA
  puesto en el MISMO ORDEN de la lista de arriba (del puesto ${group.items.length} al puesto 1), con tu
  reacción/opinión personal a ESE momento concreto, como si lo presentaras justo antes de que se vea.
`
    : "";
  const commentaryJsonFields = commentaryEnabled
    ? `,\n"commentaryIntro": "...", "commentaryOutro": "...", "itemCommentary": ["...", "..."]`
    : "";

  const raw = await provider.chatJson({
    system: buildSystemPrompt(contentLanguage),
    prompt: `Vídeo fuente: "${sourceTitle}".
Categoría detectada: "${group.category}".
Estos son los ${group.items.length} momentos elegidos para el vídeo de ranking (cuenta atrás del puesto
${group.items.length} al puesto 1, siendo el puesto 1 el más impactante), EN ESTE ORDEN de mejor a peor:

${itemsList}

Genera los metadatos de este vídeo de ranking:
- "title": título corto y estratégico tipo "TOP ${group.items.length} ${group.category.toUpperCase()}..." (máx 70
  caracteres, con gancho, en ${contentLanguage}, sin comillas).
${avoidTitlesBlock}
- "description": descripción corta (1-2 frases) resumiendo el vídeo, adaptada al canal ${config.channel.name}.
- "hashtags": 8 a 12 hashtags sin el símbolo #, relevantes para TikTok/YouTube Shorts y esta categoría.
- "viralityScore": 0-100, probabilidad de que este vídeo se vuelva viral.
- "viralityReason": 1 frase explicando por qué.
- "musicRecommended": boolean — true SOLO si este vídeo de ranking concreto mejoraría de verdad con música de
  fondo (bastante habitual en rankings sin diálogo relevante entre momentos, pero no automático: si el propio
  audio de los clips ya lleva el peso, false).
- "musicQuery": si musicRecommended=true, el TÍTULO Y ARTISTA de UNA canción concreta que pegaría como música
  de fondo para este tipo de vídeo (energética/divertida/dramática según el contenido). Sé específico (ej.
  "Thunderstruck - AC/DC" o una canción de hype/meme conocida), para que el usuario pueda buscarla en YouTube.
  Si musicRecommended=false, deja esto como cadena vacía.
- "musicSuggestedSection": si musicRecommended=true, un texto corto tipo "1:15-2:00" con la parte aproximada
  de ESA canción que mejor encajaría (el estribillo, el drop, etc. — orientativo, según tu conocimiento general
  de la canción); si no, null.
${commentaryFields}
Devuelve SOLO este JSON:
{"title": "...", "description": "...", "hashtags": ["..."], "viralityScore": number, "viralityReason": "...",
"musicRecommended": boolean, "musicQuery": "...", "musicSuggestedSection": "..." o null${commentaryJsonFields}}`,
    // Los modelos con razonamiento (p.ej. Qwen3 en Groq) gastan una parte fija y considerable del
    // presupuesto de tokens "pensando" por dentro aunque se oculte del resultado final. Con el
    // comentario en off desactivado (ENABLE_COMMENTARY=false, el valor real del servidor) no hace
    // falta tanto margen de salida — y con la capa gratuita de Groq compartiendo un cupo DIARIO
    // entre todos los trabajos del día, cada token que no hace falta pedir es cupo real que queda
    // para el resto de trabajos de ese mismo día.
    maxTokens: commentaryEnabled ? 6_000 : 2_000,
  });

  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
  const parsed = JSON.parse(cleaned) as Partial<RankingComposition>;

  const placeholders = placeholderCommentary(group.items.length);
  const itemCommentary = commentaryEnabled
    ? Array.isArray(parsed.itemCommentary)
      ? parsed.itemCommentary
      : []
    : placeholders.itemCommentary;
  while (commentaryEnabled && itemCommentary.length < group.items.length) {
    itemCommentary.push(`Este momento se merece este puesto en el ranking.`);
  }

  // Red de seguridad: si aun con la instrucción de arriba la IA repite un título ya usado (o
  // devuelve el título de repuesto genérico, que siempre es igual entre grupos de la misma
  // categoría), se distingue a mano en vez de dejar dos clips con el mismo título — pedido
  // explícito: nunca debe repetirse.
  let title = parsed.title?.slice(0, 100) ?? `TOP ${group.items.length} ${group.category}`;
  if (usedTitles.some((t) => t.trim().toLowerCase() === title.trim().toLowerCase())) {
    let suffix = 2;
    while (usedTitles.some((t) => t.trim().toLowerCase() === `${title} Vol. ${suffix}`.trim().toLowerCase())) {
      suffix++;
    }
    title = `${title} Vol. ${suffix}`;
  }

  return {
    title,
    description: parsed.description ?? "",
    hashtags: parsed.hashtags ?? [],
    viralityScore: Math.max(0, Math.min(100, Math.round(parsed.viralityScore ?? 50))),
    viralityReason: parsed.viralityReason ?? "",
    musicRecommended: !!parsed.musicRecommended,
    musicQuery: parsed.musicRecommended ? parsed.musicQuery ?? "" : "",
    musicSuggestedSection: parsed.musicRecommended ? parsed.musicSuggestedSection ?? null : null,
    commentaryIntro: commentaryEnabled
      ? parsed.commentaryIntro?.trim() || `Aquí tienes el top ${group.items.length} de ${group.category}.`
      : placeholders.commentaryIntro,
    commentaryOutro: commentaryEnabled
      ? parsed.commentaryOutro?.trim() || "Y hasta aquí el ranking de hoy."
      : placeholders.commentaryOutro,
    itemCommentary: itemCommentary.slice(0, group.items.length),
  };
}
