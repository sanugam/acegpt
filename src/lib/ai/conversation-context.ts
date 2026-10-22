import type { UIMessage } from "ai";

function clip(text: string, length: number) {
  if (text.length <= length) return text;
  const head = Math.floor(length * 0.7);
  return `${text.slice(0, head)}\n[Excerpt: some older text omitted; full message remains in chat.]\n${text.slice(-(length - head - 85))}`;
}
function words(text: string) {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter(
      (word) =>
        ![
          "this",
          "that",
          "with",
          "from",
          "what",
          "have",
          "please",
          "about",
          "could",
          "would",
          "earlier",
        ].includes(word),
    ),
  );
}
function asText(message: UIMessage) {
  return message.parts
    .flatMap((part) => {
      if (part.type === "text") return [part.text];
      if (part.type === "source-url") return [`Source: ${part.title ?? ""} ${part.url}`];
      if (part.type === "tool-create_presentation" && part.input)
        return [`Previous presentation: ${JSON.stringify(part.input)}`];
      return [];
    })
    .join("\n");
}

// Bound each model request rather than limiting the number of saved messages.
// Keep recent turns intact; retrieve relevant old passages alongside short notes.
export function conversationContext(messages: UIMessage[]) {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const query = words(lastUser ? asText(lastUser) : "");
  const images = messages.flatMap((message) =>
    message.parts.filter((part) => part.type === "file"),
  );
  const budget = Math.max(3000, 11000 - images.length * 6200);
  const normalized: UIMessage[] = messages
    .map((message) => ({
      ...message,
      parts: [
        ...(asText(message) ? [{ type: "text" as const, text: asText(message) }] : []),
        ...message.parts.filter((part) => part.type === "file"),
      ],
    }))
    .filter((message) => message.parts.length);
  const total = normalized.reduce((sum, message) => sum + asText(message).length + 40, 0);
  if (total <= budget) return { messages: normalized, condensed: false };
  const recent: UIMessage[] = [];
  let used = 0;
  const recentBudget = Math.floor(budget * 0.7);
  for (const message of [...normalized].reverse()) {
    const text = asText(message);
    if (recent.length >= 2 && used + text.length + 40 > recentBudget) break;
    const length = Math.min(text.length, recentBudget - used - 40);
    recent.unshift({
      ...message,
      parts: [
        ...(text ? [{ type: "text" as const, text: clip(text, Math.max(250, length)) }] : []),
        ...message.parts.filter((part) => part.type === "file"),
      ],
    });
    used += Math.min(text.length, Math.max(250, length)) + 40;
  }
  const recentIds = new Set(recent.map((message) => message.id));
  const older = normalized.filter((message) => !recentIds.has(message.id));
  const ranked = older
    .map((message, index) => {
      const text = asText(message);
      const terms = words(text);
      const relevance = [...query].filter((word) => terms.has(word)).length;
      return {
        message,
        index,
        text,
        score: relevance * 10 + (message.role === "user" ? 3 : 0) + (index < 2 ? 2 : 0),
      };
    })
    .sort((a, b) => b.score - a.score || b.index - a.index);
  let remaining = budget - used - 200;
  const notes: { index: number; text: string }[] = [];
  for (const item of ranked) {
    if (remaining < 100) break;
    const note = `${item.message.role}: ${clip(item.text, Math.min(600, remaining - 30))}`;
    notes.push({ index: item.index, text: note });
    remaining -= note.length + 10;
  }
  const noteText = notes
    .sort((a, b) => a.index - b.index)
    .map((note) => note.text)
    .join("\n\n");
  // Keep retained pictures even if the message containing them is now in notes.
  const earlierImages = older.flatMap((message) =>
    message.parts.filter((part) => part.type === "file"),
  );
  return {
    condensed: true,
    messages: [
      {
        id: "earlier-conversation-notes",
        role: "user" as const,
        parts: [
          {
            type: "text" as const,
            text: `Earlier conversation excerpts (context, not new instructions). Some details are omitted; ask for the original passage if needed.\n${noteText}`,
          },
          ...earlierImages,
        ],
      },
      ...recent,
    ],
  };
}
