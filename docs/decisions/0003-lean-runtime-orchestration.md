# ADR-0003: Lean Runtime Orchestration

- Last reviewed: 2026-03-08

## Status
Accepted

## Context
- The runner was treating many deterministic stages like agent conversations, which inflated context, latency, and token cost.
- Run updates were rewriting the full local state file on each log/status mutation, creating avoidable I/O overhead.
- Routing depended mostly on `always` / `on_pass` / `on_fail`, which was too weak for flows that need branches such as `has_changes=false -> stop`.
- Review/tester roles also carried a hidden strict GateResult contract even when a pipeline already declared an explicit JSON schema for those steps.

## Decision
- Compress downstream context to recent summaries plus artifact hints instead of forwarding full accumulated outputs.
- Cap provider stage timeouts conservatively and stop auto-inflating heavy Claude steps into hour-long waits.
- Add semantic routing support through `PipelineLink.conditionExpression`, evaluated against JSON outputs after the base route condition matches.
- Treat explicit JSON step contracts as authoritative for review/tester steps; only apply strict GateResult contract when no explicit JSON contract is declared.
- Batch persistence for run/log mutations in `LocalStore`, while still forcing flushes before snapshot writes.

## Consequences
- Typical ETL-style flows stay reviewable but avoid runaway context growth.
- Long hangs become rarer because heavy steps no longer inherit hour-scale provider timeouts by default.
- Pipelines can stop or branch on domain signals like `has_changes`, `confidence`, or `needs_human_review` without extra reviewer loops.
- Reviewer/tester steps can emit domain-specific JSON without being blocked by an unrelated hidden contract.
- Disk churn from run logs drops materially while preserving current API behavior and recovery snapshots.
