export interface AIImage {
  base64: string;
  mediaType: "image/jpeg" | "image/png";
}

export interface AIChatOptions {
  system?: string;
  prompt: string;
  images?: AIImage[];
  maxTokens?: number;
}

export interface AIProvider {
  /** Envía un prompt (con imágenes opcionales) y devuelve la respuesta completa como string (JSON). */
  chatJson(options: AIChatOptions): Promise<string>;
}

import { config, requireAiKey } from "@/lib/config";
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import { GeminiProvider } from "./gemini";

let cached: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  requireAiKey();
  if (cached) return cached;
  switch (config.ai.provider) {
    case "openai":
      cached = new OpenAIProvider();
      break;
    case "gemini":
      cached = new GeminiProvider();
      break;
    default:
      cached = new AnthropicProvider();
  }
  return cached;
}
