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
import { XMLValidator } from "fast-xml-parser";

export function validPresentationArtwork(svg: string) {
  return (
    /^\s*<svg\b[\s\S]*<\/svg>\s*$/.test(svg) &&
    /<(?:path|rect|circle|ellipse|polygon|polyline|line|use)\b/.test(svg) &&
    XMLValidator.validate(svg) === true
  );
}

const coverArtworkSchema = z.string().max(3500);

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
        const requestedCount = Number(requestText.match(/\b(\d+)[ -]*slides?\b/i)?.[1]);
        const schema =
          requestedCount >= 1 && requestedCount <= 30
            ? presentationSchema.extend({
                slides: z.array(presentationSchema.shape.slides.element).length(requestedCount - 1),
              })
            : presentationSchema;
        const result = await generateText({
          model: config.model,
          providerOptions: {
            groq: {
              reasoningEffort: config.model.modelId === "qwen/qwen3.8-27b" ? "none" : "low",
              reasoningFormat: "hidden",
              structuredOutputs: true,
              strictJsonSchema: true,
            },
          },
          messages: modelMessages,
          instructions:
            instructions +
            "\nFor this request, return ONLY the presentation JSON object specified by the response schema. Do not call functions or write an introduction. Include exactly the requested number of slides (one title slide is added automatically). When restyling, preserve the existing deck's title and content unless the user asks to change them. Keep notes to one short sentence and each slide to 2-3 concise bullets. The COVER SVG must be compact, about 1000-1800 characters: use 10-20 simple shapes with single-quoted attributes and reusable defs/use shapes; never hundreds of individual leaves or complex path points. Set every content slide artwork to an empty string unless a small specific diagram is essential. The app reuses cover illustration as a decorative band on content slides. Match the reference composition, not just its colours: centred headings with edge illustrations should use coverLayout centered, without a white side panel. Match the reference style and user-requested design.",
          output: Output.object({ schema }),
          maxOutputTokens: 8192,
          maxRetries: 1,
          abortSignal,
        });
        const deck = result.output;
        // A valid JSON response can still contain malformed SVG or a copied
        // history placeholder. Repair only the illustration, keeping the deck.
        if (!validPresentationArtwork(deck.design.artwork)) {
          const repair = await generateText({
            model: config.model,
            providerOptions: {
              groq: {
                reasoningEffort: config.model.modelId === "qwen/qwen3.8-27b" ? "none" : "low",
                reasoningFormat: "hidden",
                structuredOutputs: true,
                strictJsonSchema: true,
              },
            },
            instructions:
              "Return original compact valid SVG geometry in the requested JSON field. Use single-quoted XML attributes, viewBox='0 0 1600 900', explicit fill/stroke, no text, scripts, remote images, CSS or Markdown. Draw topic-specific illustrations around edges and bottom with the central area clear. Include real visible shapes. Use 10-20 shapes, not hundreds of tiny details.",
            prompt: `Create cover artwork for ${deck.title}. Design: ${JSON.stringify({ ...deck.design, artwork: undefined })}. User request: ${requestText}. Replace this invalid illustration: ${deck.design.artwork}`,
            output: Output.object({ schema: z.object({ artwork: coverArtworkSchema }) }),
            maxOutputTokens: 2500,
            maxRetries: 1,
            abortSignal,
          });
          deck.design.artwork = repair.output.artwork;
          if (!validPresentationArtwork(deck.design.artwork))
            throw new Error(
              "The slide illustration could not be drawn. Please retry the presentation.",
            );
        }
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
  title: z.string().max(140),
  subtitle: z.string().max(200),
  design: z.object({
    name: z.string().max(80).describe("A short human-readable design name"),
    background: z.string().describe("Background colour, 6 hex digits without #"),
    foreground: z.string().describe("High contrast text colour, 6 hex digits"),
    accent: z.string().describe("Accent colour, 6 hex digits"),
    surface: z.string().describe("Content card colour, 6 hex digits"),
    font: z.enum(["sans", "serif", "rounded"]),
    coverLayout: z
      .enum(["centered", "split", "editorial"])
      .describe(
        "Match reference composition. Use centered for centred headings and artwork at the edges; split for an explicitly requested side panel; editorial for magazine-style typography.",
      ),
    artwork: coverArtworkSchema.describe(
      "Original topic-specific SVG artwork, viewBox 0 0 1600 900; decorative edges and bottom, clear title area; no text/scripts/external URLs",
    ),
  }),
  slides: z.array(
    z.object({
      title: z.string().max(120),
      bullets: z.array(z.string().max(130)).max(3),
      notes: z.string().max(200),
      layout: z.enum(["cards", "split", "statement", "list"]),
      artwork: z
        .string()
        .max(800)
        .describe("Optional original SVG illustration for this content slide"),
    }),
  ),
});
