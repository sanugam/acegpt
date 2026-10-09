import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import type { UIMessage } from "ai";

import { supabase } from "@/integrations/supabase/client";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { Sidebar } from "@/components/chat/Sidebar";

export const threadMessagesQuery = (threadId: string) =>
  queryOptions({
    queryKey: ["messages", threadId],
    staleTime: Infinity,
    queryFn: async (): Promise<UIMessage[]> => {
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
      { name: "description", content: "Chat with Ace to finish your homework, essays and presentations." },
      { property: "og:title", content: "Chat — Ace" },
      { property: "og:description", content: "Your AI homework finisher." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const { redirect } = await import("@tanstack/react-router");
      throw redirect({ to: "/" });
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
