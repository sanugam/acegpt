import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Globe, MonitorUp, MonitorX, Paperclip, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import logo from "@/assets/ace-logo.png";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { supabase } from "@/integrations/supabase/client";
import type { Deck } from "@/lib/pptx";
import { PresentationCard } from "./PresentationCard";

const STARTERS = [
  "Write a 600-word persuasive essay on whether homework should be banned (Year 9).",
  "Make a 8-slide presentation on the causes of World War I for my history class.",
  "Solve: 2x² − 7x + 3 = 0 and show working.",
  "Research the latest discoveries from the James Webb telescope and summarise them.",
];

export function ChatWindow({
  threadId,
  initialMessages,
}: {
  threadId: string;
  initialMessages: UIMessage[];
}) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { threadId },
        headers: async (): Promise<Record<string, string>> => {
          const { data } = await supabase.auth.getSession();
          return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
        },
      }),
    [threadId],
  );

  const { messages, sendMessage, regenerate, status, stop } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    onError: (e) => toast.error(e.message || "Something went wrong."),
    onFinish: () => {
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["messages", threadId] });
      textareaRef.current?.focus();
    },
  });
  const busy = status === "submitted" || status === "streaming";

  // Screen share
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  async function startShare() {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      s.getVideoTracks()[0]?.addEventListener("ended", () => setStream(null));
      setStream(s);
      toast.success("Screen shared. Ace will see your screen with every message.");
    } catch {
      /* user cancelled */
    }
  }
  function stopShare() {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  }
  function captureFrame(): FileUIPart | null {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const scale = Math.min(1, 1600 / v.videoWidth);
    const c = document.createElement("canvas");
    c.width = v.videoWidth * scale;
    c.height = v.videoHeight * scale;
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return { type: "file", mediaType: "image/jpeg", filename: "screen.jpg", url: c.toDataURL("image/jpeg", 0.8) };
  }

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function submit(msg: PromptInputMessage) {
    const text = msg.text.trim();
    const files = [...msg.files];
    const frame = stream ? captureFrame() : null;
    if (frame) files.push(frame);
    if (!text && files.length === 0) return;
    sendMessage({ text: text || "Complete the task shown.", files });
    setInput("");
    textareaRef.current?.focus();
  }

  const empty = messages.length === 0;

  return (
    <main className="relative flex min-w-0 flex-1 flex-col bg-ruled">
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl px-4 py-8">
          {empty && (
            <div className="flex flex-col items-center pt-16 text-center">
              <img src={logo} alt="Ace" width={72} height={72} />
              <h1 className="mt-6 font-display text-4xl font-bold">
                What are we <span className="highlighter">finishing</span> today?
              </h1>
              <p className="mt-3 text-muted-foreground">
                Paste a task, attach a file, or share your screen.
              </p>
              <div className="mt-8 grid w-full gap-3 sm:grid-cols-2">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => sendMessage({ text: s })}
                    className="rounded-xl border bg-card/70 p-4 text-left text-sm transition hover:border-primary/60 hover:bg-card"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, idx) => (
            <ChatMessage
              key={m.id}
              message={m}
              streaming={busy && m.id === messages.at(-1)?.id}
              canRegenerate={!busy && m.role === "assistant" && idx === messages.length - 1}
              onRegenerate={() => regenerate()}
            />
          ))}

          {status === "submitted" && (
            <Message from="assistant">
              <MessageContent>
                <Shimmer>Thinking…</Shimmer>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="mx-auto w-full max-w-3xl px-4 pb-5">
        {stream && (
          <div className="mb-2 flex items-center gap-3 rounded-xl border border-primary/40 bg-card p-2">
            <video ref={videoRef} autoPlay muted playsInline className="h-16 w-28 rounded-md bg-background object-cover" />
            <p className="flex-1 text-sm">
              <span className="font-semibold text-primary">Sharing your screen.</span>{" "}
              <span className="text-muted-foreground">A snapshot goes with each message.</span>
            </p>
          </div>
        )}
        {!stream && <video ref={videoRef} className="hidden" />}
        <PromptInput onSubmit={submit} multiple globalDrop className="rounded-2xl bg-card shadow-glow">
          <AttachmentChips />
          <PromptInputTextarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste your assignment, or ask anything…"
          />
          <PromptInputFooter>
            <PromptInputTools>
              <AttachButton />
              <PromptInputButton
                tooltip={stream ? "Stop sharing" : "Share your screen"}
                onClick={stream ? stopShare : startShare}
              >
                {stream ? <MonitorX className="size-4" /> : <MonitorUp className="size-4" />}
                <span className="hidden sm:inline">{stream ? "Stop" : "Screen"}</span>
              </PromptInputButton>
            </PromptInputTools>
            <PromptInputSubmit status={status} onStop={stop} disabled={!busy && !input.trim() && !stream} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </main>
  );
}

function AttachButton() {
  const a = usePromptInputAttachments();
  return (
    <PromptInputButton tooltip="Attach files (images, PDFs, CSV, docs)" onClick={() => a.openFileDialog()}>
      <Paperclip className="size-4" />
    </PromptInputButton>
  );
}

function AttachmentChips() {
  const a = usePromptInputAttachments();
  if (a.files.length === 0) return null;
  return (
    <div className="flex w-full flex-wrap gap-2 px-3 pt-3">
      {a.files.map((f) => (
        <span key={f.id} className="flex items-center gap-2 rounded-md bg-secondary px-2 py-1 text-xs">
          {f.filename ?? "file"}
          <button type="button" aria-label="Remove" onClick={() => a.remove(f.id)} className="text-muted-foreground hover:text-foreground">
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

function ChatMessage({
  message,
  streaming,
  canRegenerate,
  onRegenerate,
}: {
  message: UIMessage;
  streaming: boolean;
  canRegenerate?: boolean;
  onRegenerate?: () => void;
}) {
  const sources = message.parts.filter((p) => p.type === "source-url");
  const [copied, setCopied] = useState(false);
  const text = message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, i) => {
          const key = `${message.id}-${i}`;
          switch (part.type) {
            case "text":
              return message.role === "user" ? (
                <p key={key} className="whitespace-pre-wrap">{part.text}</p>
              ) : (
                <MessageResponse key={key}>{part.text}</MessageResponse>
              );
            case "reasoning":
              if (!part.text) return null;
              return (
                <Reasoning key={key} isStreaming={streaming && i === message.parts.length - 1}>
                  <ReasoningTrigger />
                  <ReasoningContent>{part.text}</ReasoningContent>
                </Reasoning>
              );
            case "file":
              return part.mediaType.startsWith("image/") ? (
                <img key={key} src={part.url} alt={part.filename ?? "attachment"} className="max-h-48 rounded-lg border" />
              ) : (
                <span key={key} className="text-xs opacity-80">📎 {part.filename ?? "file"}</span>
              );
            case "tool-create_presentation":
              return (
                <PresentationCard
                  key={key}
                  deck={(part.input ?? {}) as Partial<Deck>}
                  ready={part.state === "output-available" || part.state === "input-available"}
                />
              );
            default:
              if (part.type.startsWith("tool-")) {
                const tp = part as Extract<UIMessage["parts"][number], { type: `tool-${string}` }>;
                return (
                  <Tool key={key} defaultOpen={false}>
                    <ToolHeader
                      type={tp.type}
                      state={tp.state}
                      {...(tp.type === "tool-web_search" ? { title: "Web search" } : {})}
                    />
                    <ToolContent>
                      <ToolInput input={tp.input} />
                      <ToolOutput output={tp.output} errorText={tp.errorText} />
                    </ToolContent>
                  </Tool>
                );
              }
              return null;
          }
        })}
        {sources.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {sources.map((s, i) =>
              s.type === "source-url" ? (
                <a key={i} href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">
                  <Globe className="size-3" /> {s.title || new URL(s.url).hostname}
                </a>
              ) : null,
            )}
          </div>
        )}
      </MessageContent>
    </Message>
  );
}
