import { getAIProvider } from "@/lib/ai/provider";
import { config } from "@/lib/config";

export interface SingleCommentary {
  introText: string;
  outroText: string;
}

const SYSTEM_PROMPT = `Eres la voz y la personalidad del canal "${config.channel.name}" (${config.channel.niche}).
Grabas comentarios cortos en off, en español, con tu propio punto de vista, para envolver clips ajenos con tu
reacción y análisis personal — esto es lo que convierte el clip en contenido propio y no en una simple copia.
Tu tono es cercano, natural, como hablando a cámara. Nunca lees literalmente lo que dice el clip, das tu opinión
sobre ello. Respondes EXCLUSIVAMENTE con JSON válido, sin texto adicional, sin markdown.`;

function cleanJson(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
}

/** Genera el comentario en off (intro + cierre) que envuelve un short individual. */
export async function generateSingleCommentary(params: {
  title: string;
  description: string;
  transcriptExcerpt: string;
  hook: string | null;
}): Promise<SingleCommentary> {
  const provider = getAIProvider();
  const raw = await provider.chatJson({
    system: SYSTEM_PROMPT,
    prompt: `Vas a presentar este short:
Título: "${params.title}"
Qué pasa: ${params.description}
${params.hook ? `Gancho del momento: "${params.hook}"` : ""}
Transcripción del clip: "${params.transcriptExcerpt || "(sin diálogo claro)"}"

Escribe:
- "introText": 1 frase corta (máx 15 palabras) que digas ANTES del clip, enganchando y dando tu opinión de
  lo que se va a ver, como si presentaras el vídeo a tu audiencia.
- "outroText": 1 frase corta (máx 15 palabras) que digas DESPUÉS del clip, con tu reacción, análisis o
  valoración personal de lo que acaba de pasar.

Devuelve SOLO este JSON: {"introText": "...", "outroText": "..."}`,
    maxTokens: 500,
  });

  const parsed = JSON.parse(cleanJson(raw)) as SingleCommentary;
  return {
    introText: parsed.introText?.trim() || "Mira lo que ha pasado aquí.",
    outroText: parsed.outroText?.trim() || "Una pasada, ¿no crees?",
  };
}
