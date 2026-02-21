import { Input } from "@/components/optics/input";
import { Textarea } from "@/components/optics/textarea";
import type { SmartRunField } from "@/lib/types";
import { cn } from "@/lib/cn";

interface CronScheduleRowProps {
  field: SmartRunField;
  value: string;
  isSecretMissing: boolean;
  onValueChange: (value: string) => void;
}

export function CronScheduleRow({
  field,
  value,
  isSecretMissing,
  onValueChange
}: CronScheduleRowProps) {
  const isSecret = field.type === "secret";
  if (isSecret) {
    return (
      <div className="space-y-1.5 rounded-lg border border-ink-800/70 bg-ink-900/25 px-3 py-2.5">
        <div className="flex items-center gap-1 text-xs text-ink-400">
          {field.label}
          {field.required ? <span className="text-red-400">*</span> : null}
        </div>
        <p className={cn("text-[11px]", isSecretMissing ? "text-red-400" : "text-ink-500")}>
          {isSecretMissing
            ? "Missing secure value. Run Smart Run once and provide this secret to store it securely."
            : "Secret value is resolved from secure per-pipeline storage."}
        </p>
      </div>
    );
  }

  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1 text-xs text-ink-400">
        {field.label}
        {field.required ? <span className="text-red-400">*</span> : null}
      </span>
      {field.type === "multiline" ? (
        <Textarea
          className="min-h-[80px]"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={field.placeholder}
        />
      ) : (
        <Input
          type={field.type === "url" ? "url" : "text"}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={field.placeholder}
        />
      )}
      {field.description ? <p className="text-[11px] text-ink-600">{field.description}</p> : null}
    </label>
  );
}
