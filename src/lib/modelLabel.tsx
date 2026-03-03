import type { ModelCatalogEntry } from "./modelCatalog";
import type { SelectOption } from "@/components/optics/select";

const DATE_CODE_RE = /-(\d{8})$/;

function ModelChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1.5 inline-flex items-center rounded-md bg-ink-800 px-1.5 py-px text-[10px] leading-tight text-ink-400">
      {children}
    </span>
  );
}

function buildLabelNode(entry: ModelCatalogEntry): React.ReactNode {
  const dateMatch = entry.id.match(DATE_CODE_RE);
  if (dateMatch) {
    const baseName = entry.id.slice(0, -dateMatch[0].length);
    return (
      <span className="inline-flex items-center">
        {baseName}
        <ModelChip>{dateMatch[1]}</ModelChip>
      </span>
    );
  }

  return entry.label;
}

export function toModelSelectOption(entry: ModelCatalogEntry): SelectOption {
  return {
    value: entry.id,
    label: entry.label,
    labelNode: buildLabelNode(entry)
  };
}
