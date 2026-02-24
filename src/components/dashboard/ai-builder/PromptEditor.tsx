import { Bot, MessageCircle, Send } from "lucide-react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { Textarea } from "@/components/optics/textarea";
import { SegmentedControl, type Segment } from "@/components/optics/segmented-control";
import { MAX_PROMPT_LENGTH, MIN_PROMPT_LENGTH } from "@/components/dashboard/ai-builder/useAiBuilderSession";
import type { AiBuilderMode } from "@/components/dashboard/ai-builder/mode";

const MODE_SEGMENTS: Segment<AiBuilderMode>[] = [
  { value: "agent", label: "Agent", icon: <Bot className="h-3 w-3" /> },
  { value: "ask", label: "Ask", icon: <MessageCircle className="h-3 w-3" /> }
];

interface PromptEditorProps {
  prompt: string;
  composerDisabled: boolean;
  generating: boolean;
  mode: AiBuilderMode;
  modeLocked: boolean;
  onPromptChange: (value: string) => void;
  onModeChange: (value: AiBuilderMode) => void;
  onSend: () => Promise<void> | void;
}

export function PromptEditor({
  prompt,
  composerDisabled,
  generating,
  mode,
  modeLocked,
  onPromptChange,
  onModeChange,
  onSend,
}: PromptEditorProps) {
  const promptLength = prompt.trim().length;
  const promptTooShort = promptLength < MIN_PROMPT_LENGTH;
  const promptTooLong = promptLength > MAX_PROMPT_LENGTH;
  const sendDisabled = composerDisabled || generating || promptTooShort || promptTooLong;

  return (
    <div className="border-t border-ink-800/60 p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Mode</span>
          <span className="text-[11px] text-ink-500">
            {mode === "agent" ? "Can update flow" : "Read-only answers"}
          </span>
        </div>
        <SegmentedControl
          size="sm"
          segments={MODE_SEGMENTS}
          value={mode}
          onValueChange={onModeChange}
          disabled={composerDisabled || generating || modeLocked}
        />
      </div>
      <div className="relative">
        <Textarea
          className="min-h-[80px] pr-12"
          value={prompt}
          disabled={composerDisabled}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onPromptChange(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!sendDisabled) {
                void onSend();
              }
            }
          }}
          placeholder={mode === "agent" ? "Describe changes to apply to the flow..." : "Ask a question about the current flow..."}
        />
        <button
          type="button"
          disabled={sendDisabled}
          onClick={() => void onSend()}
          className={cn(
            "absolute bottom-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
            !sendDisabled
              ? "bg-ember-500 text-ink-950 hover:bg-ember-400 cursor-pointer"
              : "bg-ink-800 text-ink-600 cursor-not-allowed"
          )}
          aria-label="Send"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className={cn("mt-1.5 text-[11px]", promptTooLong ? "text-red-400" : "text-ink-600")}>
        Shift+Enter for new line &middot; min {MIN_PROMPT_LENGTH} characters &middot; max {MAX_PROMPT_LENGTH}
        {promptTooLong ? ` (${promptLength}/${MAX_PROMPT_LENGTH})` : ""}
        {modeLocked ? " · Active run locks Agent mode." : ""}
      </p>
    </div>
  );
}
