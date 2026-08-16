import fs from "fs";
import OpenAI from "openai";
import { config } from "@/lib/config";
import type { TTSProvider } from "./provider";

/** Voz sintetizada con la API de OpenAI: de pago, pero rápida y de buena calidad. */
export class OpenAITTSProvider implements TTSProvider {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: config.tts.openaiApiKey });
  }

  async synthesize(text: string, outPath: string): Promise<void> {
    const response = await this.client.audio.speech.create({
      model: config.tts.openaiModel,
      voice: config.tts.openaiVoice,
      input: text,
      response_format: "wav",
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outPath, buffer);
  }
}
