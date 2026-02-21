import { Send } from "lucide-react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { Textarea } from "@/components/optics/textarea";
import { MIN_PROMPT_LENGTH } from "@/components/dashboard/ai-builder/useAiBuilderSession";

interface PromptEditorProps {
  prompt: string;
  readOnly: boolean;
  generating: boolean;
  onPromptChange: (value: string) => void;
  onSend: () => Promise<void> | void;
}

export function PromptEditor({
  prompt,
  readOnly,
  generating,
  onPromptChange,
  onSend,
}: PromptEditorProps) {
  return (
    <div className="border-t border-ink-800/60 p-3">
      <div className="relative">
        <Textarea
          className="min-h-[80px] pr-12"
          value={prompt}
          disabled={readOnly}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onPromptChange(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
          }}
          placeholder="Ask about the current flow or request updates/rebuild..."
        />
        <button
          type="button"
          disabled={readOnly || generating || prompt.trim().length < MIN_PROMPT_LENGTH}
          onClick={() => void onSend()}
          className={cn(
            "absolute bottom-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
            prompt.trim().length >= MIN_PROMPT_LENGTH && !generating && !readOnly
              ? "bg-ember-500 text-ink-950 hover:bg-ember-400 cursor-pointer"
              : "bg-ink-800 text-ink-600 cursor-not-allowed"
          )}
          aria-label="Send"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-600">Shift+Enter for new line &middot; min 2 characters</p>
    </div>
  );
}
