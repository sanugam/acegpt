import { SignInCard } from "@/components/auth/SignInCard";
import { useNavigate } from "@tanstack/react-router";
import { createThread, ensureChatSession, isGuestThread, useAuth } from "@/lib/auth";
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
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
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
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import type { Deck } from "@/lib/pptx";
import { PresentationCard } from "./PresentationCard";
import { AnswerDownloads } from "./AnswerDownloads";
import { IMAGES_PER_REPLY } from "@/lib/ai/image-context";
import { packImageRequest } from "@/lib/ai/image-request";
import { prepareAttachment } from "@/lib/chat-attachments";

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
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const savedThreadId = useRef<string | null>(isGuestThread(threadId) ? null : threadId);
  const [input, setInput] = useState("");
  const [preparing, setPreparing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: async (url, init) => {
          const response = await fetch(url, init);
          if (response.ok) return response;
          const text = await response.text();
          let message = text;
          try {
            message = JSON.parse(text).error ?? text;
          } catch {
            /* Plain-text server errors. */
          }
          if (response.status === 413)
            message = "This message is too large. Use fewer or smaller attachments.";
          throw new Error(message || "Ace couldn't send this message. Please retry.");
        },
        prepareSendMessagesRequest: async ({ messages, trigger, messageId }) => {
          const session = await ensureChatSession();
          savedThreadId.current ??= await createThread();
          return {
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: {
              threadId: savedThreadId.current,
              messages: await packImageRequest(messages),
              userMessage: messages.at(-1)?.role === "user" ? messages.at(-1) : undefined,
              trigger,
              messageId,
            },
          };
        },
      }),
    [threadId],
  );

  const { messages, sendMessage, regenerate, status, stop, error } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    onError: (e) => toast.error(e.message || "Something went wrong."),
    onFinish: ({ isError, isAbort }) => {
      if (!isError && !isAbort && savedThreadId.current && savedThreadId.current !== threadId) {
        navigate({
          to: "/chat/$threadId",
          params: { threadId: savedThreadId.current },
          replace: true,
        });
      }
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["messages", threadId] });
      textareaRef.current?.focus();
    },
  });
  const busy = preparing || status === "submitted" || status === "streaming";

  // Screen share
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  async function startShare() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast.error(
        "Screen sharing is available in supported desktop browsers. You can attach a screenshot instead.",
      );
      return;
    }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      s.getVideoTracks()[0]?.addEventListener("ended", () => setStream(null));
      setStream(s);
      toast.success("Screen shared. A screenshot is sent when you send a message.");
    } catch (error) {
      if ((error as Error).name !== "AbortError")
        toast.error(
          "Screen sharing didn't start. Choose a screen or tab and allow sharing, or attach a screenshot.",
        );
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
    const context = c.getContext("2d");
    if (!context) return null;
    context.drawImage(v, 0, 0, c.width, c.height);
    return {
      type: "file",
      mediaType: "image/jpeg",
      filename: "screen.jpg",
      url: c.toDataURL("image/jpeg", 0.8),
    };
  }

  function screenParts(): FileUIPart[] {
    const now = captureFrame();
    if (!now) throw new Error("Your shared screen is still loading. Wait a moment and try again.");
    return [{ ...now, filename: "screen-now.jpg" }];
  }

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  async function submit(msg: PromptInputMessage) {
    if (busy || !session) return;
    const text = msg.text.trim();
    const files = [...msg.files];
    try {
      if (stream) files.push(...screenParts());
      if (!text && files.length === 0) return;
      if (files.filter((file) => file.mediaType.startsWith("image/")).length > IMAGES_PER_REPLY)
        throw new Error(
          "Use up to three pictures per message (including the shared screen). Send more pictures in your next message.",
        );
      setPreparing(true);
      const attachments = await Promise.all(files.map(prepareAttachment));
      setInput("");
      setPreparing(false);
      await sendMessage({
        text: text || "Read the attached files and help me with them.",
        files: attachments,
      });
      textareaRef.current?.focus();
    } catch (error) {
      toast.error((error as Error).message);
      throw error;
    } finally {
      setPreparing(false);
    }
  }

  function doMyScreen() {
    if (!stream || busy || !session) return;
    void submit({
      text: "Look at my screen (the last image is what it shows right now) and complete the task fully. Lay out the finished answers so I can drop them straight in.",
      files: [],
    }).catch(() => {});
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
                    disabled={!session || busy}
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
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="h-20 w-36 rounded-md bg-background object-cover"
            />
            <p className="flex-1 text-sm">
              <span className="flex items-center gap-1.5 font-semibold text-primary">
                <span className="size-2 animate-pulse rounded-full bg-primary" />
                Screen sharing is on
              </span>
              <span className="text-muted-foreground">A screenshot is sent with each message.</span>
            </p>
            <button
              type="button"
              onClick={doMyScreen}
              disabled={busy}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              Do what's on my screen
            </button>
          </div>
        )}
        {!stream && <video ref={videoRef} className="hidden" />}
        {!session && !authLoading && (
          <div className="mb-3">
            <SignInCard />
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="mb-3 rounded-xl border border-destructive/40 bg-card p-3 text-sm"
          >
            <p>{error.message || "Ace couldn't send this message. Please try again."}</p>
            <button
              type="button"
              onClick={() => regenerate()}
              className="mt-2 font-semibold underline"
            >
              Retry message
            </button>
          </div>
        )}
        <PromptInput
          onSubmit={submit}
          multiple
          globalDrop
          maxFiles={6}
          maxFileSize={5_000_000}
          onError={(error) => toast.error(error.message)}
          className="rounded-2xl bg-card shadow-glow"
        >
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
                <span className="hidden sm:inline">{stream ? "Stop sharing" : "Screen"}</span>
              </PromptInputButton>
            </PromptInputTools>
            <ChatSubmit
              status={status}
              onStop={stop}
              disabled={!session || preparing}
              hasContent={Boolean(input.trim() || stream)}
            />
          </PromptInputFooter>
        </PromptInput>
        <p className="mt-2 text-xs text-muted-foreground">
          Up to 3 pictures per message. Each reply sees the latest 3 pictures; older pictures stay
          in your chat. Files up to 5 MB.
        </p>
      </div>
    </main>
  );
}

function ChatSubmit({
  hasContent,
  disabled,
  ...props
}: React.ComponentProps<typeof PromptInputSubmit> & { hasContent: boolean }) {
  const attachments = usePromptInputAttachments();
  const generating = props.status === "submitted" || props.status === "streaming";
  return (
    <PromptInputSubmit
      {...props}
      disabled={disabled || (!generating && !hasContent && !attachments.files.length)}
    />
  );
}

function AttachButton() {
  const a = usePromptInputAttachments();
  return (
    <PromptInputButton
      tooltip="Attach pictures, PDF, Word (.docx), text, CSV, or code (up to 5 MB)"
      aria-label="Attach files"
      onClick={() => a.openFileDialog()}
    >
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
        <span
          key={f.id}
          className="flex items-center gap-2 rounded-md bg-secondary px-2 py-1 text-xs"
        >
          {f.filename ?? "file"}
          <button
            type="button"
            aria-label="Remove"
            onClick={() => a.remove(f.id)}
            className="text-muted-foreground hover:text-foreground"
          >
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
                <p key={key} className="whitespace-pre-wrap">
                  {part.text}
                </p>
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
                <img
                  key={key}
                  src={part.url}
                  alt={part.filename ?? "attachment"}
                  className="max-h-48 rounded-lg border"
                />
              ) : (
                <span key={key} className="text-xs opacity-80">
                  📎 {part.filename ?? "file"}
                </span>
              );
            case "tool-create_presentation":
              return (
                <PresentationCard
                  key={key}
                  deck={(part.input ?? {}) as Partial<Deck>}
                  ready={part.state === "output-available"}
                  error={part.state === "output-error" ? part.errorText : undefined}
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
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Globe className="size-3" /> {s.title || new URL(s.url).hostname}
                </a>
              ) : null,
            )}
          </div>
        )}
        {message.role === "assistant" && !streaming && text && (
          <MessageActions className="mt-1">
            <MessageAction onClick={copy} tooltip="Copy reply">
              {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
            </MessageAction>
            <AnswerDownloads text={text} />
            {canRegenerate && (
              <MessageAction onClick={onRegenerate} tooltip="Regenerate reply">
                <RotateCcw className="size-3.5" />
              </MessageAction>
            )}
          </MessageActions>
        )}
      </MessageContent>
    </Message>
  );
}
