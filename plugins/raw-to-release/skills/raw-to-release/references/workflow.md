# Fixed workflow and stops

Use run ID `YYYYMMDD-HHMM-<slug>` and branch `r2r/<run-id>`. Follow the canonical
lifecycle in `method/lifecycle/phase-1.md`.

- Dirty existing repository: stop; never stash, discard, or absorb changes.
- Greenfield repository: ask before local initialization; remote creation is out.
- Plan rejection: return to confirmed intent; edit/reconfirm affected Dots.
- Interruption: resume only from the newest valid committed checkpoint described
  in `persistence.md`.
- Worker failure: retry once only for malformed output or a transient failure.
  Otherwise use the route fallback in `routing.md`. If unavailable, block.
- Reviewer failure: return only acceptance-linked findings. After two repair
  cycles, block and ask the human.
- Abort: record `aborted` at any gate and perform no further effects.
- Protected effect: stop for active host approval. Approval to discuss or plan an
  effect is not approval to perform it.

Testing evidence records exact commands, exit codes, pass/fail counts, relevant
failure output, observer, time, and acceptance criterion. Review must be fresh
and independent. Missing, stale, or narrated-only evidence fails.

Use bundled Node 22 `r2rctl` for every authoritative write. The parent
serializes Dot questions and cites the proposal revision/hash on confirmation.
Plan rejection invalidates its approval and reconfirms affected Dots. Task
authorities are sealed at plan approval; fallback-tool changes require a fresh
approval receipt and committed revision. Snapshot Git/filesystem state around
read-only reconnaissance; unexpected mutation blocks without reverting it.

Tests run only from approved argv specifications using `evidence exec`. Tester
and reviewer delegation IDs must be observable, durable, mutually distinct, and
distinct from every implementer. Commit the final candidate and handoff, then
run read-only `validate`; displayed gate booleans never override recomputed Git,
filesystem, provenance, ancestry, and receipt gates.
