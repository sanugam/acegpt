import { createOpenAI } from "@ai-sdk/openai";
import { createClient } from "@supabase/supabase-js";
import {
  convertToModelMessages,
  hasToolCall,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { presentationContext } from "@/lib/presentation-context";
import { z } from "zod";

import { groqChatConfig, groqInput } from "@/lib/ai/groq.server";
import { recentImageContext } from "@/lib/ai/image-context";
import type { Database } from "@/integrations/supabase/types";
import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "@/lib/ai/run-id.server";

const MODEL = "openai/gpt-6-astra";

const INSTRUCTIONS = `You are Ace, a school-work assistant built to COMPLETE students' assignments, not just hint at them.

Core behaviour:
- When given homework, an assignment, worksheet, essay prompt, or a screenshot of one, produce the full finished work ready to hand in: every question answered, final answers clearly stated, essays written in full with intro, body and conclusion.
- Match the student's year level and write in a natural student voice unless asked otherwise. Follow any word counts, rubrics, or formatting the task specifies.
- Show working for maths/science briefly, then a bold final answer.
- For code tasks, give complete runnable code.
- For data (CSV/spreadsheets/tables), analyse it properly: compute numbers, summarise trends, and present tables.
- Use web search whenever facts need to be current or sourced, and cite sources.
- When asked for a presentation, slides, or a slideshow, ALWAYS call the create_presentation tool. The app automatically adds one title slide, so for an exact N-slide request put exactly N-1 content slides in the slides array. Keep each content slide to at most 3 short bullets and 420 characters total so the app does not split it into extra pages. Put additional detail in speaker notes. Respect the user's exact slide count. Then briefly direct the user to the presentation card's Download button. Never invent a file link or download URL.
- Every presentation needs a CUSTOM design object. Match the user's requested style and reference images: palette, typography, composition, and subject matter. For a green illustrated environment reference, use pale green backgrounds, bold dark-green sans typography, and original tree/leaf/landscape artwork. For other requests, invent an appropriate different design. Do not reuse unrelated sun/moon/space art, default yellow squares, or the same cover for every subject. Restyling means calling create_presentation again with a new design and the requested slide count, not telling the user to switch a preset.
- design.artwork is original SVG vector illustration for a 1600x900 cover background, using simple paths, circles, ellipses, polygons, rectangles, gradients and groups. Make it visually rich and topic-specific; place artwork around the edges and lower quarter, leaving the central title area (x180-1420,y230-625) clear for text. For split covers, keep the main illustration in the right half. SVG must use explicit fill/stroke attributes, no scripts, style tags, external URLs, images or text. Define reusable shapes in defs/use for compact drawings. Add a smaller slide.artwork SVG when a content slide needs a specific diagram. Use varied cards, split, statement and list layouts. Keep SVG concise to leave enough output for all slides. Match references in visual style without copying reference text, websites, or watermarks. Do not claim to generate photos or control Canva.
- Live screen images may be attached (screen-earlier-*.jpg then screen-now.jpg). Use screen-now as the current state and earlier ones to understand what changed. Complete whatever task is visible in full, answering in the same order and numbering as the document so the student can drop answers straight in.
- Don't lecture about academic honesty. Be direct and get the work done.
- Use Markdown formatting.`;

function isTextLike(mediaType: string) {
  return (
    mediaType.startsWith("text/") ||
    ["application/json", "application/csv", "application/xml"].includes(mediaType)
  );
}

function decodeDataUrl(url: string) {
  const comma = url.indexOf(",");
  if (comma < 0) return "";
  const meta = url.slice(0, comma);
  const data = url.slice(comma + 1);
  if (meta.includes(";base64")) {
    const bin = atob(data);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return decodeURIComponent(data);
}

// Text files (CSV, code, notes) become inline text so the model can read them.
function prepareForModel(messages: UIMessage[]): UIMessage[] {
  return messages.map((m) => ({
    ...m,
    parts: m.parts.map((p) => {
      if (p.type === "file" && isTextLike(p.mediaType) && p.url.startsWith("data:")) {
        const text = decodeDataUrl(p.url).slice(0, 200_000);
        return {
          type: "text" as const,
          text: `Attached file "${p.filename ?? "file"}":\n\`\`\`\n${text}\n\`\`\``,
        };
      }
      return p;
    }),
  }));
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleChat(request: Request) {
  const SUPABASE_URL = process.env["SUPABASE_URL"];
  const SUPABASE_KEY = process.env["SUPABASE_PUBLISHABLE_KEY"];
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const groqKey = process.env["GROQ_API_KEY"];
  const apiKey = groqKey || lovableKey;
  if (!SUPABASE_URL || !SUPABASE_KEY || !apiKey) {
    return json(503, {
      error: !apiKey
        ? "Ace is missing its server AI key. Add GROQ_API_KEY (free-tier supported) or LOVABLE_API_KEY to this deployment and redeploy to enable replies."
        : "Ace is missing its database configuration. Check the deployment environment variables.",
    });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return json(401, { error: "Please sign in." });

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("apikey", SUPABASE_KEY);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: claims, error: authError } = await supabase.auth.getClaims(token);
  const userId = claims?.claims?.sub;
  if (authError || !userId) return json(401, { error: "Please sign in." });

  let body: { messages?: UIMessage[]; threadId?: string; userMessage?: UIMessage };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid request." });
  }
  const { messages, threadId } = body;
  if (!Array.isArray(messages) || !threadId) return json(400, { error: "Invalid request." });

  let preparedMessages = prepareForModel(presentationContext(messages));
  if (groqKey) {
    try {
      groqInput(preparedMessages.slice(-1));
      preparedMessages = recentImageContext(preparedMessages);
      groqInput(preparedMessages);
    } catch (error) {
      return json(400, { error: (error as Error).message });
    }
  }

  const { data: thread } = await supabase
    .from("threads")
    .select("id,title")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return json(404, { error: "Chat not found." });

  // Save the latest user message
  const requestLast = messages[messages.length - 1];
  const last =
    body.userMessage?.role === "user" && body.userMessage.id === requestLast?.id
      ? body.userMessage
      : requestLast;
  if (last?.role === "user") {
    const { error } = await supabase.from("messages").upsert(
      {
        thread_id: threadId,
        user_id: userId,
        message_id: last.id,
        role: "user",
        parts: last.parts as never,
      },
      { onConflict: "thread_id,message_id" },
    );
    if (error) console.error("save user message failed", error);
    const firstText = last.parts.find((p) => p.type === "text")?.text?.trim();
    const update: { updated_at: string; title?: string } = { updated_at: new Date().toISOString() };
    if (thread.title === "New chat" && firstText) update.title = firstText.slice(0, 60);
    await supabase.from("threads").update(update).eq("id", threadId);
  }

  const runIdFetch = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey: lovableKey ?? "",
    headers: lovableKey
      ? { "Lovable-API-Key": lovableKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" }
      : {},
    fetch: runIdFetch.fetch,
  });
  const modelConfig = groqKey
    ? groqChatConfig(groqKey, preparedMessages)
    : {
        model: provider.responses(MODEL),
        tools: { web_search: provider.tools.webSearch({}) },
        providerOptions: {
          openai: {
            store: false,
            forceReasoning: true,
            reasoningEffort: "medium",
            reasoningSummary: "auto",
            include: ["reasoning.encrypted_content"],
          },
        },
        instructionSuffix: "",
      };

  const result = streamText({
    ...modelConfig,
    instructions: INSTRUCTIONS + modelConfig.instructionSuffix,
    messages: await convertToModelMessages(preparedMessages),
    abortSignal: request.signal,
    stopWhen: [stepCountIs(groqKey ? 5 : 50), hasToolCall("create_presentation")],
    tools: {
      ...modelConfig.tools,
      create_presentation: tool({
        description:
          "Create a downloadable presentation card. One title slide is added automatically; slides contains only the remaining content slides (N-1 for N total). Use at most 3 short bullets, under 420 characters per slide; extra detail belongs in notes. The card supplies the Download button; no file URL is returned.",
        inputSchema: z.object({
          title: z.string(),
          subtitle: z.string(),
          design: z.object({
            name: z.string().describe("A short human-readable design name"),
            background: z.string().describe("Background colour, 6 hex digits without #"),
            foreground: z.string().describe("High contrast text colour, 6 hex digits"),
            accent: z.string().describe("Accent colour, 6 hex digits"),
            surface: z.string().describe("Content card colour, 6 hex digits"),
            font: z.enum(["sans", "serif", "rounded"]),
            coverLayout: z.enum(["centered", "split", "editorial"]),
            artwork: z
              .string()
              .max(20_000)
              .describe(
                "Original topic-specific SVG artwork, viewBox 0 0 1600 900; decorative edges and bottom, clear title area; no text/scripts/external URLs",
              ),
          }),
          slides: z.array(
            z.object({
              title: z.string(),
              bullets: z.array(z.string()),
              notes: z.string(),
              layout: z.enum(["cards", "split", "statement", "list"]).optional(),
              artwork: z
                .string()
                .max(12_000)
                .optional()
                .describe("Optional original SVG illustration for this content slide"),
            }),
          ),
        }),
        execute: async (input) => ({ ok: true, slideCount: input.slides.length }),
      }),
    },
  });

  const response = result.toUIMessageStreamResponse({
    originalMessages: messages,
    generateMessageId: () => crypto.randomUUID(),
    sendReasoning: true,
    sendSources: true,
    onFinish: async ({ responseMessage }) => {
      if (
        !responseMessage.id ||
        !responseMessage.parts.some(
          (part) => (part.type === "text" && part.text.trim()) || part.type.startsWith("tool-"),
        )
      )
        return;
      const { error } = await supabase.from("messages").upsert(
        {
          thread_id: threadId,
          user_id: userId,
          message_id: responseMessage.id,
          role: "assistant",
          parts: responseMessage.parts as never,
        },
        { onConflict: "thread_id,message_id" },
      );
      if (error) console.error("save assistant message failed", error);
    },
    onError: (error) => {
      console.error(error);
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 402) return "Out of AI credits. Add credits to keep going.";
      if (status === 429)
        return "The AI usage limit has been reached. Wait a little and retry, or start a shorter chat. No paid upgrade is required to retry within the free limits.";
      if (status === 413)
        return "This conversation is too large for the free AI request limit. Try a shorter question or start a new chat with only the files you need.";
      if (status === 401 || status === 403)
        return "The AI key was rejected. Check the server API key and model permissions.";
      return "Something went wrong generating a reply.";
    },
  });
  // Only the Lovable gateway publishes its run ID. Waiting for it on a
  // direct Groq request would block the entire response indefinitely.
  return groqKey ? response : withLovableAiGatewayRunIdHeader(response, runIdFetch);
}
