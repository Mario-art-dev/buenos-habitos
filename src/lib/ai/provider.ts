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
import { GroqProvider } from "./groq";
import { RateLimitedProvider, TokenRateLimiter } from "./rateLimit";

let cached: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  requireAiKey();
  if (cached) return cached;

  let provider: AIProvider;
  switch (config.ai.provider) {
    case "openai":
      provider = new OpenAIProvider();
      break;
    case "gemini":
      provider = new GeminiProvider();
      break;
    case "groq":
      provider = new GroqProvider();
      break;
    default:
      provider = new AnthropicProvider();
  }

  // Un único limitador compartido por todo el proceso: el presupuesto por minuto es de la
  // cuenta entera, no de cada llamada, así que todas las partes del pipeline lo comparten.
  cached =
    config.ai.tokensPerMinute > 0
      ? new RateLimitedProvider(provider, new TokenRateLimiter(config.ai.tokensPerMinute))
      : provider;

  return cached;
}
