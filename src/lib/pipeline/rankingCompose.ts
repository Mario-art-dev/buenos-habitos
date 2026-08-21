import { getAIProvider } from "@/lib/ai/provider";
import { config } from "@/lib/config";
import { contentLanguageName } from "@/lib/lang";
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

const SYSTEM_PROMPT = `Eres la voz y la personalidad del canal "${config.channel.name}" (${config.channel.niche}),
experto en vídeos de ranking/cuenta atrás virales ("TOP 5...", "TOP 10..."). Grabas comentarios cortos en off,
en ${contentLanguageName()}, con tu propio punto de vista sobre cada puesto — esto es lo que convierte el vídeo en
contenido propio y no en una simple copia de los clips originales. Tono cercano, natural, como hablando a cámara.
El audio original de los clips nunca se traduce ni se dobla, se usa tal cual venga; solo lo que tú escribes va
en ${contentLanguageName()}. Respondes EXCLUSIVAMENTE con JSON válido, sin markdown.`;

export async function composeRanking(group: RankingGroup, sourceTitle: string): Promise<RankingComposition> {
  const provider = getAIProvider();
  const itemsList = group.items
    .map((item, i) => `${i + 1}. ${item.label} — ${item.description} (impacto ${item.score}/100)`)
    .join("\n");

  const raw = await provider.chatJson({
    system: SYSTEM_PROMPT,
    prompt: `Vídeo fuente: "${sourceTitle}".
Categoría detectada: "${group.category}".
Estos son los ${group.items.length} momentos elegidos para el vídeo de ranking (cuenta atrás del puesto
${group.items.length} al puesto 1, siendo el puesto 1 el más impactante), EN ESTE ORDEN de mejor a peor:

${itemsList}

Genera los metadatos de este vídeo de ranking:
- "title": título corto y estratégico tipo "TOP ${group.items.length} ${group.category.toUpperCase()}..." (máx 70
  caracteres, con gancho, en ${contentLanguageName()}, sin comillas).
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
- "commentaryIntro": 1 frase corta (máx 15 palabras) que digas en off ANTES de empezar la cuenta atrás,
  presentando el ranking con tu propio gancho.
- "commentaryOutro": 1 frase corta (máx 15 palabras) que digas en off AL FINAL, con tu conclusión u opinión
  sobre el ranking completo.
- "itemCommentary": array de ${group.items.length} frases cortas (máx 12 palabras cada una), UNA POR CADA
  puesto en el MISMO ORDEN de la lista de arriba (del puesto ${group.items.length} al puesto 1), con tu
  reacción/opinión personal a ESE momento concreto, como si lo presentaras justo antes de que se vea.

Devuelve SOLO este JSON:
{"title": "...", "description": "...", "hashtags": ["..."], "viralityScore": number, "viralityReason": "...",
"musicRecommended": boolean, "musicQuery": "...", "musicSuggestedSection": "..." o null,
"commentaryIntro": "...", "commentaryOutro": "...", "itemCommentary": ["...", "..."]}`,
    // Los modelos con razonamiento (p.ej. Qwen3 en Groq) gastan una parte fija y considerable
    // del presupuesto de tokens "pensando" por dentro aunque se oculte del resultado final, y
    // aquí la salida ya crece con el número de puestos del ranking (hasta RANKING_MAX_ITEMS).
    maxTokens: 6_000,
  });

  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
  const parsed = JSON.parse(cleaned) as RankingComposition;

  const itemCommentary = Array.isArray(parsed.itemCommentary) ? parsed.itemCommentary : [];
  while (itemCommentary.length < group.items.length) {
    itemCommentary.push(`Este momento se merece este puesto en el ranking.`);
  }

  return {
    title: parsed.title?.slice(0, 100) ?? `TOP ${group.items.length} ${group.category}`,
    description: parsed.description ?? "",
    hashtags: parsed.hashtags ?? [],
    viralityScore: Math.max(0, Math.min(100, Math.round(parsed.viralityScore ?? 50))),
    viralityReason: parsed.viralityReason ?? "",
    musicRecommended: !!parsed.musicRecommended,
    musicQuery: parsed.musicRecommended ? parsed.musicQuery ?? "" : "",
    musicSuggestedSection: parsed.musicRecommended ? parsed.musicSuggestedSection ?? null : null,
    commentaryIntro: parsed.commentaryIntro?.trim() || `Aquí tienes el top ${group.items.length} de ${group.category}.`,
    commentaryOutro: parsed.commentaryOutro?.trim() || "Y hasta aquí el ranking de hoy.",
    itemCommentary: itemCommentary.slice(0, group.items.length),
  };
}
