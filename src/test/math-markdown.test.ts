import { expect, it } from "vitest";
import { mathMarkdown } from "@/lib/math-markdown";

it("renders model math delimiters while preserving literal code", () => {
  expect(mathMarkdown(String.raw`Answer \(x=3\).`)).toBe("Answer $x=3$.");
  expect(mathMarkdown(String.raw`\[x=\frac12\]`)).toBe("\n$$\nx=\\frac12\n$$\n");
  const code = '```python\nprint("\\(test\\)")\n```';
  expect(mathMarkdown(code)).toBe(code);
});
