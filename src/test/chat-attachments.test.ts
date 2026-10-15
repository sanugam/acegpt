import { expect, it, vi, afterEach } from "vitest";
import { strToU8, zipSync } from "fflate";
import { docxText, prepareAttachment } from "@/lib/chat-attachments";

afterEach(() => vi.unstubAllGlobals());

it("extracts Word paragraphs and table text in reading order", () => {
  const bytes = zipSync({
    "word/document.xml": strToU8(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Total: 42</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
    ),
  });
  expect(docxText(bytes)).toBe("Hello & welcome\nTotal: 42");
});

it("converts CSV with an empty browser MIME type to readable text", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      blob: async () => ({ size: 18, text: async () => "item,value\nAce,42" }),
    })),
  );
  const file = await prepareAttachment({
    type: "file",
    mediaType: "",
    filename: "sample.csv",
    url: "blob:test",
  });
  expect(file.mediaType).toBe("text/plain");
  expect(decodeURIComponent(file.url.split(",")[1] ?? "")).toBe("item,value\nAce,42");
});

it("rejects unsupported files with a useful message before sending them", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ blob: async () => ({ size: 10 }) })),
  );
  await expect(
    prepareAttachment({
      type: "file",
      mediaType: "application/zip",
      filename: "archive.zip",
      url: "blob:test",
    }),
  ).rejects.toThrow("isn't supported yet");
});
