# Codex Model Team

`codex-model-team` installs a project-agnostic personal delegation team for
Codex. It uses Codex custom agents rather than API substitution, so the team
can use models available through the signed-in Codex surface, including the
GPT-5.3-Codex-Spark research preview when the account exposes it.

The stable roles are:

| Agent | Model | Responsibility |
| --- | --- | --- |
| `architect` | `gpt-5.6-sol` | Ambiguous, important, architectural, and high-risk planning or review |
| `operator` | `gpt-5.6-terra` | Integrated implementation, tools, coordination, and verification |
| `analyst` | `gpt-5.6-luna` | Clear, repeatable, read-heavy, and high-volume knowledge work |
| `sprinter` | `gpt-5.3-codex-spark` | Near-instant, tightly bounded edits and experiments |

Repository guidance remains authoritative for local architecture, commands,
permissions, and completion rules. The personal team only supplies reusable
roles and routing behavior across coding, research, writing, planning, browser
investigation, and ordinary general-assistance work.

## Install

Preview the exact changes first:

```sh
python teamctl.py install --dry-run
```

Install and validate:

```sh
python teamctl.py install
python teamctl.py validate --installed
```

Use `--codex-home PATH` for an isolated installation or test. Otherwise the
CLI uses `CODEX_HOME` when set and `~/.codex` as the fallback.

The installer:

- preserves the existing parent model and reasoning setting;
- preserves project trust, MCP, hook, and unrelated configuration;
- adds only the required `[agents]` defaults when they are absent;
- manages one marked block in `AGENTS.md`;
- refuses to overwrite unmanaged agent files;
- stores timestamped backups under the selected Codex home;
- records hashes in `codex-model-team.manifest.json` for safe updates and
  uninstall.

Uninstall removes only content still matching the managed manifest:

```sh
python teamctl.py uninstall --dry-run
python teamctl.py uninstall
```

## Development

```sh
python teamctl.py validate
python -m unittest discover -s tests -v
```

See [docs/dogfood.md](docs/dogfood.md) for routing and safety acceptance
scenarios.

The implementation follows Codex's documented
[custom-agent](https://learn.chatgpt.com/docs/agent-configuration/subagents)
and [global configuration](https://learn.chatgpt.com/docs/config-file/config-basic)
surfaces.

## Boundaries

- This kit does not call a hidden model API or convert a ChatGPT subscription
  into API access.
- Model availability is detected by the Codex surface at spawn time. The
  routing contract defines fallbacks when a preferred model is unavailable.
- Models may investigate and propose protected actions, but active host,
  sandbox, and human-approval policies retain execution authority.
- Model narration is never treated as proof that an external effect occurred.
