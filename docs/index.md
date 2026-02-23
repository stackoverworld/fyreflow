# Docs Index

This folder is the source of truth for architecture and delivery guidance.

- Last reviewed: 2026-02-20

## Core Documents
- `architecture.md`: architectural boundaries, module ownership, and dependency rules.
- `api-contracts.md`: contract-first API design, versioning, and compatibility.
- `conventions.md`: coding standards, testing expectations, and collaboration flow.
- `maintenance.md`: mechanical checks, context budget enforcement, and automation policy.
- `skills.md`: curated skill inventory and trigger/testing lifecycle.
- `decisions/`: ADR history for architectural tradeoffs.
- `runbooks/local-dev.md`: local setup, run, and troubleshooting steps.

## Document Inventory
<!-- primer-ai:docs-index:start -->
- `ENGINEERING_RULES.md`
- `SKILL_COMPLIANCE.md`
- `api-contracts.md`
- `architecture.md`
- `architecture/refactor-boundaries.md`
- `conventions.md`
- `decisions/0001-initial-architecture.md`
- `maintenance.md`
- `migration/existing-context-import.md`
- `runbooks/local-dev.md`
- `skills.md`
<!-- primer-ai:docs-index:end -->

## Maintenance Loop
- Keep docs synchronized with merged implementation.
- Prefer short, specific updates over giant rewrites.
- Add ADR entries whenever cross-cutting architecture decisions change.

## Project Summary
- Name: `fyreflow`
- Description: Build agents-dashboard with an agent-optimized architecture and reproducible delivery workflow.
- Stack: React + TypeScript + Vite
