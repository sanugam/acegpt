import { expect, it } from "vitest";
import {
  actionNeedsReview,
  computerActionSchema,
  validateComputerAction,
} from "@/lib/computer-actions";
it("supports bounded routine actions and stops before sensitive controls", () => {
  expect(
    actionNeedsReview({ kind: "click", reason: "Focus the document", elementId: 4 }, "AXTextArea"),
  ).toBe(false);
  for (const label of [
    "Send",
    "Publish",
    "Delete",
    "Buy now",
    "Allow access",
    "Accept terms",
    "Sign in",
  ])
    expect(
      actionNeedsReview({ kind: "click", reason: "Use the control", elementId: 4 }, label),
    ).toBe(true);
  expect(actionNeedsReview({ kind: "click", reason: "Click the canvas", x: 10, y: 20 })).toBe(
    false,
  );
});
it("rejects arbitrary execution, unknown shortcuts and off-screen targets", () => {
  expect(() => computerActionSchema.parse({ kind: "shell", reason: "Execute" })).toThrow();
  expect(() =>
    validateComputerAction(
      { kind: "open_app", reason: "Open", app: "com.apple.Terminal" },
      1440,
      900,
    ),
  ).toThrow();
  expect(() =>
    validateComputerAction({ kind: "key", reason: "Type", key: "Cmd+Shift+J" }, 1440, 900),
  ).toThrow();
  expect(() =>
    validateComputerAction({ kind: "click", reason: "Click", x: 2000, y: 10 }, 1440, 900),
  ).toThrow();
  expect(
    validateComputerAction(
      { kind: "open_app", reason: "Open TextEdit", app: "com.apple.TextEdit" },
      1440,
      900,
    ).app,
  ).toBe("com.apple.TextEdit");
});
