import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getSession: vi.fn(), signInAnonymously: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth,
    from: vi.fn(() => {
      throw new Error("Guest must not query the database");
    }),
  },
}));
import { ensureChatSession, isGuestThread } from "@/lib/auth";

beforeEach(() => vi.resetAllMocks());

describe("chat without a sign-in screen", () => {
  it("keeps an existing session instead of creating another identity", async () => {
    const session = { access_token: "existing" };
    auth.getSession.mockResolvedValue({ data: { session } });
    expect(await ensureChatSession()).toBe(session);
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("creates one private guest session for concurrent requests", async () => {
    const session = { access_token: "guest" };
    auth.getSession.mockResolvedValue({ data: { session: null } });
    auth.signInAnonymously.mockResolvedValue({ data: { session } });
    expect(await Promise.all([ensureChatSession(), ensureChatSession()])).toEqual([
      session,
      session,
    ]);
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("explains disabled guest access and permits retry instead of redirecting home", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    auth.signInAnonymously.mockResolvedValue({
      data: { session: null },
      error: new Error("disabled"),
    });
    await expect(ensureChatSession()).rejects.toThrow("Guest chat isn't enabled");
    const session = { access_token: "enabled" };
    auth.signInAnonymously.mockResolvedValue({ data: { session } });
    expect(await ensureChatSession()).toBe(session);
  });

  it("distinguishes unsaved guest chats from database thread IDs", () => {
    expect(isGuestThread("guest-123")).toBe(true);
    expect(isGuestThread("61f2cdec-66d0-4df4-91ad-e75ad63f03a3")).toBe(false);
  });
});

vi.mock("@/components/chat/ChatWindow", () => ({ ChatWindow: () => null }));
vi.mock("@/components/chat/Sidebar", () => ({ Sidebar: () => null }));
import { threadMessagesQuery } from "@/routes/chat.$threadId";
import { QueryClient } from "@tanstack/react-query";

it("opens a guest workspace with an empty history without requiring a database identity", async () => {
  const client = new QueryClient();
  expect(await client.fetchQuery(threadMessagesQuery("guest-unsaved"))).toEqual([]);
});
