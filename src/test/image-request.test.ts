import { afterEach, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { packImageRequest } from "@/lib/ai/image-request";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("packs pictures from multiple turns into one labelled provider image without rewriting history", async () => {
  const close = vi.fn();
  const labels = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ blob: async () => new Blob() })),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 900, height: 500, close })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillRect: vi.fn(),
    fillText: labels,
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,combined",
  );
  const history: UIMessage[] = Array.from({ length: 4 }, (_, index) => ({
    id: `turn-${index}`,
    role: "user",
    parts: [
      {
        type: "file",
        mediaType: "image/png",
        filename: `${index}.png`,
        url: `data:image/png;base64,${index}`,
      },
    ],
  }));
  const packed = await packImageRequest(history);
  expect(packed.flatMap((m) => m.parts).filter((p) => p.type === "file")).toEqual([
    {
      type: "file",
      mediaType: "image/jpeg",
      filename: "combined-pictures.jpg",
      url: "data:image/jpeg;base64,combined",
    },
  ]);
  expect(labels.mock.calls.map((call) => call[0])).toEqual([
    "Picture 1: 1.png",
    "Picture 2: 2.png",
    "Picture 3: 3.png",
  ]);
  expect(history.every((m) => m.parts[0]?.type === "file")).toBe(true);
  expect(close).toHaveBeenCalledTimes(3);
});
