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
import { CerebrasProvider } from "./cerebras";
import { MistralProvider } from "./mistral";
import { RateLimitedProvider, TokenRateLimiter } from "./rateLimit";

type ProviderName = "anthropic" | "openai" | "gemini" | "groq" | "cerebras" | "mistral";

function buildProvider(name: ProviderName): AIProvider {
  switch (name) {
    case "openai":
      return new OpenAIProvider();
    case "gemini":
      return new GeminiProvider();
    case "groq":
      return new GroqProvider();
    case "cerebras":
      return new CerebrasProvider();
    case "mistral":
      return new MistralProvider();
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
    case "cerebras":
      return !!config.ai.cerebrasApiKey;
    case "mistral":
      return !!config.ai.mistralApiKey;
    default:
      return !!config.ai.anthropicApiKey;
  }
}

// Orden de reserva cuando el proveedor principal se queda sin cupo: primero las capas gratuitas
// sin tarjeta, de mejor a peor para este tipo de tarea (metadatos + clasificación por visión),
// luego las de pago al final SOLO si además se ha configurado esa clave — así un usuario que solo
// puso una clave de pago "por si acaso" no la gasta mientras alguna gratuita siga funcionando, y
// quien no tenga ninguna de pago configurada nunca gasta dinero sin querer. Con las 4 capas
// gratuitas encadenadas, cada trabajo prueba TODA la cadena antes de fallar de verdad — así que
// hace falta agotar el cupo diario de las 4 a la vez para que un vídeo falle por esto.
const FALLBACK_ORDER: ProviderName[] = ["gemini", "groq", "cerebras", "mistral", "anthropic", "openai"];

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

  // El orden real de uso es SIEMPRE el de FALLBACK_ORDER (de mejor a peor, gratuitas primero),
  // filtrado a los proveedores que de verdad tienen clave configurada — AI_PROVIDER ya no fuerza
  // cuál va primero (antes sí, y si esa clave concreta faltaba pero otras sí estaban puestas, el
  // arranque entero fallaba solo por eso). Así, en cuanto se añade la clave de un proveedor mejor
  // (p.ej. Gemini), empieza a usarse el primero automáticamente sin tocar nada más.
  const chain = FALLBACK_ORDER.filter(hasKey);

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
