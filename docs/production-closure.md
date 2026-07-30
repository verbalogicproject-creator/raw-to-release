# Production closure matrix

This matrix separates source qualification from empirical release evidence.
No pending receipt is represented as a pass.

| Audit finding / gate | Implementation | Regression evidence | Empirical receipt | Verdict |
| --- | --- | --- | --- | --- |
| Ad hoc or concurrent state writes | lock, immutable generations, event chain, manifest pointer transaction | lock, immutable confirmation, corrupt-log and concurrent execution tests | platform rename/lock matrix pending | source hardened; release pending |
| Mutable or mismatched approval | proposal revision/hash and typed receipt | differing-hash confirmation test | interactive Dot journey pending | source PASS; release pending |
| Authority drift / invalid DAG / limits | sealed authority and lifecycle ceilings | drift, dependency, limit tests | retry/fallback dogfood pending | source PASS; release pending |
| Fabricated command evidence | approved argv, `shell:false`, derived receipt | replacement argv and process exit tests | tester journeys pending | source PASS; release pending |
| Same or missing identities | provenance-bound cross-field checks | same-ID and stale-SHA tests | Codex durable-ID visibility pending | source PASS; release pending |
| Unsafe or stale artifacts | tracked regular paths, SHA, Git blob/owner | path, symlink, untracked, corruption tests | OS path receipts pending | source PASS; release pending |
| False release-ready state | read-only recomputation of Git and receipts | adversarial validation tests | two reconstructed bundles pending | source PASS; release pending |
| Legacy mutation | audit-only contract-1 path | byte-preserving audit-v1 test | legacy installed fixture pending | source PASS; release pending |
| Reproducible bundle | pinned TypeScript/Ajv, single-file ESM | rebuild and import/secret/path scans | Node 22 OS receipts pending | source PASS; release pending |
| Dependency/license/security | exact lock, CycloneDX SBOM, licenses | CI offline checks; `npm audit` reports zero vulnerabilities | independent platform audit pending | local PASS; release pending |
| Protected effects and identity | direct/wrapped protected forms denied; preflight/handoff fail closed without authenticated host capability | absolute/interpreter denial and caller-flag rejection | native authenticated capability unavailable | BLOCKED |
| Performance limits | bounded counters and envelopes | static ceilings | delegation/turn/runtime/token receipt pending | pending |
| Official plugin acceptance | skills-only 0.1.1 manifest | validator launcher fails closed | official validator/cache refresh pending | pending |

Publication remains blocked until Linux, macOS, and Windows receipts; all
installed-plugin journeys; three fixtures per route; two independently
reconstructed validating bundles; performance evidence; dependency audit;
directory/name/trademark clearance; and final independent architect PASS with
no P0/P1 findings. No merge, push, PR, deployment, publication, or plugin
submission is performed by this workflow.

The current native Codex child-process surface does not expose authenticated
delegation identity or active host-effect approval to `r2rctl`. Caller flags are
not evidence, so the CLI exits 4 at preflight/final handoff. Release remains
blocked until that host capability exists; no MCP, service, hook, or custom
orchestration substitute is authorized.
