import fs from "fs";
import path from "path";
import { config } from "@/lib/config";
import { run } from "./exec";
import type { VerticalResolution } from "./probe";

const DEFAULT_RES: VerticalResolution = { width: 1080, height: 1920 };

function escapeDrawtext(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/%/g, "\\%");
}

function escapeSubtitlesPath(p: string): string {
  // ffmpeg necesita escapar ":" y "\" dentro del argumento del filtro subtitles=
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function buildVerticalFilter(
  res: VerticalResolution,
  opts: { label?: string; subtitlesPath?: string } = {}
): string {
  const { width, height } = res;
  let filter =
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=20[bg];` +
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto,format=yuv420p[base]`;

  let lastLabel = "base";

  if (opts.subtitlesPath) {
    filter += `;[base]subtitles=${escapeSubtitlesPath(opts.subtitlesPath)}:force_style='FontName=Arial,FontSize=${Math.round(
      height / 27
    )},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Alignment=2,MarginV=${Math.round(
      height * 0.12
    )}'[subbed]`;
    lastLabel = "subbed";
  }

  if (opts.label) {
    const fontSize = Math.round(width / 6);
    filter += `;[${lastLabel}]drawtext=text='${escapeDrawtext(opts.label)}':fontcolor=white:fontsize=${fontSize}:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:borderw=6:bordercolor=black@0.8:x=(w-text_w)/2:y=${Math.round(
      height * 0.08
    )}[v]`;
    lastLabel = "v";
  } else {
    filter += `;[${lastLabel}]null[v]`;
    lastLabel = "v";
  }

  return filter;
}

export interface CutClipOptions {
  sourcePath: string;
  outPath: string;
  startSec: number;
  endSec: number;
  resolution?: VerticalResolution;
  label?: string;
  subtitlesPath?: string;
  muted?: boolean;
}

/**
 * Corta el segmento y lo recompone a formato vertical estilo short:
 * fondo desenfocado ampliado + vídeo original centrado sin recortar el encuadre.
 * Opcionalmente quema un texto de puesto (label) y/o subtítulos.
 */
export async function cutVerticalClip(opts: CutClipOptions): Promise<void> {
  const { sourcePath, outPath, startSec, endSec, resolution = DEFAULT_RES, muted } = opts;
  const duration = Math.max(0.5, endSec - startSec);
  const filter = buildVerticalFilter(resolution, { label: opts.label, subtitlesPath: opts.subtitlesPath });

  const args = [
    "-y",
    "-ss",
    String(startSec),
    "-i",
    sourcePath,
    "-t",
    String(duration),
    "-filter_complex",
    filter,
    "-map",
    "[v]",
  ];

  if (!muted) {
    args.push("-map", "0:a?", "-c:a", "aac", "-b:a", "128k");
  } else {
    args.push("-an");
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outPath
  );

  await run(config.ffmpegPath, args);
}

/** Genera una "tarjeta" de pocos segundos solo con texto sobre fondo negro, para transiciones de ranking. */
export async function renderTitleCard(
  outPath: string,
  text: string,
  durationSec: number,
  resolution: VerticalResolution = DEFAULT_RES
): Promise<void> {
  const fontSize = Math.round(resolution.width / 9);
  const filter = `drawtext=text='${escapeDrawtext(
    text
  )}':fontcolor=white:fontsize=${fontSize}:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:borderw=6:bordercolor=black@0.8:x=(w-text_w)/2:y=(h-text_h)/2`;

  await run(config.ffmpegPath, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${resolution.width}x${resolution.height}:d=${durationSec}`,
    "-vf",
    filter,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    outPath,
  ]);
}

/** Concatena varios mp4 con el mismo códec/resolución en un único vídeo, en el orden dado. */
export async function concatClips(clipPaths: string[], outPath: string): Promise<void> {
  const listPath = path.join(path.dirname(outPath), `concat_${Date.now()}.txt`);
  const listContent = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listPath, listContent);

  try {
    await run(config.ffmpegPath, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      outPath,
    ]);
  } finally {
    fs.rmSync(listPath, { force: true });
  }
}

/** Mezcla una pista de música de fondo (más baja de volumen) bajo el audio original del vídeo. */
export async function mixBackgroundMusic(videoPath: string, musicPath: string, outPath: string): Promise<void> {
  await run(config.ffmpegPath, [
    "-y",
    "-i",
    videoPath,
    "-stream_loop",
    "-1",
    "-i",
    musicPath,
    "-filter_complex",
    "[1:a]volume=0.18[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[a]",
    "-map",
    "0:v",
    "-map",
    "[a]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    outPath,
  ]);
}

export async function extractThumbnail(clipPath: string, outPath: string, atSec = 0.3): Promise<void> {
  await run(config.ffmpegPath, ["-y", "-ss", String(atSec), "-i", clipPath, "-frames:v", "1", "-q:v", "3", outPath]);
}

/** Extrae un fotograma JPEG de un punto concreto del vídeo fuente (para clasificación por IA). */
export async function extractFrameAt(sourcePath: string, atSec: number, outPath: string): Promise<void> {
  await run(config.ffmpegPath, [
    "-y",
    "-ss",
    String(Math.max(0, atSec)),
    "-i",
    sourcePath,
    "-frames:v",
    "1",
    "-q:v",
    "4",
    "-vf",
    "scale=480:-1",
    outPath,
  ]);
}

/** Extrae y recorta un fragmento de audio (para usar como música de fondo) desde un vídeo/URL ya descargado. */
export async function extractAudioSegment(
  sourcePath: string,
  startSec: number,
  durationSec: number,
  outPath: string
): Promise<void> {
  await run(config.ffmpegPath, [
    "-y",
    "-ss",
    String(Math.max(0, startSec)),
    "-i",
    sourcePath,
    "-t",
    String(durationSec),
    "-vn",
    "-c:a",
    "mp3",
    "-b:a",
    "192k",
    outPath,
  ]);
}
