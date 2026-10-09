import { createOpenAI } from "@ai-sdk/openai";
import { createClient } from "@supabase/supabase-js";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";

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
- When asked for a presentation, slides, or a slideshow, ALWAYS call the create_presentation tool with complete slide content (usually 6-12 slides), concise bullets, and speaker notes. Then briefly tell the user they can download it.
- Screenshots of the user's screen may be attached: read them carefully and complete whatever task is visible.
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
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY || !apiKey) {
    return json(500, { error: "Server is not configured." });
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

  let body: { messages?: UIMessage[]; threadId?: string };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid request." });
  }
  const { messages, threadId } = body;
  if (!Array.isArray(messages) || !threadId) return json(400, { error: "Invalid request." });

  const { data: thread } = await supabase
    .from("threads")
    .select("id,title")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return json(404, { error: "Chat not found." });

  // Save the latest user message
  const last = messages[messages.length - 1];
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
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });

  const result = streamText({
    model: provider.responses(MODEL),
    instructions: INSTRUCTIONS,
    messages: await convertToModelMessages(prepareForModel(messages)),
    abortSignal: request.signal,
    stopWhen: stepCountIs(50),
    tools: {
      web_search: provider.tools.webSearch({}),
      create_presentation: tool({
        description:
          "Create a downloadable slide presentation (PowerPoint). Provide full content for every slide.",
        inputSchema: z.object({
          title: z.string(),
          subtitle: z.string(),
          slides: z.array(
            z.object({
              title: z.string(),
              bullets: z.array(z.string()),
              notes: z.string(),
            }),
          ),
        }),
        execute: async (input) => ({ ok: true, slideCount: input.slides.length }),
      }),
    },
    providerOptions: {
      openai: {
        store: false,
        forceReasoning: true,
        reasoningEffort: "medium",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
  });

  const response = result.toUIMessageStreamResponse({
    originalMessages: messages,
    sendReasoning: true,
    sendSources: true,
    onFinish: async ({ responseMessage }) => {
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
      if (status === 429) return "Too many requests right now. Try again in a moment.";
      return "Something went wrong generating a reply.";
    },
  });
  return withLovableAiGatewayRunIdHeader(response, runIdFetch);
}
