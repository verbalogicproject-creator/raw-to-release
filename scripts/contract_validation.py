#!/usr/bin/env python3
"""Small offline validator for the Raw to Release schema subset and semantics."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / "method" / "contracts"
DOTS = {"literal_task", "strategic_intent", "boundaries", "task_type", "relevant_principles"}
LIMITS = {"delegations": 12, "concurrent_agents": 3, "implementation_tasks": 8, "fix_review_cycles": 2, "retries": 1}
STATES = ["intake", "intent_confirmed", "planned", "approved", "implementing", "verifying", "release_ready"]
TRANSITIONS = {a: {b} for a, b in zip(STATES, STATES[1:])}
TRANSITIONS.update({"planned": {"approved", "intent_confirmed"}, "implementing": {"verifying", "blocked"}, "verifying": {"release_ready", "implementing", "blocked"}, "blocked": set(), "aborted": set(), "release_ready": set()})
for state in STATES[:-1]:
    TRANSITIONS.setdefault(state, set()).update({"blocked", "aborted"})

class ContractError(ValueError):
    pass

def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))

def schemas() -> dict[str, dict[str, Any]]:
    return {path.name: load_json(path) for path in CONTRACTS.glob("*.json")}

def _resolve(ref: str, current: dict[str, Any], all_schemas: dict[str, dict[str, Any]]) -> dict[str, Any]:
    file_part, _, fragment = ref.partition("#")
    target = current if not file_part else all_schemas[file_part]
    if fragment:
        for part in fragment.lstrip("/").split("/"):
            target = target[part.replace("~1", "/").replace("~0", "~")]
    return target

def validate_schema(document: Any, schema_name: str, *, _schema: dict[str, Any] | None = None, _path: str = "$", _all: dict[str, dict[str, Any]] | None = None) -> None:
    all_schemas = _all or schemas()
    schema = _schema or all_schemas[schema_name]
    if "$ref" in schema:
        return validate_schema(document, schema_name, _schema=_resolve(schema["$ref"], all_schemas[schema_name], all_schemas), _path=_path, _all=all_schemas)
    expected = schema.get("type")
    if expected:
        names = expected if isinstance(expected, list) else [expected]
        checks = {"object": lambda v: isinstance(v, dict), "array": lambda v: isinstance(v, list), "string": lambda v: isinstance(v, str), "integer": lambda v: isinstance(v, int) and not isinstance(v, bool), "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool), "boolean": lambda v: isinstance(v, bool), "null": lambda v: v is None}
        if not any(checks[name](document) for name in names):
            raise ContractError(f"{_path}: expected {' or '.join(names)}")
    if "const" in schema and document != schema["const"]:
        raise ContractError(f"{_path}: must equal {schema['const']!r}")
    if "enum" in schema and document not in schema["enum"]:
        raise ContractError(f"{_path}: value is not allowed")
    if isinstance(document, str):
        if len(document) < schema.get("minLength", 0): raise ContractError(f"{_path}: string too short")
        if "pattern" in schema and not re.fullmatch(schema["pattern"], document): raise ContractError(f"{_path}: pattern mismatch")
    if isinstance(document, (int, float)) and not isinstance(document, bool):
        if document < schema.get("minimum", document): raise ContractError(f"{_path}: below minimum")
        if document > schema.get("maximum", document): raise ContractError(f"{_path}: above maximum")
    if isinstance(document, list):
        if len(document) < schema.get("minItems", 0): raise ContractError(f"{_path}: too few items")
        if len(document) > schema.get("maxItems", len(document)): raise ContractError(f"{_path}: too many items")
        if schema.get("uniqueItems") and len({json.dumps(v, sort_keys=True) for v in document}) != len(document): raise ContractError(f"{_path}: duplicate items")
        for index, value in enumerate(document): validate_schema(value, schema_name, _schema=schema.get("items", {}), _path=f"{_path}[{index}]", _all=all_schemas)
    if isinstance(document, dict):
        missing = set(schema.get("required", [])) - set(document)
        if missing: raise ContractError(f"{_path}: missing {sorted(missing)}")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            extra = set(document) - set(properties)
            if extra: raise ContractError(f"{_path}: unexpected {sorted(extra)}")
        for key, value in document.items():
            if key in properties: validate_schema(value, schema_name, _schema=properties[key], _path=f"{_path}.{key}", _all=all_schemas)

def validate_version(document: dict[str, Any]) -> None:
    version = document.get("contract_version", "")
    if not re.fullmatch(r"2\.[0-9]+\.[0-9]+", version): raise ContractError("unknown or invalid contract major version")

def validate_intent(intent: dict[str, Any]) -> None:
    validate_version(intent); validate_schema(intent, "intent-record.json")
    if intent["confirmation_state"] == "confirmed" and not all(dot["confirmed"] and dot["confirmed_at"] for dot in intent["dots"].values()):
        raise ContractError("confirmed intent requires five individually confirmed Dots")

def validate_task(task: dict[str, Any], run_id: str) -> None:
    validate_version(task); validate_schema(task, "task-record.json")
    if set(task["allowed_tools"]) & set(task["forbidden_tools"]): raise ContractError("tool cannot be both allowed and forbidden")
    if task["task_id"] in task["dependencies"]: raise ContractError("task cannot depend on itself")
    if task["status"] == "complete" and len(task.get("evidence_hashes", [])) < len(task["acceptance_evidence"]):
        raise ContractError("complete task lacks receipt hashes for every acceptance criterion")

def validate_run_state(state: dict[str, Any]) -> None:
    validate_version(state); validate_schema(state, "run-state.json")
    if state["history"][-1] != state["state"]: raise ContractError("state must equal final history entry")
    for before, after in zip(state["history"], state["history"][1:]):
        if after not in TRANSITIONS.get(before, set()): raise ContractError(f"illegal transition {before} -> {after}")
    if state["state"] == "release_ready":
        gates = state["gates"]
        booleans = ["privacy_acknowledged", "dots_confirmed", "plan_approved", "branch_created", "implementation_committed", "tests_fresh", "review_independent", "handoff_committed", "final_worktree_clean"]
        if not all(gates[name] for name in booleans): raise ContractError("release_ready gate is false")
        if gates["tests_outcome"] != "pass" or not gates["test_evidence_ids"]: raise ContractError("release_ready requires fresh passing test evidence")
        if gates["review_outcome"] != "pass" or not gates["review_evidence_ids"]: raise ContractError("release_ready requires independent review evidence")
        if any(not value for value in state["artifacts"].values()): raise ContractError("release_ready requires all committed artifacts")

def validate_bundle(bundle: dict[str, Any]) -> None:
    intent, state, tasks = bundle["intent"], bundle["run_state"], bundle.get("tasks", [])
    validate_intent(intent); validate_run_state(state)
    if intent["run_id"] != state["run_id"]: raise ContractError("run id mismatch")
    if tasks and intent["confirmation_state"] != "confirmed": raise ContractError("tasks cannot exist before confirmed intent")
    if len(tasks) > LIMITS["implementation_tasks"]: raise ContractError("implementation task limit exceeded")
    ids = {task["task_id"] for task in tasks}
    if len(ids) != len(tasks): raise ContractError("duplicate task id")
    for task in tasks:
        validate_task(task, state["run_id"])
        if not set(task["dependencies"]) <= ids: raise ContractError("unknown task dependency")
    if state["state"] == "release_ready":
        if not tasks or any(task.get("status") != "complete" for task in tasks): raise ContractError("release_ready requires every task complete")

def journey_outcome(case: dict[str, Any]) -> str:
    event, data = case["event"], case.get("input", {})
    if event == "preflight_existing": return "intake" if data.get("clean") else "blocked"
    if event == "greenfield_init": return "intake" if data.get("confirmed") else "blocked"
    if event == "resume": return data.get("committed_state", "blocked") if data.get("artifacts_valid") else "blocked"
    if event == "plan_rejected": return "intent_confirmed"
    if event == "worker_failure": return "implementing" if data.get("fallback_available") else "blocked"
    if event == "retry": return "implementing" if data.get("retries", 0) <= LIMITS["retries"] else "blocked"
    if event == "abort": return "aborted"
    if event == "protected_effect": return "implementing" if data.get("approved") else "blocked"
    if event == "review_failure": return "implementing" if data.get("fix_review_cycles", 0) < LIMITS["fix_review_cycles"] else "blocked"
    raise ContractError(f"unknown journey event {event}")
