# Product Review Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development; each owner runs focused regression tests and reports integration boundaries.

**Goal:** Restore a clear local learning loop with a focused desk, recurring returns and simpler first use.

**Architecture:** Keep Electron, React, SQLite and existing model services. Rearrange existing UI without weakening evidence, source, recovery or billing boundaries; add a local scheduling module.

**Tech Stack:** TypeScript, React, Electron, Vitest, Playwright.

**Spec:** ../specs/2026-10-15-product-review-design.md

## Global Constraints

- Work in the existing reclimb-knowledge-graph worktree. Preserve historical checkouts and user changes.
- No server deployment, uploaded analytics or paid model call without explicit configuration and authorization.
- Published v0.7.1 artifacts remain immutable.

## Task 1: Focused learning desk

**Files:** DeskPage.tsx, App.tsx, new DeskTools.tsx/desk.css and renderer-desk tests.

- [x] Reproduce duplicated feedback and task ordering with renderer tests.
- [x] Place task, answer and one primary action before supporting tools; retain recovery and source access.
- [x] Render current feedback once; move historical and support content into persistent tools.
- [x] Verify original input idempotency, paused resume, independent focus and keyboard drawer behavior.
- [x] Capture desktop layouts at the required sizes and check visible controls and page height.

## Task 2: Continuous local returns

**Files:** main/evidence.ts, new main/shared scheduling modules, Review type, backup validation and scheduling tests.

- [x] Test independent/assisted/failed returns and prevent duplicate queues before implementation.
- [x] Add interval progression and idempotent old-workspace reconciliation while preserving old records.
- [x] Provide due queue, mixed capability ordering and local metrics; integrate HomePage/EvidencePage.
- [x] Add opt-in local reminders, validated settings, and date-aware suppression tests.

## Task 3: First-use configuration

**Files:** SettingsPage.tsx, SettingsCard.tsx, QuickSetup.tsx, associated CSS/tests; HomePage/App integration.

- [x] Test simplification and preservation of existing configurations.
- [x] Reuse encrypted key save/test/activate and existing budget limits, retaining editable cost assumptions.
- [x] Group settings into learning, AI/cost and data; keep inactive editors mounted.
- [x] Make the original offline sample reachable directly from the first screen.

## Task 4: Records, wording and graph

**Files:** EvidencePage.tsx, LearningRelationsPanel.tsx, knowledge-graph.css, local layout helpers/tests.

- [x] Group records by capability without discarding invalidated historical attempts.
- [x] Show next due date and distinct delayed/transfer history.
- [x] Correct graph bounds and show complete labels with readable edges; identify it as provenance.
- [x] Record wording changes and dispositions for the product review.

## Task 5: Evaluation and delivery

**Files:** evaluation fixtures, validation CLI/manual workflow, documentation/source allowlist.

- [x] Prepare original cases covering explanation, attempts, feedback and return checks with human scoring fields.
- [x] Keep execution opt-in and costs bounded; verify no-key dry run and local mock boundary.
- [x] Run integrated tests, build and desktop checks; independently review final diff.
- [x] Record real vs simulated evidence and remaining human-dependent validation accurately.

## Delivery evidence

Implementation and local checks are recorded in ../../verification/验证记录-0.8.0.md. Real-model validation is incomplete: 30 of 80 reports exist, 16 returned usable results; the selected provider later returned empty bodies and the queue stopped. Human learning outcomes remain unverified. Package verification is recorded separately before publication.
