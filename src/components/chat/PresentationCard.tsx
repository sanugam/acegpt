import { useState } from "react";
import { Download, Presentation } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { downloadDeck, type Deck } from "@/lib/pptx";

export function PresentationCard({ deck, ready }: { deck: Partial<Deck>; ready: boolean }) {
  const [busy, setBusy] = useState(false);
  const slides = deck.slides ?? [];
  return (
    <div className="my-3 overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Presentation className="size-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{deck.title ?? "Building presentation…"}</p>
            <p className="text-xs text-muted-foreground">{slides.length + 1} slides</p>
          </div>
        </div>
        <Button
          size="sm"
          disabled={!ready || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await downloadDeck(deck as Deck);
            } catch (e) {
              toast.error("Couldn't create the file: " + (e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download className="size-4" /> {busy ? "Saving…" : "Download .pptx"}
        </Button>
      </div>
      <div className="flex gap-3 overflow-x-auto p-4">
        {slides.map((s, i) => (
          <div
            key={i}
            className="aspect-video w-56 shrink-0 rounded-lg border bg-secondary p-3 text-left"
          >
            <p className="text-[10px] text-muted-foreground">Slide {i + 2}</p>
            <p className="mt-1 line-clamp-2 text-sm font-semibold">{s?.title}</p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
              {(s?.bullets ?? []).slice(0, 3).map((b, j) => (
                <li key={j} className="line-clamp-1">• {b}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
