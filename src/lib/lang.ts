import { config } from "@/lib/config";

const displayNamesEs = new Intl.DisplayNames(["es"], { type: "language" });

// Whisper (API u local) puede devolver el idioma detectado como código ISO 639-1 ("en", "es") o
// como su nombre en inglés ("english", "spanish") según el proveedor — se homogeneiza a un código
// ISO para poder mostrarlo siempre en español, sea cual sea el proveedor de transcripción.
const ISO_CANDIDATES = [
  "en", "es", "fr", "de", "it", "pt", "nl", "ru", "ja", "ko", "zh", "ar", "hi", "tr",
  "pl", "sv", "da", "no", "fi", "el", "he", "th", "vi", "id", "uk", "cs", "ro", "hu",
  "bg", "ca", "hr", "sk", "sr", "fa", "ur", "bn", "ta", "te", "ms", "sw",
];

const englishNameToCode: Record<string, string> = (() => {
  const dn = new Intl.DisplayNames(["en"], { type: "language" });
  const map: Record<string, string> = {};
  for (const code of ISO_CANDIDATES) {
    try {
      const name = dn.of(code);
      if (name) map[name.toLowerCase()] = code;
    } catch {
      // código no soportado por este runtime de Intl, se ignora
    }
  }
  return map;
})();

/**
 * Homogeneiza el idioma que devuelve Whisper (código ISO como "en"/"es", o el nombre en inglés
 * como "english"/"spanish" según el proveedor) a un código ISO 639-1 en minúsculas. Devuelve null
 * si no se reconoce nada útil (transcripción vacía, vídeo sin diálogo, etc.).
 */
export function normalizeLanguageCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (/^[a-z]{2}$/.test(trimmed)) return trimmed;
  return englishNameToCode[trimmed] ?? null;
}

/** Nombre en español de un código de idioma ISO, p.ej. "en" -> "inglés". */
export function languageDisplayName(code: string): string {
  try {
    return displayNamesEs.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Nombre en español del idioma configurado para el contenido generado (títulos, descripciones,
 * hashtags, comentario en off...) cuando no hay ningún idioma detectado del vídeo fuente (p.ej.
 * modos PRODUCT/SONG, que no transcriben diálogo). Acepta cualquier código ISO que ponga el
 * usuario en CHANNEL_LANGUAGE.
 */
export function contentLanguageName(): string {
  return languageDisplayName(config.channel.language);
}

/**
 * Idioma en el que debe escribirse TODO el texto generado para un trabajo concreto: el idioma
 * REAL hablado en el vídeo fuente (detectado por Whisper al transcribir, ver transcribe.ts) tiene
 * prioridad sobre el idioma fijo configurado del canal — así un vídeo en inglés genera título,
 * descripción, hashtags y subtítulos en inglés aunque el canal esté configurado en español, y
 * viceversa. Si no se pudo detectar (vídeo sin diálogo, transcripción vacía...), se cae al idioma
 * configurado del canal.
 */
export function resolveContentLanguage(detectedCode: string | null | undefined): string {
  if (detectedCode) return languageDisplayName(detectedCode);
  return contentLanguageName();
}

/**
 * Etiqueta "Parte N" quemada en pantalla en SPLIT/DOUBLE, traducida al inglés ("Part N") cuando
 * el vídeo está en inglés — pedido explícito. Cualquier otro idioma (incluido español, o sin
 * detectar) se queda en español, que es el valor por defecto de siempre.
 */
export function partLabel(contentLanguageCode: string | null | undefined, n: number): string {
  return contentLanguageCode === "en" ? `Part ${n}` : `Parte ${n}`;
}
