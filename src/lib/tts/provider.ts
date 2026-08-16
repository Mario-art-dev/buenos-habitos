export interface TTSProvider {
  /** Sintetiza `text` a voz y escribe el audio resultante en `outPath` (wav o mp3 según el proveedor). */
  synthesize(text: string, outPath: string): Promise<void>;
}

import { config } from "@/lib/config";
import { LocalTTSProvider } from "./local";
import { OpenAITTSProvider } from "./openai";

let cached: TTSProvider | null = null;

export function getTTSProvider(): TTSProvider {
  if (cached) return cached;
  cached = config.tts.provider === "openai" ? new OpenAITTSProvider() : new LocalTTSProvider();
  return cached;
}
