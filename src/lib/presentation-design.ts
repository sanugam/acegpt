export type Deck = { title: string; subtitle: string; slides: { title: string; bullets: string[]; notes: string }[] };
export type ThemeName = "studio" | "botanical" | "pop";
export const THEMES = {
  studio: { label: "Studio", ink: "1B2233", paper: "F6F7F9", accent: "F5D63D", soft: "E8ECF3", muted: "566176" },
  botanical: { label: "Botanical", ink: "143C35", paper: "F4F8F5", accent: "A9DEB2", soft: "DFEBE3", muted: "506A5F" },
  pop: { label: "Pop", ink: "40212E", paper: "FFF5F7", accent: "FF889E", soft: "F7DEE5", muted: "795B66" },
};
export type SlidePage = { title: string; bullets: string[]; notes: string; cover?: boolean };
export type Element = { kind: "rect"; x: number; y: number; w: number; h: number; color: string } | { kind: "text"; x: number; y: number; w: number; h: number; color: string; text: string; size: number; bold?: boolean; display?: boolean };

export function deckPages(deck: Partial<Deck>): SlidePage[] {
  const pages: SlidePage[] = [{ title: deck.title ?? "Building presentation…", bullets: [deck.subtitle ?? ""], notes: "", cover: true }];
  for (const slide of deck.slides ?? []) {
    const bullets = slide.bullets ?? [];
    // Keep all content, splitting crowded slides instead of truncating it.
    const groups: string[][] = [];
    let group: string[] = [];
    let chars = 0;
    for (const bullet of bullets) {
      const sentences = bullet.length > 240 ? bullet.match(/.{1,220}(?:\s|$)|\S{1,220}/g) ?? [bullet] : [bullet];
      for (const sentence of sentences) {
        if (group.length >= 3 || (chars + sentence.length > 420 && group.length)) {
          groups.push(group); group = []; chars = 0;
        }
        group.push(sentence.trim()); chars += sentence.length;
      }
    }
    if (group.length || !groups.length) groups.push(group);
    groups.forEach((items, i) => pages.push({ title: `${slide.title ?? ""}${i ? " (continued)" : ""}`, bullets: items, notes: slide.notes ?? "" }));
  }
  return pages;
}

export function slideElements(page: SlidePage, index: number, total: number, theme: ThemeName): Element[] {
  const p = THEMES[theme];
  const elements: Element[] = [];
  const rect = (x: number, y: number, w: number, h: number, color: string) => elements.push({ kind: "rect", x, y, w, h, color });
  const text = (value: string, x: number, y: number, w: number, h: number, size: number, color: string, bold = false, display = false) => elements.push({ kind: "text", text: value, x, y, w, h, size, color, bold, display });
  rect(0, 0, 1600, 900, page.cover ? p.ink : p.paper);
  text("ACE / " + (page.cover ? "PRESENTATION" : "" + String(index).padStart(2, "0")), 80, 55, 1250, 40, 20, page.cover ? p.accent : p.muted, true);
  text(`${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, 1350, 810, 170, 30, 20, page.cover ? p.accent : p.muted);
  if (page.cover) {
    rect(1280, 140, 240, 240, p.accent);
    rect(1380, 405, 140, 140, p.soft);
    text(page.title, 80, 210, 1130, 360, page.title.length > 80 ? 68 : 88, p.paper, true, true);
    text(page.bullets[0] ?? "", 85, 635, 1110, 115, 32, p.paper);
    return elements;
  }
  text(page.title, 80, 130, 1410, 170, page.title.length > 80 ? 48 : 64, p.ink, true, true);
  if (index % 3 === 1) {
    rect(80, 345, 310, 395, p.accent);
    text(String(index).padStart(2, "0"), 115, 400, 240, 160, 132, p.ink, true, true);
    text("KEY IDEAS", 115, 650, 240, 50, 22, p.ink, true);
    page.bullets.forEach((b, i) => {
      text(String(i + 1).padStart(2, "0"), 455, 350 + i * 145, 70, 50, 24, p.muted, true);
      text(b, 550, 345 + i * 145, 935, 128, 30, p.ink);
    });
  } else if (index % 3 === 2) {
    const count = Math.max(page.bullets.length, 1);
    const width = (1440 - (count - 1) * 35) / count;
    page.bullets.forEach((b, i) => {
      const x = 80 + i * (width + 35);
      rect(x, 345, width, 400, i === 0 ? p.accent : p.soft);
      text(String(i + 1).padStart(2, "0"), x + 30, 375, width - 60, 85, 64, p.ink, true, true);
      text(b, x + 30, 490, width - 60, 225, 28, p.ink);
    });
  } else {
    page.bullets.forEach((b, i) => {
      rect(80, 345 + i * 142, 85, 90, i === 1 ? p.soft : p.accent);
      text(String(i + 1), 110, 365 + i * 142, 50, 50, 36, p.ink, true);
      text(b, 220, 350 + i * 142, 1260, 115, 32, p.ink);
    });
  }
  return elements;
}

export async function renderSlide(page: SlidePage, index: number, total: number, theme: ThemeName): Promise<string> {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1600; canvas.height = 900;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Slide preview isn't supported in this browser.");
  for (const e of slideElements(page, index, total, theme)) {
    ctx.fillStyle = `#${e.color}`;
    if (e.kind === "rect") { ctx.fillRect(e.x, e.y, e.w, e.h); continue; }
    let size = e.size;
    let lines: string[] = [];
    do {
      ctx.font = `${e.bold ? "700" : "400"} ${size}px ${e.display ? "Fraunces, Georgia" : "Figtree, sans-serif"}`;
      lines = [];
      for (const paragraph of e.text.split("\n")) {
        let line = "";
        for (const word of paragraph.split(/\s+/)) {
          const candidate = line ? `${line} ${word}` : word;
          if (ctx.measureText(candidate).width > e.w && line) { lines.push(line); line = word; } else line = candidate;
        }
        lines.push(line);
      }
      if (lines.length * size * 1.22 <= e.h) break;
      size -= 1;
    } while (size > 18);
    ctx.textBaseline = "top";
    lines.forEach((line, i) => ctx.fillText(line, e.x, e.y + i * size * 1.22, e.w));
  }
  return canvas.toDataURL("image/png");
}