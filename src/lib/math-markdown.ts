// Markdown otherwise eats the backslashes in the model's \(...\) syntax.
// Leave code examples alone while normalizing KaTeX-compatible delimiters.
export function mathMarkdown(text: string) {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, index) =>
      index % 2
        ? part
        : part
            .replace(/\\\[([\s\S]*?)\\\]/g, (_, math: string) => `\n$$\n${math.trim()}\n$$\n`)
            .replace(/\\\(([\s\S]*?)\\\)/g, (_, math: string) => `$${math.trim()}$`),
    )
    .join("");
}
