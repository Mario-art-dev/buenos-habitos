import { config } from "@/lib/config";

const displayNames = new Intl.DisplayNames(["es"], { type: "language" });

/**
 * Nombre en español del idioma configurado para el contenido generado (títulos, descripciones,
 * hashtags, comentario en off...), p.ej. "inglés", "español", "francés". Acepta cualquier código
 * ISO que ponga el usuario en CHANNEL_LANGUAGE, no solo los que conocemos de antemano.
 */
export function contentLanguageName(): string {
  try {
    return displayNames.of(config.channel.language) ?? config.channel.language;
  } catch {
    return config.channel.language;
  }
}
