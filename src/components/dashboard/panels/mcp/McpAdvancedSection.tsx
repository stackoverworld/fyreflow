import { Input } from "@/components/optics/input";
import type { McpDraft } from "@/components/dashboard/panels/mcp/formSchema";

interface McpAdvancedSectionProps {
  draft: McpDraft;
  onChange: (next: McpDraft) => void;
}

export function McpAdvancedSection({ draft, onChange }: McpAdvancedSectionProps) {
  const isNetwork = draft.transport === "http";

  return (
    <section className="space-y-3">
      <label className="block space-y-1.5">
        <span className="text-xs text-ink-400">Tool allowlist</span>
        <Input
          value={draft.toolAllowlist}
          onChange={(event) => onChange({ ...draft, toolAllowlist: event.target.value })}
          placeholder={isNetwork ? "tools/callable_tool,another_tool" : "optional for stdio"}
        />
      </label>

      {isNetwork && (
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">Outbound host allowlist</span>
          <Input
            value={draft.hostAllowlist}
            onChange={(event) => onChange({ ...draft, hostAllowlist: event.target.value })}
            placeholder="api.githubcopilot.com"
          />
        </label>
      )}
    </section>
  );
}
