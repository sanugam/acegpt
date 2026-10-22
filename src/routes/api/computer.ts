import { createFileRoute } from "@tanstack/react-router";
import { handleComputer } from "@/lib/computer.server";
export const Route = createFileRoute("/api/computer")({
  server: { handlers: { POST: ({ request }) => handleComputer(request) } },
});
