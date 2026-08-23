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

import { config } from "@/lib/config";
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import { GeminiProvider } from "./gemini";
import { GroqProvider } from "./groq";
import { CerebrasProvider } from "./cerebras";
import { MistralProvider } from "./mistral";
import { RateLimitedProvider, TokenRateLimiter } from "./rateLimit";
import { resolvedAiKeys, type AiProviderName } from "./credentials";

type ProviderName = AiProviderName;

function buildProvider(name: ProviderName, apiKey: string): AIProvider {
  switch (name) {
    case "openai":
      return new OpenAIProvider(apiKey);
    case "gemini":
      return new GeminiProvider(apiKey);
    case "groq":
      return new GroqProvider(apiKey);
    case "cerebras":
      return new CerebrasProvider(apiKey);
    case "mistral":
      return new MistralProvider(apiKey);
    default:
      return new AnthropicProvider(apiKey);
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
// Huella de qué claves se usaron para construir "cached" — si cambian (se guarda/quita una clave
// desde Ajustes), se reconstruye la cadena; si no, se reutiliza la misma instancia (importa: cada
// RateLimitedProvider recuerda en memoria si ese proveedor ya agotó su cupo diario, y esa memoria
// se perdería sin necesidad si se reconstruyera en cada llamada).
let cachedFingerprint = "";

export async function getAIProvider(): Promise<AIProvider> {
  const keys = await resolvedAiKeys();
  // El orden real de uso es SIEMPRE el de FALLBACK_ORDER (de mejor a peor, gratuitas primero),
  // filtrado a los proveedores que de verdad tienen clave configurada (desde Ajustes o como
  // variable de entorno/secreto de GitHub, indistintamente) — AI_PROVIDER ya no fuerza cuál va
  // primero. Así, en cuanto hay clave de un proveedor mejor (p.ej. Gemini), empieza a usarse el
  // primero automáticamente sin tocar nada más ni reiniciar el servidor.
  const chain = FALLBACK_ORDER.filter((name) => !!keys[name]);

  if (chain.length === 0) {
    throw new Error(
      "No hay ninguna clave de IA configurada: añade una desde Ajustes → Proveedores de IA, o como " +
        "variable de entorno (GEMINI_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY, MISTRAL_API_KEY, " +
        "ANTHROPIC_API_KEY u OPENAI_API_KEY)."
    );
  }

  const fingerprint = chain.map((name) => `${name}:${keys[name]}`).join("|");
  if (cached && fingerprint === cachedFingerprint) return cached;

  // Un limitador de tokens por minuto POR PROVEEDOR: cada uno tiene su propio presupuesto (son
  // cuentas distintas), así que comparten limitador no tendría sentido — pero dentro de un mismo
  // proveedor sí es una única cuenta para todo el proceso.
  const wrapped = chain.map((name) => {
    const provider = buildProvider(name, keys[name]);
    return config.ai.tokensPerMinute > 0
      ? new RateLimitedProvider(provider, new TokenRateLimiter(config.ai.tokensPerMinute))
      : provider;
  });

  cached = wrapped.length > 1 ? new FallbackAIProvider(wrapped, chain) : wrapped[0];
  cachedFingerprint = fingerprint;
  return cached;
}
