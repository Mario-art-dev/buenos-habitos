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

type ProviderName = "anthropic" | "openai" | "gemini" | "groq";

function buildProvider(name: ProviderName): AIProvider {
  switch (name) {
    case "openai":
      return new OpenAIProvider();
    case "gemini":
      return new GeminiProvider();
    case "groq":
      return new GroqProvider();
    default:
      return new AnthropicProvider();
  }
}

function hasKey(name: ProviderName): boolean {
  switch (name) {
    case "openai":
      return !!config.ai.openaiApiKey;
    case "gemini":
      return !!config.ai.geminiApiKey;
    case "groq":
      return !!config.ai.groqApiKey;
    default:
      return !!config.ai.anthropicApiKey;
  }
}

// Orden de reserva cuando el proveedor principal se queda sin cupo: primero las capas gratuitas
// (Groq/Gemini), luego las de pago si están configuradas — así un usuario que solo puso una clave
// de pago "por si acaso" no la gasta mientras la gratuita siga funcionando.
const FALLBACK_ORDER: ProviderName[] = ["groq", "gemini", "anthropic", "openai"];

/**
 * Prueba los proveedores en orden y pasa al siguiente si el que está probando falla (agotó su
 * cupo diario, error de red, lo que sea) — así un trabajo entero no falla solo porque el
 * proveedor principal (normalmente la capa gratuita) se quedó sin cupo, si hay otra clave
 * configurada de repuesto. Ver el bug real que arregla esto: un vídeo de Rankings con varios
 * grupos fallaba TODOS en silencio (cada composeRanking() lanzaba el mismo error de cupo diario
 * antes de crear su Clip) y el job terminaba "Listo" con cero clips.
 */
class FallbackAIProvider implements AIProvider {
  constructor(
    private readonly providers: AIProvider[],
    private readonly names: string[]
  ) {}

  async chatJson(options: AIChatOptions): Promise<string> {
    let lastError: Error | null = null;
    for (let i = 0; i < this.providers.length; i++) {
      try {
        return await this.providers[i].chatJson(options);
      } catch (err) {
        lastError = err as Error;
        // sigue con el siguiente proveedor de la cadena, si queda alguno
      }
    }
    throw lastError ?? new Error("Ningún proveedor de IA configurado pudo responder.");
  }
}

let cached: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  requireAiKey();
  if (cached) return cached;

  const primary = config.ai.provider as ProviderName;
  const chain = [primary, ...FALLBACK_ORDER.filter((name) => name !== primary && hasKey(name))];

  // Un limitador de tokens por minuto POR PROVEEDOR: cada uno tiene su propio presupuesto (son
  // cuentas distintas), así que comparten limitador no tendría sentido — pero dentro de un mismo
  // proveedor sí es una única cuenta para todo el proceso.
  const wrapped = chain.map((name) => {
    const provider = buildProvider(name);
    return config.ai.tokensPerMinute > 0
      ? new RateLimitedProvider(provider, new TokenRateLimiter(config.ai.tokensPerMinute))
      : provider;
  });

  cached = wrapped.length > 1 ? new FallbackAIProvider(wrapped, chain) : wrapped[0];
  return cached;
}
