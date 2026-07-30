# Persistence and artifacts

Create `.raw-to-release/runtime/<run-id>/` for ignored observations, scratch, and
diagnostics. Create `.raw-to-release/runs/<run-id>/` for committed records:

```text
intent.json                 run-state.json
plan.md                     tasks.json
tasks/<task-id>.json        capability-report.json
verification.json           run-observation.json
handoff.md                   artifact-manifest.json
run-manifest.json            events.json
receipts/*.json              proposals/*.json
```

Copy `project.gitignore` into `.raw-to-release/.gitignore`. Persist a draft after
each Dot, but commit only confirmed intent and approved plan. For authoritative
updates, write a sibling temporary file, validate it against the packaged schema
and semantic gates, then atomically rename it. `r2rctl` flushes records and
replaces `run-manifest.json` last as the transaction commit point under a
per-run runtime lock. Orphaned temporary or pre-manifest files are
non-authoritative. Never infer state from narration or absorb ambiguous state.

Resume from an explicitly requested run or the sole newest committed run. Reject
unknown major contract versions, ambiguous candidates, broken references,
missing committed artifacts, or state/history disagreement. Ignored runtime
files can assist recovery but never override committed records.

Reject absolute, escaping, missing, symlinked, non-regular, untracked, or
hash-mismatched artifacts. Contract 1.x is accepted only by read-only
`audit-v1`; it cannot be resumed or migrated automatically.
