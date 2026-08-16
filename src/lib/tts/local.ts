import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { config } from "@/lib/config";
import { run } from "@/lib/pipeline/exec";
import type { TTSProvider } from "./provider";

/** Voz sintetizada en el propio servidor con Piper: gratis, sin claves, sin límite de uso. */
export class LocalTTSProvider implements TTSProvider {
  async synthesize(text: string, outPath: string): Promise<void> {
    const scriptPath = path.resolve(process.cwd(), "scripts", "local_tts.py");
    const textFile = path.join(os.tmpdir(), `tts_${crypto.randomUUID()}.txt`);
    fs.writeFileSync(textFile, text, "utf-8");

    try {
      await run(config.transcription.pythonPath, [scriptPath, textFile, outPath, config.tts.localVoice]);
    } finally {
      fs.rmSync(textFile, { force: true });
    }
  }
}
