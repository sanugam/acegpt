import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Presentation } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deckPages, renderSlide, THEMES, type ThemeName } from "@/lib/presentation-design";
import { downloadDeck, downloadDeckPdf, type Deck } from "@/lib/pptx";

export function PresentationCard({ deck, ready }: { deck: Partial<Deck>; ready: boolean }) {
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<ThemeName>("studio");
  const [index, setIndex] = useState(0);
  const [image, setImage] = useState("");
  const pages = useMemo(() => deckPages(deck), [deck]);
  const active = Math.min(index, pages.length - 1);
  const currentPage = pages[active];
  useEffect(() => {
    let cancelled = false;
    setImage("");
    if (!currentPage) return;
    renderSlide(currentPage, active, pages.length, theme)
      .then((url) => {
        if (!cancelled) setImage(url);
      })
      .catch((error) => {
        if (!cancelled) toast.error(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [pages, currentPage, active, theme]);

  async function download(format: "pptx" | "pdf") {
    if (!ready || !deck.title || !deck.slides) return;
    setBusy(true);
    try {
      const complete = {
        ...deck,
        title: deck.title,
        subtitle: deck.subtitle ?? "",
        slides: deck.slides,
      };
      await (format === "pptx" ? downloadDeck(complete, theme) : downloadDeckPdf(complete, theme));
    } catch (error) {
      toast.error("Couldn't save presentation: " + (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="my-4 overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Presentation className="size-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{deck.title ?? "Building presentation…"}</p>
            <p className="text-xs text-muted-foreground">{pages.length} slides</p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" disabled={!ready || busy}>
              <Download />
              {busy ? "Saving…" : "Download"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void download("pptx")}>
              PowerPoint (.pptx)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void download("pdf")}>PDF (.pdf)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        className="flex flex-wrap items-center gap-1 px-3 py-2"
        role="group"
        aria-label="Presentation theme"
      >
        {deck.design ? (
          <div className="px-2 py-1 text-sm">
            <span className="font-semibold">{deck.design.name || "Custom design"}</span>
            <span className="ml-2 text-muted-foreground">
              Ask Ace to change the colours, layout, or illustrations.
            </span>
          </div>
        ) : (
          (Object.keys(THEMES) as ThemeName[]).map((name) => (
            <Button
              key={name}
              size="sm"
              variant={theme === name ? "secondary" : "ghost"}
              aria-pressed={theme === name}
              onClick={() => setTheme(name)}
            >
              <span className={`deck-swatch deck-swatch-${name}`} />
              {THEMES[name].label}
            </Button>
          ))
        )}
      </div>
      <div className="aspect-video bg-secondary" aria-busy={!image}>
        {image && (
          <img
            src={image}
            alt={`Slide ${active + 1}: ${currentPage?.title ?? ""}`}
            className="h-full w-full object-contain"
          />
        )}
      </div>
      <div className="flex items-center justify-between px-3 py-2">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Previous slide"
          disabled={active === 0}
          onClick={() => setIndex(active - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="text-xs text-muted-foreground">
          {active + 1} / {pages.length}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Next slide"
          disabled={active === pages.length - 1}
          onClick={() => setIndex(active + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
      {currentPage?.notes && (
        <details className="border-t px-4 py-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Speaker notes</summary>
          <p className="mt-2 whitespace-pre-wrap">{currentPage.notes}</p>
        </details>
      )}
    </div>
  );
}
