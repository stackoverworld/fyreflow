# Docs Index

This folder is the source of truth for architecture and delivery guidance.

- Last reviewed: 2026-02-25

## Core Documents
- `architecture.md`: architectural boundaries, module ownership, and dependency rules.
- `api-contracts.md`: contract-first API design, versioning, and compatibility.
- `conventions.md`: coding standards, testing expectations, and collaboration flow.
- `maintenance.md`: mechanical checks, context budget enforcement, and automation policy.
- `skills.md`: curated skill inventory and trigger/testing lifecycle.
- `decisions/`: ADR history for architectural tradeoffs.
- `runbooks/local-dev.md`: local setup, run, and troubleshooting steps.
- `runbooks/remote-engine-deploy.md`: deploy the engine on Railway or any Docker host.

## Document Inventory
<!-- primer-ai:docs-index:start -->
- `ENGINEERING_RULES.md`
- `SKILL_COMPLIANCE.md`
- `api-contracts.md`
- `architecture.md`
- `architecture/refactor-boundaries.md`
- `conventions.md`
- `decisions/0001-initial-architecture.md`
- `decisions/0002-runtime-kernel-and-managed-release-updates.md`
- `maintenance.md`
- `migration/existing-context-import.md`
- `runbooks/local-dev.md`
- `runbooks/remote-engine-deploy.md`
- `skills.md`
<!-- primer-ai:docs-index:end -->

## Maintenance Loop
- Keep docs synchronized with merged implementation.
- Prefer short, specific updates over giant rewrites.
- Add ADR entries whenever cross-cutting architecture decisions change.

## Project Summary
- Name: `FyreFlow`
- Description: Build FyreFlow with an agent-optimized architecture and reproducible delivery workflow.
- Stack: React + TypeScript + Vite
