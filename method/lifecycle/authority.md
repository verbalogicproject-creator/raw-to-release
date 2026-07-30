# Authority, evidence, and budgets

Context never grants authority. Each task records allowed and forbidden tools,
allowed local effects, approval-gated effects, included and excluded scope, and
acceptance evidence. Unknown and unobservable facts remain explicitly unknown.

Defaults are hard ceilings: 12 total delegations, 3 concurrent agents, 8
implementation tasks, 2 fix–review cycles, and 1 malformed/transient retry.
Exceeding a ceiling requires fresh human approval recorded as evidence. Token and
monetary enforcement are `unobservable` unless the active surface exposes
trustworthy measurements.

The plan checkpoint seals the complete task-authority set by SHA-256. A task
record carries that exact hash; adding a fallback tool, effect, route, or scope
after approval requires a new immutable human approval receipt and a committed
authority revision. Self-dependencies, dependency cycles, counter overflow,
retry exhaustion, and a third repair attempt are lifecycle blocks.

Intent and plan approvals bind the user assertion, revision, exact displayed
content hash, approval type, and time. Identity values are durable delegation
IDs asserted by the host, not authenticated persons. Release readiness requires
observable, mutually distinct tester and reviewer IDs, each distinct from every
implementer. Missing identity visibility fails closed.

Only the binding's evidence runtime may produce command receipts. It executes
the approved argv and repository-relative cwd without a shell and derives the
exit code, outcome, output hashes, test counts, and bounded redacted failure
excerpt from that process. Narrated commands and handwritten receipts are not
evidence.

Network access, dependency installation, account creation, remote writes,
merge, push, review-request creation, deployment, and publication follow active
host and human approval policy. The method itself authorizes none of them.
