# Acceptance Record — 2026-07-28

## Environment

- Surface: Codex session on Termux/Android
- Personal Codex home: `/data/data/com.termux/files/home/.codex`
- Parent default preserved: `gpt-5.6-sol`, high reasoning
- Intended roles: architect/Sol, operator/Terra, analyst/Luna,
  sprinter/GPT-5.3-Codex-Spark

## Automated acceptance

| Check | Result |
| --- | --- |
| Four agent templates parse as TOML with exact model, reasoning, and sandbox mappings | Pass |
| Global guidance contains adaptive routing, fallbacks, task envelope, result contract, and authority boundary | Pass |
| Clean and pre-existing isolated homes install successfully | Pass |
| Second installation makes no changes | Pass |
| Existing model, MCP, and unrelated configuration survive installation | Pass |
| Unmanaged agent collision fails closed | Pass |
| Modified managed files fail closed during uninstall | Pass |
| Tampered manifest paths and unexpected managed entries fail closed | Pass |
| Broad `/` and home-directory installation targets are rejected | Pass |
| Uninstall preserves unrelated guidance and configuration | Pass |
| Manifest stores hashes without absolute paths | Pass |
| Real-home dry run reports only intended managed changes | Pass |
| Installed files and configuration match the manifest | Pass |
| Real-home second dry run reports current/idempotent state | Pass |
| Real-home uninstall preview targets only managed content | Pass |

Automated command: `python -m unittest discover -s tests -v` — 11 tests passed.

## Installed configuration delta

The existing global configuration changed only by adding:

```toml
[agents]
enabled = true
max_concurrent_threads_per_session = 3
interrupt_message = true
```

The installer created four personal agent files, the managed global guidance,
and a hash manifest. The pre-install backup is stored under the personal Codex
home at `backups/codex-model-team/20260728T044339.245436Z`.

## Runtime dogfood boundary

This shell does not expose a standalone `codex` executable, so it cannot start
a second Codex process to prove model entitlement or live routing. Start a new
Codex session after installation and run the scenarios in `docs/dogfood.md`.
That runtime pass must record the actual selected role, surface-visible model,
fallbacks, approval events, and evidence without retaining chat transcripts or
private source content.
