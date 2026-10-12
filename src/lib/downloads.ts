export function safeFilename(name: string, fallback = "ace-answer") {
  return (
    name
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .trim()
      .slice(0, 70) || fallback
  );
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function codeFiles(text: string) {
  const extensions: Record<string, string> = {
    javascript: "js",
    typescript: "ts",
    python: "py",
    html: "html",
    css: "css",
    json: "json",
    csv: "csv",
    sql: "sql",
    bash: "sh",
    jsx: "jsx",
    tsx: "tsx",
    java: "java",
    cpp: "cpp",
  };
  return Array.from(text.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g), (match, index) => {
    const language = (match[1] ?? "").trim().toLowerCase();
    return {
      filename: `ace-file-${index + 1}.${extensions[language] ?? (/^[a-z]{1,8}$/.test(language) ? language : "txt")}`,
      content: (match[2] ?? "").replace(/\n$/, ""),
    };
  });
}

export async function downloadAnswer(text: string, format: "md" | "txt" | "docx") {
  if (format !== "docx") {
    saveBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `ace-answer.${format}`);
    return;
  }
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
  const paragraphs = text.split("\n").map((line) => {
    const heading = line.match(/^(#{1,3})\s+(.*)/);
    return new Paragraph({
      ...(heading
        ? {
            heading:
              [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][
                (heading[1] ?? "#").length - 1
              ] ?? HeadingLevel.HEADING_1,
          }
        : {}),
      children: [new TextRun((heading?.[2] ?? line).replace(/\*\*(.*?)\*\*/g, "$1"))],
      spacing: { after: 160 },
    });
  });
  const doc = new Document({ sections: [{ children: paragraphs }] });
  saveBlob(await Packer.toBlob(doc), "ace-answer.docx");
}
