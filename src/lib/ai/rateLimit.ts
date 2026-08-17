import type { AIChatOptions, AIProvider } from "./provider";

/**
 * Las capas gratuitas de IA (Groq, Gemini...) limitan los tokens por minuto (TPM). Un vídeo
 * largo genera transcripciones enormes, así que sin control se supera el límite y la API
 * responde 413/429 y el trabajo entero falla. Este módulo lleva la cuenta de lo gastado en el
 * último minuto y espera lo necesario antes de cada petición.
 */

interface Spend {
  at: number;
  tokens: number;
}

const WINDOW_MS = 60_000;

export class TokenRateLimiter {
  private history: Spend[] = [];

  constructor(private readonly tokensPerMinute: number) {}

  private usedTokens(now: number): number {
    this.history = this.history.filter((s) => s.at > now - WINDOW_MS);
    return this.history.reduce((sum, s) => sum + s.tokens, 0);
  }

  /** Espera hasta que quepan `tokens` dentro del presupuesto del último minuto. */
  async reserve(tokens: number): Promise<void> {
    if (this.tokensPerMinute <= 0) return;

    // Una petición que por sí sola no cabe nunca esperaría eternamente: se deja pasar y que
    // sea la API quien la rechace, con un error claro, en vez de colgar el trabajo.
    const needed = Math.min(tokens, this.tokensPerMinute);

    for (;;) {
      const now = Date.now();
      if (this.usedTokens(now) + needed <= this.tokensPerMinute) {
        this.history.push({ at: now, tokens });
        return;
      }
      const oldest = this.history[0];
      const waitMs = oldest ? Math.max(500, oldest.at + WINDOW_MS - now) : 1_000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

/** Estimación aproximada de tokens: ~4 caracteres por token, más el coste fijo de cada imagen. */
export function estimateTokens(text: string, imageCount = 0, maxOutputTokens = 0): number {
  return Math.ceil(text.length / 4) + imageCount * 1_600 + maxOutputTokens;
}

function isRateLimitError(message: string): boolean {
  return /rate.?limit|429|413|too large|tokens per minute|\bTPM\b|quota/i.test(message);
}

/**
 * Envuelve un proveedor de IA para respetar el límite de tokens por minuto y reintentar
 * cuando aun así la API responda que se ha superado.
 */
export class RateLimitedProvider implements AIProvider {
  constructor(
    private readonly inner: AIProvider,
    private readonly limiter: TokenRateLimiter
  ) {}

  async chatJson(options: AIChatOptions): Promise<string> {
    const estimated = estimateTokens(
      `${options.system ?? ""}${options.prompt}`,
      options.images?.length ?? 0,
      options.maxTokens ?? 4_096
    );

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.limiter.reserve(estimated);
      try {
        return await this.inner.chatJson(options);
      } catch (err) {
        const error = err as Error;
        if (!isRateLimitError(error.message)) throw error;
        lastError = error;
        // Espera creciente: el límite se mide por minuto, así que esperar ~1 minuto suele bastar.
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 20_000));
      }
    }

    throw new Error(
      `La IA rechazó la petición por límite de uso incluso tras varios reintentos: ${lastError?.message ?? "sin detalle"}`
    );
  }
}
