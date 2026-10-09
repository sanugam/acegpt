export type Deck = {
  title: string;
  subtitle: string;
  slides: { title: string; bullets: string[]; notes: string }[];
};

const INK = "1B2233";
const CHALK = "F4F1E6";
const YELLOW = "F5D63D";

export async function downloadDeck(deck: Deck) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";

  const cover = pptx.addSlide();
  cover.background = { color: INK };
  cover.addShape("rect", { x: 0.6, y: 3.9, w: 2.2, h: 0.12, fill: { color: YELLOW } });
  cover.addText(deck.title, { x: 0.6, y: 1.6, w: 12, h: 1.8, fontSize: 44, bold: true, color: CHALK, fontFace: "Georgia" });
  cover.addText(deck.subtitle, { x: 0.6, y: 4.2, w: 12, h: 1, fontSize: 20, color: "B8BFD0" });

  for (const s of deck.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: CHALK };
    slide.addShape("rect", { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: YELLOW } });
    slide.addText(s.title, { x: 0.7, y: 0.4, w: 12, h: 1, fontSize: 32, bold: true, color: INK, fontFace: "Georgia" });
    slide.addText(
      s.bullets.map((b) => ({ text: b, options: { bullet: true, paraSpaceAfter: 10 } })),
      { x: 0.7, y: 1.6, w: 11.8, h: 5.3, fontSize: 20, color: "333A4A", valign: "top" },
    );
    if (s.notes) slide.addNotes(s.notes);
  }

  const name = deck.title.replace(/[^\w\s-]/g, "").trim().slice(0, 60) || "presentation";
  await pptx.writeFile({ fileName: `${name}.pptx` });
}
