import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ComputerPanel } from "@/components/chat/ComputerPanel";
vi.mock("@/lib/auth", () => ({
  ensureChatSession: async () => ({ access_token: "test-account-session" }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("keeps pairing local and cannot execute an AI plan that arrives after Stop", async () => {
  const pairing = "a".repeat(43);
  let finishPlan: (response: Response) => void = () => {};
  const pendingPlan = new Promise<Response>((resolve) => {
    finishPlan = resolve;
  });
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/status")) return Response.json({ accessibility: true, recording: true });
    if (url.endsWith("/observe"))
      return Response.json({
        id: "fresh",
        app: "TextEdit",
        width: 1440,
        height: 900,
        text: "AXTextArea document " + "visible text ".repeat(10),
        elements: [{ id: 4, label: "Document" }],
      });
    if (url === "/api/computer") {
      expect(JSON.stringify(init)).not.toContain(pairing);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-account-session");
      return pendingPlan;
    }
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<ComputerPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Computer mode" }));
  fireEvent.change(screen.getByLabelText("Companion pairing code"), { target: { value: pairing } });
  fireEvent.click(screen.getByRole("button", { name: "Connect this Mac" }));
  const task = await screen.findByLabelText("What should Ace do?");
  fireEvent.change(task, { target: { value: "Draft a checklist in TextEdit" } });
  fireEvent.click(screen.getByRole("button", { name: "Start task" }));
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([url]) => url === "/api/computer")).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "Stop and disconnect" }));
  finishPlan(
    Response.json({
      action: { kind: "type", reason: "Write the draft", text: "Hello" },
      review: false,
    }),
  );
  await screen.findByRole("button", { name: "Connect this Mac" });
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/stop"))).toBe(true),
  );
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/execute"))).toBe(false);
});
