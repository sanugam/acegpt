import type { UIMessage } from "ai";

// Previous SVG path data can consume the whole free-tier input budget when
// restyling a deck. Keep its content and visual identity, and redraw artwork.
export function presentationContext(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type !== "tool-create_presentation" || !part.input || typeof part.input !== "object")
        return part;
      const input = part.input as Record<string, unknown>;
      const design = input["design"] as Record<string, unknown> | undefined;
      const { artwork: _coverArtwork, ...designIdentity } = design ?? {};
      return {
        ...part,
        input: {
          ...input,
          ...(design
            ? {
                design: designIdentity,
              }
            : {}),
          ...(Array.isArray(input["slides"])
            ? {
                slides: input["slides"].map((slide: Record<string, unknown>) => {
                  const { artwork: _artwork, ...content } = slide;
                  return content;
                }),
              }
            : {}),
        },
      };
    }),
  }));
}
