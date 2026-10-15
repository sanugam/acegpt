import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MessageResponse } from "@/components/ai-elements/message";

afterEach(cleanup);

it("renders model inline and display equations as maths rather than literal delimiters", () => {
  const { container } = render(<MessageResponse>{String.raw`Answer \(x=3\).

\[x=\frac12\]`}</MessageResponse>);
  expect(container.querySelectorAll(".katex")).toHaveLength(2);
});
