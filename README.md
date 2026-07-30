# Raw to Release

Raw to Release turns a rough idea into a tested, independently reviewed local
branch. Its provider-neutral method is packaged as a native, skills-only Codex
plugin. It never autonomously merges, pushes, opens a PR, deploys, or publishes.

Phase 1 is verified only for Codex CLI. Desktop, IDE, cloud, model visibility,
and cost enforcement remain unverified or unobservable until recorded otherwise.

## Install locally

Requirements: Codex CLI, Git, and Node 22 or newer. The installed plugin ships a
compiled dependency-free CLI and does not require `npm install`. From this
repository root:

```sh
codex plugin marketplace add .
codex plugin add raw-to-release@raw-to-release-local
codex plugin list --json
```

Start a new Codex CLI thread in a clean repository and say:

```text
Use $raw-to-release to turn my volunteer task idea into a verified local branch.
```

Raw to Release will interview you through five confirmed Dots, show a plan for
approval, implement only on `r2r/<run-id>`, test and review committed work, and
leave an evidence-backed handoff. Network access, dependency installation, and
other protected effects still use the host's approval flow.

Remove the local installation without changing this repository:

```sh
codex plugin remove raw-to-release@raw-to-release-local
codex plugin marketplace remove raw-to-release-local
```

See the current official [Codex plugin CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli#cli-codex-plugin).

## Learn on Pocket Tasks

The [Pocket Tasks curriculum](examples/pocket-tasks/README.md) compounds one
volunteer-task CLI through intake, planning, implementation, testing, review,
and handoff. It includes novice, expert, and feature-only paths with a verify
command at every checkpoint.

## Architecture and development

- `method/` — normative provider-neutral lifecycle and contracts.
- `plugins/raw-to-release/` — native Codex binding and artifact templates.
- `examples/pocket-tasks/` — Phase 1 onboarding project.
- `.raw-to-release/` — target-project records created during a run.

Development pins TypeScript and Ajv as build-only dependencies; the consumer
bundle has zero package dependencies:

```sh
npm ci
npm run build && npm run check:bundle && npm run check:schemas
npm test && npm run check:supply-chain -- --check
python scripts/sync_method.py --check
python scripts/validate_repository.py
python -m unittest discover -s tests -v
python -m unittest discover -s examples/pocket-tasks/tests -v
python scripts/run_official_plugin_validator.py
```

Read [architecture](docs/architecture.md), [lifecycle](docs/lifecycle.md),
[acceptance](docs/acceptance.md), [compatibility](docs/compatibility.md),
[migration](docs/migration.md), and the [roadmap](docs/roadmap.md).
