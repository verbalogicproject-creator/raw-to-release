# Phase 1 lifecycle

The fixed path is `intake → intent_confirmed → planned → approved → implementing
→ verifying → release_ready`. `blocked` and `aborted` are terminal. Plan
rejection is the sole backward edge, from `planned` to `intent_confirmed`;
review failure returns `verifying` to `implementing` for at most two repairs.

## Gates

1. Preflight stops a dirty existing worktree. A new project may initialize local
   version control only after explicit confirmation.
2. `intent_confirmed` requires a privacy acknowledgement and all five Dots to be
   individually confirmed. Tasks cannot exist earlier.
3. Read-only reconnaissance precedes a separate planning pass. `approved`
   requires explicit human approval of scope, architecture, affected areas,
   tests, risks, and exclusions.
4. Every task cites at least one Dot, declares dependencies and authority, and
   returns evidence linked to one of its acceptance criteria.
5. A fresh tester observes exact commands and outcomes. A separate reviewer
   reads intent, plan, applicable rules, the committed implementation diff, and
   test evidence directly.
6. `release_ready` requires approved intent and plan, a local run branch, a
   committed implementation, fresh passing tests, independent passing review,
   committed verification and handoff artifacts, linked evidence, and a clean
   final worktree. Missing or stale evidence is failure.

After approval, commit intent and plan on `r2r/<run-id>`. Commit implementation
before independent testing and review. Apply bounded fixes as new commits, then
commit verification and handoff. Prove the worktree is clean after that final
commit. The handoff records the verified implementation SHA; the parent reports
the final handoff commit SHA after it exists, avoiding an impossible
self-referential commit hash.

`release_ready` never means released. Merge, push, review-request creation,
deployment, publication, and remote repository creation remain manual.

## Persistence and resume

Drafts and diagnostics live in `.raw-to-release/runtime/<run-id>/` and are
ignored. Committed records live in `.raw-to-release/runs/<run-id>/`: `intent.json`,
`run-state.json`, `plan.md`, `tasks.json`, `tasks/<task-id>.json`,
`capability-report.json`, `verification.json`, `run-observation.json`, and
`handoff.md`. Write a replacement file, validate it, then rename it over the
previous record; never leave a partially written authoritative record.

On resume, choose the requested run ID or the sole newest committed run. Validate
contract versions, hashes/locators, state history, and referential integrity.
Resume from the last committed valid state. Conflicting, missing, or invalid
artifacts stop as `blocked`; ignored runtime drafts never outrank committed state.
