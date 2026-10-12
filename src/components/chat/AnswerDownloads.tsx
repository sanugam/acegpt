import { useState } from "react";
import { Download, FileCode, FileText } from "lucide-react";
import { toast } from "sonner";
import { MessageAction } from "@/components/ai-elements/message";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { codeFiles, downloadAnswer, saveBlob } from "@/lib/downloads";

export function AnswerDownloads({ text }: { text: string }) {
  const [busy, setBusy] = useState(false);
  async function save(format: "docx" | "md" | "txt") {
    setBusy(true);
    try {
      await downloadAnswer(text, format);
    } catch (error) {
      toast.error("Couldn't download: " + (error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const files = codeFiles(text);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MessageAction label="Download reply" disabled={busy}>
          <Download className="size-3.5" />
        </MessageAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => void save("docx")}>
          <FileText />
          Word document (.docx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void save("md")}>
          <FileText />
          Markdown (.md)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void save("txt")}>
          <FileText />
          Plain text (.txt)
        </DropdownMenuItem>
        {files.length > 0 && <DropdownMenuSeparator />}
        {files.map((file) => (
          <DropdownMenuItem
            key={file.filename}
            onSelect={() =>
              saveBlob(
                new Blob([file.content], { type: "text/plain;charset=utf-8" }),
                file.filename,
              )
            }
          >
            <FileCode />
            {file.filename}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
