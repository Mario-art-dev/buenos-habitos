import OpenAI from "openai";
import { config } from "@/lib/config";
import type { AIChatOptions, AIProvider } from "./provider";

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: config.ai.openaiApiKey });
  }

  async chatJson({ system, prompt, maxTokens = 4096 }: AIChatOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: config.ai.openaiModel,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        { role: "user" as const, content: prompt },
      ],
    });

    const text = response.choices[0]?.message?.content;
    if (!text) {
      throw new Error("Respuesta de OpenAI sin contenido");
    }
    return text;
  }
}
