import { describe, expect, it } from "vitest";
import { codeFiles, safeFilename } from "../lib/downloads";
import { deckPages } from "../lib/presentation-design";

describe("download content", () => {
  it("retains executable code exactly", () => {
    expect(codeFiles("```python\nprint('hello')\n```")).toEqual([
      { filename: "ace-file-1.py", content: "print('hello')" },
    ]);
  });
  it("retains CSV data exactly", () => {
    expect(codeFiles("```csv\nname,value\nAce,42\n```")[0]).toEqual({
      filename: "ace-file-1.csv",
      content: "name,value\nAce,42",
    });
  });
  it("preserves all slide points when splitting crowded decks", () => {
    const bullets = ["one", "two", "three", "four", "five", "six", "seven"];
    const pages = deckPages({
      title: "Test",
      subtitle: "Intro",
      slides: [{ title: "Content", bullets, notes: "Full notes" }],
    });
    expect(pages.slice(1).flatMap((p) => p.bullets)).toEqual(bullets);
    expect(pages.slice(1).every((p) => p.notes === "Full notes")).toBe(true);
    expect(pages).toHaveLength(4);
  });
  it("sanitizes filenames", () => expect(safeFilename("../Test: deck?")).toBe("Test deck"));
});
