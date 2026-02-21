import type { RunInputRequest, RunStartupBlocker } from "@/lib/types";

export interface ParsedRunInputRequests {
  status?: "pass" | "needs_input" | "blocked";
  summary?: string;
  requests: RunInputRequest[];
  blockers: RunStartupBlocker[];
  notes: string[];
}
