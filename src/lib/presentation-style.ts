import type { Element, SlidePage } from "./presentation-design";

export type PresentationDesign = {
  name: string;
  background: string;
  foreground: string;
  accent: string;
  surface: string;
  font: "sans" | "serif" | "rounded";
  coverLayout: "centered" | "split" | "editorial";
  artwork?: string;
};
export type SlideLayout = "cards" | "split" | "statement" | "list";

const artworkCache = new Map<string, string | undefined>();
const tags = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polygon",
  "polyline",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "use",
]);
const attributes = new Set([
  "xmlns",
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "transform",
  "id",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "href",
]);

// Artwork is declarative SVG geometry, never executable HTML or a remote URL.
export function artworkData(svg: string): string | undefined {
  if (artworkCache.has(svg)) return artworkCache.get(svg);
  if (!svg || svg.length > 20_000 || typeof DOMParser === "undefined") return undefined;
  const xml = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = xml.documentElement;
  if (
    root.localName !== "svg" ||
    xml.querySelector("parsererror") ||
    root.querySelectorAll("*").length > 250
  )
    return undefined;
  for (const node of [root, ...Array.from(root.querySelectorAll("*"))]) {
    if (!tags.has(node.localName.toLowerCase())) {
      node.remove();
      continue;
    }
    for (const attr of Array.from(node.attributes)) {
      const internalRef = /^#[a-zA-Z][\w-]*$/.test(attr.value);
      if (
        !attributes.has(attr.name) ||
        attr.value.length > 6000 ||
        (/(?:javascript:|data:|https?:|\/\/)/i.test(attr.value) && attr.name !== "xmlns") ||
        (attr.name === "href" && !internalRef) ||
        (/url\(/i.test(attr.value) && !/^url\(#[a-zA-Z][\w-]*\)$/.test(attr.value))
      )
        node.removeAttribute(attr.name);
    }
    if (node.localName === "use" && node.getAttribute("href")?.startsWith("#")) {
      node.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", node.getAttribute("href")!);
    }
  }
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!root.hasAttribute("viewBox")) root.setAttribute("viewBox", "0 0 1600 900");
  root.setAttribute("width", "1600");
  root.setAttribute("height", "900");
  const safe = new XMLSerializer().serializeToString(root);
  const bytes = new TextEncoder().encode(safe);
  const data = `data:image/svg+xml;base64,${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))}`;
  if (artworkCache.size >= 100) artworkCache.clear();
  artworkCache.set(svg, data);
  return data;
}

function color(value: string | undefined, fallback: string) {
  return value && /^#?[\da-f]{6}$/i.test(value) ? value.replace(/^#/, "") : fallback;
}

export function customSlideElements(page: SlidePage, index: number, total: number): Element[] {
  const design = page.design!;
  const background = color(design.background, "F0F8F4");
  const ink = color(design.foreground, "183D32");
  const accent = color(design.accent, "419663");
  const surface = color(design.surface, "FFFFFF");
  const font =
    design.font === "serif" ? "Georgia" : design.font === "rounded" ? "Trebuchet MS" : "Arial";
  const elements: Element[] = [];
  const rect = (x: number, y: number, w: number, h: number, fill: string, radius = 0) =>
    elements.push({ kind: "rect", x, y, w, h, color: fill, radius });
  const text = (
    value: string,
    x: number,
    y: number,
    w: number,
    h: number,
    size: number,
    bold = false,
    align: "left" | "center" = "left",
    fill = ink,
  ) =>
    elements.push({ kind: "text", text: value, x, y, w, h, size, color: fill, bold, font, align });
  const art = (svg: string | undefined, x: number, y: number, w: number, h: number) => {
    const data = svg && artworkData(svg);
    if (data) elements.push({ kind: "image", data, x, y, w, h });
  };
  rect(0, 0, 1600, 900, background);
  if (page.cover) {
    art(design.artwork, 0, 0, 1600, 900);
    if (design.coverLayout === "split") {
      rect(60, 110, 820, 655, surface, 32);
      text(page.title, 110, 190, 690, 310, 76, true);
      text(page.bullets[0] ?? "", 115, 540, 680, 135, 30);
    } else if (design.coverLayout === "editorial") {
      rect(80, 135, 12, 560, accent);
      text(page.title, 130, 155, 1290, 330, 88, true);
      text(page.bullets[0] ?? "", 135, 560, 1090, 120, 32);
    } else {
      text(page.title, 180, 230, 1240, 260, 88, true, "center");
      text(page.bullets[0] ?? "", 280, 510, 1040, 115, 32, false, "center");
    }
  } else {
    // Content follows the same visual identity, with a quieter illustration band.
    art(design.artwork, 0, 660, 1600, 240);
    text(page.title, 85, 75, 1420, 150, 60, true);
    const layout = page.layout ?? (["cards", "split", "list"] as const)[(index - 1) % 3];
    const bullets = page.bullets;
    if (layout === "statement") {
      text(bullets[0] ?? "", 150, 280, 1300, 205, 58, true, "center");
      text(bullets.slice(1).join("\n\n"), 230, 530, 1140, 155, 30, false, "center");
    } else if (layout === "split") {
      rect(80, 265, 780, 445, surface, 24);
      bullets.forEach((bullet, i) => text(bullet, 120, 300 + i * 130, 690, 112, 31));
      art(page.artwork ?? design.artwork, 910, 260, 610, 440);
    } else if (layout === "cards") {
      const count = Math.max(1, bullets.length);
      const width = (1430 - (count - 1) * 28) / count;
      bullets.forEach((bullet, i) => {
        const x = 85 + i * (width + 28);
        rect(x, 285, width, 380, surface, 24);
        rect(x + 30, 320, 70, 7, accent, 3);
        text(bullet, x + 30, 370, width - 60, 250, 34);
      });
    } else {
      bullets.forEach((bullet, i) => {
        rect(90, 275 + i * 140, 12, 92, accent, 6);
        text(bullet, 145, 280 + i * 140, page.artwork ? 870 : 1320, 110, 35);
      });
      if (page.artwork) art(page.artwork, 1070, 255, 440, 440);
    }
  }
  text(
    `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
    1360,
    835,
    150,
    28,
    18,
    false,
    "center",
  );
  return elements;
}
