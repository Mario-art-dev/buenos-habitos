import { createHash } from "crypto";
import { execFile } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import path from "path";

// Voz natural para la narración: Kokoro-82M (gratis, Apache 2.0). Se genera en el servidor
// y cada frase se guarda en caché. Si no está instalado, la web usa la voz del navegador.

const MODEL_DIR = process.env.KOKORO_DIR || path.join(process.cwd(), "models");
const MODEL = path.join(MODEL_DIR, "kokoro-v1.0.int8.onnx");
const VOICES = path.join(MODEL_DIR, "voices-v1.0.bin");
const VOICE = process.env.KOKORO_VOICE || "af_heart";
const CACHE_DIR = path.join(process.cwd(), "storage", "tts");
const PY = process.env.PYTHON_BIN || "python3";
const SCRIPT = path.join(process.cwd(), "src", "lib", "study", "tts", "kokoro_say.py");

export function voiceAvailable(): boolean {
  return existsSync(MODEL) && existsSync(VOICES);
}

export async function speechWav(text: string): Promise<Buffer> {
  if (!voiceAvailable()) throw new Error("voice_unavailable");
  const clean = text.trim().slice(0, 1200);
  const key = createHash("sha1").update(`kokoro|${VOICE}|${clean}`).digest("hex");
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${key}.wav`);
  if (existsSync(file)) return readFileSync(file);

  await new Promise<void>((resolve, reject) => {
    const child = execFile(PY, ["-I", SCRIPT, MODEL, VOICES, VOICE, "1.0", file], { timeout: 180_000 }, (err, _out, stderr) => {
      if (err) reject(new Error(`kokoro: ${stderr || err.message}`));
      else resolve();
    });
    child.stdin?.end(clean);
  });
  return readFileSync(file);
}
