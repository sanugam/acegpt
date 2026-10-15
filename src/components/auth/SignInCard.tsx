import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SignInCard() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (!data.session) {
          setNotice(
            "Check your inbox and spam folder for the confirmation email. Open its confirmation link, then return here and sign in with your email and password.",
          );
          setMode("in");
        }
      }
      setPassword("");
    } catch (error) {
      setError((error as Error).message || "Could not sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Ace account"
      className="w-full rounded-2xl border bg-card p-5 text-left shadow-glow"
    >
      <h2 className="font-display text-xl font-bold">
        {mode === "in" ? "Sign in to Ace" : "Create your Ace account"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Sign in to send messages and save your chats. Guest access is turned off.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <label className="block text-sm">
          Email
          <Input
            className="mt-1"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={busy}
          />
        </label>
        <label className="block text-sm">
          Password
          <Input
            className="mt-1"
            type="password"
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            minLength={mode === "up" ? 8 : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={busy}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}
        </Button>
      </form>
      <button
        type="button"
        className="mt-3 text-sm underline"
        disabled={busy}
        onClick={() => {
          setMode(mode === "in" ? "up" : "in");
          setError("");
          setNotice("");
        }}
      >
        {mode === "in" ? "New to Ace? Create an account" : "Already have an account? Sign in"}
      </button>
    </section>
  );
}
