import { afterEach, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { isPresentationRequest, presentationResponse } from "@/lib/presentation-generation.server";

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("ai", async (original) => ({ ...(await original<typeof import("ai")>()), generateText: generate }));
afterEach(() => vi.clearAllMocks());

const request: UIMessage = { id: "request", role: "user", parts: [{ type: "text", text: "Make 3 slides about robotics in a purple style" }] };

it("routes creation and restyling to the deck builder while leaving questions as chat", () => {
  expect(isPresentationRequest([request])).toBe(true);
  expect(isPresentationRequest([{ ...request, parts: [{ type: "text", text: "How do I download a presentation?" }] }])).toBe(false);
  const previous: UIMessage = { id: "old", role: "assistant", parts: [{ type: "tool-create_presentation", toolCallId: "old", state: "output-available", input: {}, output: {} }] };
  expect(isPresentationRequest([previous, { ...request, parts: [{ type: "text", text: "Make it look more like this picture" }] }])).toBe(true);
});

it("builds a saved downloadable card from structured output without native function calling", async () => {
  const design = { name: "Purple circuits", background: "110C27", foreground: "FFFFFF", accent: "AA77FF", surface: "221844", font: "sans", coverLayout: "split", artwork: "<svg/>" };
  generate.mockResolvedValue({ output: { title: "Robotics", subtitle: "Future systems", design, slides: [{ title: "Robots", bullets: ["Sensors"], notes: "Explain sensors", layout: "split", artwork: "" }] } });
  const saveReply = vi.fn(async (_message: UIMessage) => {});
  const response = presentationResponse({ apiKey: "test-server-key", preparedMessages: [request], originalMessages: [request], instructions: "Make the requested slides", abortSignal: new AbortController().signal, saveReply, onError: () => "Test failure" });
  const body = await response.text();
  expect(body).toContain('"toolName":"create_presentation"');
  expect(body).toContain('"type":"tool-output-available"');
  expect(body).toContain("Purple circuits");
  expect(saveReply).toHaveBeenCalledTimes(1);
  expect(saveReply.mock.calls[0]?.[0].id).toBeTruthy();
  expect(generate.mock.calls[0]?.[0]).toHaveProperty("output");
  expect(generate.mock.calls[0]?.[0]).not.toHaveProperty("tools");
});
