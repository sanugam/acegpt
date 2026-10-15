import { afterEach, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import {
  isPresentationRequest,
  presentationResponse,
  validPresentationArtwork,
} from "@/lib/presentation-generation.server";

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: generate,
}));
afterEach(() => vi.clearAllMocks());

const request: UIMessage = {
  id: "request",
  role: "user",
  parts: [{ type: "text", text: "Make 3 slides about robotics in a purple style" }],
};

it("routes creation and restyling to the deck builder while leaving questions as chat", () => {
  expect(isPresentationRequest([request])).toBe(true);
  expect(
    isPresentationRequest([
      { ...request, parts: [{ type: "text", text: "How do I download a presentation?" }] },
    ]),
  ).toBe(false);
  const previous: UIMessage = {
    id: "old",
    role: "assistant",
    parts: [
      {
        type: "tool-create_presentation",
        toolCallId: "old",
        state: "output-available",
        input: {},
        output: {},
      },
    ],
  };
  expect(
    isPresentationRequest([
      previous,
      { ...request, parts: [{ type: "text", text: "Make it look more like this picture" }] },
    ]),
  ).toBe(true);
});

it("builds a saved downloadable card from structured output without native function calling", async () => {
  const design = {
    name: "Purple circuits",
    background: "110C27",
    foreground: "FFFFFF",
    accent: "AA77FF",
    surface: "221844",
    font: "sans",
    coverLayout: "split",
    artwork:
      "<svg viewBox='0 0 1600 900'><rect x='1000' y='200' width='400' height='500' fill='#AA77FF'/></svg>",
  };
  generate.mockResolvedValue({
    output: {
      title: "Robotics",
      subtitle: "Future systems",
      design,
      slides: [
        {
          title: "Robots",
          bullets: ["Sensors"],
          notes: "Explain sensors",
          layout: "split",
          artwork: "",
        },
      ],
    },
  });
  const saveReply = vi.fn(async (_message: UIMessage) => {});
  const response = presentationResponse({
    apiKey: "test-server-key",
    preparedMessages: [request],
    originalMessages: [request],
    instructions: "Make the requested slides",
    abortSignal: new AbortController().signal,
    saveReply,
    onError: () => "Test failure",
  });
  const body = await response.text();
  expect(body).toContain('"toolName":"create_presentation"');
  expect(body).toContain('"type":"tool-output-available"');
  expect(body).toContain("Purple circuits");
  expect(saveReply).toHaveBeenCalledTimes(1);
  expect(saveReply.mock.calls[0]?.[0].id).toBeTruthy();
  expect(generate.mock.calls[0]?.[0]).toHaveProperty("output");
  expect(generate.mock.calls[0]?.[0]).not.toHaveProperty("tools");
});

it("rejects missing illustrations and malformed XML instead of showing a blank cover", () => {
  expect(validPresentationArtwork("[Previous vector artwork omitted]")).toBe(false);
  expect(validPresentationArtwork("<svg><path d='M0 0'/></g></svg>")).toBe(false);
  expect(validPresentationArtwork("<svg><circle r='50'/></svg>")).toBe(true);
});

it("repairs a missing illustration without changing the generated slide content", async () => {
  generate.mockReset();
  const artwork =
    "<svg viewBox='0 0 1600 900'><circle cx='1350' cy='700' r='120' fill='#AA77FF'/></svg>";
  generate.mockResolvedValueOnce({
    output: {
      title: "Robotics",
      subtitle: "Keep this",
      design: { name: "Circuits", artwork: "[omitted]" },
      slides: [],
    },
  });
  generate.mockResolvedValueOnce({ output: { artwork } });
  const saveReply = vi.fn(async (_message: UIMessage) => {});
  const body = await presentationResponse({
    apiKey: "test-server-key",
    preparedMessages: [request],
    originalMessages: [request],
    instructions: "Make slides",
    abortSignal: new AbortController().signal,
    saveReply,
    onError: () => "Failure",
  }).text();
  expect(generate).toHaveBeenCalledTimes(2);
  expect(body).toContain('"subtitle":"Keep this"');
  expect(body).toContain(artwork);
  expect(body).toContain('"type":"tool-output-available"');
  expect(saveReply).toHaveBeenCalledTimes(1);
});

it("reads a reference image before asking the text model for structured slides", async () => {
  generate.mockReset();
  const imageRequest: UIMessage = {
    ...request,
    parts: [
      ...request.parts,
      { type: "file", mediaType: "image/png", url: "data:image/png;base64,aGVsbG8=" },
    ],
  };
  generate.mockResolvedValueOnce({
    text: "Mint background, green trees at the edges, centered headings.",
  });
  generate.mockResolvedValueOnce({
    output: {
      title: "Environment",
      subtitle: "Protect nature",
      design: { artwork: "<svg><circle r='50'/></svg>" },
      slides: [],
    },
  });
  const response = presentationResponse({
    apiKey: "test-server-key",
    preparedMessages: [imageRequest],
    originalMessages: [imageRequest],
    instructions: "Make slides",
    abortSignal: new AbortController().signal,
    saveReply: async () => {},
    onError: () => "Failure",
  });
  expect(await response.text()).toContain('"type":"tool-output-available"');
  expect(generate.mock.calls[0]?.[0].model.modelId).toBe("qwen/qwen3.8-27b");
  expect(generate.mock.calls[1]?.[0].model.modelId).toBe("openai/gpt-oss-120b");
  const documentMessages = JSON.stringify(generate.mock.calls[1]?.[0].messages);
  expect(documentMessages).toContain("Mint background");
  expect(documentMessages).not.toContain('"type":"image"');
});
