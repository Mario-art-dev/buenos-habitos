import OpenAI from "openai";
import { config } from "@/lib/config";
import type { AIChatOptions, AIProvider } from "./provider";

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: config.ai.openaiApiKey });
  }

  async chatJson({ system, prompt, images = [], maxTokens = 4096 }: AIChatOptions): Promise<string> {
    const content: OpenAI.Chat.ChatCompletionContentPart[] = [
      { type: "text", text: prompt },
      ...images.map((img) => ({
        type: "image_url" as const,
        image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
      })),
    ];

    const response = await this.client.chat.completions.create({
      model: config.ai.openaiModel,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        { role: "user" as const, content },
      ],
    });

    const text = response.choices[0]?.message?.content;
    if (!text) {
      throw new Error("Respuesta de OpenAI sin contenido");
    }
    return text;
  }
}
