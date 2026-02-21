import type { CronPreset } from "./formatters";

export type CronPresetTableColumnKey = keyof CronPreset;

export interface CronPresetTableColumn {
  key: CronPresetTableColumnKey;
  label: string;
  render: (preset: CronPreset) => string;
}

export const cronPresetColumns: CronPresetTableColumn[] = [
  { key: "label", label: "Preset", render: (preset) => preset.label },
  { key: "cron", label: "Cron", render: (preset) => preset.cron },
  { key: "timezone", label: "Timezone", render: (preset) => preset.timezone },
  { key: "task", label: "Task", render: (preset) => preset.task }
];

