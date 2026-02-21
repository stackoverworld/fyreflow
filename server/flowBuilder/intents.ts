export function isReplaceIntent(prompt: string): boolean {
  const input = prompt.toLowerCase();
  return (
    input.includes("replace flow") ||
    input.includes("replace this flow") ||
    input.includes("from scratch") ||
    input.includes("start over") ||
    input.includes("brand new") ||
    input.includes("recreate") ||
    input.includes("new flow")
  );
}

export function isMutationIntent(prompt: string): boolean {
  const input = prompt.toLowerCase();
  return (
    input.includes("build") ||
    input.includes("create") ||
    input.includes("generate") ||
    input.includes("make") ||
    input.includes("update") ||
    input.includes("modify") ||
    input.includes("change") ||
    input.includes("edit") ||
    input.includes("add") ||
    input.includes("remove") ||
    input.includes("delete") ||
    input.includes("rework") ||
    isReplaceIntent(prompt)
  );
}
