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

// El límite DIARIO (Groq: "tokens per day (TPD)") es un error distinto del de por minuto: no se
// arregla esperando unos segundos, se tarda decenas de minutos u horas en liberar. Reintentar
// como si fuera un límite por minuto solo malgasta tiempo y produce una cascada de errores casi
// idénticos en cada clip del trabajo (visto en real: 4 clips seguidos fallando ~80s cada uno).
function isDailyLimitError(message: string): boolean {
  return /tokens per day|\bTPD\b/i.test(message);
}

/** Extrae "Please try again in 38m39.8s" (o variantes con horas) del mensaje de error de Groq. */
function parseRetryAfterMs(message: string): number | null {
  const match = message.match(/try again in\s+(?:([\d.]+)\s*h)?\s*(?:([\d.]+)\s*m)?\s*(?:([\d.]+)\s*s)?/i);
  if (!match) return null;
  const hours = parseFloat(match[1] ?? "0") || 0;
  const minutes = parseFloat(match[2] ?? "0") || 0;
  const seconds = parseFloat(match[3] ?? "0") || 0;
  const totalMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
  return totalMs > 0 ? totalMs : null;
}

/**
 * Envuelve un proveedor de IA para respetar el límite de tokens por minuto y reintentar
 * cuando aun así la API responda que se ha superado.
 */
export class RateLimitedProvider implements AIProvider {
  // Una vez se detecta el límite diario, se recuerda para el resto de la sesión: así el resto
  // de clips del mismo trabajo (y cualquier trabajo posterior en esta misma sesión) fallan al
  // momento con un aviso claro, en vez de cada uno reintentando en vano.
  private dailyLimitUntil: number | null = null;

  constructor(
    private readonly inner: AIProvider,
    private readonly limiter: TokenRateLimiter
  ) {}

  async chatJson(options: AIChatOptions): Promise<string> {
    if (this.dailyLimitUntil && Date.now() < this.dailyLimitUntil) {
      const minutesLeft = Math.ceil((this.dailyLimitUntil - Date.now()) / 60_000);
      throw new Error(
        `La IA ha agotado su cupo gratuito DIARIO (no solo por minuto). Se libera solo con el tiempo: ` +
          `prueba de nuevo en ~${minutesLeft} min, o mejor mañana.`
      );
    }

    // Colchón de seguridad: el recuento real de tokens del proveedor va por delante de esta
    // estimación aproximada (~chars/4) en la práctica un 3-5%, lo bastante para que peticiones
    // que aquí salían "justo por debajo" del límite lleguen "justo por encima" en el servidor
    // real y reciban un 413 (visto con Groq: estimado ~7750, "Requested" real 8094-8300).
    const estimated = Math.ceil(
      estimateTokens(
        `${options.system ?? ""}${options.prompt}`,
        options.images?.length ?? 0,
        options.maxTokens ?? 4_096
      ) * 1.15
    );

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.limiter.reserve(estimated);
      try {
        return await this.inner.chatJson(options);
      } catch (err) {
        const error = err as Error;
        if (isDailyLimitError(error.message)) {
          const retryMs = parseRetryAfterMs(error.message) ?? 60 * 60_000;
          this.dailyLimitUntil = Date.now() + retryMs;
          throw new Error(
            `La IA ha agotado su cupo gratuito DIARIO (Groq limita los tokens por día, no solo por ` +
              `minuto). Se libera solo con el tiempo: prueba de nuevo en ~${Math.ceil(retryMs / 60_000)} min, ` +
              `o mejor mañana. Detalle: ${error.message}`
          );
        }
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
