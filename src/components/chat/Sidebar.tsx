import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LogOut, Pencil, PenSquare, Search, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import logo from "@/assets/ace-logo.png";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { createThread } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function Sidebar({ activeId }: { activeId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const { data: threads = [] } = useQuery({
    queryKey: ["threads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("threads")
        .select("id,title,updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function newChat() {
    try {
      const id = await createThread();
      await qc.invalidateQueries({ queryKey: ["threads"] });
      navigate({ to: "/chat/$threadId", params: { threadId: id } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(id: string) {
    const { error } = await supabase.from("threads").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["threads"] });
    if (id === activeId) {
      const next = threads.find((t) => t.id !== id);
      if (next) navigate({ to: "/chat/$threadId", params: { threadId: next.id } });
      else newChat();
    }
  }

  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex items-center gap-2 px-4 py-4">
        <img src={logo} alt="Ace" width={32} height={32} />
        <span className="font-display text-xl font-bold">Ace</span>
      </div>
      <div className="px-3">
        <Button className="w-full justify-start gap-2" onClick={newChat}>
          <PenSquare className="size-4" /> New chat
        </Button>
      </div>
      <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-2">
        {threads.map((t) => (
          <div
            key={t.id}
            className={cn(
              "group flex items-center rounded-lg text-sm",
              t.id === activeId ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
            )}
          >
            <Link
              to="/chat/$threadId"
              params={{ threadId: t.id }}
              className="flex-1 truncate px-3 py-2"
            >
              {t.title}
            </Link>
            <button
              type="button"
              aria-label="Delete chat"
              onClick={() => remove(t.id)}
              className="mr-1 rounded p-1.5 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/" });
          }}
        >
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>
    </aside>
  );
}
