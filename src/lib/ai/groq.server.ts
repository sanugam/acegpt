import { createGroq } from "@ai-sdk/groq";
import type { UIMessage } from "ai";

export const GROQ_TEXT_MODEL = "openai/gpt-oss-120b";
export const GROQ_VISION_MODEL = "qwen/qwen3.8-27b";

// Groq's text model cannot read images; select a vision model explicitly.
// Reject unsupported input instead of silently discarding the user's files.
export function groqInput(messages: UIMessage[]) {
  const files = messages.flatMap((message) => message.parts.filter((part) => part.type === "file"));
  const unsupported = files.find((file) => !file.mediaType.startsWith("image/"));
  if (unsupported) {
    throw new Error(
      "This AI connection accepts images and text files, including code and CSV. For PDF or Word files, paste the document text into chat first.",
    );
  }
  if (files.length > 3) {
    throw new Error(
      "This AI connection supports up to three images per conversation. Start a new chat for more screenshots.",
    );
  }
  return { vision: files.length > 0, modelId: files.length ? GROQ_VISION_MODEL : GROQ_TEXT_MODEL };
}

export function groqChatConfig(apiKey: string, messages: UIMessage[], customFetch?: typeof fetch) {
  const { vision, modelId } = groqInput(messages);
  const groq = createGroq({ apiKey, ...(customFetch ? { fetch: customFetch } : {}) });
  return {
    model: groq(modelId),
    tools: vision ? {} : { web_search: groq.tools.browserSearch({}) },
    providerOptions: { groq: { reasoningEffort: "low" as const } },
    maxOutputTokens: 2048,
    instructionSuffix: vision
      ? "\nThis conversation uses an image-capable model without live web search. Do not claim to have browsed or verified current facts. Ask the user to start a text-only chat when live research is needed."
      : "",
  };
}
