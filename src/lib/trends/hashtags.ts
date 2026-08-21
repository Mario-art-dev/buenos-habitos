import { getAIProvider } from "@/lib/ai/provider";
import { config } from "@/lib/config";
import { contentLanguageName } from "@/lib/lang";

export type Platform = "YOUTUBE" | "TIKTOK";

export interface HashtagSuggestion {
  hashtags: string[];
  note: string;
}

/**
 * No existe una API gratuita fiable de "hashtags en tendencia ahora mismo" para TikTok/YouTube.
 * Si el usuario configura TRENDS_API_URL (un endpoint propio o de un proveedor de pago que
 * devuelva {"hashtags": ["..."]}), se combina con la sugerencia de la IA. Si no, se usa
 * solo el criterio de la IA, dejándolo claro en la respuesta.
 */
async function fetchExternalTrendingTags(platform: Platform, topic: string): Promise<string[]> {
  const url = process.env.TRENDS_API_URL;
  if (!url) return [];
  try {
    const res = await fetch(`${url}?platform=${platform.toLowerCase()}&topic=${encodeURIComponent(topic)}`, {
      headers: process.env.TRENDS_API_KEY ? { Authorization: `Bearer ${process.env.TRENDS_API_KEY}` } : undefined,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { hashtags?: string[] };
    return Array.isArray(data.hashtags) ? data.hashtags : [];
  } catch {
    return [];
  }
}

export async function suggestHashtags(params: {
  platform: Platform;
  title: string;
  description: string;
  existing?: string[];
  // Idioma en el que deben ir los hashtags (ya resuelto: el detectado del vídeo fuente, o el
  // idioma configurado del canal si no aplica). Si no se pasa, se cae al idioma del canal.
  contentLanguage?: string;
}): Promise<HashtagSuggestion> {
  const { platform, title, description, existing = [], contentLanguage = contentLanguageName() } = params;

  const external = await fetchExternalTrendingTags(platform, `${title} ${description}`);

  const provider = getAIProvider();
  const raw = await provider.chatJson({
    system: `Eres un experto en crecimiento orgánico y SEO de ${platform === "TIKTOK" ? "TikTok" : "YouTube Shorts"},
especializado en canales de comedia y entretenimiento — sabes exactamente qué hashtags sigue y busca ESE
público concreto (no un público genérico) para descubrir contenido nuevo. Respondes solo con JSON válido.`,
    prompt: `Canal: "${config.channel.name}" — nicho: ${config.channel.niche}.
Plataforma: ${platform}.
Público objetivo: la audiencia de comedia/entretenimiento de la plataforma (la que sigue cuentas de humor,
momentos virales, fails, reacciones) — los hashtags deben hablarle a ESE público concreto, no a cualquiera.
Título del short: "${title}"
Descripción: "${description}"
${existing.length ? `Hashtags ya sugeridos previamente: ${existing.join(", ")}` : ""}
${external.length ? `Hashtags detectados como populares ahora mismo por una fuente externa: ${external.join(", ")}` : ""}

Elige el set de 8 a 12 hashtags con más probabilidad real de hacer viral ESTE clip concreto — nada de
hashtags random ni genéricos que le sirvan a cualquier vídeo. Piensa como un estratega, no rellenes:
1. 2-3 hashtags de ALTO volumen que seguidores de comedia/entretenimiento usan para descubrir contenido
   nuevo en ${platform === "TIKTOK" ? "TikTok" : "YouTube Shorts"} (ej. equivalentes locales de "funny",
   "comedy", "entertainment", "fyp"/"viral" según la plataforma) — para entrar en el radar de ESE público.
2. 4-6 hashtags de NICHO, específicos de lo que pasa en ESTE clip en concreto (el tema, la situación, la
   emoción que provoca, el tipo de momento) — para que a quien le guste justo esto, se lo encuentre.
3. 1-2 hashtags de marca/canal.
Cada hashtag debe justificar su hueco: si no ayuda a que ESTE clip llegue al público de comedia/
entretenimiento, no va. Los hashtags deben estar en ${contentLanguage} salvo los que ya sean
universales en cualquier idioma (nombres propios, "fyp", "viral", etc.). No repitas, no uses el símbolo #,
en minúsculas, sin espacios dentro de cada hashtag.

Formato de respuesta JSON exacto:
{"hashtags": ["tag1", "tag2", ...]}`,
    // Los modelos con razonamiento (p.ej. Qwen3 en Groq) gastan una parte fija y considerable
    // del presupuesto de tokens "pensando" por dentro aunque la respuesta real sea diminuta, así
    // que el suelo tiene que ser generoso o el JSON sale cortado a medias.
    maxTokens: 5_500,
  });

  try {
    const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
    const parsed = JSON.parse(cleaned) as { hashtags: string[] };
    return {
      hashtags: parsed.hashtags.slice(0, 12),
      note: external.length
        ? "Combinado con datos de tendencias externas configuradas (TRENDS_API_URL)."
        : "Estimado por IA según buenas prácticas de la plataforma y el nicho del canal (no hay fuente de tendencias en vivo configurada).",
    };
  } catch {
    return { hashtags: existing, note: "No se pudieron regenerar los hashtags; se mantienen los anteriores." };
  }
}
