# ACEGPT Mac companion

The web app alone cannot click or type in Mac applications. This native companion adds an explicit, temporary, paired session for supported apps. Requires an Apple Silicon Mac with macOS 14+ and Chrome for the web UI.

1. Download the companion from Computer mode in ACEGPT and open it.
2. The human grants Accessibility and Screen Recording in macOS, then clicks Start a 10-minute session.
3. Paste the temporary pairing code into Computer mode on https://acegpt-kappa.vercel.app. Allow the browser's local-network connection when requested.
4. Describe a routine task and click Start task. Keep the Mac unlocked and supervise. The first version supports TextEdit, Pages, Keynote, Numbers, Calculator, Preview, Chrome, Safari and Firefox.
5. Stop and disconnect, the native Stop button, Command–Shift–Escape, quitting the companion, or expiry revokes the pairing code.

The service binds only 127.0.0.1:48623. Every operation requires the exact ACEGPT origin, matching Host and a random 256-bit temporary code. Codes stay in web-tab memory and are never passed to the model. Observations exclude the companion window; secure text controls are omitted. Screenshots and visible text sent for planning are processed by the existing server-side Groq connection, not stored in chat. The app does not expose filesystem, shell, credential or arbitrary-code tools. Actions consume one short-lived observation, check the foreground app, and use observed accessibility controls. Coordinate clicks must hit the observed foreground app and pass local target checks. Publishing, sending, purchases, passwords, permission changes and other sensitive operations require the human to take over. These checks reduce risk; this is an initial supervised agent, not an unrestricted or unattended administrator.

No startup service or persistent remote access is installed. Free AI quotas still apply; the controller pauses between steps. A task stops after 12 actions or a local session expires after 10 minutes. macOS permissions must be granted by the user; automated tests deliberately do not grant them.

## Build and tests

Run `./companion/macos/build.sh` on an Apple Silicon Mac with Apple's command-line tools. This compiles source, signs locally, runs validation self-tests without invoking computer actions, and packages `public/downloads/ACEGPT-Companion-Mac.zip`. It is locally signed, not Apple-notarized; the agent must never bypass macOS security warnings. A signed and notarized release requires the owner's Apple Developer signing identity.

Web/API tests: `npm test`; type check: `npx tsc --noEmit`; production build: `VERCEL=1 npm run build`.
