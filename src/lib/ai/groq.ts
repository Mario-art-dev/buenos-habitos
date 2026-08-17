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

    // gpt-oss-20b (texto) no ve imágenes: las peticiones con fotogramas adjuntos (clasificación
    // de momentos en modo Rankings/Canción) usan aparte un modelo que sí sea multimodal.
    const usingVisionModel = images.length > 0;
    const model = usingVisionModel ? config.ai.groqVisionModel : config.ai.groqModel;

    const params = {
      model,
      max_tokens: maxTokens,
      response_format: { type: "json_object" as const },
      // Modelos con razonamiento anteponen un bloque de "pensamiento" a la respuesta si no se
      // oculta explícitamente, lo que rompe la validación de "json_object" de Groq en TODAS las
      // peticiones (error "Failed to validate JSON"). Groq solo admite "hidden" o "parsed"
      // combinado con json_object; "hidden" descarta el razonamiento y deja solo el JSON final.
      reasoning_format: "hidden" as const,
      // Solo gpt-oss admite bajar el esfuerzo de razonamiento de verdad (no solo esconderlo del
      // resultado): con la capa gratuita de Groq limitada a 200.000 tokens AL DÍA, ese ahorro
      // real de tokens es necesario, no solo cosmético. qwen3.6 (el modelo de visión) rechaza
      // este parámetro, así que solo se manda cuando NO se usa el modelo de visión.
      ...(usingVisionModel ? {} : { reasoning_effort: "low" as const }),
      stream: false as const,
      messages: [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        { role: "user" as const, content },
      ],
    };

    let response: OpenAI.Chat.ChatCompletion;
    try {
      response = await this.client.chat.completions.create(
        params as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
      );
    } catch (err) {
      // Si Groq rechaza la salida por no ser JSON válido, el cuerpo del error trae el texto
      // real generado en "failed_generation". Lo incluimos en el mensaje para poder
      // diagnosticar de un vistazo si vuelve a pasar, en vez de solo ver "Failed to validate JSON".
      const apiErr = err as { error?: { failed_generation?: string; error?: { failed_generation?: string } } };
      const failedGeneration =
        apiErr?.error?.failed_generation ?? apiErr?.error?.error?.failed_generation;
      if (failedGeneration) {
        const preview = failedGeneration.slice(0, 300);
        throw new Error(`${(err as Error).message} — generado: "${preview}"`);
      }
      throw err;
    }

    const text = response.choices[0]?.message?.content;
    if (!text) {
      throw new Error("Respuesta de Groq sin contenido");
    }
    return text;
  }
}
