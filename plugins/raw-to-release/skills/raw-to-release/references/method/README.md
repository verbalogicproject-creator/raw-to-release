# Raw to Release method 2.0.0

This directory is normative and provider-neutral. It defines the fixed Phase 1
lifecycle, authority and evidence rules, numeric budgets, and fourteen public JSON
Schema contracts. Bindings may select native roles and tools, but may not weaken
these gates.

Version 2 production records bind immutable hashes and asserted provenance
(which is not authentication). Consumers must reject unknown major
versions. Compatible minor versions may add only explicitly declared optional
fields. Structural schema validation is necessary but not sufficient: bindings
must also enforce the lifecycle and referential rules in `lifecycle/phase-1.md`.
