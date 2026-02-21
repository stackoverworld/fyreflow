import { Textarea } from "@/components/optics/textarea";
import type { McpDraft } from "@/components/dashboard/panels/mcp/formSchema";

interface AuthSectionProps {
  draft: McpDraft;
  onChange: (next: McpDraft) => void;
}

export function AuthSection({ draft, onChange }: AuthSectionProps) {
  const isNetwork = draft.transport === "http" || draft.transport === "sse";

  return (
    <section className="space-y-3">
      {isNetwork && (
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">Headers</span>
          <Textarea
            className="min-h-[48px]"
            value={draft.headers}
            onChange={(event) => onChange({ ...draft, headers: event.target.value })}
            placeholder="Authorization: Bearer ..."
          />
        </label>
      )}

      <label className="block space-y-1.5">
        <span className="text-xs text-ink-400">Environment variables</span>
        <Textarea
          className="min-h-[48px]"
          value={draft.env}
          onChange={(event) => onChange({ ...draft, env: event.target.value })}
          placeholder={draft.transport === "stdio" ? "FIGMA_TOKEN=..." : "API_KEY=..."}
        />
      </label>
    </section>
  );
}
