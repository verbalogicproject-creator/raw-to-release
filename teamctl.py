#!/usr/bin/env python3
"""Safe installer and validator for the Codex personal model team."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import tomllib
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PACKAGE_VERSION = "0.1.0"
MANIFEST_NAME = "codex-model-team.manifest.json"
BEGIN_MARKER = "<!-- codex-model-team:begin -->"
END_MARKER = "<!-- codex-model-team:end -->"
ROOT = Path(__file__).resolve().parent
TEMPLATES = ROOT / "templates"

AGENT_SPECS: dict[str, dict[str, str]] = {
    "architect": {
        "model": "gpt-5.6-sol",
        "model_reasoning_effort": "high",
        "sandbox_mode": "read-only",
    },
    "operator": {
        "model": "gpt-5.6-terra",
        "model_reasoning_effort": "medium",
        "sandbox_mode": "workspace-write",
    },
    "analyst": {
        "model": "gpt-5.6-luna",
        "model_reasoning_effort": "low",
        "sandbox_mode": "read-only",
    },
    "sprinter": {
        "model": "gpt-5.3-codex-spark",
        "model_reasoning_effort": "medium",
        "sandbox_mode": "workspace-write",
    },
}

AGENT_SETTINGS: dict[str, Any] = {
    "enabled": True,
    "max_concurrent_threads_per_session": 3,
    "interrupt_message": True,
}

SECTION_RE = re.compile(r"^\s*\[([^]]+)]\s*(?:#.*)?$")
ASSIGNMENT_RE = re.compile(r"^\s*([A-Za-z0-9_.-]+)\s*=")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class TeamError(RuntimeError):
    """Expected validation, collision, or installation failure."""


@dataclass
class InstallPlan:
    codex_home: Path
    writes: dict[Path, str]
    manifest: dict[str, Any]
    actions: list[str]


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def parse_toml(text: str, label: str) -> dict[str, Any]:
    try:
        return tomllib.loads(text) if text.strip() else {}
    except tomllib.TOMLDecodeError as exc:
        raise TeamError(f"{label} is not valid TOML: {exc}") from exc


def validate_codex_home(codex_home: Path) -> Path:
    resolved = codex_home.expanduser().resolve()
    forbidden = {Path("/").resolve(), Path.home().resolve()}
    if resolved in forbidden:
        raise TeamError(f"refusing unsafe Codex home target: {resolved}")
    return resolved


def safe_target(codex_home: Path, relative: str) -> Path:
    root = validate_codex_home(codex_home)
    target = (root / relative).resolve()
    if target == root or root not in target.parents:
        raise TeamError(f"managed path escapes Codex home: {relative!r}")
    return target


def render_toml_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    raise TeamError(f"unsupported managed TOML value: {value!r}")


def load_manifest(codex_home: Path) -> dict[str, Any] | None:
    codex_home = validate_codex_home(codex_home)
    path = safe_target(codex_home, MANIFEST_NAME)
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise TeamError(f"cannot read managed manifest {path}: {exc}") from exc
    if value.get("schema_version") != 1:
        raise TeamError(f"unsupported manifest schema in {path}")
    expected_agent_files = {f"agents/{name}.toml" for name in AGENT_SPECS}
    agent_files = value.get("agent_files")
    if not isinstance(agent_files, dict) or set(agent_files) != expected_agent_files:
        raise TeamError(f"manifest has an unexpected managed agent set: {path}")
    if any(not isinstance(item, str) or not SHA256_RE.fullmatch(item) for item in agent_files.values()):
        raise TeamError(f"manifest has an invalid agent hash: {path}")
    block_hash = value.get("global_block_sha256")
    if not isinstance(block_hash, str) or not SHA256_RE.fullmatch(block_hash):
        raise TeamError(f"manifest has an invalid guidance hash: {path}")
    config_keys = value.get("config_added_keys")
    if not isinstance(config_keys, list) or not set(config_keys).issubset(AGENT_SETTINGS):
        raise TeamError(f"manifest has unexpected managed config keys: {path}")
    return value


def template_agent_texts() -> dict[str, str]:
    return {
        name: read_text(TEMPLATES / "agents" / f"{name}.toml")
        for name in AGENT_SPECS
    }


def extract_managed_block(text: str) -> str | None:
    begin_count = text.count(BEGIN_MARKER)
    end_count = text.count(END_MARKER)
    if begin_count == 0 and end_count == 0:
        return None
    if begin_count != 1 or end_count != 1:
        raise TeamError("AGENTS.md contains malformed or duplicate managed markers")
    start = text.index(BEGIN_MARKER)
    end = text.index(END_MARKER, start) + len(END_MARKER)
    return text[start:end]


def install_managed_block(current: str, desired: str) -> tuple[str, str | None]:
    desired_block = extract_managed_block(desired)
    if desired_block is None:
        raise TeamError("AGENTS block template is missing managed markers")
    current_block = extract_managed_block(current)
    if current_block is None:
        prefix = current.rstrip()
        result = f"{prefix}\n\n{desired_block}\n" if prefix else f"{desired_block}\n"
        return result, None
    start = current.index(BEGIN_MARKER)
    end = current.index(END_MARKER, start) + len(END_MARKER)
    return f"{current[:start]}{desired_block}{current[end:]}", current_block


def remove_managed_block(current: str) -> str:
    block = extract_managed_block(current)
    if block is None:
        return current
    start = current.index(BEGIN_MARKER)
    end = current.index(END_MARKER, start) + len(END_MARKER)
    before = current[:start].rstrip()
    after = current[end:].lstrip("\r\n")
    if before and after:
        return f"{before}\n\n{after}"
    if before:
        return f"{before}\n"
    return after


def section_bounds(lines: list[str], section_name: str) -> tuple[int, int] | None:
    start: int | None = None
    for index, line in enumerate(lines):
        match = SECTION_RE.match(line)
        if not match:
            continue
        if start is not None:
            return start, index
        if match.group(1).strip() == section_name:
            start = index
    return (start, len(lines)) if start is not None else None


def merge_agents_config(
    current: str, previous_manifest: dict[str, Any] | None
) -> tuple[str, list[str], bool]:
    parsed = parse_toml(current, "config.toml")
    current_agents = parsed.get("agents", {})
    if current_agents is not None and not isinstance(current_agents, dict):
        raise TeamError("config.toml [agents] must be a table")

    previous_added = set((previous_manifest or {}).get("config_added_keys", []))
    added_keys: list[str] = []
    for key, expected in AGENT_SETTINGS.items():
        if key in current_agents:
            if current_agents[key] != expected:
                raise TeamError(
                    f"config.toml [agents].{key} is {current_agents[key]!r}; "
                    f"expected {expected!r}. Refusing to overwrite an explicit setting."
                )
        else:
            added_keys.append(key)

    lines = current.splitlines()
    bounds = section_bounds(lines, "agents")
    section_created = bounds is None
    additions = [f"{key} = {render_toml_value(AGENT_SETTINGS[key])}" for key in added_keys]

    if bounds is None:
        while lines and not lines[-1].strip():
            lines.pop()
        if lines:
            lines.append("")
        lines.append("[agents]")
        lines.extend(additions)
    elif additions:
        _, end = bounds
        insert_at = end
        while insert_at > bounds[0] + 1 and not lines[insert_at - 1].strip():
            insert_at -= 1
        lines[insert_at:insert_at] = additions

    result = "\n".join(lines)
    if result:
        result += "\n"
    parse_toml(result, "merged config.toml")
    managed_keys = sorted(previous_added | set(added_keys))
    was_created = bool((previous_manifest or {}).get("config_section_created", False))
    return result, managed_keys, section_created or was_created


def remove_managed_config(current: str, manifest: dict[str, Any]) -> str:
    parsed = parse_toml(current, "config.toml")
    agents = parsed.get("agents", {})
    managed_keys = set(manifest.get("config_added_keys", []))
    for key in managed_keys:
        expected = AGENT_SETTINGS.get(key)
        if key not in agents:
            continue
        if agents[key] != expected:
            raise TeamError(
                f"config.toml [agents].{key} changed after installation; "
                "refusing to remove it"
            )

    lines = current.splitlines()
    bounds = section_bounds(lines, "agents")
    if bounds is None:
        return current
    start, end = bounds
    remove_indexes: set[int] = set()
    found: set[str] = set()
    for index in range(start + 1, end):
        match = ASSIGNMENT_RE.match(lines[index])
        if match and match.group(1) in managed_keys:
            remove_indexes.add(index)
            found.add(match.group(1))
    missing_lines = managed_keys - found - (managed_keys - set(agents))
    if missing_lines:
        raise TeamError(
            "cannot safely locate managed config assignments: "
            + ", ".join(sorted(missing_lines))
        )
    kept = [line for index, line in enumerate(lines) if index not in remove_indexes]
    result = "\n".join(kept)
    if result:
        result += "\n"
    parse_toml(result, "uninstalled config.toml")
    return result


def validate_templates() -> list[str]:
    messages: list[str] = []
    for name, expected in AGENT_SPECS.items():
        path = TEMPLATES / "agents" / f"{name}.toml"
        if not path.exists():
            raise TeamError(f"missing agent template: {path}")
        data = parse_toml(read_text(path), str(path))
        for field in ("name", "description", "developer_instructions"):
            if not isinstance(data.get(field), str) or not data[field].strip():
                raise TeamError(f"{path} requires non-empty {field}")
        if data["name"] != name:
            raise TeamError(f"{path} name must be {name!r}")
        for field, value in expected.items():
            if data.get(field) != value:
                raise TeamError(f"{path} {field} must be {value!r}")
        messages.append(f"valid template: {name}")

    block = read_text(TEMPLATES / "AGENTS.block.md")
    if extract_managed_block(block) is None:
        raise TeamError("managed AGENTS block is missing")
    for token in ("objective:", "acceptance_evidence:", "status: complete | partial | blocked"):
        if token not in block:
            raise TeamError(f"managed AGENTS block is missing contract token {token!r}")
    messages.append("valid template: AGENTS.block.md")
    return messages


def build_install_plan(codex_home: Path) -> InstallPlan:
    codex_home = validate_codex_home(codex_home)
    validate_templates()
    manifest = load_manifest(codex_home)
    writes: dict[Path, str] = {}
    actions: list[str] = []
    agent_hashes: dict[str, str] = {}

    previous_hashes = (manifest or {}).get("agent_files", {})
    for name, desired in template_agent_texts().items():
        relative = f"agents/{name}.toml"
        destination = safe_target(codex_home, relative)
        desired_hash = sha256_text(desired)
        agent_hashes[relative] = desired_hash
        if destination.exists():
            current = read_text(destination)
            current_hash = sha256_text(current)
            previous_hash = previous_hashes.get(relative)
            if current_hash == desired_hash:
                continue
            if previous_hash != current_hash:
                raise TeamError(
                    f"unmanaged or locally modified agent collision: {destination}"
                )
            actions.append(f"update {destination}")
        else:
            actions.append(f"create {destination}")
        writes[destination] = desired

    agents_path = safe_target(codex_home, "AGENTS.md")
    agents_current = read_text(agents_path)
    desired_block_file = read_text(TEMPLATES / "AGENTS.block.md")
    desired_block = extract_managed_block(desired_block_file)
    assert desired_block is not None
    new_agents, current_block = install_managed_block(agents_current, desired_block_file)
    if current_block is not None and current_block != desired_block:
        previous_block_hash = (manifest or {}).get("global_block_sha256")
        if previous_block_hash != sha256_text(current_block):
            raise TeamError(f"managed block in {agents_path} was modified locally")
    if new_agents != agents_current:
        actions.append(f"update {agents_path}" if agents_path.exists() else f"create {agents_path}")
        writes[agents_path] = new_agents

    config_path = safe_target(codex_home, "config.toml")
    config_current = read_text(config_path)
    config_new, config_added_keys, section_created = merge_agents_config(
        config_current, manifest
    )
    if config_new != config_current:
        actions.append(f"update {config_path}" if config_path.exists() else f"create {config_path}")
        writes[config_path] = config_new

    now = datetime.now(timezone.utc).isoformat()
    updated_at = now if writes or manifest is None else manifest.get("updated_at", now)
    new_manifest = {
        "schema_version": 1,
        "package_version": PACKAGE_VERSION,
        "installed_at": (manifest or {}).get("installed_at", now),
        "updated_at": updated_at,
        "agent_files": agent_hashes,
        "global_block_sha256": sha256_text(desired_block),
        "config_added_keys": config_added_keys,
        "config_section_created": section_created,
    }
    manifest_path = safe_target(codex_home, MANIFEST_NAME)
    manifest_text = json.dumps(new_manifest, indent=2, sort_keys=True) + "\n"
    if read_text(manifest_path) != manifest_text:
        actions.append(f"write {manifest_path}")
        writes[manifest_path] = manifest_text

    return InstallPlan(codex_home, writes, new_manifest, actions)


def atomic_write(path: Path, content: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    existing_mode = path.stat().st_mode & 0o777 if path.exists() else mode
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, existing_mode)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def create_backup(codex_home: Path, targets: list[Path]) -> Path:
    codex_home = validate_codex_home(codex_home)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    backup = codex_home / "backups" / "codex-model-team" / timestamp
    backup.mkdir(parents=True, exist_ok=False)
    metadata: dict[str, Any] = {"created_at": timestamp, "files": {}}
    for target in targets:
        try:
            relative = target.relative_to(codex_home)
        except ValueError as exc:
            raise TeamError(f"backup target escapes Codex home: {target}") from exc
        relative_text = relative.as_posix()
        if target.exists():
            destination = backup / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, destination)
            metadata["files"][relative_text] = {
                "existed": True,
                "sha256": sha256_bytes(target.read_bytes()),
            }
        else:
            metadata["files"][relative_text] = {"existed": False}
    atomic_write(backup / "backup.json", json.dumps(metadata, indent=2, sort_keys=True) + "\n")
    return backup


def apply_install(plan: InstallPlan, dry_run: bool) -> None:
    if not plan.actions:
        print("codex-model-team is already installed and current")
        return
    for action in plan.actions:
        print(f"PLAN {action}" if dry_run else action)
    if dry_run:
        return
    plan.codex_home.mkdir(parents=True, exist_ok=True)
    targets = list(plan.writes)
    backup = create_backup(plan.codex_home, targets)
    manifest_path = plan.codex_home / MANIFEST_NAME
    for path, content in plan.writes.items():
        if path == manifest_path:
            continue
        atomic_write(path, content)
    if manifest_path in plan.writes:
        atomic_write(manifest_path, plan.writes[manifest_path])
    print(f"backup {backup}")


def validate_installed(codex_home: Path) -> list[str]:
    codex_home = validate_codex_home(codex_home)
    manifest = load_manifest(codex_home)
    if manifest is None:
        raise TeamError(f"{MANIFEST_NAME} is not installed in {codex_home}")
    messages: list[str] = []
    for relative, expected_hash in manifest.get("agent_files", {}).items():
        path = safe_target(codex_home, relative)
        if not path.exists() or sha256_bytes(path.read_bytes()) != expected_hash:
            raise TeamError(f"installed agent does not match manifest: {path}")
        parse_toml(read_text(path), str(path))
        messages.append(f"valid installed agent: {relative}")

    agents_path = safe_target(codex_home, "AGENTS.md")
    block = extract_managed_block(read_text(agents_path))
    if block is None or sha256_text(block) != manifest.get("global_block_sha256"):
        raise TeamError(f"installed managed block does not match manifest: {agents_path}")
    messages.append("valid installed global guidance")

    config = parse_toml(
        read_text(safe_target(codex_home, "config.toml")), "installed config.toml"
    )
    agents = config.get("agents", {})
    for key, expected in AGENT_SETTINGS.items():
        if agents.get(key) != expected:
            raise TeamError(f"installed [agents].{key} must be {expected!r}")
    messages.append("valid installed agent settings")
    return messages


def build_uninstall_plan(codex_home: Path) -> tuple[dict[Path, str], list[Path], list[str]]:
    codex_home = validate_codex_home(codex_home)
    manifest = load_manifest(codex_home)
    if manifest is None:
        raise TeamError(f"codex-model-team is not installed in {codex_home}")
    writes: dict[Path, str] = {}
    deletes: list[Path] = []
    actions: list[str] = []

    for relative, expected_hash in manifest.get("agent_files", {}).items():
        path = safe_target(codex_home, relative)
        if not path.exists():
            continue
        if sha256_bytes(path.read_bytes()) != expected_hash:
            raise TeamError(f"refusing to remove locally modified agent: {path}")
        deletes.append(path)
        actions.append(f"remove {path}")

    agents_path = safe_target(codex_home, "AGENTS.md")
    agents_current = read_text(agents_path)
    block = extract_managed_block(agents_current)
    if block is not None:
        if sha256_text(block) != manifest.get("global_block_sha256"):
            raise TeamError(f"refusing to remove modified managed block: {agents_path}")
        agents_new = remove_managed_block(agents_current)
        writes[agents_path] = agents_new
        actions.append(f"update {agents_path}")

    config_path = safe_target(codex_home, "config.toml")
    config_current = read_text(config_path)
    config_new = remove_managed_config(config_current, manifest)
    if config_new != config_current:
        writes[config_path] = config_new
        actions.append(f"update {config_path}")

    manifest_path = safe_target(codex_home, MANIFEST_NAME)
    if manifest_path.exists():
        deletes.append(manifest_path)
        actions.append(f"remove {manifest_path}")
    return writes, deletes, actions


def apply_uninstall(codex_home: Path, dry_run: bool) -> None:
    writes, deletes, actions = build_uninstall_plan(codex_home)
    for action in actions:
        print(f"PLAN {action}" if dry_run else action)
    if dry_run:
        return
    backup = create_backup(codex_home, list(writes) + deletes)
    for path, content in writes.items():
        atomic_write(path, content)
    for path in deletes:
        if path.exists():
            path.unlink()
    agents_dir = codex_home / "agents"
    if agents_dir.exists() and not any(agents_dir.iterdir()):
        agents_dir.rmdir()
    print(f"backup {backup}")


def default_codex_home() -> Path:
    configured = os.environ.get("CODEX_HOME")
    return Path(configured).expanduser() if configured else Path.home() / ".codex"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    for command in ("install", "uninstall"):
        child = subparsers.add_parser(command)
        child.add_argument("--codex-home", type=Path, default=default_codex_home())
        child.add_argument("--dry-run", action="store_true")

    validate = subparsers.add_parser("validate")
    validate.add_argument("--codex-home", type=Path, default=default_codex_home())
    validate.add_argument("--installed", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "install":
            apply_install(build_install_plan(args.codex_home.expanduser().resolve()), args.dry_run)
        elif args.command == "uninstall":
            apply_uninstall(args.codex_home.expanduser().resolve(), args.dry_run)
        else:
            messages = validate_templates()
            if args.installed:
                messages.extend(validate_installed(args.codex_home.expanduser().resolve()))
            for message in messages:
                print(message)
    except TeamError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
