import { getAIProvider } from "@/lib/ai/provider";
import { config } from "@/lib/config";

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
}): Promise<HashtagSuggestion> {
  const { platform, title, description, existing = [] } = params;

  const external = await fetchExternalTrendingTags(platform, `${title} ${description}`);

  const provider = getAIProvider();
  const raw = await provider.chatJson({
    system: `Eres un experto en crecimiento orgánico y SEO de ${platform === "TIKTOK" ? "TikTok" : "YouTube Shorts"}.
Respondes solo con JSON válido.`,
    prompt: `Canal: "${config.channel.name}" — nicho: ${config.channel.niche}.
Plataforma: ${platform}.
Título del short: "${title}"
Descripción: "${description}"
${existing.length ? `Hashtags ya sugeridos previamente: ${existing.join(", ")}` : ""}
${external.length ? `Hashtags detectados como populares ahora mismo por una fuente externa: ${external.join(", ")}` : ""}

Devuelve el mejor set de 8 a 12 hashtags para maximizar alcance AHORA, combinando:
- hashtags amplios y muy usados en la plataforma para el tipo de contenido (alto volumen),
- hashtags de nicho específicos del clip (competencia media, más conversión),
- 1-2 hashtags de marca/canal.
No repitas, no uses el símbolo #, en minúsculas, sin espacios dentro de cada hashtag.

Formato de respuesta JSON exacto:
{"hashtags": ["tag1", "tag2", ...]}`,
    // Margen extra: los modelos con razonamiento (p.ej. Qwen3 en Groq) gastan parte del
    // presupuesto de tokens en su razonamiento interno aunque se oculte del resultado final.
    maxTokens: 800,
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
