import type { FileUIPart } from "ai";
import { strFromU8, unzipSync } from "fflate";

const MAX_TEXT = 100_000;
const MAX_IMAGE_BYTES = 900_000;

function textFile(file: FileUIPart, text: string): FileUIPart {
  if (!text.trim())
    throw new Error(
      `${file.filename ?? "This document"} has no readable text. For scanned pages, attach screenshots instead.`,
    );
  if (text.length > MAX_TEXT)
    throw new Error(
      "This document is too long. Attach a smaller section (up to 100,000 characters).",
    );
  return {
    ...file,
    mediaType: "text/plain",
    url: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`,
  };
}

export function docxText(bytes: Uint8Array) {
  const files = unzipSync(bytes, {
    filter: (entry) => entry.name === "word/document.xml" && entry.originalSize <= 2_000_000,
  });
  const document = files["word/document.xml"];
  if (!document)
    throw new Error("This Word file couldn't be read. Use a .docx file or export it as PDF.");
  const xml = new DOMParser().parseFromString(strFromU8(document), "application/xml");
  return Array.from(xml.getElementsByTagName("w:p"), (paragraph) =>
    Array.from(paragraph.getElementsByTagName("w:t"), (node) => node.textContent ?? "").join(""),
  ).join("\n");
}

export async function prepareAttachment(file: FileUIPart): Promise<FileUIPart> {
  const blob = await (await fetch(file.url)).blob();
  if (blob.size > 5_000_000) throw new Error("Keep each file under 5 MB.");
  const extension = file.filename?.split(".").pop()?.toLowerCase() ?? "";
  if (file.mediaType.startsWith("image/")) {
    const image = await createImageBitmap(blob).catch(() => {
      throw new Error("This picture couldn't be opened. Try PNG, JPG, or WebP.");
    });
    try {
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser couldn't prepare your picture.");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let url = canvas.toDataURL("image/jpeg", 0.8);
      if (url.length > MAX_IMAGE_BYTES) url = canvas.toDataURL("image/jpeg", 0.5);
      if (url.length > MAX_IMAGE_BYTES)
        throw new Error("This picture is too large. Crop it or use a smaller image.");
      return { ...file, mediaType: "image/jpeg", url };
    } finally {
      image.close();
    }
  }
  if (extension === "docx")
    return textFile(file, docxText(new Uint8Array(await blob.arrayBuffer())));
  if (extension === "pdf" || file.mediaType === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = (
      await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
    ).default;
    const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
    const pdf = await task.promise;
    try {
      if (pdf.numPages > 50) throw new Error("Attach up to 50 PDF pages at a time.");
      const pages: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
      }
      return textFile(file, pages.join("\n\n"));
    } finally {
      await task.destroy();
    }
  }
  if (
    file.mediaType.startsWith("text/") ||
    [
      "txt",
      "md",
      "csv",
      "json",
      "xml",
      "js",
      "ts",
      "tsx",
      "jsx",
      "py",
      "html",
      "css",
      "sql",
      "java",
      "cpp",
      "c",
      "sh",
    ].includes(extension)
  ) {
    return textFile(file, await blob.text());
  }
  throw new Error(
    "Attach a picture, PDF, Word (.docx), text, CSV, or code file. This file type isn't supported yet.",
  );
}
