# Perplexity alignment: Raw to Release v0.1.1

Date: 2026-07-30

This document updates the Perplexity research synthesis with the implementation
direction taken in this repository. It is a pause-point handoff, not a release
claim. A local implementation checkpoint exists on the release branch, empirical
qualification is incomplete, and no merge, push, PR, deployment, publication,
or plugin submission occurred.

## Executive alignment

The research correctly identified the core production risks: narrated evidence,
mutable approvals, ad hoc state writes, stale Git claims, unobservable delegated
identity, unsafe artifact paths, and release gates inferred from booleans rather
than reconstructed from evidence.

The implementation keeps the research goal but uses a smaller native binding:

- Codex remains responsible for user interaction, planning, delegation,
  implementation, testing decisions, and review decisions.
- A bundled Node 22 CLI, `r2rctl`, owns authoritative run records, command
  execution receipts, and read-only validation.
- The plugin remains skills-only. We added no MCP server, hosted service, hook,
  agent SDK, or replacement orchestration layer.
- Contract 2.0 records are resumable. Contract 1.x records are audit-only and
  cannot be migrated or marked release-ready automatically.

## What changed from the earlier approach

### 1. From Python simulation to a shipped Node runtime

The earlier repository used Python schema checks and simulated lifecycle
journeys. Those checks remain useful for provider-neutral contract regression,
but they are no longer the intended authority for live run writes.

The new consumer runtime is a compiled, single-file ESM bundle at:

`plugins/raw-to-release/skills/raw-to-release/bin/r2rctl.mjs`

Consumers need Node 22 and Git, but do not run `npm install`. TypeScript, Ajv,
and Node types are exactly pinned build/test dependencies only.

### 2. From per-file replacement to immutable generations

The implementation uses a per-run exclusive lock under ignored runtime state.
Each mutation:

1. validates the active generation and requested transition in memory;
2. copies the complete authoritative snapshot into a new staging generation;
3. writes and flushes changed records and the extended hash-chained event log;
4. atomically renames the staging directory to its immutable generation number;
   and
5. replaces `run-manifest.json` last so its generation pointer is the sole
   transaction commit point.

A future generation left by interruption is never authoritative and is rejected,
not absorbed, on the next mutation or validation. The validator also rejects
staging directories, missing generations, corrupt event chains, record
hash/length mismatches, nested symlinks, and ambiguous locks without deleting
or repairing them.

### 3. From editable confirmation state to immutable approval receipts

Each Dot is first persisted as a numbered proposal with a SHA-256 content hash.
Confirmation must cite that exact Dot, revision, and displayed hash. Intent and
plan approval receipts bind the asserted user, revision, displayed content hash,
approval type, time, and—where relevant—the sealed task-authority hash.

Plan rejection is documented to invalidate the old plan receipt and reconfirm
every affected Dot. Adding a fallback tool or effect after the plan checkpoint
requires a new approval receipt and committed authority revision.

### 4. From narrated tests to runtime-produced command receipts

Tasks carry approved command IDs, argv arrays, repository-relative working
directories, evidence criteria, delegation IDs, and the sealed authority hash.
`evidence exec` looks up the approved argv and uses `spawnSync` with
`shell: false`; replacement or narrated argv is rejected.

The receipt is derived from the process and records:

- approved command and task IDs;
- exact argv and repository-relative cwd;
- implementation Git SHA;
- start/end time and child exit code;
- pass/fail outcome and test counts;
- SHA-256 hashes of stdout and stderr; and
- a bounded, repository-path-normalized, secret-redacted failure excerpt.

A failing child command retains its real exit code and makes the CLI exit 5.
Task completion refuses failed or missing receipts.

### 5. From role labels to observable identity separation

Review receipts contain durable asserted delegation IDs for every implementer,
the tester, and the reviewer. The CLI requires all of them to be present and
mutually distinct and rejects review against a stale SHA.

This is provenance, not authentication. Tester IDs are also cross-bound from
runtime-produced command receipts into review. If the Codex surface cannot
expose durable delegation IDs, preflight exits 4 and release readiness is
unavailable.

### 6. From artifact names to Git- and filesystem-bound manifests

Artifact recording rejects absolute paths, `..`, missing files, symlinks,
non-regular files, and untracked paths. Each entry binds repository-relative
path, SHA-256, Git blob ID, owning commit, and regular-file type. Read-only final
validation recomputes file hashes, blob identity, ancestry, branch, tracking,
worktree cleanliness, command freshness, review independence, and lifecycle
history.

Display gate booleans are not accepted as proof. The exact final branch must be
`r2r/<run-id>`. The handoff stores the verified implementation SHA; the parent
reports the later final handoff commit SHA after validation, avoiding
self-reference.

## Contract and package changes

- Plugin version: `0.1.1`.
- Provider-neutral method version: `2.0.0`.
- Resumable contracts accept major 2 only; majors 1 and 3 fail closed.
- `audit-v1` is a separate byte-preserving, read-only legacy path.
- New production contracts cover approval receipts, command receipts, review
  receipts, tasks, verification, and artifact manifests.
- Plan and handoff Markdown use required ordered sections.
- CI is configured for Node 22 plus Python on Linux, macOS, and Windows.
- A deterministic CycloneDX SBOM and build-license inventory are generated from
  the exact lockfile.

## First independent review and hardening response

The first independent architect review returned FAIL with no P0 findings and ten
P1 findings. The current hardening changes respond by:

- using complete immutable generations instead of a set of independently
  replaced live records;
- forbidding task registration before plan approval and binding each task to
  its exact sealed authority entry;
- denying protected command classes before process creation and executing with
  a minimal environment;
- cross-binding tester, implementer, reviewer, evidence, input, and reviewed-SHA
  provenance;
- adding plan rejection, abort, block, retry, fallback, and repair transitions
  with reconstructed counters;
- rejecting traversal, nested symlinks, future generations, receipt overwrite,
  stale attempts, post-review product drift, and event/approval cross-run drift;
  and
- validating real runtime-emitted records against the canonical schemas.

These changes have local automated evidence, but the final independent review
did not return PASS.

## Current automated evidence

Passing at this pause point:

- 34 Node tests, including six positive/negative contract-2 pairs and runtime
  integration tests for preflight, locking, immutable approvals, authority
  drift, dependency rejection, shell-free execution, receipt derivation,
  redaction, identity separation, stale review, unsafe paths, corrupt logs, and
  read-only v1 audit. Added adversarial cases cover canonical schema conformance
  of emitted records, interrupted future generations, pre-plan task rejection,
  protected commands, affected-Dot reconfirmation, latest-attempt policy,
  traversal, and nested symlinks.
- 15 Python repository/contract/lifecycle tests.
- 3 Pocket Tasks tests.
- deterministic bundle build and regeneration check;
- all method 2.0 schemas compile under pinned Ajv;
- canonical method and packaged copy are synchronized;
- repository/plugin validation passes; and
- offline supply-chain inspection passes with zero runtime package imports and
  bundle SHA-256
  `e11001612cb2a66bf926b5595cf84bf7e51981c74fc0aa9af94219e8593f6a50`.

## Important resolved finding

### Dependency audit

The initial `ajv@8.17.1` build pin carried advisory `GHSA-2g4f-4pwh-qvx6`.
The pin is now `ajv@8.20.0`; the lockfile, SBOM, and license report were
regenerated; schema compilation and the complete local test suite pass; and
`npm audit --audit-level=high` reports zero vulnerabilities. Ajv remains a
build/test dependency and is not shipped in the runtime bundle.

## Important unresolved findings

### Native capability block

The final hardening cycle established that the bundled child process has no
authenticated native channel for host-observed delegation identity or active
host effect approval. A caller flag or model-authored file would only be another
claim. Accordingly, `preflight` and `handoff prepare` now exit 4 instead of
accepting self-asserted capability. This blocks the intended forward path, but
the final review found that it is not yet a complete authority boundary:
`evidence exec` does not require successful preflight, and `validate` does not
require authenticated capability attestation. Perplexity should treat a future
authenticated Codex host capability as a prerequisite, not recommend an
MCP/service/hook workaround.

### Final architect verdict

The final review after two repair cycles returned FAIL/BLOCKED with reachable
P1 findings:

- protected effects can still be hidden behind unclassified executables,
  reordered Git options, or obfuscated interpreter payloads because
  `evidence exec` is callable without a successful capability preflight; and
- a handcrafted, internally hash-consistent `release_ready` bundle can still be
  accepted by `validate` because validation has no authenticated capability
  gate.

The workflow ceiling is exhausted, so no third repair cycle is authorized.
The branch is a documented blocked checkpoint, not a release candidate.

### Empirical qualification

The following cannot be inferred from local source tests and remain pending:

- real Node 22 receipts for Linux, macOS, and Windows filesystem/Git behavior;
- official plugin validation, marketplace cache refresh, and reinstall;
- fresh installed-plugin greenfield and clean-existing journeys;
- installed-plugin plan rejection plus affected-Dot reconfirmation;
- installed-plugin interruption/resume, malformed fallback, retry exhaustion,
  abort, protected-effect refusal, reviewer repair, and two-cycle block journeys;
- three real fixtures for every route and fallback route;
- two independently reconstructed run bundles that validate successfully;
- Pocket Tasks performance receipts for delegation, turn, runtime, and
  trustworthy token limits;
- directory/name/trademark clearance; and
- a future independent architect PASS with no P0/P1 findings after the source
  blockers are resolved under fresh human authority.

The current machine runs Node 26, so its passing runtime tests do not substitute
for the required Node 22 platform matrix.

## Deliberate boundaries

- No autonomous merge, push, PR, deployment, publication, submission, purchase,
  account creation, or remote repository creation.
- No API substitution for subscription model access.
- No claim that asserted local identity is authenticated.
- No fabricated platform, installed-plugin, performance, or security receipts.
- No automatic contract-1 migration.
- No attempt to revert or absorb the dirty continuation baseline inherited from
  the previous implementation session.

## Recommended next research/review focus

Perplexity should evaluate the approach on four questions:

1. Does an immutable complete-generation snapshot plus an atomic manifest
   pointer and hash-chained event log provide an adequate cross-platform
   crash-consistency boundary, especially on Windows?
2. Are the contract fields sufficient to detect stale or cross-run evidence
   without creating an impossible final-commit self-reference?
3. Is host-exposed durable delegation identity a realistic Codex CLI
   capability across supported surfaces, and what must remain explicitly
   unsupported if it is absent?
4. Which parts of the empirical matrix can be automated without weakening the
   rule that model narration and dispatch are claims rather than proof?

The detailed gate-by-gate status is maintained in
`docs/production-closure.md`.
