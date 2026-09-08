# Compatibility

| Capability | Phase 1 status |
| --- | --- |
| Bundled Node 22 CLI | locally qualified; no consumer install |
| Installed plugin on Linux/macOS | pending empirical qualification |
| Installed plugin on Windows | not qualified; 11/34 tests fail with EPERM, not in CI |
| Codex CLI package shape | verified by local official validators |
| Codex CLI end-to-end journeys | unverified pending fresh sessions |
| Interaction and approval prompts | unverified per installed version |
| Model/route visibility | unobservable unless the surface reports it |
| Concurrency behavior | unverified |
| Token and monetary enforcement | unobservable |
| Desktop, IDE, and cloud | unverified |

The plugin runtime needs only Codex CLI and Git. Python is used for repository
development and the Pocket Tasks tutorial, not for plugin orchestration.
