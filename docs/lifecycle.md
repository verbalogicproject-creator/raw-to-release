# Lifecycle

The public states are `intake`, `intent_confirmed`, `planned`, `approved`,
`implementing`, `verifying`, and `release_ready`, plus terminal `blocked` and
`aborted`. See the [normative lifecycle](../method/lifecycle/phase-1.md) for
transition, evidence, commit, persistence, and resume rules.

`release_ready` deliberately differs from released. The local branch is clean,
tested, reviewed, and handed off; the human still chooses whether to merge,
push, open a PR, deploy, or publish.
