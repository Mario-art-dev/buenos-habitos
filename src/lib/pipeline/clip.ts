import fs from "fs";
import path from "path";
import { config } from "@/lib/config";
import { run } from "./exec";
import { probeVideo, type VerticalResolution } from "./probe";

const DEFAULT_RES: VerticalResolution = { width: 1080, height: 1920 };

export function escapeDrawtext(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/%/g, "\\%");
}

function escapeSubtitlesPath(p: string): string {
  // ffmpeg necesita escapar ":" y "\" dentro del argumento del filtro subtitles=
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

/** Reparte un texto en varias líneas para que quepa en el ancho del vídeo (drawtext no envuelve solo). */
export function wrapText(text: string, maxCharsPerLine: number): string {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  return lines.join("\n");
}

export function buildVerticalFilter(
  res: VerticalResolution,
  opts: { subtitlesPath?: string; bigCaptionsPath?: string; dynamicZoomPhase?: number } = {}
): string {
  const { width, height } = res;
  let filter =
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=20[bg];` +
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto,format=yuv420p[wide]`;

  let lastLabel = "wide";

  if (opts.dynamicZoomPhase !== undefined) {
    // La MAYORÍA del tiempo se ve el plano recortado en vertical, llenando toda la pantalla sin
    // barras de fondo desenfocado; solo de vez en cuando (ráfaga corta) se abre al plano ancho
    // original con las barras — al revés que la versión anterior, a petición expresa ("la
    // mayoría en vertical, alguna que otra escena en horizontal"). El desfase varía por clip
    // (según su startSec) para que no todos los clips del mismo vídeo "abran" a la vez.
    const period = 12;
    const wideBurstSec = 1.8;
    const zoomFactor = 1.35;
    const zoomW = Math.round(width * zoomFactor);
    const zoomH = Math.round(height * zoomFactor);
    const phase = Math.round(opts.dynamicZoomPhase) % period;
    filter += `;[0:v]scale=${zoomW}:${zoomH}:force_original_aspect_ratio=increase,crop=${width}:${height},format=yuv420p[zoomed]`;
    filter += `;[zoomed][wide]overlay=0:0:enable='lt(mod(t+${phase},${period}),${wideBurstSec})':format=auto,format=yuv420p[base]`;
    lastLabel = "base";
  }

  if (opts.subtitlesPath) {
    // Subtítulo normal pegado abajo: blanco con contorno negro fino, cambiando de color palabra
    // a palabra (mismo motor/paleta que el caption grande, ver subtitles.ts) para que la lectura
    // sea interactiva. Va en .ass con el estilo ya definido dentro del propio archivo, así que
    // aquí no hace falta force_style (igual que el caption grande de abajo).
    filter += `;[${lastLabel}]subtitles=${escapeSubtitlesPath(opts.subtitlesPath)}[subbed]`;
    lastLabel = "subbed";
  }

  if (opts.bigCaptionsPath) {
    // Segunda capa de subtítulos, aparte de la de abajo: el "caption" grande y de colores en el
    // centro de la pantalla que pidió el usuario (estilo MrBeastClips). Va en un .ass (no .srt)
    // porque necesita color distinto por golpe de texto, algo que un .srt plano no soporta — el
    // color/contorno/desenfoque de cada línea ya viene definido dentro del propio archivo
    // (bigCaptions.ts), así que aquí no hace falta force_style.
    filter += `;[${lastLabel}]subtitles=${escapeSubtitlesPath(opts.bigCaptionsPath)}[bigcap]`;
    lastLabel = "bigcap";
  }

  filter += `;[${lastLabel}]null[v]`;
  return filter;
}

export interface CutClipOptions {
  sourcePath: string;
  outPath: string;
  startSec: number;
  endSec: number;
  resolution?: VerticalResolution;
  subtitlesPath?: string;
  bigCaptionsPath?: string;
  muted?: boolean;
  dynamicZoom?: boolean;
}

/**
 * Corta el segmento y lo recompone a formato vertical estilo short:
 * fondo desenfocado ampliado + vídeo original centrado sin recortar el encuadre.
 * Opcionalmente quema subtítulos, la capa de "caption" grande, y/o mete "punch-ins" de zoom
 * periódicos (dynamicZoom).
 */
export async function cutVerticalClip(opts: CutClipOptions): Promise<void> {
  const { sourcePath, outPath, startSec, endSec, resolution = DEFAULT_RES, muted } = opts;
  const duration = Math.max(0.5, endSec - startSec);
  const filter = buildVerticalFilter(resolution, {
    subtitlesPath: opts.subtitlesPath,
    bigCaptionsPath: opts.bigCaptionsPath,
    dynamicZoomPhase: opts.dynamicZoom ? startSec : undefined,
  });

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
    args.push("-map", "0:a?", "-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-an");
  }

  // "fast" (antes "veryfast") + CRF 18 (antes 20): más calidad de imagen a cambio de algo más de
  // tiempo de renderizado por clip — pedido explícitamente ("la mejor calidad posible"). No se
  // sube más el preset (p.ej. "medium"/"slow") porque el coste en tiempo de CPU por clip crece
  // deprisa y el runner de GitHub Actions es compartido con el resto del trabajo del vídeo.
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outPath
  );

  await run(config.ffmpegPath, args);
}

/**
 * Genera una "tarjeta" de pocos segundos con texto sobre fondo negro, para transiciones de ranking.
 * Si se pasa `audioPath` (p.ej. una narración de IA), la tarjeta dura lo que dure ese audio y lo
 * incluye como pista de sonido; si no, lleva una pista de audio silenciosa. Esto es necesario para
 * que todos los fragmentos tengan el mismo número de pistas al concatenarlos con `concatClips`
 * (si un fragmento no llevara pista de audio y otro sí, la concatenación por copia de flujo falla
 * o desincroniza el audio).
 */
export async function renderTitleCard(
  outPath: string,
  text: string,
  durationSec: number,
  resolution: VerticalResolution = DEFAULT_RES,
  audioPath?: string,
  fontDivisor = 9
): Promise<void> {
  let finalDuration = durationSec;
  if (audioPath) {
    const { durationSec: audioDurationSec } = await probeVideo(audioPath);
    finalDuration = Math.max(durationSec, audioDurationSec + 0.4);
  }

  const fontSize = Math.round(resolution.width / fontDivisor);
  const drawtextFilter = `drawtext=text='${escapeDrawtext(
    text
  )}':fontcolor=white:fontsize=${fontSize}:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:borderw=6:bordercolor=black@0.8:x=(w-text_w)/2:y=(h-text_h)/2`;

  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${resolution.width}x${resolution.height}:d=${finalDuration}`,
  ];

  if (audioPath) {
    args.push("-i", audioPath);
  } else {
    args.push("-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=44100:d=${finalDuration}`);
  }

  args.push(
    "-filter_complex",
    `[0:v]${drawtextFilter}[v]`,
    "-map",
    "[v]",
    "-map",
    "1:a",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    outPath
  );

  await run(config.ffmpegPath, args);
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

/**
 * Extrae un fotograma JPEG a la resolución nativa del vídeo (sin reescalar a 480px como
 * `extractFrameAt`, que es para clasificación barata por IA) — para usarlo como portada/miniatura
 * del short, donde sí importa la máxima calidad posible.
 */
export async function extractCoverFrameAt(sourcePath: string, atSec: number, outPath: string): Promise<void> {
  await run(config.ffmpegPath, [
    "-y",
    "-ss",
    String(Math.max(0, atSec)),
    "-i",
    sourcePath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
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

export interface ImageSegmentOptions {
  imagePath: string;
  outPath: string;
  durationSec: number;
  resolution?: VerticalResolution;
  caption?: string;
  audioPath?: string;
  zoomDirection?: "in" | "out";
}

/**
 * Convierte una foto estática en un segmento de vídeo vertical con efecto Ken Burns (zoom lento),
 * pie de foto opcional y narración opcional. Se usa en el modo Producto para las fotos subidas
 * por el usuario cuando no hay vídeo de producto disponible.
 */
export async function renderImageSegment(opts: ImageSegmentOptions): Promise<void> {
  const { imagePath, outPath, resolution = DEFAULT_RES, caption, audioPath, zoomDirection = "in" } = opts;
  let finalDuration = opts.durationSec;
  if (audioPath) {
    const { durationSec: audioDurationSec } = await probeVideo(audioPath);
    finalDuration = Math.max(opts.durationSec, audioDurationSec + 0.4);
  }

  const fps = 25;
  const totalFrames = Math.max(1, Math.round(finalDuration * fps));
  // Escala a una resolución mayor primero para que el zoompan tenga margen sin pixelar.
  const upscaleW = resolution.width * 2;
  const upscaleH = resolution.height * 2;
  const zoomExpr = zoomDirection === "in" ? `min(zoom+0.0015,1.3)` : `if(eq(on,1),1.3,max(zoom-0.0015,1.0))`;

  let filter =
    `[0:v]scale=${upscaleW}:${upscaleH}:force_original_aspect_ratio=increase,crop=${upscaleW}:${upscaleH},` +
    `zoompan=z='${zoomExpr}':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${resolution.width}x${resolution.height}:fps=${fps},` +
    `format=yuv420p[zoomed]`;

  let lastLabel = "zoomed";
  if (caption) {
    const fontSize = Math.round(resolution.width / 14);
    const wrapped = wrapText(caption, 28);
    filter += `;[${lastLabel}]drawtext=text='${escapeDrawtext(
      wrapped
    )}':fontcolor=white:fontsize=${fontSize}:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:borderw=5:bordercolor=black@0.8:x=(w-text_w)/2:y=h-text_h-${Math.round(
      resolution.height * 0.1
    )}:line_spacing=10[capped]`;
    lastLabel = "capped";
  }

  const args = ["-y", "-loop", "1", "-i", imagePath];
  if (audioPath) {
    args.push("-i", audioPath);
  } else {
    args.push("-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=44100:d=${finalDuration}`);
  }

  args.push(
    "-t",
    String(finalDuration),
    "-filter_complex",
    filter,
    "-map",
    `[${lastLabel}]`,
    "-map",
    "1:a",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    outPath
  );

  await run(config.ffmpegPath, args);
}

export interface ProductVideoSegmentOptions {
  sourcePath: string;
  outPath: string;
  resolution?: VerticalResolution;
  narrationAudioPath?: string;
  startSec?: number;
  endSec?: number;
}

/**
 * Reformatea a vertical un fragmento de vídeo de producto subido por el usuario. Si se pasa
 * narración de IA, sustituye el audio original del clip por la narración (mezclando duración);
 * si no, conserva el audio original del vídeo del producto.
 */
export async function renderProductVideoSegment(opts: ProductVideoSegmentOptions): Promise<void> {
  const { sourcePath, outPath, resolution = DEFAULT_RES, narrationAudioPath, startSec, endSec } = opts;
  const filter = buildVerticalFilter(resolution, {});

  const args = ["-y"];
  if (startSec !== undefined) {
    args.push("-ss", String(startSec));
  }
  args.push("-i", sourcePath);
  if (endSec !== undefined && startSec !== undefined) {
    args.push("-t", String(Math.max(0.5, endSec - startSec)));
  }

  if (narrationAudioPath) {
    args.push("-i", narrationAudioPath);
  }

  args.push("-filter_complex", filter, "-map", "[v]");

  if (narrationAudioPath) {
    args.push("-map", "1:a", "-c:a", "aac", "-b:a", "128k", "-shortest");
  } else {
    args.push("-map", "0:a?", "-c:a", "aac", "-b:a", "128k");
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

/** Sustituye por completo la pista de audio de un vídeo (p.ej. sincronizar con una canción elegida). */
export async function replaceAudioTrack(
  videoPath: string,
  audioPath: string,
  outPath: string,
  audioStartSec = 0
): Promise<void> {
  await run(config.ffmpegPath, [
    "-y",
    "-i",
    videoPath,
    "-ss",
    String(Math.max(0, audioStartSec)),
    "-i",
    audioPath,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    outPath,
  ]);
}
