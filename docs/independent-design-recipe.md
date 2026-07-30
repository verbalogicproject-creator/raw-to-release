# Recipe: Independent Design Pass — General-Purpose Idea-to-Production Framework

*(updated — reflects everything decided on the Claude Code side as of 2026-07-29;
this document is still a brief for an INDEPENDENT design, not a spec to copy)*

## Context

You're being asked to independently architect a transformation of an existing
personal Codex-native delegation framework (`codex-model-team` — you're
sitting in it right now: `architect`/`operator`/`analyst`/`sprinter` roles
on `gpt-5.6-sol`/`terra`/`luna` and `gpt-5.3-codex-spark`, a `teamctl.py`
installer, `AGENTS.md` contributor guidance) into a general-purpose,
publicly-releasable framework for ANY user of an AI coding CLI — not just
its original author.

This is one of two parallel, INDEPENDENT design efforts on the same goal.
The other is happening separately, on the Claude Code side, using a sibling
repo (`claude-model-team`, being renamed **In the Loop**, a Verbalogix
project) as its foundation. That effort has now reached a decided,
detailed Phase 1 plan — described below for shared ground-truth ONLY, not
as something to converge on. Do not assume you know its exact file layout
or try to mirror it structurally. Solve this fresh, using whatever
mechanisms are idiomatic to Codex's own platform (its own agent/task/tool
primitives — use those natively; don't force a Claude-Code-specific concept
onto this design unless Codex has a real equivalent).

This is a planning task. Do not write implementation code. Produce a design.

## What exists today on the Claude Code side (shared ground truth — same facts either design effort should see)

- 5 roles routed by task shape rather than task label, a shared task-envelope
  (`objective/context_and_inputs/scope/constraints/authority/deliverable/
  acceptance_evidence/budget/escalate_when`) and result-contract
  (`status/summary/evidence/artifacts_or_changed_files/verification/
  risks_or_unknowns/recommended_next_route`), a hash-manifest installer,
  14+ tests.
- **A measured, still-unsolved problem**: a usage audit of 118 sessions /
  32,147 turns found 84.6% of turns ran on the top-tier model, 0% on the
  cheapest tier — despite the cheap tier existing and being documented.
  The routing contract is not empirically shown to be followed in practice.
  Treat "will this actually get used as routed" as a thing to measure on
  your own platform too, not just architect and hope for.
- A forked/isolated Claude Code subagent does NOT retain access to
  interactive user-question tools at runtime, even when its own tool
  declarations claim it does. If Codex's own isolation/subagent mechanism
  has an equivalent limitation, check it empirically before designing an
  interactive front door around it — don't assume either way.
- Four sibling personal Claude Code assets (a production-audit pipeline, a
  repo-extraction/ship pipeline, a 30-agent adversarial-review council, a
  frontend design agent) contain valuable, provable patterns but are each
  hard-coupled to one person's environment — in one case via actual
  executable identity-gating code (a `git log` author check requiring an
  exact name, a literal client-name denylist regex in a shell command).
  None of the four ship any automated tests.
- **New since the last version of this recipe**: a fifth asset was found —
  an already-built `points-dots` plugin implementing a 5-Dot intake
  interview (Literal Task / Strategic Intent / Boundaries / Task Type /
  Relevant Principles) via interactive confirmation gates, MCP-backed
  cross-session persistence, per-task-item traceability back to which Dot
  produced it, and a structured hand-off into an implementation plan. It's
  more complete than what either design track started with. Its one
  environment-specific step is a sync call into the original author's
  personal knowledge system — everything else is already fairly generic.
  If Codex's platform has (or could have) an equivalent intake mechanism,
  this is worth studying as a reference for maturity level, not copying.
- **New competitive-landscape finding**: `github.com/haeriamin/throughline`
  already ships a close architectural cousin on the Claude Code side — a
  spec-driven, multi-agent, provider-neutral-core-with-per-tool-adapters
  framework, agents literally named Analyst/Implementer, an independent
  reviewer that reads standards from source rather than trusting the
  implementer's own summary, a human-only merge gate, and — notably —
  it *already* ships adapters for eight different AI coding tools, Codex
  included. It's small (0 stars, experimental, one author) but real. This
  means "nothing like this exists yet" is not the honest starting
  assumption for either design track. Worth reading directly before you
  design, specifically to find genuine gaps rather than re-deriving
  something that already exists at similar maturity.

## Confirmed goal and constraints (same for both tracks — these came from a live interview with the project owner, not from either design's own reasoning)

Build a customizable, modular orchestration-and-delegation framework that
takes a user from a raw idea to a shipped, production-quality product —
surfacing expertise (architecture decisions, testing discipline, security
gates, documentation bars) a beginner doesn't know they need, while also
supercharging an expert's throughput. Explicitly meant to be a genuine
portfolio/recognition piece for its author, so public-release quality is a
day-one requirement.

- **Phased roadmap** — architect the whole system, ship as ordered,
  independently buildable/testable phases. Not one big build, not a
  throwaway v1.
- **Fully generic from day one, every phase** — zero hardcoded personal
  paths, usernames, or environment assumptions, from the first phase.
- **Two-layer architecture** — a provider/model-agnostic spec (the intake
  methodology, task-envelope/result-contract, production-squad concept,
  authority/evidence discipline) and a native binding per platform. The
  Claude Code side is building `spec/` (provider-neutral) plus
  `bindings/claude-code/` (native). Your job, if you choose to follow the
  same shape, is a fully independent `bindings/codex/`-equivalent — or
  your own better idea for the same two-layer promise.
- **Public release from day one** — permissive license, real quickstart,
  docs/tests at genuine portfolio quality.
- **An onboarding EXPERIENCE, not just docs** — the project owner has
  separately published a real, working example of this done well: a
  20-chapter curriculum where every chapter compounds on ONE anchor
  example rather than N disconnected demos, offers goal-based reading
  paths (novice / expert / "just this one feature"), and closes every
  exercise with a concrete "verify your build" check. Whatever front door
  you design should hit this bar: learning the framework and using it on a
  real first project should be the same act, not two separate activities.

## Relevant principles (apply throughout)

1. Native over bespoke — dispatch through your platform's own primitives;
   no custom orchestration SDK reinventing what the platform provides.
2. Tests are the bar, not prompts — every new/rebuilt piece ships with real
   automated tests.
3. Confirm-before-claim — any audit/verify-shaped agent defaults to
   "not found/not done" until an empirical check proves otherwise.
4. Numeric limits over prose limits — cost ceilings, cycle caps, retries
   are enforced numbers, not soft "escalate if it feels expensive" language.
5. Condensed result contracts — every delegated unit of work returns a
   short, structured summary regardless of internal work done.
6. Gates for cheap tiers, not for self-verifying ones — cheap-tier stages
   need explicit allowed/forbidden tool lists and hard stop points;
   top-tier agents shouldn't carry redundant self-verification boilerplate
   if the underlying model already self-verifies.
7. A heuristic earns permanence, it isn't assumed one — new rules
   discovered mid-build get logged with their justification and only
   harden into permanent policy after recurring across multiple real cases.
8. Public-repo hygiene from day one — license, quickstart, docs held to a
   genuine bar, not deferred.

## Source material worth generalizing FROM (unchanged from the prior version of this recipe — summarized)

1. **Production-audit pipeline** (scout → prover → fixer → cicd): cheap
   wide-net triage, empirical-probe confirmation (defaults to "not a bug"
   until proven), class-standard fixes with regression tests, full CI/CD
   verification. Adopt: its "a bug class only graduates into the catalog
   after confirming across multiple real repos" rule; its deprecated-alias
   convention for renamed components. Strip: personal repo names baked
   into its worked examples (its operating rules are already generic).
2. **Repo-extraction/ship pipeline** (coder → documenter → verifier): turns
   a script into an installable package, produces a full doc suite,
   adversarially gates release. Adopt: numeric cost-ceiling + cycle-cap
   pattern; capped, owner-tagged retry-on-failure. Strip (heaviest burden
   of anything studied — actual executable code, not prose): a git-log
   check requiring an exact author name, a literal name-based denylist
   regex, a hardcoded email in a runnable commit command.
3. **Adversarial-review council** (5 core roles: hostile critic, empirical
   assumption-auditor, failure-mode scanner, blind-spot explorer, dedicated
   steelman defender, plus many optional specialist packs). Adopt: the
   asymmetric shape itself (more attackers than defenders, always exactly
   one dedicated defender), prose-only verdicts, convergence-as-trust-
   signal, shared context computed once and injected identically
   everywhere. Strip: even several "core" agents hardcode a persona fixing
   them to one narrow technical domain and runtime — the "generic core"
   isn't fully generic today.
4. **Frontend design/restyling agent**: reads architecture docs, restyles
   within pre-declared boundaries, verifies the build stays green. Wanted:
   generalized and upgraded into a fuller editor role. Strip: a bespoke
   architecture-card format with non-standard slot names, a hardcoded
   absolute path to design standards, references to the original author's
   own framework components by name.

## New components wanted (design these; none exist yet on either track)

- A FastAPI-specialist agent.
- A schema-specialist agent.
- A Git/repo-hosting lifecycle agent, deliberately narrow in scope: helps a
  user with no account create one, handles repo init, commits, versioning,
  pushing.
- A rewrite of a personal orchestration-format spec (Philosophy / Topology /
  State-Schema / Agent-Nodes / Execution / Routing-Rules sections, the last
  with a real grammar for conditional/skip/abort/checkpoint/cycle-back-max-N/
  compound-AND-OR routing, plus a genuine per-tier cost model). Its
  Philosophy/Topology/State-Schema/Routing-Rules sections are already
  provider-neutral; its Agent-Nodes/Execution sections currently assume a
  bespoke Python SDK and need rewriting so whichever platform executes it
  dispatches each node through that platform's own native mechanism.
- An upgraded interactive front door fusing a live, question-driven planning
  interview with a "5 Dots" intake methodology (see the points-dots finding
  above) — Dots confirmed one at a time BEFORE any plan tasks are
  formulated — PLUS the curriculum-grade onboarding experience described
  above (one compounding example, goal-based paths, verify-your-build
  checkpoints).
- Routing more pipeline stages to the cheapest reliable tier, using
  explicit stop/wait gates and allowed/forbidden tool lists per phase to
  make cheap-tier stages trustworthy — aimed at closing the measured
  84.6%/0% imbalance described above (or whatever the equivalent
  measurement turns out to be on Codex's own usage).

## Your task

Produce, independently:

1. **A phased roadmap** — your own dependency-ordered decomposition. Don't
   assume any particular phase count or mirror the Claude-side phase count.
   State why each phase can't start before the previous one lands.
2. **A detailed, execution-ready design for whichever phase should go
   first** — concrete enough to start building immediately: what to
   create in `codex-model-team`, what to test, how "done" is verified.
   Keep everything after phase 1 at architecture-level only.
3. **2-3 candidate names** — your own, independent of "In the Loop." Must
   not read as branded to any one person's existing project; should evoke
   "translates a beginner's vague idea into professional-grade production,
   while also supercharging experts"; avoid generic overused dev-tool
   naming (Forge, Blueprint, Compass, Scaffold, Nexus, Catalyst, and now
   also avoid anything evocative of "throughline"/unbroken-line/thread
   imagery, since that space has a real existing occupant).

## Terms of engagement

This stays a deliberately separate, independent track. Build it as its own
standalone design — don't hedge toward compatibility with the Claude Code
side's specific file layout or tool names. If and when this track proves
successful, it may be reconciled with the other one later. Until then, it
stands alone.
