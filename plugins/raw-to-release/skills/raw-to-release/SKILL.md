---
name: raw-to-release
description: Guide a user from an unformed idea through confirmed Five-Dot intent, approved planning, bounded implementation, independent testing and review, and an evidence-backed local release-ready branch. Use for greenfield projects, features, and repairs that must not autonomously merge, push, open a PR, deploy, or publish.
---

# Raw to Release

Read `references/workflow.md`, `references/persistence.md`, and
`references/routing.md` before starting. Read the matching role file before each
delegation. Use packaged contracts and templates. Keep every question and
approval gate in the parent; never commit credentials, private source bodies,
personal data, transcripts, or unnecessary absolute paths.

All authoritative `.raw-to-release/runs/<run-id>/` writes go through the bundled
Node 22 `bin/r2rctl.mjs`. Never hand-author records, use `jq`, append evidence,
or infer state from narration. `r2rctl` is only the state/evidence runtime;
Codex retains native interaction, routing, delegation, implementation, testing,
and review. The plugin remains skills-only and adds no orchestration service.

1. Run `r2rctl preflight --delegation-ids observable`. Read applicable rules and
   checks. Stop on a dirty existing repository or missing Node 22, Git, local
   execution, or durable delegation-ID visibility. Ask before local greenfield
   Git initialization; remote creation is out of scope.
2. Warn about committed-artifact privacy and use `run init`. Ask the Five Dots
   serially: Literal Task, Strategic Intent, Boundaries, Task Type, Relevant
   Principles. Persist each with `intent propose`; confirm its exact displayed
   revision/hash with `intent confirm`. Revisions replace neither proposals nor
   approval receipts.
3. Delegate read-only reconnaissance, snapshotting Git/filesystem before and
   after, then a separate read-only plan. Present scope, architecture, affected
   areas, tests, risks, exclusions, and task authorities. Use `plan approve` to
   bind exact plan and authority hashes. Rejection invalidates plan approval and
   reconfirms each affected Dot. Create `r2r/<run-id>` and commit the checkpoint.
4. Register/start/complete dependency-ready tasks through `r2rctl`, with at most
   three concurrent and non-overlapping ownership. The authority set is sealed;
   adding a fallback tool/effect requires a fresh approval receipt and committed
   revision. Stop on cycles, exhaustion, unexpected reconnaissance mutation, or
   unavailable fallback.
5. Commit implementation. A fresh tester runs only approved argv through
   `evidence exec`. Persist a fresh independent review using `review record`.
   Tester and reviewer delegation IDs must be observable, mutually distinct,
   and distinct from every implementer. Allow at most two repair/review cycles.
6. Record tracked regular-file artifacts, use `handoff prepare`, commit final
   state, and run read-only `validate`. Report `release_ready` only after it
   passes on exact branch `r2r/<run-id>` with a clean tree. Report the final
   handoff commit separately from the verified implementation SHA, and state
   that merge, push, PR creation, deployment, publication, and submission were
   not performed.

Hard ceilings: 12 delegations, 3 concurrent agents, 8 implementation tasks, 2
fix-review cycles, and 1 malformed/transient retry. Token and monetary limits
are `unobservable` unless trustworthy usage is exposed. Contract 1.x is
read-only `audit-v1`; never resume, rewrite, migrate, or mark it release-ready.

Exit codes: 0 passed; 2 invalid contract/evidence; 3 lifecycle or approval
block; 4 required capability unavailable; 5 executed command, review, or
full-run failure.
