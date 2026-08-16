export interface AIChatOptions {
  system?: string;
  prompt: string;
  maxTokens?: number;
}

export interface AIProvider {
  /** Envía un prompt de texto y devuelve la respuesta completa como string. */
  chatJson(options: AIChatOptions): Promise<string>;
}

import { config, requireAiKey } from "@/lib/config";
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";

let cached: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  requireAiKey();
  if (cached) return cached;
  cached = config.ai.provider === "openai" ? new OpenAIProvider() : new AnthropicProvider();
  return cached;
}
