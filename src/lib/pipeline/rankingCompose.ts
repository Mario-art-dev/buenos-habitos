import { getAIProvider } from "@/lib/ai/provider";
import { config } from "@/lib/config";
import type { RankingGroup } from "./rankingAnalyze";

export interface RankingComposition {
  title: string;
  description: string;
  hashtags: string[];
  viralityScore: number;
  viralityReason: string;
  musicQuery: string;
}

const SYSTEM_PROMPT = `Eres un productor experto en vídeos de ranking/cuenta atrás virales ("TOP 5...", "TOP 10...")
para el canal "${config.channel.name}" (${config.channel.niche}). Respondes solo con JSON válido.`;

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
${group.items.length} al puesto 1, siendo el puesto 1 el más impactante):

${itemsList}

Genera los metadatos de este vídeo de ranking:
- "title": título corto y estratégico tipo "TOP ${group.items.length} ${group.category.toUpperCase()}..." (máx 70
  caracteres, con gancho, en español, sin comillas).
- "description": descripción corta (1-2 frases) resumiendo el vídeo, adaptada al canal ${config.channel.name}.
- "hashtags": 8 a 12 hashtags sin el símbolo #, relevantes para TikTok/YouTube Shorts y esta categoría.
- "viralityScore": 0-100, probabilidad de que este vídeo se vuelva viral.
- "viralityReason": 1 frase explicando por qué.
- "musicQuery": el TÍTULO Y ARTISTA de UNA canción concreta que pegaría como música de fondo para este tipo de
  vídeo (energética/divertida/dramática según el contenido). Sé específico (ej. "Thunderstruck - AC/DC" o una
  canción de hype/meme conocida), para que el usuario pueda buscarla en YouTube.

Devuelve SOLO este JSON:
{"title": "...", "description": "...", "hashtags": ["..."], "viralityScore": number, "viralityReason": "...", "musicQuery": "..."}`,
    maxTokens: 1000,
  });

  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
  const parsed = JSON.parse(cleaned) as RankingComposition;

  return {
    title: parsed.title?.slice(0, 100) ?? `TOP ${group.items.length} ${group.category}`,
    description: parsed.description ?? "",
    hashtags: parsed.hashtags ?? [],
    viralityScore: Math.max(0, Math.min(100, Math.round(parsed.viralityScore ?? 50))),
    viralityReason: parsed.viralityReason ?? "",
    musicQuery: parsed.musicQuery ?? "",
  };
}
