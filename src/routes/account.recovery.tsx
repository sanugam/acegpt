import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/account/recovery")({
  ssr: false,
  component: PasswordRecovery,
});

export function PasswordRecovery() {
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const recoveryLink =
      new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (mounted && event === "PASSWORD_RECOVERY" && session) {
        setReady(true);
        setChecking(false);
      }
    });
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (recoveryLink && data.session && !error) setReady(true);
        setChecking(false);
      })
      .catch(() => {
        if (mounted) setChecking(false);
      });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!ready) return;
    if (password !== confirmation) {
      setError("The passwords don't match. Please enter the same new password twice.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword("");
      setConfirmation("");
      setDone(true);
    } catch (error) {
      setError(
        (error as Error).message ||
          "Could not update your password. Request a new reset link and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ruled p-6">
      <section className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-glow">
        <h1 className="font-display text-2xl font-bold">
          {done ? "Your Ace password is ready" : "Choose your Ace password"}
        </h1>
        {checking ? (
          <p className="mt-4">Checking your reset link…</p>
        ) : done ? (
          <>
            <p className="mt-3 text-muted-foreground">
              Your password has been updated. You can now open your chat.
            </p>
            <Link
              to="/chat/$threadId"
              params={{ threadId: "new" }}
              className="mt-5 inline-block rounded-lg bg-primary px-4 py-2 text-primary-foreground"
            >
              Open chat
            </Link>
          </>
        ) : ready ? (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <label className="block text-sm">
              New Ace password
              <Input
                className="mt-1"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="block text-sm">
              Confirm new Ace password
              <Input
                className="mt-1"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={busy}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button className="w-full" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save new password"}
            </Button>
          </form>
        ) : (
          <>
            <p role="alert" className="mt-4 text-muted-foreground">
              Open the latest password-reset link from your email to use this page. The link may
              have expired or already been used.
            </p>
            <Link to="/" className="mt-4 inline-block underline">
              Return to sign in and request a new link
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
