import { expect, it } from "vitest";
import type { UIMessage } from "ai";
import { conversationContext } from "@/lib/ai/conversation-context";
const message = (id: string, text: string, role: UIMessage["role"] = "user"): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text }],
});
it("keeps many questions saved while bounding the provider request and retrieving relevant old facts", () => {
  const history = [
    message("first", "Our project codename is ORBIT and its colour is teal."),
    ...Array.from({ length: 100 }, (_, i) =>
      message(
        `m${i}`,
        `Question ${i}: ${"unrelated classroom discussion ".repeat(50)}`,
        i % 2 ? "user" : "assistant",
      ),
    ),
    message("now", "What is our project codename and colour?"),
  ];
  const copy = JSON.stringify(history);
  const result = conversationContext(history);
  expect(result.condensed).toBe(true);
  expect(JSON.stringify(result.messages)).toContain("ORBIT");
  expect(result.messages.at(-1)?.id).toBe("now");
  expect(JSON.stringify(result.messages).length).toBeLessThan(12500);
  expect(JSON.stringify(history)).toBe(copy);
});
it("retains the end of a long previous answer so it can continue", () => {
  const result = conversationContext([
    message("user", "Write a long report"),
    message("answer", "Beginning. ".repeat(3000) + "LAST SECTION: Jupiter", "assistant"),
    message("continue", "Continue your previous answer"),
  ]);
  expect(JSON.stringify(result.messages)).toContain("LAST SECTION: Jupiter");
  expect(result.messages.at(-1)?.id).toBe("continue");
});
it("keeps attached images and source URLs without resending historical tool protocol", () => {
  const result = conversationContext([
    {
      id: "old",
      role: "assistant",
      parts: [
        {
          type: "tool-create_presentation",
          toolCallId: "deck",
          state: "output-available",
          input: { title: "Forest" },
          output: {},
        },
        { type: "source-url", sourceId: "nasa", url: "https://nasa.gov", title: "NASA" },
      ],
    },
    {
      id: "new",
      role: "user",
      parts: [{ type: "file", mediaType: "image/png", url: "data:image/png;base64,aGVsbG8=" }],
    },
  ]);
  expect(result.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: expect.stringContaining("Forest"),
  });
  expect(JSON.stringify(result.messages)).toContain("https://nasa.gov");
  expect(result.messages[1]?.parts[0]?.type).toBe("file");
});
