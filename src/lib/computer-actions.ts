import { z } from "zod";
export const computerActionSchema = z.object({
  kind: z.enum(["click", "type", "key", "scroll", "open_app", "done", "ask_user"]),
  reason: z.string().max(500),
  elementId: z.number().int().nonnegative().optional(),
  x: z.number().min(0).max(10000).optional(),
  y: z.number().min(0).max(10000).optional(),
  text: z.string().max(2000).optional(),
  key: z.string().max(30).optional(),
  app: z.string().max(100).optional(),
  direction: z.enum(["up", "down"]).optional(),
});
export type ComputerAction = z.infer<typeof computerActionSchema>;
export const companionURL = "http://127.0.0.1:48623";
export const allowedApps = [
  "com.apple.TextEdit",
  "com.apple.iWork.Pages",
  "com.apple.iWork.Keynote",
  "com.apple.iWork.Numbers",
  "com.apple.calculator",
  "com.apple.Preview",
  "com.google.Chrome",
  "com.apple.Safari",
  "org.mozilla.firefox",
];
export function actionNeedsReview(action: ComputerAction, targetLabel = "") {
  return /\b(send|submit|publish|post|delete|remove|trash|buy|pay|purchase|checkout|transfer|password|credential|sign.?in|log.?in|allow|install|grant|share|turn.?in|accept|agree|confirm)\b/i.test(
    `${targetLabel} ${action.reason}`,
  );
}
export function validateComputerAction(action: ComputerAction, width: number, height: number) {
  if (
    action.kind === "click" &&
    action.elementId === undefined &&
    !(action.x !== undefined && action.y !== undefined && action.x < width && action.y < height)
  )
    throw new Error("The AI did not identify a valid click target. Please retry.");
  if (action.kind === "type" && !action.text) throw new Error("No text was supplied.");
  if (action.kind === "open_app" && !allowedApps.includes(action.app ?? ""))
    throw new Error("That application is outside the companion's supported apps.");
  if (
    action.kind === "key" &&
    ![
      "Return",
      "Tab",
      "Escape",
      "Backspace",
      "Left",
      "Right",
      "Up",
      "Down",
      "Cmd+A",
      "Cmd+L",
      "Cmd+N",
      "Cmd+S",
      "Cmd+F",
      "Cmd+Z",
    ].includes(action.key ?? "")
  )
    throw new Error("That shortcut is not supported.");
  return action;
}
