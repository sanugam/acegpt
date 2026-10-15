import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LogOut, Pencil, PenSquare, Search, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import logo from "@/assets/ace-logo.png";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { createThread, useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function Sidebar({ activeId }: { activeId: string }) {
  const navigate = useNavigate();
  const { session } = useAuth();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const { data: threads = [] } = useQuery({
    queryKey: ["threads"],
    enabled: Boolean(session),
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
      const id = session ? await createThread() : `guest-${crypto.randomUUID()}`;
      await qc.invalidateQueries({ queryKey: ["threads"] });
      navigate({ to: "/chat/$threadId", params: { threadId: id } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function rename(id: string) {
    const title = editTitle.trim();
    setEditingId(null);
    if (!title) return;
    const { error } = await supabase.from("threads").update({ title }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["threads"] });
  }

  const filtered = threads.filter((t) =>
    t.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

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
      <div className="mt-3 px-3">
        <div className="flex items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-3 py-1.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-2">
        {filtered.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {query ? "No chats match your search." : "No chats yet."}
          </p>
        )}
        {filtered.map((t) => (
          <div
            key={t.id}
            className={cn(
              "group flex items-center rounded-lg text-sm",
              t.id === activeId ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
            )}
          >
            {editingId === t.id ? (
              <div className="flex flex-1 items-center gap-1 px-2 py-1">
                <input
                  autoFocus
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") rename(t.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="w-full rounded bg-background px-2 py-1 text-sm outline-none"
                />
                <button
                  type="button"
                  aria-label="Save name"
                  onClick={() => rename(t.id)}
                  className="p-1 text-primary"
                >
                  <Check className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Cancel"
                  onClick={() => setEditingId(null)}
                  className="p-1 text-muted-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <>
                <Link
                  to="/chat/$threadId"
                  params={{ threadId: t.id }}
                  className="flex-1 truncate px-3 py-2"
                >
                  {t.title}
                </Link>
                <button
                  type="button"
                  aria-label="Rename chat"
                  onClick={() => {
                    setEditingId(t.id);
                    setEditTitle(t.title);
                  }}
                  className="rounded p-1.5 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Delete chat"
                  onClick={() => remove(t.id)}
                  className="mr-1 rounded p-1.5 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="size-4" />
                </button>
              </>
            )}
          </div>
        ))}
      </nav>
      {session ? (
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
      ) : (
        <p className="border-t border-sidebar-border p-4 text-xs text-muted-foreground">
          Guest workspace · No sign-in screen needed
        </p>
      )}
    </aside>
  );
}
