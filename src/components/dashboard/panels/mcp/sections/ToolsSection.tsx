import { Input } from "@/components/optics/input";
import type { McpDraft } from "@/components/dashboard/panels/mcp/formSchema";

interface ToolsSectionProps {
  draft: McpDraft;
  onChange: (next: McpDraft) => void;
}

export function ToolsSection({ draft, onChange }: ToolsSectionProps) {
  return (
    <section className="space-y-3">
      <label className="block space-y-1.5">
        <span className="text-xs text-ink-400">Tool allowlist</span>
        <Input
          value={draft.toolAllowlist}
          onChange={(event) => onChange({ ...draft, toolAllowlist: event.target.value })}
          placeholder="Leave empty to allow all tools"
        />
      </label>
    </section>
  );
}
