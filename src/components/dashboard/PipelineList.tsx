import { Plus, Trash2, Workflow } from "lucide-react";
import type { Pipeline } from "@/lib/types";
import { Button } from "@/components/optics/button";
import { cn } from "@/lib/cn";

interface PipelineListProps {
  pipelines: Pipeline[];
  selectedId: string | null;
  onSelect: (pipelineId: string) => void;
  onCreate: () => void;
  onDelete: (pipelineId: string) => void;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function PipelineList({ pipelines, selectedId, onSelect, onCreate, onDelete }: PipelineListProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-500">Your agent workflows</p>
        <Button size="sm" onClick={onCreate}>
          <Plus className="mr-1 h-3.5 w-3.5" /> New flow
        </Button>
      </div>

      <div className="space-y-1">
        {pipelines.map((pipeline) => {
          const isActive = selectedId === pipeline.id;

          return (
            <button
              key={pipeline.id}
              type="button"
              onClick={() => onSelect(pipeline.id)}
              className={cn(
                "group relative w-full rounded-lg px-3 py-2.5 text-left transition-colors duration-150",
                isActive
                  ? "bg-ink-800/50"
                  : "hover:bg-ink-800/30"
              )}
            >
              <span className={cn(
                "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-ember-500 transition-opacity duration-150",
                isActive ? "opacity-100" : "opacity-0"
              )} />

              <div className="flex items-center justify-between gap-2">
                <p className={cn(
                  "truncate text-[13px] font-medium transition-colors duration-150",
                  isActive ? "text-ink-50" : "text-ink-200"
                )}>
                  {pipeline.name}
                </p>

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(pipeline.id);
                  }}
                  className="shrink-0 rounded-md p-1 text-ink-700 opacity-0 transition-[color,opacity] duration-150 hover:text-red-400 group-hover:opacity-100"
                  aria-label={`Delete ${pipeline.name}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>

              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-500">
                <Workflow className="h-3 w-3 text-ink-600" />
                <span>{pipeline.steps.length} steps</span>
                <span className="text-ink-700">·</span>
                <span>{timeAgo(new Date(pipeline.updatedAt))}</span>
              </div>
            </button>
          );
        })}

        {pipelines.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-xs text-ink-500">No flows yet</p>
            <p className="mt-1 text-[11px] text-ink-600">Create one to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}
