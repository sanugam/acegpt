<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- AI chat streams from the `/api/chat` server route (src/lib/chat.server.ts), which verifies the user's bearer token and saves messages with a user-scoped client; keeps model calls and keys server-side.
- Chats are stored as `threads` + `messages` (AI SDK parts as jsonb), one page per thread at `/chat/$threadId`; reload restores history.
- Presentations come from the `create_presentation` tool and are turned into .pptx in the browser with pptxgenjs, so no file storage is needed.
- Screen sharing sends a snapshot of the shared screen with each message; the browser cannot control the computer.
