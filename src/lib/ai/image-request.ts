import type { FileUIPart, UIMessage } from "ai";
import { recentImageContext } from "./image-context";

// Groq charges 2048 input tokens per image. A labelled contact sheet keeps
// multi-picture requests below the free account's per-request token limit.
export async function packImageRequest(messages: UIMessage[]): Promise<UIMessage[]> {
  const context = recentImageContext(messages);
  const pictures = context.flatMap((message) =>
    message.parts.filter(
      (part): part is FileUIPart => part.type === "file" && part.mediaType.startsWith("image/"),
    ),
  );
  if (pictures.length < 2) return context;
  const bitmaps: ImageBitmap[] = [];
  try {
    for (const picture of pictures)
      bitmaps.push(await createImageBitmap(await (await fetch(picture.url)).blob()));
    const width = 1400;
    const heights = bitmaps.map((image) =>
      Math.round(image.height * Math.min(1, width / image.width)),
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = heights.reduce((sum, height) => sum + height + 60, 0);
    const drawing = canvas.getContext("2d");
    if (!drawing) throw new Error("Couldn't prepare your pictures. Try sending them separately.");
    drawing.fillStyle = "white";
    drawing.fillRect(0, 0, width, canvas.height);
    let y = 0;
    bitmaps.forEach((image, index) => {
      drawing.fillStyle = "black";
      drawing.font = "28px Arial";
      drawing.fillText(
        `Picture ${index + 1}: ${pictures[index]?.filename ?? "attachment"}`,
        20,
        y + 38,
        width - 40,
      );
      const scale = Math.min(1, width / image.width);
      drawing.drawImage(image, 0, y + 60, image.width * scale, heights[index]!);
      y += heights[index]! + 60;
    });
    let index = 0;
    const packed = context.map((message) => ({
      ...message,
      parts: message.parts.map((part) =>
        part.type === "file" && part.mediaType.startsWith("image/")
          ? {
              type: "text" as const,
              text: `[Picture ${++index}: ${part.filename ?? "attachment"}. See the labelled combined image attached to the latest user message.]`,
            }
          : part,
      ),
    }));
    let imageUrl = canvas.toDataURL("image/jpeg", 0.8);
    if (imageUrl.length > 900_000) imageUrl = canvas.toDataURL("image/jpeg", 0.5);
    if (imageUrl.length > 900_000) throw new Error("These pictures are too large together. Send them separately or crop them first.");
    const reverseIndex = [...packed].reverse().findIndex((message) => message.role === "user");
    const lastUser = reverseIndex < 0 ? -1 : packed.length - 1 - reverseIndex;
    if (lastUser >= 0)
      packed[lastUser]!.parts.push({
        type: "file",
        mediaType: "image/jpeg",
        filename: "combined-pictures.jpg",
      url: imageUrl,
      });
    return packed;
  } finally {
    bitmaps.forEach((image) => image.close());
  }
}
