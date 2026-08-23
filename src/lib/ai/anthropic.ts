import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/lib/config";
import type { AIChatOptions, AIProvider } from "./provider";

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;

  constructor(apiKey: string = config.ai.anthropicApiKey) {
    this.client = new Anthropic({ apiKey });
  }

  async chatJson({ system, prompt, images = [], maxTokens = 4096 }: AIChatOptions): Promise<string> {
    const content: Anthropic.MessageParam["content"] = [
      ...images.map((img) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 },
      })),
      { type: "text" as const, text: prompt },
    ];

    const response = await this.client.messages.create({
      model: config.ai.anthropicModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Respuesta de Anthropic sin contenido de texto");
    }
    return textBlock.text;
  }
}
