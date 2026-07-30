# Codex routing

These mappings are binding-local candidates; use only roles/models actually
visible in the current Codex session and record observed selection when exposed.

| Work | Native route | Preferred candidate | Fallback | Tools |
| --- | --- | --- | --- | --- |
| Reconnaissance | `explorer` | analyst / `gpt-5.6-luna` | read-only `default` | read, search, Git inspection only |
| Planning | fresh `default` | architect / `gpt-5.6-sol` | high-reasoning `default` | read only |
| Implementation | `worker` | operator / `gpt-5.6-terra` | `worker` at available balanced tier | task-declared local tools |
| Microtask | bounded `worker` | sprinter / `gpt-5.3-codex-spark` | operator / balanced worker | narrow declared tools |
| Verification | fresh `default` | architect / `gpt-5.6-sol` | fresh high-reasoning `default` | read and declared checks only |

Reconnaissance cannot edit, plan, install, or use network. Planning cannot edit
or dispatch implementation. Workers receive explicit file ownership, allowed
and forbidden tools, authority, evidence, and numeric limits. Tester and reviewer
must not be implementers and must read intent, plan, rules, diff, and evidence
from source.
