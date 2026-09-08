# Acceptance protocol

Automated checks validate manifests, marketplace wiring, all positive and
negative contract fixtures, unknown-major rejection, lifecycle transitions,
numeric ceilings, Dot→task→evidence links, release gates, 16 protected/failed/
resume journeys, method-package drift, hygiene, and Pocket Tasks behavior.

Public release additionally requires evidence that automation cannot manufacture:

1. Fresh Codex CLI sessions complete one greenfield and one clean-existing run.
2. Three fixtures per route shape select the expected role or record an explicit
   fallback; parent and delegated questioning are probed separately.
3. One deliberate reviewer failure is repaired within the two-cycle bound.
4. Observations prove no merge, push, PR, deployment, or publication occurred.
5. Linux and macOS CI receipts and the official plugin validator pass.
   Windows is out of scope and not qualified; see docs/compatibility.md.

Record only surface/version, requested and observed route/model when visible,
fallbacks, approvals, result, and acceptance outcome. Never record transcripts
or sensitive source content. Until these journeys are performed, CLI runtime
behavior is `unverified`; static validation alone is not empirical acceptance.
