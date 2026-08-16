import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/lib/config";
import type { AIChatOptions, AIProvider } from "./provider";

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: config.ai.anthropicApiKey });
  }

  async chatJson({ system, prompt, maxTokens = 4096 }: AIChatOptions): Promise<string> {
    const response = await this.client.messages.create({
      model: config.ai.anthropicModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Respuesta de Anthropic sin contenido de texto");
    }
    return textBlock.text;
  }
}
