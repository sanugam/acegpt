import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return { session, user: session?.user ?? null, loading };
}

export async function createThread() {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("threads")
    .insert({ user_id: u.user.id })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

// Keep public guest access disabled. A visible sign-in form supplies the session.
export async function ensureChatSession(): Promise<Session> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session)
    throw new Error(
      "Sign in to Ace to send this message. Your message is still here so you can retry after signing in.",
    );
  return data.session;
}

export function isGuestThread(threadId: string) {
  return threadId.startsWith("guest-");
}
