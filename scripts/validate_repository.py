#!/usr/bin/env python3
"""Offline repository conformance checks for Raw to Release."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from contract_validation import ContractError, validate_schema

ROOT = Path(__file__).resolve().parents[1]
METHOD = ROOT / "method"
PLUGIN = ROOT / "plugins" / "raw-to-release"
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
NEUTRAL_FORBIDDEN = re.compile(r"(?i)(gpt-|codex|claude|gemini|/home/|\\\\Users\\\\|api[_ -]?key|password\s*=|chat transcript)")
CONTRACTS = {"intent-record", "run-state", "evidence-ref", "task-envelope", "task-result", "task-record", "capability-report", "run-observation"}
V2_CONTRACTS = {"tasks", "verification", "command-receipt", "review-receipt", "approval-receipt", "artifact-manifest"}

def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)

def load(path: Path):
    try: return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc: fail(f"invalid JSON {path.relative_to(ROOT)}: {exc}")

def main() -> int:
    manifest = load(PLUGIN / ".codex-plugin" / "plugin.json")
    for key, value in {"name": "raw-to-release", "version": "0.1.1", "license": "MIT", "skills": "./skills/"}.items():
        if manifest.get(key) != value: fail(f"manifest {key}")
    if not SEMVER.fullmatch(manifest["version"]): fail("manifest version is not strict semver")
    if manifest.get("author", {}).get("name") != "Eyal Bar Or": fail("manifest author")
    ui = manifest.get("interface", {})
    if ui.get("displayName") != "Raw to Release" or ui.get("category") != "Productivity" or set(ui.get("capabilities", [])) != {"Interactive", "Write"}: fail("manifest interface")
    if not ui.get("defaultPrompt") or any(len(item) > 128 for item in ui["defaultPrompt"]): fail("starter prompts")
    if any(key in manifest for key in ("hooks", "apps", "mcpServers")): fail("Phase 1 must be skills-only")

    marketplace = load(ROOT / ".agents" / "plugins" / "marketplace.json")
    matches = [entry for entry in marketplace.get("plugins", []) if entry.get("name") == "raw-to-release"]
    if len(matches) != 1: fail("marketplace must contain one Raw to Release entry")
    entry = matches[0]
    if entry.get("source") != {"source": "local", "path": "./plugins/raw-to-release"}: fail("marketplace source")
    if entry.get("policy") != {"installation": "AVAILABLE", "authentication": "ON_INSTALL"} or entry.get("category") != "Productivity": fail("marketplace policy")

    for path in METHOD.rglob("*"):
        if path.is_file() and NEUTRAL_FORBIDDEN.search(path.read_text(encoding="utf-8")): fail(f"non-neutral content in {path.relative_to(ROOT)}")
    schema_names = {path.stem for path in (METHOD / "contracts").glob("*.json")} - {"common"}
    if schema_names != CONTRACTS | V2_CONTRACTS: fail(f"contract set mismatch: {sorted(schema_names ^ (CONTRACTS | V2_CONTRACTS))}")
    for name in CONTRACTS:
        schema = load(METHOD / "contracts" / f"{name}.json")
        if not schema.get("$id") or "contract_version" not in schema.get("required", []): fail(f"unversioned contract {name}")
        fixture_dir = ROOT / "tests" / "fixtures" / name
        valid_path = fixture_dir / "valid.json"
        invalid_path = fixture_dir / "invalid.json"
        if name == "run-state":
            valid_path = ROOT / "tests" / "fixtures" / "run-state-valid.json"
            invalid_path = ROOT / "tests" / "fixtures" / "run-state-invalid.json"
        try:
            validate_schema(load(valid_path), f"{name}.json")
        except ContractError as exc: fail(f"valid {name} fixture rejected: {exc}")
        try:
            validate_schema(load(invalid_path), f"{name}.json")
        except ContractError:
            pass
        else: fail(f"invalid {name} fixture accepted")

    skill_root = PLUGIN / "skills" / "raw-to-release"
    required_assets = {"project.gitignore", "intent.json", "run-state.json", "plan.md", "tasks.json", "task-record.json", "capability-report.json", "verification.json", "run-observation.json", "handoff.md"}
    assets = {path.name for path in (skill_root / "assets" / "templates").glob("*")}
    if not required_assets <= assets: fail(f"missing templates: {sorted(required_assets - assets)}")
    if not (skill_root / "agents" / "openai.yaml").exists(): fail("missing skill UI metadata")
    skill_text = (skill_root / "SKILL.md").read_text(encoding="utf-8")
    if "$raw-to-release" not in (skill_root / "agents" / "openai.yaml").read_text(encoding="utf-8") or "[TODO" in skill_text: fail("skill metadata or placeholders")

    packaged = skill_root / "references" / "method"
    expected = {path.relative_to(METHOD) for path in METHOD.rglob("*") if path.is_file()}
    actual = {path.relative_to(packaged) for path in packaged.rglob("*") if path.is_file()}
    if expected != actual: fail("method package file set drift")
    for relative in expected:
        if (METHOD / relative).read_bytes() != (packaged / relative).read_bytes(): fail(f"method package content drift: {relative}")

    managed_text = "\n".join(path.read_text(encoding="utf-8") for root in (METHOD, PLUGIN) for path in root.rglob("*") if path.is_file() and "__pycache__" not in path.parts)
    for marker in ("legacy-global-install-command", "codex-model-team.manifest", "[TODO:"):
        if marker in managed_text: fail(f"stale or placeholder marker: {marker}")
    print("repository validation passed")
    return 0

if __name__ == "__main__": raise SystemExit(main())
