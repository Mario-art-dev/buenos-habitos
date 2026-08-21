// GitHub Secrets (y pegar a mano desde el móvil en general) cuelan fácilmente un espacio o
// salto de línea invisible al principio/final del valor — el Client ID/Secret "parece" igual a
// simple vista pero ya no coincide byte a byte con lo que tiene Google/TikTok, y APIs como OAuth
// lo rechazan sin más pista que "invalid_client". Recortarlo aquí, en el único punto por el que
// pasan TODAS las variables de entorno, evita tener que perseguir este bug variable por variable.
function required(name: string, fallback?: string): string {
  const value = (process.env[name] ?? fallback)?.trim();
  if (value === undefined) {
    throw new Error(`Falta la variable de entorno ${name}. Revisa tu archivo .env (mira .env.example).`);
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

const aiProvider = optional("AI_PROVIDER", "anthropic") as "anthropic" | "openai" | "gemini" | "groq";

// La capa gratuita de Groq limita a 8.000 tokens por PETICIÓN y 200.000 tokens AL DÍA — ambos
// importan. El modelo de texto por defecto (gpt-oss-20b con reasoning_effort:"low") gasta mucho
// menos en "pensar" que el modelo de visión (qwen3.6, que no se puede bajar de intensidad), así
// que puede permitirse trozos de transcripción más grandes. Esto es importante porque cada
// petición repite el mismo texto de sistema/instrucciones: menos peticiones (trozos más grandes)
// = menos coste total repetido = un vídeo largo entero cabe de verdad en el cupo diario. Con un
// vídeo de 1 hora, esto reduce el gasto de la fase de análisis de ~142% del cupo diario (con
// trozos más pequeños) a ~55%, dejando margen real para el resto del trabajo (comentario,
// hashtags, subidas). Comprobado con números reales, no es una estimación al azar.
const FREE_TIER_DEFAULTS = {
  groq: { tokensPerMinute: "8000", transcriptChars: "8000", visionBatch: "1" },
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
    // gpt-oss-20b (no qwen3.6) para texto: es más pequeño/rápido y, sobre todo, Groq SÍ deja
    // controlarle el razonamiento con "reasoning_effort" (a "low" gasta muchos menos tokens
    // pensando de verdad, no solo lo esconde del resultado como pasaba con qwen3.6). Con la
    // capa gratuita limitada a 200.000 tokens AL DÍA (no solo por minuto), ese ahorro real es
    // necesario: analizar un solo vídeo de 50 min con qwen3.6 se comía casi todo el día entero.
    groqModel: optional("GROQ_MODEL", "openai/gpt-oss-20b"),
    // gpt-oss-20b no tiene visión: para clasificar fotogramas (modo Rankings/Canción) hace falta
    // un modelo que sí vea imágenes, así que ese caso sigue usando qwen3.6 aparte.
    groqVisionModel: optional("GROQ_VISION_MODEL", "qwen/qwen3.6-27b"),

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
    // Añade voz en off + una tarjeta de texto sobre fondo negro (intro y cierre) antes/después
    // de cada short. Por defecto DESACTIVADO: un short profesional (estilo MrBeast) entra
    // directo a la acción, no se detiene unos segundos en una pantalla negra con letras.
    enabled: optional("ENABLE_COMMENTARY", "false") === "true",
  },

  dynamicZoom: {
    // De vez en cuando (unos segundos cada ~9s, variando por clip) recorta el plano a más zoom
    // ocupando el vertical entero, en vez de quedarse fijo con las barras de fondo desenfocado
    // todo el short — corte de cámara habitual en edición viral para que el plano no se sienta
    // estático 60-180s seguidos.
    enabled: optional("ENABLE_DYNAMIC_ZOOM", "true") === "true",
  },

  bigCaptions: {
    // Único subtítulo quemado sobre el vídeo: un "caption" grande en el centro, blanco, que
    // resalta en verde y un poco más grande la palabra exacta que se está diciendo — estilo
    // pedido explícitamente por el usuario a partir de ejemplos reales (MrBeastClips). Antes
    // había una segunda capa pequeña abajo; se quitó a petición expresa ("hay dos subtítulos,
    // quiero que elimines el de abajo").
    enabled: optional("ENABLE_BIG_CAPTIONS", "true") === "true",
  },

  hookFrameCheck: {
    // Comprueba con IA (un único fotograma, una única llamada por clip) si al principio del
    // short se ve a una persona en pantalla — el gancho engancha mucho más con una cara desde el
    // segundo 0 que con un plano vacío o de transición. Si no se ve, adelanta el inicio un poco
    // (ajuste local, sin coste de IA) como mejor intento. Cuesta un fotograma+llamada de más por
    // clip (modelo de visión, ~1 imagen ~1600 tokens + margen de razonamiento oculto), así que en
    // vídeos con muchos clips resta presupuesto diario real: se puede desactivar si hace falta.
    enabled: optional("ENABLE_HOOK_FRAME_CHECK", "true") === "true",
  },

  coverCard: {
    // Portada de marca al principio y al final de cada short: un fotograma del propio vídeo (a
    // máxima calidad) con el título quemado encima estilo miniatura de creador de contenido,
    // congelado mientras suena el sonido de marca (assets/audio/brand_sting.wav). Pedido
    // explícito del usuario: la pantalla en pausa con la portada mientras suena el sonido, y
    // directo al vídeo después — la MISMA portada se repite igual al final.
    enabled: optional("ENABLE_COVER_CARD", "true") === "true",
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
    // El redirect_uri de OAuth NO sale de aquí: la URL pública cambia cada vez que se reinicia
    // la sesión (túnel de Cloudflare), así que se calcula por petición a partir de la cabecera
    // Host real (ver src/lib/requestOrigin.ts) en vez de fiarse de una URL fija.
  },

  tiktok: {
    clientKey: optional("TIKTOK_CLIENT_KEY"),
    clientSecret: optional("TIKTOK_CLIENT_SECRET"),
  },

  ytdlpPath: optional("YTDLP_PATH", "yt-dlp"),
  ffmpegPath: optional("FFMPEG_PATH", "ffmpeg"),
  // Servicio bgutil-ytdlp-pot-provider: genera un token de origen para que YouTube no bloquee
  // las descargas desde IPs de datacenter (Docker/GitHub Actions) con "Sign in to confirm
  // you're not a bot". Por defecto asume que corre en la misma máquina (caso GitHub Actions);
  // en docker-compose se sobreescribe a la URL del servicio "bgutil-provider".
  ytdlpPotProviderBaseUrl: optional("BGUTIL_POT_BASE_URL", "http://127.0.0.1:4416"),

  pipeline: {
    maxClipsPerJob: Number(optional("MAX_CLIPS_PER_JOB", "40")),
    clipMinSeconds: Number(optional("CLIP_MIN_SECONDS", "60")),
    clipMaxSeconds: Number(optional("CLIP_MAX_SECONDS", "180")),
    workerPollIntervalMs: Number(optional("WORKER_POLL_INTERVAL_MS", "4000")),
  },

  ranking: {
    minItems: Number(optional("RANKING_MIN_ITEMS", "5")),
    maxItems: Number(optional("RANKING_MAX_ITEMS", "10")),
    minSegmentSeconds: Number(optional("RANKING_MIN_SEGMENT_SECONDS", "3")),
    // Duración total mínima (suma de los momentos, sin contar tarjetas/subtítulos) que tiene que
    // tener un vídeo de ranking para publicarse — por debajo de esto no cuenta como visualización
    // monetizable de verdad en TikTok/YouTube, igual que el mínimo por clip en modo SINGLE.
    minDurationSec: Number(optional("RANKING_MIN_DURATION_SEC", "60")),
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
      "Recopilación de los momentos más divertidos, graciosos y de entretenimiento de creadores de contenido — humor, giros inesperados y reacciones, pensado para el público de comedia/entretenimiento de shorts"
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
