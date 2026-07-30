from __future__ import annotations
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class PocketTasksTests(unittest.TestCase):
    def run_cli(self, database: Path, *args: str):
        return subprocess.run([sys.executable, "-m", "pocket_tasks", "--file", str(database), *args], cwd=ROOT, text=True, capture_output=True)

    def test_add_list_and_complete_compound(self):
        with tempfile.TemporaryDirectory() as temp:
            database = Path(temp) / "tasks.json"
            self.assertEqual(self.run_cli(database, "add", "Call volunteers").returncode, 0)
            self.assertEqual(self.run_cli(database, "add", "Book room").returncode, 0)
            before = self.run_cli(database, "list")
            self.assertIn("[ ] 1: Call volunteers", before.stdout)
            self.assertEqual(self.run_cli(database, "done", "1").returncode, 0)
            after = self.run_cli(database, "list")
            self.assertIn("[x] 1: Call volunteers", after.stdout)
            self.assertIn("[ ] 2: Book room", after.stdout)

    def test_empty_title_and_unknown_id_fail_without_corrupting_store(self):
        with tempfile.TemporaryDirectory() as temp:
            database = Path(temp) / "tasks.json"
            self.assertNotEqual(self.run_cli(database, "add", "   ").returncode, 0)
            self.assertEqual(self.run_cli(database, "add", "Call volunteers").returncode, 0)
            original = database.read_bytes()
            self.assertNotEqual(self.run_cli(database, "done", "99").returncode, 0)
            self.assertEqual(database.read_bytes(), original)

    def test_invalid_store_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            database = Path(temp) / "tasks.json"
            database.write_text('{"not":"a list"}', encoding="utf-8")
            result = self.run_cli(database, "list")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("invalid shape", result.stderr)

if __name__ == "__main__": unittest.main()
