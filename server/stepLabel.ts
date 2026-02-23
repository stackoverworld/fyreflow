function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readObjectStringField(value: unknown, field: "name" | "stepName" | "id" | "stepId"): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return asNonEmptyString((value as Record<string, unknown>)[field]);
}

export function normalizeStepLabel(label: unknown, fallback: unknown): string {
  const direct = asNonEmptyString(label);
  if (direct) {
    return direct;
  }

  const embedded =
    readObjectStringField(label, "name") ??
    readObjectStringField(label, "stepName") ??
    readObjectStringField(label, "id") ??
    readObjectStringField(label, "stepId");
  if (embedded) {
    return embedded;
  }

  return asNonEmptyString(fallback) ?? "Unknown step";
}
