import type { UIMessage } from "ai";

export const IMAGES_PER_REPLY = 3;

// Keep the stored/UI history intact, but don't resend every old screenshot on
// each turn. The provider limits images per request, not per conversation.
export function recentImageContext(messages: UIMessage[]): UIMessage[] {
  let remaining = IMAGES_PER_REPLY;
  return [...messages]
    .reverse()
    .map((message) => ({
      ...message,
      parts: [...message.parts]
        .filter((part) => part.type !== "reasoning")
        .reverse()
        .map((part) => {
          if (part.type !== "file" || !part.mediaType.startsWith("image/")) return part;
          if (remaining-- > 0) return part;
          return {
            type: "text" as const,
            text: `[Earlier image: ${part.filename ?? "picture"}. Its previous discussion remains in chat; reattach this picture to inspect it again.]`,
          };
        })
        .reverse(),
    }))
    .reverse();
}
