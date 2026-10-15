import { z } from "zod";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  Output,
  type UIMessage,
} from "ai";
import { groqChatConfig, groqWebSearch } from "./ai/groq.server";

export function isPresentationRequest(messages: UIMessage[]) {
  const last = [...messages].reverse().find((message) => message.role === "user");
  const text =
    last?.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(" ") ?? "";
  const artifact = /\b(presentation|slides?|slideshow|powerpoint|pptx|deck)\b/i.test(text);
  const action =
    /\b(make|create|build|generate|design|prepare|redo|rebuild|remake|restyle|redesign|change|turn|give)\b/i.test(
      text,
    );
  if (artifact && (action || /\b\d+[ -]*slides?\b/i.test(text))) return true;
  const previous = messages.some((message) =>
    message.parts.some((part) => part.type === "tool-create_presentation"),
  );
  return (
    previous &&
    action &&
    /\b(look|style|design|cover|colour|color|font|layout|illustration|green|blue|red|black|purple|pink|image|picture|photo)\b/i.test(
      text,
    )
  );
}

export function presentationResponse({
  apiKey,
  preparedMessages,
  originalMessages,
  instructions,
  abortSignal,
  saveReply,
  onError,
}: {
  apiKey: string;
  preparedMessages: UIMessage[];
  originalMessages: UIMessage[];
  instructions: string;
  abortSignal: AbortSignal;
  saveReply: (message: UIMessage) => Promise<void>;
  onError: (error: unknown) => string;
}) {
  const config = groqChatConfig(apiKey, preparedMessages);
  const stream = createUIMessageStream({
    originalMessages,
    generateId: () => crypto.randomUUID(),
    onError,
    onFinish: ({ responseMessage }) => saveReply(responseMessage),
    execute: async ({ writer }) => {
      const toolCallId = crypto.randomUUID();
      writer.write({ type: "start" });
      writer.write({ type: "start-step" });
      writer.write({ type: "tool-input-start", toolCallId, toolName: "create_presentation" });
      try {
        const requestText =
          [...preparedMessages]
            .reverse()
            .find((message) => message.role === "user")
            ?.parts.filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(" ") ?? "";
        const modelMessages = await convertToModelMessages(preparedMessages);
        if (/\b(research|sources|current|today|latest|recent|news|cite)\b/i.test(requestText)) {
          const research = await groqWebSearch(
            apiKey,
            `Find reliable sources for this presentation request and include source URLs: ${requestText}`,
            abortSignal,
          );
          modelMessages.push({
            role: "user",
            content: `Use this web research and include its source URLs in relevant speaker notes:\n${research.text.slice(0, 6000)}`,
          });
        }
        const result = await generateText({
          model: config.model,
          providerOptions: {
            groq: {
              reasoningEffort: "low",
              reasoningFormat: "hidden",
              structuredOutputs: true,
              strictJsonSchema: true,
            },
          },
          messages: modelMessages,
          instructions:
            instructions +
            "\nFor this request, return ONLY the presentation JSON object specified by the response schema. Do not call functions or write an introduction. Include exactly the requested number of slides (one title slide is added automatically). Keep notes to one short sentence and each slide to 2-3 concise bullets. Use compact original SVG artwork (preferably under 2500 characters) with single-quoted SVG attributes and reusable defs/use shapes. Per-slide artwork can be an empty string when not needed. Match the reference style and user-requested design.",
          output: Output.object({ schema: presentationSchema }),
          maxOutputTokens: 4096,
          maxRetries: 1,
          abortSignal,
        });
        const deck = result.output;
        writer.write({
          type: "tool-input-available",
          toolCallId,
          toolName: "create_presentation",
          input: deck,
        });
        writer.write({
          type: "tool-output-available",
          toolCallId,
          output: { ok: true, slideCount: deck.slides.length + 1 },
        });
        writer.write({ type: "finish-step" });
        writer.write({ type: "finish", finishReason: "stop" });
        writer.setOutcome({ status: "completed" });
      } catch (error) {
        writer.write({
          type: "tool-input-error",
          toolCallId,
          toolName: "create_presentation",
          input: {},
          errorText: onError(error),
        });
        throw error;
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
}

export const presentationSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  design: z.object({
    name: z.string().describe("A short human-readable design name"),
    background: z.string().describe("Background colour, 6 hex digits without #"),
    foreground: z.string().describe("High contrast text colour, 6 hex digits"),
    accent: z.string().describe("Accent colour, 6 hex digits"),
    surface: z.string().describe("Content card colour, 6 hex digits"),
    font: z.enum(["sans", "serif", "rounded"]),
    coverLayout: z.enum(["centered", "split", "editorial"]),
    artwork: z
      .string()
      .max(20_000)
      .describe(
        "Original topic-specific SVG artwork, viewBox 0 0 1600 900; decorative edges and bottom, clear title area; no text/scripts/external URLs",
      ),
  }),
  slides: z.array(
    z.object({
      title: z.string(),
      bullets: z.array(z.string()),
      notes: z.string(),
      layout: z.enum(["cards", "split", "statement", "list"]),
      artwork: z
        .string()
        .max(12_000)
        .describe("Optional original SVG illustration for this content slide"),
    }),
  ),
});
