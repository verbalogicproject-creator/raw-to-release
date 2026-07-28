# Codex Model Team contributor guidance

- Keep the kit project-agnostic; project vocabulary belongs in repository-local
  overlays.
- Preserve existing personal Codex configuration and fail closed on unmanaged
  file or setting collisions.
- Never add API substitution for ChatGPT- or Codex-subscription model access.
- Keep protected effects under active host, sandbox, project, and human
  approval policies.
- Treat model output and dispatch as claims, not proof of execution.
- Run `python teamctl.py validate` and
  `python -m unittest discover -s tests -v` before committing.
