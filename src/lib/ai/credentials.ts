import { db } from "@/lib/db";
import { config } from "@/lib/config";

export type AiProviderName = "gemini" | "groq" | "cerebras" | "mistral" | "anthropic" | "openai";

export const AI_PROVIDER_NAMES: AiProviderName[] = ["gemini", "groq", "cerebras", "mistral", "anthropic", "openai"];

function envKey(provider: AiProviderName): string {
  switch (provider) {
    case "gemini":
      return config.ai.geminiApiKey;
    case "groq":
      return config.ai.groqApiKey;
    case "cerebras":
      return config.ai.cerebrasApiKey;
    case "mistral":
      return config.ai.mistralApiKey;
    case "anthropic":
      return config.ai.anthropicApiKey;
    case "openai":
      return config.ai.openaiApiKey;
  }
}

/**
 * Claves pegadas desde Ajustes (guardadas en la base de datos) — para quien no pueda/sepa moverse
 * por Settings → Secrets de GitHub. Si hay fila en AiCredential para un proveedor, esa clave
 * manda sobre la variable de entorno del mismo nombre; si no hay fila, se usa la de entorno tal
 * cual (el comportamiento de siempre). Así cualquiera de los dos caminos funciona indistintamente.
 */
export async function resolvedAiKeys(): Promise<Record<AiProviderName, string>> {
  const rows = await db.aiCredential.findMany();
  const fromDb = new Map(rows.map((r) => [r.provider as AiProviderName, r.apiKey]));
  const result = {} as Record<AiProviderName, string>;
  for (const name of AI_PROVIDER_NAMES) {
    result[name] = fromDb.get(name) || envKey(name);
  }
  return result;
}

export interface AiKeyStatus {
  provider: AiProviderName;
  configured: boolean;
  source: "app" | "env" | null;
}

/** Para la página de Ajustes: qué proveedores tienen clave y de dónde viene (nunca el valor real). */
export async function aiKeyStatuses(): Promise<AiKeyStatus[]> {
  const rows = await db.aiCredential.findMany();
  const fromDb = new Set(rows.map((r) => r.provider));
  return AI_PROVIDER_NAMES.map((provider) => {
    if (fromDb.has(provider)) return { provider, configured: true, source: "app" as const };
    if (envKey(provider)) return { provider, configured: true, source: "env" as const };
    return { provider, configured: false, source: null };
  });
}

export async function saveAiKey(provider: AiProviderName, apiKey: string): Promise<void> {
  await db.aiCredential.upsert({
    where: { provider },
    create: { provider, apiKey },
    update: { apiKey },
  });
}

export async function removeAiKey(provider: AiProviderName): Promise<void> {
  await db.aiCredential.deleteMany({ where: { provider } });
}
