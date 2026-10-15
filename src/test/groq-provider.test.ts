import { describe, expect, it, vi } from "vitest";
import { convertToModelMessages, generateText, type UIMessage } from "ai";
import {
  GROQ_TEXT_MODEL,
  GROQ_VISION_MODEL,
  groqChatConfig,
  groqInput,
  groqWebSearch,
} from "@/lib/ai/groq.server";
import { recentImageContext } from "@/lib/ai/image-context";

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
  it("accepts provider-executed search answers without requiring a client tool-call event", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(new AbortController().signal);
    const searchFetch = vi.fn(
      async (_url: unknown, _init: unknown) =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: "NASA overview: https://science.nasa.gov/solar-system/" } },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    try {
      const result = await groqWebSearch(
        "test-key",
        "NASA overview",
        undefined,
        searchFetch as typeof fetch,
      );
      expect(result.text).toContain("https://science.nasa.gov/solar-system/");
      const body = JSON.parse((searchFetch.mock.calls[0]?.[1] as RequestInit).body as string);
      expect(body.tool_choice).toBe("required");
      expect(body.tools).toEqual([{ type: "browser_search" }]);
      expect(body.reasoning_effort).toBe("low");
    } finally {
      timeout.mockRestore();
    }
  });
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

  it("routes screenshots to vision with a callable web search instead of an incompatible native search tool", () => {
    const messages: UIMessage[] = [{ ...textMessage, parts: [image] }];
    const config = groqChatConfig("test-server-key", messages);
    expect(config.model.modelId).toBe(GROQ_VISION_MODEL);
    expect(config.tools.web_search).toHaveProperty("execute");
    expect(config.instructionSuffix).toContain("web_search");
  });

  it("rejects unsupported documents and excess images rather than dropping attachments", () => {
    expect(() =>
      groqInput([{ ...textMessage, parts: [{ ...image, mediaType: "application/pdf" }] }]),
    ).toThrow("paste the document text");
    expect(() => groqInput([{ ...textMessage, parts: [image, image, image, image] }])).toThrow(
      "three pictures",
    );
  });

  it("keeps the latest three pictures across many turns without changing the displayed history", () => {
    const history: UIMessage[] = Array.from({ length: 7 }, (_, index) => ({
      id: `image-${index}`,
      role: "user",
      parts: [{ ...image, filename: `picture-${index}.png` }],
    }));
    const context = recentImageContext(history);
    expect(
      context
        .flatMap((m) => m.parts)
        .filter((p) => p.type === "file")
        .map((p) => p.filename),
    ).toEqual(["picture-4.png", "picture-5.png", "picture-6.png"]);
    expect(context[0]?.parts[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("reattach"),
    });
    expect(history.every((m) => m.parts[0]?.type === "file")).toBe(true);
    expect(groqInput(context).vision).toBe(true);
    expect(recentImageContext(context)).toEqual(context);
  });
});
