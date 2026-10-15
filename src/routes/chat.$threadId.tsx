import { createFileRoute, redirect } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import type { UIMessage } from "ai";

import { createThread, isGuestThread } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { Sidebar } from "@/components/chat/Sidebar";

export const threadMessagesQuery = (threadId: string) =>
  queryOptions({
    queryKey: ["messages", threadId],
    staleTime: Infinity,
    queryFn: async (): Promise<UIMessage[]> => {
      if (isGuestThread(threadId)) return [];
      const { data, error } = await supabase
        .from("messages")
        .select("message_id, role, parts")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.message_id,
        role: r.role as UIMessage["role"],
        parts: r.parts as UIMessage["parts"],
      }));
    },
  });

export const Route = createFileRoute("/chat/$threadId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Chat — Ace" },
      {
        name: "description",
        content: "Chat with Ace to finish your homework, essays and presentations.",
      },
      { property: "og:title", content: "Chat — Ace" },
      { property: "og:description", content: "Your AI homework finisher." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async ({ params }) => {
    if (params.threadId === "new") {
      const { data } = await supabase.auth.getSession();
      const id = data.session ? await createThread() : `guest-${crypto.randomUUID()}`;
      throw redirect({ to: "/chat/$threadId", params: { threadId: id }, replace: true });
    }
  },
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(threadMessagesQuery(params.threadId)),
  component: ChatPage,
});

function ChatPage() {
  const { threadId } = Route.useParams();
  const { data: initial } = useSuspenseQuery(threadMessagesQuery(threadId));
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar activeId={threadId} />
      <ChatWindow key={threadId} threadId={threadId} initialMessages={initial} />
    </div>
  );
}
