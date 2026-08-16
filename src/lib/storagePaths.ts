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

export function musicSegmentPath(jobId: string, clipId: string): string {
  return path.join(tmpDir(jobId), `${clipId}_music.mp3`);
}

export function srtPath(jobId: string, clipId: string, position: number): string {
  return path.join(tmpDir(jobId), `${clipId}_item_${position}.srt`);
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
