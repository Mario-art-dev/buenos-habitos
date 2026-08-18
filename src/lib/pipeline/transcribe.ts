import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { config } from "@/lib/config";
import { run } from "./exec";

export interface TranscriptWord {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  /** Marca de tiempo de cada palabra suelta, si el proveedor las da (para subtítulos palabra a palabra). */
  words?: TranscriptWord[];
}

export interface Transcript {
  text: string;
  segments: TranscriptSegment[];
}

const CHUNK_SECONDS = 18 * 60; // Whisper API limita a 25MB por archivo; ~18min mono a 64kbps entra holgado

export async function extractAudio(sourcePath: string, audioOutPath: string): Promise<void> {
  await run(config.ffmpegPath, [
    "-y",
    "-i",
    sourcePath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "64k",
    audioOutPath,
  ]);
}

async function getDurationSec(filePath: string): Promise<number> {
  const ffprobePath = config.ffmpegPath.replace(/ffmpeg$/, "ffprobe");
  const { stdout } = await run(ffprobePath, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  return Number(stdout.trim()) || 0;
}

async function splitAudio(audioPath: string, outDir: string): Promise<string[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const pattern = path.join(outDir, "chunk_%03d.mp3");
  await run(config.ffmpegPath, [
    "-y",
    "-i",
    audioPath,
    "-f",
    "segment",
    "-segment_time",
    String(CHUNK_SECONDS),
    "-c",
    "copy",
    pattern,
  ]);
  return fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith("chunk_"))
    .sort()
    .map((f) => path.join(outDir, f));
}

async function transcribeChunk(client: OpenAI, filePath: string): Promise<TranscriptSegment[]> {
  const result = await client.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: config.whisper.model,
    response_format: "verbose_json",
    // "word" además de "segment": necesario para poder resaltar palabra a palabra el caption
    // grande (ver src/lib/pipeline/bigCaptions.ts) en vez de bloques de frase entera.
    timestamp_granularities: ["segment", "word"],
  });

  const raw = result as unknown as {
    segments?: { start: number; end: number; text: string }[];
    words?: { start: number; end: number; word: string }[];
  };
  const words = raw.words ?? [];
  if (raw.segments && raw.segments.length > 0) {
    return raw.segments.map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text.trim(),
      words: words
        .filter((w) => w.start >= s.start && w.start < s.end)
        .map((w) => ({ start: w.start, end: w.end, text: w.word.trim() })),
    }));
  }
  // fallback si el modelo no devuelve segmentos con timestamps
  return [{ start: 0, end: 0, text: (result as { text: string }).text }];
}

/**
 * Transcribe en el propio servidor con faster-whisper: sin coste de API y sin
 * límite de tamaño de archivo (no hace falta trocear el audio).
 */
async function transcribeLocally(audioFilePath: string): Promise<Transcript> {
  const scriptPath = path.resolve(process.cwd(), "scripts", "local_whisper.py");
  const { stdout } = await run(config.transcription.pythonPath, [
    scriptPath,
    audioFilePath,
    config.transcription.localModel,
  ]);

  let segments: TranscriptSegment[];
  try {
    segments = JSON.parse(stdout) as TranscriptSegment[];
  } catch {
    throw new Error("La transcripción local no devolvió un JSON válido. Revisa que faster-whisper esté instalado.");
  }

  return {
    text: segments.map((s) => s.text).join(" "),
    segments,
  };
}

export async function transcribeAudio(audioFilePath: string): Promise<Transcript> {
  if (config.transcription.provider === "local") {
    return transcribeLocally(audioFilePath);
  }

  if (!config.whisper.apiKey) {
    throw new Error(
      "Falta OPENAI_API_KEY (o OPENAI_API_KEY_WHISPER) para transcribir el audio. " +
        "Si quieres transcribir gratis en tu propio servidor, pon TRANSCRIPTION_PROVIDER=\"local\" en el .env."
    );
  }
  const client = new OpenAI({ apiKey: config.whisper.apiKey });

  const duration = await getDurationSec(audioFilePath);
  let allSegments: TranscriptSegment[] = [];

  if (duration <= CHUNK_SECONDS) {
    allSegments = await transcribeChunk(client, audioFilePath);
  } else {
    const chunksDir = path.join(path.dirname(audioFilePath), "chunks");
    const chunkFiles = await splitAudio(audioFilePath, chunksDir);
    let offset = 0;
    for (const chunkFile of chunkFiles) {
      const segments = await transcribeChunk(client, chunkFile);
      allSegments.push(
        ...segments.map((s) => ({
          start: s.start + offset,
          end: s.end + offset,
          text: s.text,
          words: s.words?.map((w) => ({ start: w.start + offset, end: w.end + offset, text: w.text })),
        }))
      );
      offset += CHUNK_SECONDS;
    }
    fs.rmSync(chunksDir, { recursive: true, force: true });
  }

  return {
    text: allSegments.map((s) => s.text).join(" "),
    segments: allSegments,
  };
}
