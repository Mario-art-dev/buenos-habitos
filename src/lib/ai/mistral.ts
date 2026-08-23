import OpenAI from "openai";
import { config } from "@/lib/config";
import type { AIChatOptions, AIProvider } from "./provider";

/**
 * Proveedor de IA usando Mistral (La Plateforme). Su API es compatible con la de OpenAI, así
 * que se reutiliza el paquete "openai" — igual que Groq/Cerebras.
 *
 * Tercer eslabón de repuesto en la cadena de proveedores gratuitos: se prueba si Groq y Cerebras
 * ya agotaron su cupo. Usa Pixtral (modelo con visión de Mistral) para las peticiones con
 * fotogramas adjuntos (modo Rankings).
 */
export class MistralProvider implements AIProvider {
  private client: OpenAI;

  constructor(apiKey: string = config.ai.mistralApiKey) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.mistral.ai/v1",
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

    const usingVisionModel = images.length > 0;
    const model = usingVisionModel ? config.ai.mistralVisionModel : config.ai.mistralModel;

    const params = {
      model,
      max_tokens: maxTokens,
      response_format: { type: "json_object" as const },
      stream: false as const,
      messages: [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        { role: "user" as const, content },
      ],
    };

    const response = await this.client.chat.completions.create(
      params as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
    );

    const text = response.choices[0]?.message?.content;
    if (!text) {
      throw new Error("Respuesta de Mistral sin contenido");
    }
    return text;
  }
}
