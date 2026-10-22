import { useEffect, useRef, useState } from "react";
import { MonitorCog, Square, X } from "lucide-react";
import { ensureChatSession } from "@/lib/auth";
import { companionURL, type ComputerAction } from "@/lib/computer-actions";

type Observation = {
  id: string;
  width: number;
  height: number;
  app: string;
  text: string;
  elements: { id: number; label: string }[];
  image?: string;
};
function pause(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Stopped", "AbortError"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Stopped", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function ComputerPanel() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [connected, setConnected] = useState(false);
  const [task, setTask] = useState("");
  const [running, setRunning] = useState(false);
  const [visual, setVisual] = useState(false);
  const [status, setStatus] = useState("");
  const [activity, setActivity] = useState<string[]>([]);
  const [preview, setPreview] = useState<string>();
  const controller = useRef<AbortController | undefined>(undefined);
  const pairing = useRef("");

  async function local(path: string, body = {}, signal?: AbortSignal) {
    const response = await fetch(`${companionURL}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pairing.current}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ?? null,
      credentials: "omit",
      cache: "no-store",
      ...({ targetAddressSpace: "loopback" } as object),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "The companion could not complete that step.");
    return result;
  }
  async function disconnect() {
    controller.current?.abort();
    setRunning(false);
    setConnected(false);
    setPreview(undefined);
    if (pairing.current) {
      try {
        await local("/stop");
      } catch {
        /* It may already be stopped. */
      }
    }
    pairing.current = "";
    setCode("");
    setStatus("Stopped. Start a new session in the Mac companion to reconnect.");
  }
  useEffect(() => {
    const revoke = () => {
      controller.current?.abort();
      if (pairing.current)
        void fetch(`${companionURL}/stop`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${pairing.current}`,
            "Content-Type": "application/json",
          },
          body: "{}",
          keepalive: true,
        }).catch(() => {});
      pairing.current = "";
    };
    window.addEventListener("pagehide", revoke);
    return () => {
      window.removeEventListener("pagehide", revoke);
      revoke();
    };
  }, []);
  async function connect() {
    pairing.current = code.trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(pairing.current)) {
      setStatus("Paste the pairing code shown by the Mac companion after starting a session.");
      return;
    }
    try {
      const result = await local("/status", {}, AbortSignal.timeout(8000));
      if (!result.accessibility || !result.recording)
        throw new Error("Allow Accessibility and Screen Recording in the Mac companion first.");
      setConnected(true);
      setCode("");
      setStatus("Connected for this session. Describe a task, then start.");
    } catch (error) {
      pairing.current = "";
      setStatus(
        error instanceof TypeError
          ? "Could not reach the companion. Open it, start a session, and allow Chrome's local-network prompt if shown. Use Chrome on the same Mac."
          : (error as Error).message,
      );
    }
  }
  async function run() {
    if (!connected || !task.trim() || running) return;
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setActivity([]);
    const history: string[] = [];
    let failedActions = 0;
    try {
      const session = await ensureChatSession();
      for (let step = 0; step < 12; step++) {
        setStatus(`Looking at the active app — step ${step + 1} of 12…`);
        const observation: Observation = await local("/observe", {}, abort.signal);
        setPreview(observation.image);
        const sendImage = visual || observation.text.length < 80;
        setStatus("Choosing the next step…");
        const response = await fetch("/api/computer", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          signal: abort.signal,
          body: JSON.stringify({
            task,
            observation: {
              ...observation,
              text: observation.text.slice(0, 6500),
              image: sendImage ? observation.image : undefined,
            },
            history,
          }),
        });
        const result = await response.json();
        if (response.status === 429) {
          setStatus("Pausing for the free AI allowance. You can stop at any time…");
          await pause(30000, abort.signal);
          step--;
          continue;
        }
        if (!response.ok) throw new Error(result.error || "The AI could not choose a next step.");
        const action = result.action as ComputerAction;
        if (action.kind === "done") {
          setStatus(`Finished: ${action.reason}`);
          return;
        }
        if (action.kind === "ask_user" || result.review) {
          setStatus(
            `Paused for you: ${action.reason}. Complete that step yourself, then start again.`,
          );
          return;
        }
        // No action can execute after Stop, even if a plan arrived concurrently.
        abort.signal.throwIfAborted();
        setStatus(action.reason);
        let executed;
        try {
          executed = await local(
            "/execute",
            { observationId: observation.id, action },
            abort.signal,
          );
          failedActions = 0;
        } catch (error) {
          const message = (error as Error).message;
          if (
            abort.signal.aborted ||
            ++failedActions >= 3 ||
            /take over|paused|stopped|permission|pairing|expired|partially/i.test(message)
          )
            throw error;
          history.push(
            `${step + 1}. Failed ${action.kind}: ${message}. Observe again and choose another approach.`.slice(
              0,
              600,
            ),
          );
          setActivity([...history]);
          setStatus("That step did not work. Checking the screen again…");
          await pause(1500, abort.signal);
          continue;
        }
        history.push(
          `${step + 1}. ${action.kind}: ${action.reason}. Result: ${executed.message}`.slice(
            0,
            600,
          ),
        );
        setActivity([...history]);
        setStatus("Step completed. Waiting briefly within the free AI allowance…");
        await pause(sendImage ? 35000 : 18000, abort.signal);
      }
      setStatus("Paused after 12 steps. Review the result, then start again if needed.");
    } catch (error) {
      if (!abort.signal.aborted)
        setStatus((error as Error).message || "The task paused. Nothing further will run.");
    } finally {
      setRunning(false);
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-secondary"
        aria-label="Computer mode"
      >
        <MonitorCog className="size-4" />
        <span className="hidden sm:inline">Computer</span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="computer-title"
        >
          <section className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 id="computer-title" className="font-display text-2xl font-bold">
                Work on my Mac
              </h2>
              <button
                type="button"
                aria-label="Close computer mode"
                onClick={() => {
                  void disconnect();
                  setOpen(false);
                }}
              >
                <X className="size-5" />
              </button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Ace can work in supported Mac apps while you supervise. Screen sharing by itself only
              lets Ace see pictures.
            </p>
            {!connected ? (
              <div className="mt-4 space-y-3">
                <a
                  href="/downloads/ACEGPT-Companion-Mac.zip"
                  download
                  className="inline-block rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground"
                >
                  Download Mac companion
                </a>
                <p className="text-sm">
                  For Apple Silicon Macs with macOS 14 or newer. Open the companion, allow
                  Accessibility and Screen Recording, then start a ten-minute session.
                </p>
                <p className="text-sm text-muted-foreground">
                  The companion can read the visible screen and control supported apps. Visible
                  text—and screenshots when needed—are sent to ACEGPT's AI provider, Groq. Pairing
                  codes stay on your Mac and are never sent to the AI. Close private windows first.
                </p>
                <label className="block text-sm">
                  Pairing code
                  <input
                    aria-label="Companion pairing code"
                    type="password"
                    autoComplete="off"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    className="mt-1 w-full rounded-lg border bg-secondary p-2"
                  />
                </label>
                <button type="button" onClick={connect} className="rounded-lg border px-3 py-2">
                  Connect this Mac
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block text-sm">
                  What should Ace do?
                  <textarea
                    value={task}
                    onChange={(event) => setTask(event.target.value)}
                    disabled={running}
                    maxLength={3000}
                    placeholder="Open TextEdit and draft a five-item study checklist."
                    className="mt-1 min-h-24 w-full rounded-lg border bg-secondary p-2"
                  />
                </label>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={visual}
                    disabled={running}
                    onChange={(event) => setVisual(event.target.checked)}
                  />
                  Use screenshots as well as visible app controls for planning
                </label>
                <p className="text-xs text-muted-foreground">
                  Supported: TextEdit, Pages, Keynote, Numbers, Calculator, Preview, Chrome, Safari
                  and Firefox. Tasks pause for passwords, payments, sending, publishing and
                  permission changes. Free AI limits can add pauses between steps.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={running || !task.trim()}
                    onClick={run}
                    className="rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Start task
                  </button>
                  <button
                    type="button"
                    onClick={() => void disconnect()}
                    className="flex items-center gap-1 rounded-lg border border-destructive px-3 py-2"
                  >
                    <Square className="size-4" />
                    Stop and disconnect
                  </button>
                </div>
                {preview && (
                  <img
                    src={preview}
                    alt="Latest screen observed by the Mac companion"
                    className="max-h-48 w-full rounded-lg border object-contain"
                  />
                )}
              </div>
            )}
            {status && (
              <p role="status" className="mt-4 rounded-lg border p-3 text-sm">
                {status}
              </p>
            )}
            {activity.length > 0 && (
              <ol className="mt-3 space-y-1 text-xs text-muted-foreground">
                {activity.map((entry, index) => (
                  <li key={index}>{entry}</li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </>
  );
}
