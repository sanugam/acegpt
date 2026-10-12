import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

// Normalize package metadata emitted by PptxGenJS for strict Office readers.
export function normalizePptx(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  const types = files["[Content_Types].xml"];
  if (types) {
    files["[Content_Types].xml"] = strToU8(
      strFromU8(types).replace(
        /<Override\b[^>]*PartName="([^"]+)"[^>]*\/>/g,
        (tag, path: string) => (files[path.replace(/^\//, "")] ? tag : ""),
      ),
    );
  }
  const presentation = files["ppt/presentation.xml"];
  if (presentation) {
    let xml = strFromU8(presentation);
    const notes = xml.match(/<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>/)?.[0];
    if (notes) {
      xml = xml.replace(notes, "").replace("</p:sldMasterIdLst>", `</p:sldMasterIdLst>${notes}`);
    }
    files["ppt/presentation.xml"] = strToU8(xml);
  }
  return zipSync(files);
}
