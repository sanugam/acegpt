import { deckPages, renderSlide, slideElements, type Deck, type ThemeName } from "./presentation-design";
import { safeFilename, saveBlob } from "./downloads";
export type { Deck } from "./presentation-design";

export async function buildDeck(deck: Deck, theme: ThemeName = "studio") {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Ace";
  pptx.title = deck.title;
  pptx.subject = deck.subtitle;
  const pages = deckPages(deck);
  const scale = 1 / 120;
  pages.forEach((page, index) => {
    const slide = pptx.addSlide();
    for (const e of slideElements(page, index, pages.length, theme)) {
      const box = { x: e.x * scale, y: e.y * scale, w: e.w * scale, h: e.h * scale };
      if (e.kind === "rect") slide.addShape("rect", { ...box, fill: { color: e.color }, line: { color: e.color, transparency: 100 } });
      else slide.addText(e.text, { ...box, fontSize: e.size * 0.6, color: e.color, bold: e.bold, fontFace: e.display ? "Georgia" : "Aptos", margin: 0, valign: "top", breakLine: false, fit: "shrink" });
    }
    if (page.notes) slide.addNotes(page.notes);
  });
  return pptx;
}

export async function downloadDeck(deck: Deck, theme: ThemeName = "studio") {
  const pptx = await buildDeck(deck, theme);
  await pptx.writeFile({ fileName: `${safeFilename(deck.title, "presentation")}.pptx` });
}

export async function downloadDeckPdf(deck: Deck, theme: ThemeName = "studio") {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [1600, 900], hotfixes: ["px_scaling"] });
  const pages = deckPages(deck);
  for (const [index, page] of pages.entries()) {
    if (index) pdf.addPage([1600, 900], "landscape");
    pdf.addImage(await renderSlide(page, index, pages.length, theme), "PNG", 0, 0, 1600, 900);
  }
  saveBlob(pdf.output("blob"), `${safeFilename(deck.title, "presentation")}.pdf`);
}