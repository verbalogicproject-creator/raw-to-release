# Architecture

`method/` is the normative provider-neutral layer: versioned JSON Schemas,
lifecycle, authority, evidence, and numeric budgets. The repository validator
enforces structural and semantic rules. `scripts/sync_method.py` deterministically
copies the complete method into the plugin; drift fails CI.

`plugins/raw-to-release/` is the Codex binding. It contains one principal skill,
native delegation instructions, binding-local routing candidates, references,
and artifact templates. It has no service, orchestration SDK, MCP server, app,
hook, or API substitution.

Target projects split persistence: ignored drafts and diagnostics under
`.raw-to-release/runtime/<run-id>/`, committed authoritative records under
`.raw-to-release/runs/<run-id>/`. Git provides the durable checkpoint boundary;
the skill interprets the method with native Codex tools and subagents.
