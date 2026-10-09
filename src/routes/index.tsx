import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { BookOpenCheck, Globe, MonitorUp, Presentation } from "lucide-react";
import { toast } from "sonner";

import logo from "@/assets/ace-logo.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { createThread, useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ace — AI that finishes your schoolwork" },
      { name: "description", content: "Sign in to Ace: essays, maths, research, code and presentations completed for you." },
      { property: "og:title", content: "Ace — AI that finishes your schoolwork" },
      { property: "og:description", content: "Essays, maths, research, code and slides — done." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const FEATURES = [
  { icon: BookOpenCheck, label: "Full answers & essays" },
  { icon: Presentation, label: "Slide decks you can download" },
  { icon: MonitorUp, label: "Share your screen, get it done" },
  { icon: Globe, label: "Live web research" },
];

function Index() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (!session || started.current) return;
    started.current = true;
    (async () => {
      const { data } = await supabase
        .from("threads")
        .select("id")
        .order("updated_at", { ascending: false })
        .limit(1);
      const id = data?.[0]?.id ?? (await createThread());
      navigate({ to: "/chat/$threadId", params: { threadId: id }, replace: true });
    })().catch((e) => toast.error(e.message));
  }, [session, navigate]);

  if (loading || session) {
    return <div className="min-h-screen bg-ruled" />;
  }

  return (
    <main className="min-h-screen bg-ruled grid lg:grid-cols-2">
      <section className="flex flex-col justify-center px-8 py-16 lg:px-20">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Ace logo" width={44} height={44} />
          <span className="font-display text-2xl font-bold">Ace</span>
        </div>
        <h1 className="mt-10 font-display text-5xl font-bold leading-[1.05] lg:text-6xl">
          Your homework, <span className="highlighter">done.</span>
        </h1>
        <p className="mt-6 max-w-md text-lg text-muted-foreground">
          Paste the task, upload the sheet, or share your screen. Ace writes it, solves it,
          researches it and builds the slides.
        </p>
        <ul className="mt-10 grid max-w-md grid-cols-2 gap-4">
          {FEATURES.map((f) => (
            <li key={f.label} className="flex items-center gap-3 text-sm">
              <f.icon className="size-5 text-primary" />
              {f.label}
            </li>
          ))}
        </ul>
      </section>
      <section className="flex items-center justify-center px-6 py-16">
        <AuthCard />
      </section>
    </main>
  );
}

function AuthCard() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) toast.success("Check your email to confirm your account.");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) toast.error(String(result.error.message ?? result.error));
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border bg-card p-8 shadow-glow">
      <h2 className="font-display text-2xl font-bold">
        {mode === "in" ? "Welcome back" : "Create your account"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Your chats are saved to your account.</p>
      <Button variant="outline" className="mt-6 w-full" onClick={google} type="button">
        Continue with Google
      </Button>
      <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
      </div>
      <form onSubmit={submit} className="space-y-3">
        <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input type="password" placeholder="Password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
        <Button type="submit" className="w-full" disabled={busy}>
          {mode === "in" ? "Sign in" : "Sign up"}
        </Button>
      </form>
      <button
        type="button"
        className="mt-4 text-sm text-muted-foreground hover:text-foreground"
        onClick={() => setMode(mode === "in" ? "up" : "in")}
      >
        {mode === "in" ? "No account? Sign up" : "Have an account? Sign in"}
      </button>
    </div>
  );
}
