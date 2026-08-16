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

export const config = {
  appUrl: optional("APP_URL", "http://localhost:3000"),
  appPassword: optional("APP_PASSWORD"),
  sessionSecret: optional("SESSION_SECRET", "dev-secret-change-me"),

  ai: {
    provider: (optional("AI_PROVIDER", "anthropic") as "anthropic" | "openai" | "gemini"),
    anthropicApiKey: optional("ANTHROPIC_API_KEY"),
    anthropicModel: optional("ANTHROPIC_MODEL", "claude-sonnet-5"),
    openaiApiKey: optional("OPENAI_API_KEY"),
    openaiModel: optional("OPENAI_ANALYSIS_MODEL", "gpt-4o"),
    geminiApiKey: optional("GEMINI_API_KEY"),
    geminiModel: optional("GEMINI_MODEL", "gemini-2.0-flash"),
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

  pipeline: {
    maxClipsPerJob: Number(optional("MAX_CLIPS_PER_JOB", "8")),
    clipMinSeconds: Number(optional("CLIP_MIN_SECONDS", "15")),
    clipMaxSeconds: Number(optional("CLIP_MAX_SECONDS", "90")),
    workerPollIntervalMs: Number(optional("WORKER_POLL_INTERVAL_MS", "4000")),
  },

  ranking: {
    minItems: Number(optional("RANKING_MIN_ITEMS", "5")),
    maxItems: Number(optional("RANKING_MAX_ITEMS", "10")),
    minSegmentSeconds: Number(optional("RANKING_MIN_SEGMENT_SECONDS", "3")),
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
    language: optional("CHANNEL_LANGUAGE", "es"),
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
}
