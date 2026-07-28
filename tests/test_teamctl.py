from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import teamctl


class TeamCtlTests(unittest.TestCase):
    def temporary_home(self) -> tuple[tempfile.TemporaryDirectory[str], Path]:
        temporary = tempfile.TemporaryDirectory()
        return temporary, Path(temporary.name) / ".codex"

    def install(self, codex_home: Path) -> None:
        with contextlib.redirect_stdout(io.StringIO()):
            teamctl.apply_install(teamctl.build_install_plan(codex_home), False)

    def test_templates_are_valid_and_models_are_exact(self) -> None:
        messages = teamctl.validate_templates()
        self.assertEqual(len(messages), 5)
        for name, expected in teamctl.AGENT_SPECS.items():
            data = teamctl.parse_toml(
                teamctl.read_text(teamctl.TEMPLATES / "agents" / f"{name}.toml"),
                name,
            )
            self.assertEqual(data["model"], expected["model"])
            self.assertEqual(data["sandbox_mode"], expected["sandbox_mode"])

    def test_install_is_idempotent_and_valid(self) -> None:
        temporary, codex_home = self.temporary_home()
        self.addCleanup(temporary.cleanup)
        self.install(codex_home)
        self.assertTrue(teamctl.validate_installed(codex_home))
        second = teamctl.build_install_plan(codex_home)
        self.assertEqual(second.actions, [])
        self.assertEqual(second.writes, {})

    def test_install_preserves_existing_global_configuration_and_guidance(self) -> None:
        temporary, codex_home = self.temporary_home()
        self.addCleanup(temporary.cleanup)
        codex_home.mkdir(parents=True)
        original_config = '''model = "gpt-5.6-sol"
model_reasoning_effort = "high"

[mcp_servers.example]
url = "https://example.invalid/mcp"
'''
        (codex_home / "config.toml").write_text(original_config, encoding="utf-8")
        (codex_home / "AGENTS.md").write_text(
            "# Existing personal guidance\n\nKeep this sentence.\n", encoding="utf-8"
        )

        self.install(codex_home)
        config = teamctl.parse_toml(
            (codex_home / "config.toml").read_text(encoding="utf-8"), "installed"
        )
        self.assertEqual(config["model"], "gpt-5.6-sol")
        self.assertEqual(config["model_reasoning_effort"], "high")
        self.assertEqual(config["mcp_servers"]["example"]["url"], "https://example.invalid/mcp")
        self.assertEqual(config["agents"], teamctl.AGENT_SETTINGS)
        guidance = (codex_home / "AGENTS.md").read_text(encoding="utf-8")
        self.assertIn("Keep this sentence.", guidance)
        self.assertEqual(guidance.count(teamctl.BEGIN_MARKER), 1)

    def test_unmanaged_agent_collision_fails_closed(self) -> None:
        temporary, codex_home = self.temporary_home()
        self.addCleanup(temporary.cleanup)
        agents = codex_home / "agents"
        agents.mkdir(parents=True)
        (agents / "architect.toml").write_text("name = 'mine'\n", encoding="utf-8")
        with self.assertRaisesRegex(teamctl.TeamError, "collision"):
            teamctl.build_install_plan(codex_home)

    def test_modified_managed_agent_is_not_removed(self) -> None:
        temporary, codex_home = self.temporary_home()
        self.addCleanup(temporary.cleanup)
        self.install(codex_home)
        architect = codex_home / "agents" / "architect.toml"
        architect.write_text(architect.read_text(encoding="utf-8") + "# local\n", encoding="utf-8")
        with self.assertRaisesRegex(teamctl.TeamError, "locally modified"):
            teamctl.build_uninstall_plan(codex_home)

    def test_uninstall_removes_only_managed_content(self) -> None:
        temporary, codex_home = self.temporary_home()
        self.addCleanup(temporary.cleanup)
        codex_home.mkdir(parents=True)
        (codex_home / "config.toml").write_text(
            "model = 'gpt-5.6-sol'\n\n[notice]\nkeep = true\n", encoding="utf-8"
        )
        (codex_home / "AGENTS.md").write_text("Keep me.\n", encoding="utf-8")
        self.install(codex_home)

        writes, deletes, _ = teamctl.build_uninstall_plan(codex_home)
        backup = teamctl.create_backup(codex_home, list(writes) + deletes)
        self.assertTrue((backup / "backup.json").exists())
        for path, content in writes.items():
            teamctl.atomic_write(path, content)
        for path in deletes:
            path.unlink()

        config = teamctl.parse_toml(
            (codex_home / "config.toml").read_text(encoding="utf-8"), "uninstalled"
        )
        self.assertEqual(config["model"], "gpt-5.6-sol")
        self.assertTrue(config["notice"]["keep"])
        self.assertEqual(config.get("agents"), {})
        self.assertEqual((codex_home / "AGENTS.md").read_text(encoding="utf-8"), "Keep me.\n")
        self.assertFalse((codex_home / teamctl.MANIFEST_NAME).exists())

    def test_dry_run_does_not_mutate_target(self) -> None:
        temporary, codex_home = self.temporary_home()
        self.addCleanup(temporary.cleanup)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = teamctl.main(["install", "--codex-home", str(codex_home), "--dry-run"])
        self.assertEqual(result, 0)
        self.assertIn("PLAN", output.getvalue())
        self.assertFalse(codex_home.exists())

    def test_manifest_contains_no_absolute_paths(self) -> None:
        temporary, codex_home = self.temporary_home()
        self.addCleanup(temporary.cleanup)
        self.install(codex_home)
        manifest = json.loads((codex_home / teamctl.MANIFEST_NAME).read_text(encoding="utf-8"))
        serialized = json.dumps(manifest)
        self.assertNotIn(str(codex_home), serialized)

    def test_tampered_manifest_path_fails_closed(self) -> None:
        temporary, codex_home = self.temporary_home()
        self.addCleanup(temporary.cleanup)
        self.install(codex_home)
        manifest_path = codex_home / teamctl.MANIFEST_NAME
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["agent_files"]["../../outside.toml"] = "0" * 64
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(teamctl.TeamError, "unexpected managed agent set"):
            teamctl.build_uninstall_plan(codex_home)

    def test_broad_codex_home_targets_are_rejected(self) -> None:
        with self.assertRaisesRegex(teamctl.TeamError, "unsafe Codex home"):
            teamctl.build_install_plan(Path("/"))
        with self.assertRaisesRegex(teamctl.TeamError, "unsafe Codex home"):
            teamctl.build_install_plan(Path.home())

    def test_routing_and_result_contract_are_installed(self) -> None:
        block = teamctl.read_text(teamctl.TEMPLATES / "AGENTS.block.md")
        for role in teamctl.AGENT_SPECS:
            self.assertIn(f"`{role}`", block)
        for field in (
            "objective:",
            "authority:",
            "acceptance_evidence:",
            "status: complete | partial | blocked",
            "verification:",
            "recommended_next_route:",
        ):
            self.assertIn(field, block)


if __name__ == "__main__":
    unittest.main()
