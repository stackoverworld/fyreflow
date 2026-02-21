import { Sparkles } from "lucide-react";

export function PlanPreviewHeader() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-ember-500/10 text-ember-400">
        <Sparkles className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-ink-200">AI Flow Builder</p>
      <p className="mt-1 max-w-[260px] text-xs text-ink-500">
        Ask questions about your current flow, request edits, or ask for a fully new rebuild.
      </p>
    </div>
  );
}
