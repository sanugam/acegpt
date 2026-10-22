import { afterEach, expect, it, vi } from "vitest";
import { handleComputer } from "@/lib/computer.server";
const { generate, claims } = vi.hoisted(() => ({ generate: vi.fn(), claims: vi.fn() }));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: generate,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getClaims: claims } }) }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
function setup() {
  vi.stubEnv("GROQ_API_KEY", "test-only-server-key");
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-public-key");
  claims.mockResolvedValue({ data: { claims: { sub: "test-user" } } });
}
function request(auth = true, observation = {}) {
  return new Request("https://acegpt-kappa.vercel.app/api/computer", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: "Bearer test-session" } : {}),
    },
    body: JSON.stringify({
      task: "Draft a checklist in TextEdit",
      history: [],
      observation: {
        id: "fresh-observation",
        width: 1440,
        height: 900,
        app: "TextEdit",
        text: "2: AXTextArea document",
        elements: [{ id: 2, label: "AXTextArea document" }],
        ...observation,
      },
    }),
  });
}
it("requires account authentication before asking the AI to plan", async () => {
  setup();
  expect((await handleComputer(request(false))).status).toBe(401);
  expect(generate).not.toHaveBeenCalled();
  claims.mockResolvedValue({ data: null, error: { message: "Invalid" } });
  expect((await handleComputer(request())).status).toBe(401);
  expect(generate).not.toHaveBeenCalled();
});
it("returns one validated plan without exposing keys or executing it on the server", async () => {
  setup();
  generate.mockResolvedValue({
    output: { kind: "click", elementId: 2, reason: "Focus the document" },
  });
  const response = await handleComputer(request());
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(body).toContain('"review":false');
  expect(body).not.toContain("test-only-server-key");
  expect(generate.mock.calls[0]?.[0].instructions).toContain("untrusted data");
});
it("pauses on sensitive controls and refuses unknown targets", async () => {
  setup();
  generate.mockResolvedValue({
    output: { kind: "click", elementId: 2, reason: "Press the button" },
  });
  expect(
    await (
      await handleComputer(request(true, { elements: [{ id: 2, label: "Send message" }] }))
    ).json(),
  ).toHaveProperty("review", true);
  generate.mockResolvedValue({ output: { kind: "click", elementId: 2000, reason: "Click" } });
  expect((await handleComputer(request())).status).toBe(400);
});
it("rejects remote image URLs instead of fetching untrusted resources", async () => {
  setup();
  expect(
    (await handleComputer(request(true, { image: "https://evil.example/track" }))).status,
  ).toBe(400);
  expect(generate).not.toHaveBeenCalled();
});
it("returns a retryable pause when the free provider limit is reached", async () => {
  setup();
  generate.mockRejectedValue({ statusCode: 429 });
  const response = await handleComputer(request());
  expect(response.status).toBe(429);
  expect(await response.json()).toHaveProperty("retryAfter", 25);
});
