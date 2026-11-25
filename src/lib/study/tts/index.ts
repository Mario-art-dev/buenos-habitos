import { createHash } from "crypto";
import { execFile } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import path from "path";

// Voz natural para la narración: Piper (gratis) generado en el servidor y guardado en caché.
// Si no está instalado, la web usa la voz del navegador como plan B.

const MODEL = process.env.PIPER_MODEL || path.join(process.cwd(), "models", "en_US-lessac-medium.onnx");
const CACHE_DIR = path.join(process.cwd(), "storage", "tts");
const PY = process.env.PYTHON_BIN || "python3";
const SCRIPT = path.join(process.cwd(), "src", "lib", "study", "tts", "piper_say.py");

export function voiceAvailable(): boolean {
  return existsSync(MODEL);
}

export async function speechWav(text: string): Promise<Buffer> {
  if (!voiceAvailable()) throw new Error("voice_unavailable");
  const clean = text.trim().slice(0, 1200);
  const key = createHash("sha1").update(`${MODEL}|${clean}`).digest("hex");
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${key}.wav`);
  if (existsSync(file)) return readFileSync(file);

  await new Promise<void>((resolve, reject) => {
    const child = execFile(PY, ["-I", SCRIPT, MODEL, file], { timeout: 120_000 }, (err, _out, stderr) => {
      if (err) reject(new Error(`piper: ${stderr || err.message}`));
      else resolve();
    });
    child.stdin?.end(clean);
  });
  return readFileSync(file);
}

