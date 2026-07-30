from __future__ import annotations
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from contract_validation import ContractError, journey_outcome, validate_bundle, validate_intent, validate_run_state, validate_schema

CONTRACTS = ("intent-record", "run-state", "evidence-ref", "task-envelope", "task-result", "task-record", "capability-report", "run-observation")

def fixture(name: str, kind: str = "valid"):
    path = ROOT / "tests" / "fixtures" / name / f"{kind}.json"
    if name == "run-state": path = ROOT / "tests" / "fixtures" / f"run-state-{kind}.json"
    return json.loads(path.read_text(encoding="utf-8"))

def bundle():
    return {"intent": fixture("intent-record"), "run_state": fixture("run-state"), "tasks": [fixture("task-record")]}

def git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", "-C", str(root), *args], text=True, capture_output=True)

def initialize_repository(root: Path) -> None:
    self_result = git(root, "init")
    if self_result.returncode != 0: raise RuntimeError(self_result.stderr)
    git(root, "config", "user.name", "Raw to Release Test")
    git(root, "config", "user.email", "test@example.invalid")
    (root / "README.md").write_text("fixture\n", encoding="utf-8")
    git(root, "add", "README.md")
    result = git(root, "commit", "-m", "fixture")
    if result.returncode != 0: raise RuntimeError(result.stderr)

class RepositoryTests(unittest.TestCase):
    def run_ok(self, *args: str) -> str:
        result = subprocess.run([sys.executable, *args], cwd=ROOT, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def test_repository_validator_and_sync(self):
        self.assertIn("passed", self.run_ok("scripts/validate_repository.py"))
        self.assertIn("synchronized", self.run_ok("scripts/sync_method.py", "--check"))

    def test_every_schema_accepts_positive_and_rejects_negative_fixture(self):
        for name in CONTRACTS:
            with self.subTest(name=name, kind="valid"): validate_schema(fixture(name), f"{name}.json")
            with self.subTest(name=name, kind="invalid"):
                with self.assertRaises(ContractError): validate_schema(fixture(name, "invalid"), f"{name}.json")

    def test_unknown_major_versions_fail_closed(self):
        for name in CONTRACTS:
            for version in ("1.9.9", "3.0.0"):
                value = fixture(name); value["contract_version"] = version
                with self.subTest(name=name, version=version), self.assertRaises(ContractError): validate_schema(value, f"{name}.json")

    def test_tasks_require_all_five_confirmed_dots(self):
        value = bundle(); value["intent"]["dots"]["boundaries"]["confirmed"] = False
        with self.assertRaisesRegex(ContractError, "five individually confirmed"): validate_bundle(value)
        value = bundle(); value["intent"]["confirmation_state"] = "draft"
        with self.assertRaisesRegex(ContractError, "tasks cannot exist"): validate_bundle(value)

    def test_complete_task_requires_linked_acceptance_evidence(self):
        value = bundle(); value["tasks"][0]["evidence_hashes"] = []
        with self.assertRaisesRegex(ContractError, "receipt hashes"): validate_bundle(value)

    def test_release_ready_requires_every_gate_and_linked_evidence(self):
        validate_bundle(bundle())
        for gate in ("plan_approved", "implementation_committed", "tests_fresh", "review_independent", "handoff_committed", "final_worktree_clean"):
            value = bundle(); value["run_state"]["gates"][gate] = False
            with self.subTest(gate=gate), self.assertRaises(ContractError): validate_bundle(value)

    def test_illegal_transition_and_numeric_limits_fail(self):
        value = fixture("run-state"); value["history"] = ["intake", "release_ready"]
        with self.assertRaisesRegex(ContractError, "illegal transition"): validate_run_state(value)
        for field, over in (("delegations", 13), ("concurrent_agents", 4), ("implementation_tasks", 9), ("fix_review_cycles", 3), ("retries", 2)):
            value = fixture("run-state"); value["counters"][field] = over
            with self.subTest(field=field), self.assertRaises(ContractError): validate_run_state(value)

    def test_all_operational_journeys(self):
        cases = json.loads((ROOT / "tests" / "fixtures" / "journeys.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(cases), 16)
        for case in cases:
            with self.subTest(case=case["name"]): self.assertEqual(journey_outcome(case), case["expected"])

    def test_clean_dirty_and_greenfield_preflight_use_real_git_repositories(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); initialize_repository(root)
            clean = not git(root, "status", "--porcelain").stdout
            self.assertEqual(journey_outcome({"event": "preflight_existing", "input": {"clean": clean}}), "intake")
            (root / "dirty.txt").write_text("dirty\n", encoding="utf-8")
            clean = not git(root, "status", "--porcelain").stdout
            self.assertEqual(journey_outcome({"event": "preflight_existing", "input": {"clean": clean}}), "blocked")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertFalse((root / ".git").exists())
            denied = journey_outcome({"event": "greenfield_init", "input": {"confirmed": False}})
            self.assertEqual(denied, "blocked"); self.assertFalse((root / ".git").exists())
            if journey_outcome({"event": "greenfield_init", "input": {"confirmed": True}}) == "intake": initialize_repository(root)
            self.assertTrue((root / ".git").is_dir())

    def test_each_journey_persists_an_atomically_replaced_valid_checkpoint(self):
        cases = json.loads((ROOT / "tests" / "fixtures" / "journeys.json").read_text(encoding="utf-8"))
        histories = {
            "intake": ["intake"], "approved": ["intake", "intent_confirmed", "planned", "approved"],
            "intent_confirmed": ["intake", "intent_confirmed", "planned", "intent_confirmed"],
            "aborted": ["intake", "aborted"],
        }
        for case in cases:
            with self.subTest(case=case["name"]), tempfile.TemporaryDirectory() as temp:
                root = Path(temp); initialize_repository(root)
                outcome = journey_outcome(case)
                state = fixture("run-state")
                if outcome == "implementing":
                    history = ["intake", "intent_confirmed", "planned", "approved", "implementing"]
                    if case["event"] == "review_failure": history += ["verifying", "implementing"]
                elif outcome == "blocked":
                    history = ["intake", "blocked"]
                    if case["event"] in {"worker_failure", "retry"}: history = ["intake", "intent_confirmed", "planned", "approved", "implementing", "blocked"]
                    if case["event"] == "review_failure": history = ["intake", "intent_confirmed", "planned", "approved", "implementing", "verifying", "blocked"]
                else: history = histories[outcome]
                state["state"] = outcome; state["history"] = history
                run = root / ".raw-to-release" / "runs" / state["run_id"]
                run.mkdir(parents=True)
                temporary = run / ".run-state.json.tmp"
                temporary.write_text(json.dumps(state), encoding="utf-8")
                temporary.replace(run / "run-state.json")
                restored = json.loads((run / "run-state.json").read_text(encoding="utf-8"))
                validate_run_state(restored)

    def test_committed_resume_and_release_sequence_in_real_repository(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); initialize_repository(root)
            value = bundle(); run_id = value["run_state"]["run_id"]
            run = root / ".raw-to-release" / "runs" / run_id
            (run / "tasks").mkdir(parents=True)
            approved = copy.deepcopy(value["run_state"])
            approved["state"] = "approved"; approved["history"] = ["intake", "intent_confirmed", "planned", "approved"]
            (run / "intent.json").write_text(json.dumps(value["intent"]), encoding="utf-8")
            (run / "run-state.json").write_text(json.dumps(approved), encoding="utf-8")
            (run / "plan.md").write_text("# Approved plan\n", encoding="utf-8")
            (run / "tasks.json").write_text(json.dumps({"tasks": ["task-1"]}), encoding="utf-8")
            git(root, "add", ".raw-to-release"); self.assertEqual(git(root, "commit", "-m", "approve plan").returncode, 0)
            (root / "product.txt").write_text("implemented\n", encoding="utf-8")
            git(root, "add", "product.txt"); self.assertEqual(git(root, "commit", "-m", "implementation").returncode, 0)
            implementation_sha = git(root, "rev-parse", "HEAD").stdout.strip()
            (run / "tasks" / "task-1.json").write_text(json.dumps(value["tasks"][0]), encoding="utf-8")
            (run / "run-state.json").write_text(json.dumps(value["run_state"]), encoding="utf-8")
            (run / "verification.json").write_text(json.dumps({"implementation_sha": implementation_sha, "tests": "pass", "review": "pass"}), encoding="utf-8")
            (run / "handoff.md").write_text(f"verified implementation {implementation_sha}\n", encoding="utf-8")
            git(root, "add", ".raw-to-release"); self.assertEqual(git(root, "commit", "-m", "verification and handoff").returncode, 0)
            self.assertEqual(git(root, "status", "--porcelain").stdout, "")
            restored = {"intent": json.loads((run / "intent.json").read_text()), "run_state": json.loads((run / "run-state.json").read_text()), "tasks": [json.loads((run / "tasks" / "task-1.json").read_text())]}
            validate_bundle(restored)
            for version in ("1.0.0", "3.0.0"):
                restored["run_state"]["contract_version"] = version
                with self.assertRaises(ContractError): validate_bundle(restored)

    def test_json_templates_are_structurally_valid(self):
        templates = ROOT / "plugins" / "raw-to-release" / "skills" / "raw-to-release" / "assets" / "templates"
        for filename, schema in (("intent.json", "intent-record.json"), ("run-state.json", "run-state.json"), ("task-record.json", "task-record.json"), ("capability-report.json", "capability-report.json"), ("run-observation.json", "run-observation.json")):
            with self.subTest(template=filename): validate_schema(json.loads((templates / filename).read_text(encoding="utf-8")), schema)

    def test_adversarial_release_ready_evidence_probes_fail(self):
        value = bundle(); value["tasks"][0]["status"] = "started"
        with self.assertRaises(ContractError): validate_bundle(value)
        value = bundle(); value["tasks"].append(copy.deepcopy(value["tasks"][0])); value["tasks"][1]["task_id"] = "task-2"; value["tasks"][1]["status"] = "registered"
        with self.assertRaisesRegex(ContractError, "every task complete"): validate_bundle(value)

    def test_official_validator_launcher_fails_closed_when_missing(self):
        with tempfile.TemporaryDirectory() as temp:
            result = subprocess.run([sys.executable, "scripts/run_official_plugin_validator.py", "--validator", str(Path(temp) / "missing.py")], cwd=ROOT)
        self.assertEqual(result.returncode, 2)

    def test_managed_tree_has_no_absolute_personal_paths_or_transcripts(self):
        forbidden = ("/Users/", "/home/", "chat transcript", "BEGIN PRIVATE KEY")
        for root in (ROOT / "method", ROOT / "plugins" / "raw-to-release"):
            for path in root.rglob("*"):
                if path.is_file():
                    text = path.read_text(encoding="utf-8")
                    for marker in forbidden:
                        with self.subTest(path=path, marker=marker): self.assertNotIn(marker, text)

if __name__ == "__main__": unittest.main()
