import { PlayCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CronPreset, NormalizedCronSchedule } from "./formatters";
import { cronPresetColumns } from "./tableColumns";
import { isPresetActive } from "./formatters";

interface RowActionsProps {
  presets: CronPreset[];
  schedule: NormalizedCronSchedule;
  readOnly: boolean;
  onPresetSelect: (preset: CronPreset) => void;
}

export function RowActions({
  presets,
  schedule,
  readOnly,
  onPresetSelect
}: RowActionsProps) {
  const presetLabelColumn = cronPresetColumns[0];

  return (
    <div className="grid grid-cols-2 gap-1.5">
      {presets.map((preset) => {
        const active = isPresetActive(preset, schedule);
        const label = presetLabelColumn?.render?.(preset) ?? preset.label;

        return (
          <button
            key={preset.label}
            type="button"
            disabled={readOnly}
            onClick={() => onPresetSelect(preset)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left text-[11px] font-medium transition-colors cursor-pointer",
              active
                ? "border-ember-500/30 bg-ember-500/8 text-ember-300"
                : "border-ink-800 bg-ink-900/40 text-ink-400 hover:bg-[var(--divider)] hover:text-ink-200",
              readOnly && "cursor-not-allowed opacity-60"
            )}
          >
            <PlayCircle className={cn("h-3 w-3 shrink-0", active ? "text-ember-400" : "text-ink-600")} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
