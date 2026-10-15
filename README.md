# Acegpt

Can you make a chatgpt 'clone' Ai which makes generitive respones write, code, analyze data, browse the live web, and automate complex work projects, and also make presentations for school made specifically for compleating school work fully, make it able to accese a laptop screens and have a screen share and make it possible to work on your laptop, basically make it do everything chatgpt can do but more about compleating school work and presentations

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://acegpt.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/6041fdcf-cbc3-4c8a-9c01-606d13d21374).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Deploying chat on Vercel

The Vercel build uses Nitro's `vercel` target. Do not rewrite all requests to `/`: the app needs its `/api/chat` server route as well as page routes.

Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and server-only `LOVABLE_API_KEY` in the deployment environment. Never prefix the AI key with `VITE_` or commit it. Redeploy after changing these values.

For chat without a sign-in screen, enable anonymous sign-ins in the Supabase/Lovable backend authentication settings. Guest sessions get their own user ID; existing per-user database policies and server token verification continue to apply. The interface opens before a session is created. The first message creates a guest session and a real database thread, and a completed response updates the URL to that saved chat. If guest access or the AI key is missing, chat displays an actionable error instead of returning to the welcome page.

### Free-tier AI connection

Add server-only `GROQ_API_KEY` to Vercel and redeploy. Groq is selected when this key is present; otherwise the existing Lovable gateway continues to work. No key is sent to the browser. Account signup and Free-plan limits are managed by Groq; adding a key does not guarantee unlimited or free usage on an already-paid Groq account.

Text chat uses `openai/gpt-oss-120b`, including browser search and the presentation tool. Image conversations use the preview vision model `qwen/qwen3.8-27b` (up to three images across the conversation), without browser search. Text/code/CSV attachments are decoded as before; PDF/Word attachments must be pasted as text on this connection. The Groq path limits each response to 2,048 tokens and five tool steps to reduce free-tier usage. Model availability and free quotas can change.
