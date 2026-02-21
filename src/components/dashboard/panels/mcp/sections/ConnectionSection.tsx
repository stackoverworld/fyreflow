import { Input } from "@/components/optics/input";
import { Select } from "@/components/optics/select";
import type { McpDraft } from "@/components/dashboard/panels/mcp/formSchema";
import { MCP_SERVER_TRANSPORT_OPTIONS } from "../formSchema";

interface ConnectionSectionProps {
  draft: McpDraft;
  onChange: (next: McpDraft) => void;
}

export function ConnectionSection({ draft, onChange }: ConnectionSectionProps) {
  const isNetwork = draft.transport === "http" || draft.transport === "sse";
  const isStdio = draft.transport === "stdio";

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">Name</span>
          <Input
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">Transport</span>
          <Select
            value={draft.transport}
            onValueChange={(value) => onChange({ ...draft, transport: value as McpDraft["transport"] })}
            options={[...MCP_SERVER_TRANSPORT_OPTIONS]}
          />
        </label>
      </div>

      {isNetwork && (
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">URL</span>
          <Input
            value={draft.url}
            onChange={(event) => onChange({ ...draft, url: event.target.value })}
            placeholder={draft.transport === "sse" ? "http://localhost:3010/sse" : "http://localhost:3010"}
          />
        </label>
      )}

      {isStdio && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">Command</span>
            <Input
              value={draft.command}
              onChange={(event) => onChange({ ...draft, command: event.target.value })}
              placeholder="npx"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">Args</span>
            <Input
              value={draft.args}
              onChange={(event) => onChange({ ...draft, args: event.target.value })}
              placeholder="-y package-name --stdio"
            />
          </label>
        </div>
      )}
    </section>
  );
}
