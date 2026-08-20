import path from "path";
import fs from "fs";
import { config } from "@/lib/config";

const ROOT = path.resolve(process.cwd(), config.storageDir);

export function jobDir(jobId: string): string {
  const dir = path.join(ROOT, "jobs", jobId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sourceVideoPath(jobId: string): string {
  return path.join(jobDir(jobId), "source.mp4");
}

export function audioPath(jobId: string): string {
  return path.join(jobDir(jobId), "audio.mp3");
}

export function clipsDir(jobId: string): string {
  const dir = path.join(jobDir(jobId), "clips");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function clipVideoPath(jobId: string, clipId: string): string {
  return path.join(clipsDir(jobId), `${clipId}.mp4`);
}

export function clipThumbnailPath(jobId: string, clipId: string): string {
  return path.join(clipsDir(jobId), `${clipId}.jpg`);
}

/** Vídeo del ranking ya montado (cortes + tarjetas + subtítulos) pero sin música mezclada todavía. */
export function clipAssembledPath(jobId: string, clipId: string): string {
  return path.join(clipsDir(jobId), `${clipId}_assembled.mp4`);
}

export function tmpDir(jobId: string): string {
  const dir = path.join(jobDir(jobId), "tmp");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function candidateThumbPath(jobId: string, index: number): string {
  return path.join(tmpDir(jobId), `candidate_${index}.jpg`);
}

export function candidateSubClipPath(jobId: string, clipId: string, position: number): string {
  return path.join(tmpDir(jobId), `${clipId}_item_${position}.mp4`);
}

export function candidateCardPath(jobId: string, clipId: string, key: string): string {
  return path.join(tmpDir(jobId), `${clipId}_card_${key}.mp4`);
}

/** Clip principal ya cortado, antes de envolverlo con las tarjetas de comentario narrado. */
export function clipBodyPath(jobId: string, clipId: string): string {
  return path.join(tmpDir(jobId), `${clipId}_body.mp4`);
}

/** Clip ya envuelto con las tarjetas de comentario narrado, antes de envolverlo con la portada. */
export function clipCommentedPath(jobId: string, clipId: string): string {
  return path.join(tmpDir(jobId), `${clipId}_commented.mp4`);
}

/** Portada de marca (fotograma + título + sonido) que abre y cierra el short. */
export function coverCardPath(jobId: string, clipId: string): string {
  return path.join(tmpDir(jobId), `${clipId}_cover.mp4`);
}

export function narrationAudioPath(jobId: string, clipId: string, key: string): string {
  return path.join(tmpDir(jobId), `${clipId}_narration_${key}.wav`);
}

export function musicSegmentPath(jobId: string, clipId: string): string {
  return path.join(tmpDir(jobId), `${clipId}_music.mp3`);
}

/** Fotos/vídeos del producto: subidos por el usuario o extraídos por scraping del enlace del producto. */
export function productAssetsDir(jobId: string): string {
  const dir = path.join(jobDir(jobId), "product_assets");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function productAssetPath(jobId: string, index: number, ext: string): string {
  return path.join(productAssetsDir(jobId), `asset_${index}.${ext}`);
}

export function songAudioPath(jobId: string): string {
  return path.join(jobDir(jobId), "song.mp3");
}

export function productSegmentPath(jobId: string, clipId: string, key: string): string {
  return path.join(tmpDir(jobId), `${clipId}_product_${key}.mp4`);
}

export function songSegmentPath(jobId: string, clipId: string, index: number): string {
  return path.join(tmpDir(jobId), `${clipId}_song_seg_${index}.mp4`);
}

/** Vídeo del modo Canción ya montado con los cortes al ritmo, antes de sustituir el audio por la canción. */
export function songSilentAssemblyPath(jobId: string, clipId: string): string {
  return path.join(tmpDir(jobId), `${clipId}_song_silent.mp4`);
}

/** Archivo .ass de la capa de "caption" grande y de colores del centro de la pantalla. */
export function bigCaptionsPath(jobId: string, clipId: string, position = 0): string {
  return path.join(tmpDir(jobId), `${clipId}_bigcap_${position}.ass`);
}

/** Archivo .ass de los textos que el usuario añade a mano en el editor del clip. */
export function customTextPath(jobId: string, clipId: string): string {
  return path.join(tmpDir(jobId), `${clipId}_customtext.ass`);
}

/** Fotograma temporal para comprobar si el gancho inicial del clip muestra a una persona. */
export function hookFramePath(jobId: string, clipId: string): string {
  return path.join(tmpDir(jobId), `${clipId}_hook.jpg`);
}

/**
 * Subidas troceadas: el túnel gratuito (Cloudflare) corta cada petición individual sobre los
 * ~100MB, así que los vídeos grandes (p.ej. una recopilación de una hora) se suben en trozos
 * pequeños que se van concatenando aquí antes de convertirse en el vídeo fuente de un job.
 */
export function uploadsDir(): string {
  const dir = path.join(ROOT, "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function uploadPartPath(uploadId: string): string {
  return path.join(uploadsDir(), `${uploadId}.part`);
}

/** Convierte una ruta absoluta de storage en una ruta relativa servible por /api/media/... */
export function toMediaUrl(absolutePath: string | null | undefined): string | null {
  if (!absolutePath) return null;
  const rel = path.relative(ROOT, absolutePath).split(path.sep).join("/");
  return `/api/media/${rel}`;
}

export function resolveMediaPath(relParts: string[]): string {
  return path.join(ROOT, ...relParts);
}

export const STORAGE_ROOT = ROOT;
