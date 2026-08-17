import { getAIProvider } from "@/lib/ai/provider";
import { config } from "@/lib/config";
import { contentLanguageName } from "@/lib/lang";

export interface SongComposition {
  title: string;
  description: string;
  hashtags: string[];
  viralityScore: number;
  viralityReason: string;
}

const SYSTEM_PROMPT = `Eres la voz y la personalidad del canal "${config.channel.name}" (${config.channel.niche}),
experto en montajes/edits al ritmo de música (estilo "hype edit") para TikTok/YouTube Shorts.
Respondes EXCLUSIVAMENTE con JSON válido, sin markdown.`;

function cleanJson(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
}

/** Genera título/descripción/hashtags para un vídeo montado al ritmo de una canción elegida. */
export async function composeSongEdit(params: {
  sourceTitle: string;
  songTitle: string;
  clipCount: number;
}): Promise<SongComposition> {
  const provider = getAIProvider();
  const raw = await provider.chatJson({
    system: SYSTEM_PROMPT,
    prompt: `Has montado un vídeo corto vertical con ${params.clipCount} cortes de la recopilación
"${params.sourceTitle}", editados para que cada cambio de plano caiga justo en el ritmo/beat de la canción
"${params.songTitle}" (estilo hype edit / montaje musical).

Genera los metadatos de este vídeo:
- "title": título corto y estratégico (máx 70 caracteres), en ${contentLanguageName()}, con gancho, sin comillas.
- "description": descripción corta (1-2 frases), adaptada al canal ${config.channel.name}, mencionando el
  ritmo/la música.
- "hashtags": 8 a 12 hashtags sin el símbolo #, relevantes para TikTok/YouTube Shorts, incluyendo alguno de
  "edit"/"hypeedit"/música.
- "viralityScore": 0-100.
- "viralityReason": 1 frase.

Devuelve SOLO este JSON:
{"title": "...", "description": "...", "hashtags": ["..."], "viralityScore": number, "viralityReason": "..."}`,
    // Los modelos con razonamiento (p.ej. Qwen3 en Groq) gastan una parte fija y considerable
    // del presupuesto de tokens "pensando" por dentro aunque la respuesta real sea diminuta, así
    // que el suelo tiene que ser generoso o el JSON sale cortado a medias.
    maxTokens: 5_500,
  });

  const parsed = JSON.parse(cleanJson(raw)) as Partial<SongComposition>;
  return {
    title: parsed.title?.slice(0, 100) ?? `Montaje al ritmo de ${params.songTitle}`,
    description: parsed.description ?? "",
    hashtags: parsed.hashtags ?? [],
    viralityScore: Math.max(0, Math.min(100, Math.round(parsed.viralityScore ?? 50))),
    viralityReason: parsed.viralityReason ?? "",
  };
}
