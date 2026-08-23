import OpenAI from "openai";
import { config } from "@/lib/config";
import type { AIChatOptions, AIProvider } from "./provider";

/**
 * Proveedor de IA usando Cerebras Cloud. Su API es compatible con la de OpenAI (mismo SDK,
 * cambiando solo la URL base), así que se reutiliza el paquete "openai" — igual que Groq.
 *
 * Otra alternativa gratuita sin tarjeta (como Groq), pensada como segundo eslabón de la cadena
 * de proveedores: si Groq agota su cupo diario, se prueba aquí antes de recurrir a un proveedor
 * de pago. Los modelos que sirve Cerebras son sobre todo de texto — si el modelo configurado no
 * admite imágenes, una petición de clasificación por visión (modo Rankings) fallará aquí y
 * FallbackAIProvider pasará sola al siguiente proveedor de la cadena.
 */
export class CerebrasProvider implements AIProvider {
  private client: OpenAI;

  constructor(apiKey: string = config.ai.cerebrasApiKey) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.cerebras.ai/v1",
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
    const model = usingVisionModel ? config.ai.cerebrasVisionModel : config.ai.cerebrasModel;

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
      throw new Error("Respuesta de Cerebras sin contenido");
    }
    return text;
  }
}
