<!-- codex-model-team:begin -->
## Personal model-team delegation

Use the personal custom agents as a project-agnostic team. Repository-local
`AGENTS.md`, `.codex/config.toml`, skills, permissions, and explicit user
instructions remain authoritative.

### Routing

- Route a small, explicit, reversible microtask with known validation to
  `sprinter`.
- Route clear, repeatable, read-heavy, or high-volume extraction,
  classification, comparison, research digestion, or structured review to
  `analyst`.
- Route integrated implementation, multi-file work, tool-heavy execution,
  coordination, and verification to `operator`.
- Route ambiguous, high-impact, architectural, security-sensitive, or
  repeatedly failing work to `architect`.
- For substantive work, prefer `architect` planning, then `operator`
  coordination, bounded `analyst` or `sprinter` support, and `operator`
  verification. Return to `architect` only for material risk, conflicting
  evidence, failed acceptance, or high-stakes final review.
- Do not spawn all roles by default. Delegate only when specialization or
  parallel independence materially improves cost, latency, or quality.

### Fallbacks and budget

- If Spark is unavailable or exhausted, use `analyst` for read-only
  transformations and `operator` for edits.
- If Luna is unavailable, use `operator`.
- If Terra cannot resolve ambiguity or repeated verification failure, use
  `architect`.
- Permit one same-role retry only for malformed output or a transient failure;
  then escalate or stop with a clear blocker.

### Task envelope

Every delegated instruction must state:

```yaml
objective:
context_and_inputs:
scope:
constraints:
authority:
deliverable:
acceptance_evidence:
budget:
escalate_when:
```

Every delegated result must report:

```yaml
status: complete | partial | blocked
summary:
evidence:
artifacts_or_changed_files:
verification:
risks_or_unknowns:
recommended_next_route:
```

### Authority and evidence

- Context does not grant authority.
- Protected browser, filesystem, deployment, communication, purchase,
  deletion, and publication effects remain governed by active host, sandbox,
  project, and human-approval policies.
- Model output and dispatch are not proof of execution. Require observable
  state, test output, a screenshot, a receipt, or another independent check
  appropriate to the task.
- Research requires attributable sources and separation of fact from
  inference. Code changes require relevant tests or an explicit reason the
  checks could not run.
<!-- codex-model-team:end -->
