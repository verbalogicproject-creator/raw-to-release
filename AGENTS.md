# Raw to Release contributor guidance

- Keep the kit project-agnostic; project vocabulary belongs in repository-local
  overlays.
- Keep the canonical `method/` provider-neutral and keep the plugin skills-only.
- Never add API substitution for subscription model access.
- Keep protected effects under active host, sandbox, project, and human
  approval policies.
- Treat model output and dispatch as claims, not proof of execution.
- Run `python scripts/sync_method.py --check`,
  `python scripts/validate_repository.py`, and
  `python -m unittest discover -s tests -v`, and
  `python -m unittest discover -s examples/pocket-tasks/tests -v` before committing.
