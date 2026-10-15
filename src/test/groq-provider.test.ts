import { describe, expect, it, vi } from "vitest";
import { convertToModelMessages, generateText, type UIMessage } from "ai";
import {
  GROQ_TEXT_MODEL,
  GROQ_VISION_MODEL,
  groqChatConfig,
  groqInput,
} from "@/lib/ai/groq.server";

const textMessage: UIMessage = {
  id: "user-1",
  role: "user",
  parts: [{ type: "text", text: "What is 2 + 2?" }],
};
const image = {
  type: "file" as const,
  mediaType: "image/png",
  url: "data:image/png;base64,aGVsbG8=",
};

describe("Groq integration", () => {
  it("routes plain text to the reasoning model with browser search", async () => {
    const mockFetch = vi.fn(
      async (_input: unknown, _init: unknown) =>
        new Response(
          JSON.stringify({
            id: "completion-1",
            object: "chat.completion",
            created: 1,
            model: GROQ_TEXT_MODEL,
            choices: [
              { index: 0, message: { role: "assistant", content: "4" }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const config = groqChatConfig("test-server-key", [textMessage], mockFetch as typeof fetch);
    const result = await generateText({
      ...config,
      messages: await convertToModelMessages([textMessage]),
    });
    expect(result.text).toBe("4");
    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-server-key");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(GROQ_TEXT_MODEL);
    expect(body.tools).toContainEqual({ type: "browser_search" });
    expect(JSON.stringify(body)).not.toContain("test-server-key");
    expect(body.max_tokens).toBe(2048);
  });

  it("routes screenshots to vision without sending an incompatible search tool", () => {
    const messages: UIMessage[] = [{ ...textMessage, parts: [image] }];
    const config = groqChatConfig("test-server-key", messages);
    expect(config.model.modelId).toBe(GROQ_VISION_MODEL);
    expect(config.tools).toEqual({});
    expect(config.instructionSuffix).toContain("without live web search");
  });

  it("rejects unsupported documents and excess images rather than dropping attachments", () => {
    expect(() =>
      groqInput([{ ...textMessage, parts: [{ ...image, mediaType: "application/pdf" }] }]),
    ).toThrow("paste the document text");
    expect(() => groqInput([{ ...textMessage, parts: [image, image, image, image] }])).toThrow(
      "three images",
    );
  });
});
