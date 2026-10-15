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

// Guest identities still use Supabase tokens and the existing per-user policies.
// Never remove server authorization just to hide the sign-in screen.
let guestSession: Promise<Session> | undefined;
export async function ensureChatSession(): Promise<Session> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session) return data.session;
  if (!guestSession) {
    guestSession = (async () => {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error || !data.session) {
        throw new Error(
          "Guest chat isn't enabled on this deployment yet. Enable anonymous sign-ins in the app's backend to send messages without a login screen.",
        );
      }
      return data.session;
    })().finally(() => {
      guestSession = undefined;
    });
  }
  return guestSession;
}

export function isGuestThread(threadId: string) {
  return threadId.startsWith("guest-");
}
