import { QualityGatesPanel } from "@/components/dashboard/QualityGatesPanel";
import type { QualityGatesSectionProps } from "../types";

export function QualityGatesSection({ draft, readOnly, onChange }: QualityGatesSectionProps) {
  return <QualityGatesPanel draft={draft} readOnly={readOnly} onChange={onChange} />;
}

