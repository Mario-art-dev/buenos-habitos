import { config } from "@/lib/config";
import type { AIChatOptions, AIProvider } from "./provider";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}

/**
 * Proveedor de IA usando la API de Google Gemini.
 *
 * Es la opción para funcionar sin coste: Gemini tiene una capa gratuita (con
 * límites de peticiones por minuto/día) que basta de sobra para este uso.
 * Se llama por REST directamente para no depender de otro SDK.
 */
export class GeminiProvider implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = config.ai.geminiApiKey;
    this.model = config.ai.geminiModel;
  }

  async chatJson({ system, prompt, images = [], maxTokens = 4096 }: AIChatOptions): Promise<string> {
    const parts: GeminiPart[] = [
      ...images.map((img) => ({
        inline_data: { mime_type: img.mediaType, data: img.base64 },
      })),
      { text: prompt },
    ];

    const body: Record<string, unknown> = {
      contents: [{ parts }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        responseMimeType: "application/json",
      },
    };
    if (system) {
      body.systemInstruction = { parts: [{ text: system }] };
    }

    const res = await fetch(`${BASE_URL}/${this.model}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as GeminiResponse;
    if (!res.ok) {
      throw new Error(`Gemini devolvió un error: ${data.error?.message ?? res.statusText}`);
    }

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) {
      throw new Error("Respuesta de Gemini sin contenido de texto");
    }
    return text;
  }
}
