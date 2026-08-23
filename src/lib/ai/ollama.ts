import OpenAI from "openai";
import { config } from "@/lib/config";
import type { AIChatOptions, AIProvider } from "./provider";

/**
 * Proveedor de IA usando Ollama corriendo EN EL PROPIO SERVIDOR (ver server.yml): modelos abiertos
 * (Llama/Moondream) ejecutándose localmente, sin API externa, sin clave, sin cuenta, sin tarjeta,
 * sin límite de peticiones — el único límite es la potencia del propio servidor, así que es lento
 * comparado con Groq/Gemini/etc. Por eso es el ÚLTIMO eslabón de la cadena de proveedores (ver
 * FALLBACK_ORDER en provider.ts): solo se usa si todos los proveedores en la nube han fallado, y
 * en ese caso preferimos "lento pero funciona" a "el vídeo falla del todo".
 *
 * Usa el endpoint compatible con OpenAI que expone Ollama (mismo SDK que Groq/Cerebras/Mistral),
 * apuntando a localhost en vez de a un servicio externo — no hace falta ninguna clave real, Ollama
 * no la comprueba.
 */
export class OllamaProvider implements AIProvider {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: "ollama-no-hace-falta-clave",
      baseURL: `${config.ai.ollamaBaseUrl}/v1`,
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
    const model = usingVisionModel ? config.ai.ollamaVisionModel : config.ai.ollamaModel;

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
      throw new Error("Respuesta del modelo local (Ollama) sin contenido");
    }
    return text;
  }
}
