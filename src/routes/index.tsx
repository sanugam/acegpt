import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <h1 className="text-4xl font-extrabold tracking-tight">Welcome to Ace GPT</h1>
        <p className="text-slate-400">
          Your AI-powered workspace is ready. Click below to start chatting directly without signing
          in.
        </p>
        <Link
          to="/chat/$threadId"
          params={{ threadId: "new" }}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium flex items-center justify-center gap-2 py-4 text-lg rounded-xl shadow-lg transition-all no-underline"
        >
          <MessageSquare className="w-5 h-5" />
          Open AI Chat Interface
        </Link>
      </div>
    </main>
  );
}
