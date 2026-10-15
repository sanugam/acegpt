import { describe, expect, it } from "vitest";
import { deckPages, slideElements, type Deck } from "@/lib/presentation-design";
import { artworkData, type PresentationDesign } from "@/lib/presentation-style";
import { presentationContext } from "@/lib/presentation-context";
import type { UIMessage } from "ai";

const forest: PresentationDesign = {
  name: "Forest canopy",
  background: "E4FFF0",
  foreground: "174825",
  accent: "52AB58",
  surface: "FFFFFF",
  font: "sans",
  coverLayout: "centered",
  artwork:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><defs><g id="tree"><rect x="50" y="700" width="25" height="150" fill="#87562a"/><circle cx="65" cy="690" r="80" fill="#256c35"/></g></defs><use href="#tree"/><use href="#tree" transform="translate(1400 0)"/></svg>',
};

describe("custom presentation designs", () => {
  it("keeps slide content and colours for revisions without resending old vector paths", () => {
    const input = {
      title: "Environment",
      design: forest,
      slides: [
        {
          title: "Act now",
          bullets: ["Reduce plastic"],
          notes: "Keep these notes",
          artwork: "<svg/>",
        },
      ],
    };
    const history: UIMessage[] = [
      {
        id: "old-deck",
        role: "assistant",
        parts: [
          {
            type: "tool-create_presentation",
            toolCallId: "deck-1",
            state: "output-available",
            input,
            output: { ok: true },
          },
        ],
      },
    ];
    const context = presentationContext(history);
    const saved = (context[0]!.parts[0] as { input: typeof input }).input;
    expect(saved.design.foreground).toBe(forest.foreground);
    expect(saved.design.artwork).not.toContain("<svg");
    expect(saved.slides[0]).toMatchObject({
      title: "Act now",
      bullets: ["Reduce plastic"],
      notes: "Keep these notes",
    });
    expect(saved.slides[0]).not.toHaveProperty("artwork");
    expect(input.design.artwork).toContain("<svg");
  });
  it("carries the requested visual identity through every page without adding slides", () => {
    const deck: Deck = {
      title: "Protect our environment",
      subtitle: "Choose a future without plastic",
      design: forest,
      slides: Array.from({ length: 9 }, (_, i) => ({
        title: `Slide ${i}`,
        bullets: ["One point", "Another point"],
        notes: "Notes",
        layout: "cards",
      })),
    };
    const pages = deckPages(deck);
    expect(pages).toHaveLength(10);
    expect(pages.every((page) => page.design === forest)).toBe(true);
    const cover = slideElements(pages[0]!, 0, 10, "studio");
    expect(cover[0]).toMatchObject({ kind: "rect", color: "E4FFF0" });
    expect(cover).toContainEqual(
      expect.objectContaining({
        kind: "text",
        text: deck.title,
        font: "Arial",
        align: "center",
        color: "174825",
      }),
    );
    expect(cover.some((element) => element.kind === "image")).toBe(true);
    expect(cover.some((element) => element.kind === "rect" && element.color === "F5D63D")).toBe(
      false,
    );
  });

  it("uses different artwork, typography and composition for a different subject", () => {
    const design: PresentationDesign = {
      ...forest,
      name: "Neon robotics",
      background: "110C27",
      foreground: "FFFFFF",
      accent: "BB75FF",
      font: "rounded",
      coverLayout: "split",
      artwork:
        '<svg viewBox="0 0 1600 900"><rect x="1000" y="200" width="400" height="500" fill="#BB75FF"/></svg>',
    };
    const page = deckPages({ title: "Robotics", design })[0]!;
    const cover = slideElements(page, 0, 1, "botanical");
    expect(cover[0]).toMatchObject({ color: "110C27" });
    expect(cover).toContainEqual(
      expect.objectContaining({
        kind: "text",
        text: "Robotics",
        font: "Trebuchet MS",
        align: "left",
      }),
    );
    const pictures = cover.filter((element) => element.kind === "image");
    expect(pictures[0]?.data).not.toBe(artworkData(forest.artwork!));
  });

  it("removes executable and external SVG content while retaining vector geometry", () => {
    const data = artworkData(
      '<svg viewBox="0 0 1600 900" onload="alert(1)"><script>alert(1)</script><foreignObject><div>unsafe</div></foreignObject><image href="https://example.com/track"/><rect width="100" height="100" fill="#00aa00" onclick="alert(1)"/><use href="https://example.com/remote.svg"/></svg>',
    )!;
    const svg = atob(data.split(",")[1]!);
    expect(svg).toContain("rect");
    for (const unsafe of ["script", "foreignObject", "onload", "onclick", "example.com", "<image"])
      expect(svg).not.toContain(unsafe);
    expect(artworkData('<svg><path d="broken"></svg>')).toBeUndefined();
  });
});
