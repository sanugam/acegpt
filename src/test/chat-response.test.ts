import { afterEach, expect, it, vi } from "vitest";
import { handleChat } from "@/lib/chat.server";

const { gatewayResponse, directResponse } = vi.hoisted(() => ({
  gatewayResponse: vi.fn(),
  directResponse: vi.fn(() => new Response('data: {"type":"text-delta","delta":"Hello"}\n\n')),
}));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  streamText: () => ({ toUIMessageStreamResponse: directResponse }),
}));
vi.mock("@/lib/ai/run-id.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/run-id.server")>()),
  withLovableAiGatewayRunIdHeader: gatewayResponse,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: "user-1" } } }) },
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: { id: "thread-1", title: "Existing chat" } }),
        upsert: async () => ({}),
        update: () => query,
      };
      return query;
    },
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("returns a direct Groq stream without waiting for an unused Lovable gateway run ID", async () => {
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-public-key");
  vi.stubEnv("GROQ_API_KEY", "test-groq-key");
  const response = await handleChat(new Request("https://ace.example/api/chat", {
    method: "POST",
    headers: { authorization: "Bearer test-session", "content-type": "application/json" },
    body: JSON.stringify({ threadId: "thread-1", messages: [
      { id: "message-1", role: "user", parts: [{ type: "text", text: "Hello" }] },
    ] }),
  }));
  expect(gatewayResponse).not.toHaveBeenCalled();
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('"delta":"Hello"');
});
