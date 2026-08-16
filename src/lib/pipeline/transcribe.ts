import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { config } from "@/lib/config";
import { run } from "./exec";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
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
  });

  const segments = (result as unknown as { segments?: { start: number; end: number; text: string }[] }).segments;
  if (segments && segments.length > 0) {
    return segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
  }
  // fallback si el modelo no devuelve segmentos con timestamps
  return [{ start: 0, end: 0, text: (result as { text: string }).text }];
}

export async function transcribeAudio(audioFilePath: string): Promise<Transcript> {
  if (!config.whisper.apiKey) {
    throw new Error("Falta OPENAI_API_KEY (o OPENAI_API_KEY_WHISPER) para transcribir el audio.");
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
      allSegments.push(...segments.map((s) => ({ start: s.start + offset, end: s.end + offset, text: s.text })));
      offset += CHUNK_SECONDS;
    }
    fs.rmSync(chunksDir, { recursive: true, force: true });
  }

  return {
    text: allSegments.map((s) => s.text).join(" "),
    segments: allSegments,
  };
}
