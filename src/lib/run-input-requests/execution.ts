import type { RunInputRequest, RunStartupBlocker } from "@/lib/types";
import type { ParsedRunInputRequests } from "./types";
import {
  collectJsonCandidates,
  normalizeBlocker,
  normalizeRequest
} from "./normalizers";
import { dedupeBlockers, dedupeRequests } from "./requestBuilders";

export function parseRunInputRequestsFromText(rawOutput: string): ParsedRunInputRequests | null {
  if (!rawOutput || rawOutput.trim().length === 0) {
    return null;
  }

  for (const candidate of collectJsonCandidates(rawOutput)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        continue;
      }

      const record = parsed as Record<string, unknown>;
      const requestsRaw = Array.isArray(record.input_requests)
        ? record.input_requests
        : Array.isArray(record.requests)
          ? record.requests
          : [];
      const blockersRaw = Array.isArray(record.blockers) ? record.blockers : [];
      const notesRaw = Array.isArray(record.notes) ? record.notes : [];

      const requests = dedupeRequests(
        requestsRaw
          .map((entry) => normalizeRequest(entry))
          .filter((entry): entry is RunInputRequest => entry !== null)
      );
      const blockers = dedupeBlockers(
        blockersRaw
          .map((entry, index) => normalizeBlocker(entry, index))
          .filter((entry): entry is RunStartupBlocker => entry !== null)
      );

      if (requests.length === 0 && blockers.length === 0) {
        continue;
      }

      const statusRaw = typeof record.status === "string" ? record.status.trim().toLowerCase() : undefined;
      const status =
        statusRaw === "blocked" || statusRaw === "needs_input" || statusRaw === "pass"
          ? statusRaw
          : undefined;

      return {
        status,
        summary: typeof record.summary === "string" ? record.summary.trim() : undefined,
        requests,
        blockers,
        notes: notesRaw
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      };
    } catch {
      // Continue trying other candidates.
    }
  }

  return null;
}
