import OpenAI from "openai";
import { config } from "@/lib/config";
import type { AIChatOptions, AIProvider } from "./provider";

/**
 * Proveedor de IA usando Groq. Su API es compatible con la de OpenAI (mismo SDK, cambiando
 * solo la URL base), así que se reutiliza el paquete "openai".
 *
 * Es la alternativa gratuita para quien no pueda usar Gemini: la capa gratuita de Gemini NO
 * está disponible en la Unión Europea, Reino Unido ni Suiza (Google exige ahí facturación con
 * tarjeta por las exigencias del RGPD/Reglamento de IA europeo). Groq sí tiene capa gratuita
 * sin tarjeta ni restricción geográfica conocida.
 */
export class GroqProvider implements AIProvider {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: config.ai.groqApiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }

  async chatJson({ system, prompt, images = [], maxTokens = 4096 }: AIChatOptions): Promise<string> {
    const content: OpenAI.Chat.ChatCompletionContentPart[] = [
      { type: "text", text: prompt },
      ...images.map((img) => ({
        type: "image_url" as const,
        image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
      })),
    ];

    const response = await this.client.chat.completions.create({
      model: config.ai.groqModel,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        { role: "user" as const, content },
      ],
    });

    const text = response.choices[0]?.message?.content;
    if (!text) {
      throw new Error("Respuesta de Groq sin contenido");
    }
    return text;
  }
}
