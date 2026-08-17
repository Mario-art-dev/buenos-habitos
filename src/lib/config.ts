function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Falta la variable de entorno ${name}. Revisa tu archivo .env (mira .env.example).`);
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

const aiProvider = optional("AI_PROVIDER", "anthropic") as "anthropic" | "openai" | "gemini" | "groq";

// La capa gratuita de Groq limita a 8.000 tokens por PETICIÓN (no solo por minuto), muy por
// debajo de lo que ocupa la transcripción de un vídeo largo. Además, el modelo por defecto
// (qwen3.6, "de razonamiento") gasta una parte de esos tokens pensando por dentro antes de
// responder, aunque esa parte se oculte del resultado — así que cuanto más grande el trozo de
// transcripción que se manda, menos margen le queda para el razonamiento + la respuesta, y el
// JSON sale cortado a medias. Por eso aquí se trocea en trozos pequeños (menos texto de entrada)
// y se deja mucho margen de salida (maxTokens) para el razonamiento + la respuesta real.
const FREE_TIER_DEFAULTS = {
  groq: { tokensPerMinute: "8000", transcriptChars: "4000", visionBatch: "1" },
  gemini: { tokensPerMinute: "0", transcriptChars: "40000", visionBatch: "6" },
  anthropic: { tokensPerMinute: "0", transcriptChars: "60000", visionBatch: "6" },
  openai: { tokensPerMinute: "0", transcriptChars: "60000", visionBatch: "6" },
} as const;

const aiDefaults = FREE_TIER_DEFAULTS[aiProvider] ?? FREE_TIER_DEFAULTS.anthropic;

// El inglés suele dar más ingresos publicitarios (CPM más alto) que el español, así que es el
// idioma por defecto de todo el contenido generado (títulos, descripciones, hashtags, comentario
// en off...). Esto NO afecta al audio original de los vídeos fuente, que nunca se traduce ni se
// dobla: se recorta y se usa tal cual venga (si un vídeo fuente ya está en inglés, se queda igual).
const channelLanguage = optional("CHANNEL_LANGUAGE") || "en";

// Voz de Piper que mejor encaja con el idioma configurado, para que el comentario en off (TTS)
// no quede en un idioma distinto al de los títulos/descripciones. Se puede forzar otra con
// LOCAL_TTS_VOICE si el idioma configurado no es ninguno de estos.
const DEFAULT_TTS_VOICE_BY_LANGUAGE: Record<string, string> = {
  en: "en_US-lessac-medium",
  es: "es_ES-davefx-medium",
};

export const config = {
  appUrl: optional("APP_URL", "http://localhost:3000"),
  appPassword: optional("APP_PASSWORD"),
  sessionSecret: optional("SESSION_SECRET", "dev-secret-change-me"),

  ai: {
    provider: aiProvider,
    anthropicApiKey: optional("ANTHROPIC_API_KEY"),
    anthropicModel: optional("ANTHROPIC_MODEL", "claude-sonnet-5"),
    openaiApiKey: optional("OPENAI_API_KEY"),
    openaiModel: optional("OPENAI_ANALYSIS_MODEL", "gpt-4o"),
    geminiApiKey: optional("GEMINI_API_KEY"),
    // "gemini-flash-latest" es un alias que Google mantiene apuntando siempre al último
    // Flash estable, así este valor por defecto no se queda obsoleto cuando lancen modelos nuevos.
    geminiModel: optional("GEMINI_MODEL", "gemini-flash-latest"),
    // Groq: alternativa gratuita a Gemini para quien esté en la UE/Reino Unido/Suiza, donde la
    // capa gratuita de Gemini no está disponible (Google exige tarjeta ahí por el RGPD/Reglamento
    // de IA). Groq no tiene esa restricción ni pide tarjeta.
    groqApiKey: optional("GROQ_API_KEY"),
    groqModel: optional("GROQ_MODEL", "qwen/qwen3.6-27b"),

    // Presupuesto de tokens por minuto del proveedor (0 = sin freno). Si se supera, la API
    // devuelve 413/429 y el trabajo falla, así que las peticiones se espacian solas.
    tokensPerMinute: Number(optional("AI_TOKENS_PER_MINUTE", aiDefaults.tokensPerMinute)),
    // Cuánta transcripción cabe en una sola petición: los vídeos largos se analizan por partes.
    maxTranscriptChars: Number(optional("AI_MAX_TRANSCRIPT_CHARS", aiDefaults.transcriptChars)),
    // Cuántos fotogramas se mandan juntos al clasificar momentos con visión (modo Rankings).
    visionBatchSize: Number(optional("AI_VISION_BATCH_SIZE", aiDefaults.visionBatch)),
  },

  transcription: {
    // "openai" = API de Whisper (de pago) | "local" = faster-whisper en el propio servidor (gratis)
    provider: (optional("TRANSCRIPTION_PROVIDER", "openai") as "openai" | "local"),
    localModel: optional("LOCAL_WHISPER_MODEL", "base"),
    pythonPath: optional("PYTHON_PATH", "python3"),
  },

  whisper: {
    apiKey: optional("OPENAI_API_KEY_WHISPER") || optional("OPENAI_API_KEY"),
    model: optional("WHISPER_MODEL", "whisper-1"),
  },

  commentary: {
    // Añade voz en off + texto de comentario/reacción con IA a cada short (intro y cierre),
    // para reforzar que el contenido esté transformado y no sea una copia directa.
    enabled: optional("ENABLE_COMMENTARY", "true") === "true",
  },

  tts: {
    // "local" = Piper (gratis, corre en el propio servidor) | "openai" = API de voz de OpenAI (de pago)
    provider: (optional("TTS_PROVIDER", "local") as "local" | "openai"),
    localVoice: optional("LOCAL_TTS_VOICE") || DEFAULT_TTS_VOICE_BY_LANGUAGE[channelLanguage] || "en_US-lessac-medium",
    openaiApiKey: optional("OPENAI_API_KEY_TTS") || optional("OPENAI_API_KEY"),
    openaiVoice: optional("OPENAI_TTS_VOICE", "alloy"),
    openaiModel: optional("OPENAI_TTS_MODEL", "tts-1"),
  },

  google: {
    clientId: optional("GOOGLE_CLIENT_ID"),
    clientSecret: optional("GOOGLE_CLIENT_SECRET"),
    get redirectUri() {
      return `${config.appUrl}/api/auth/youtube/callback`;
    },
  },

  tiktok: {
    clientKey: optional("TIKTOK_CLIENT_KEY"),
    clientSecret: optional("TIKTOK_CLIENT_SECRET"),
    get redirectUri() {
      return `${config.appUrl}/api/auth/tiktok/callback`;
    },
  },

  ytdlpPath: optional("YTDLP_PATH", "yt-dlp"),
  ffmpegPath: optional("FFMPEG_PATH", "ffmpeg"),
  // Servicio bgutil-ytdlp-pot-provider: genera un token de origen para que YouTube no bloquee
  // las descargas desde IPs de datacenter (Docker/GitHub Actions) con "Sign in to confirm
  // you're not a bot". Por defecto asume que corre en la misma máquina (caso GitHub Actions);
  // en docker-compose se sobreescribe a la URL del servicio "bgutil-provider".
  ytdlpPotProviderBaseUrl: optional("BGUTIL_POT_BASE_URL", "http://127.0.0.1:4416"),

  pipeline: {
    maxClipsPerJob: Number(optional("MAX_CLIPS_PER_JOB", "30")),
    clipMinSeconds: Number(optional("CLIP_MIN_SECONDS", "60")),
    clipMaxSeconds: Number(optional("CLIP_MAX_SECONDS", "180")),
    workerPollIntervalMs: Number(optional("WORKER_POLL_INTERVAL_MS", "4000")),
  },

  ranking: {
    minItems: Number(optional("RANKING_MIN_ITEMS", "5")),
    maxItems: Number(optional("RANKING_MAX_ITEMS", "10")),
    minSegmentSeconds: Number(optional("RANKING_MIN_SEGMENT_SECONDS", "3")),
  },

  song: {
    maxDurationSec: Number(optional("SONG_MAX_DURATION_SEC", "60")),
  },

  scheduler: {
    pollIntervalMs: Number(optional("SCHEDULER_POLL_INTERVAL_MS", "60000")),
  },

  channel: {
    name: optional("CHANNEL_NAME", "Escenas Virales"),
    niche: optional(
      "CHANNEL_NICHE",
      "Recopilación de las mejores escenas virales de creadores de contenido"
    ),
    language: channelLanguage,
  },

  storageDir: optional("STORAGE_DIR", "storage"),
};

export function requireAiKey(): void {
  if (config.ai.provider === "anthropic" && !config.ai.anthropicApiKey) {
    throw new Error("AI_PROVIDER=anthropic pero falta ANTHROPIC_API_KEY en .env");
  }
  if (config.ai.provider === "openai" && !config.ai.openaiApiKey) {
    throw new Error("AI_PROVIDER=openai pero falta OPENAI_API_KEY en .env");
  }
  if (config.ai.provider === "gemini" && !config.ai.geminiApiKey) {
    throw new Error("AI_PROVIDER=gemini pero falta GEMINI_API_KEY en .env");
  }
  if (config.ai.provider === "groq" && !config.ai.groqApiKey) {
    throw new Error("AI_PROVIDER=groq pero falta GROQ_API_KEY en .env");
  }
}
