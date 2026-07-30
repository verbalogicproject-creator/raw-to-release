"""Validated JSON persistence for Pocket Tasks."""
from __future__ import annotations
import json
from pathlib import Path

class StoreError(ValueError):
    pass

class TaskStore:
    def __init__(self, path: Path): self.path = path

    def list(self) -> list[dict]:
        if not self.path.exists(): return []
        try: value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc: raise StoreError(f"cannot read task store: {exc}") from exc
        if not isinstance(value, list) or any(not isinstance(item, dict) or set(item) != {"id", "title", "done"} or not isinstance(item["id"], int) or not isinstance(item["title"], str) or not isinstance(item["done"], bool) for item in value):
            raise StoreError("task store has an invalid shape")
        return value

    def _save(self, tasks: list[dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(json.dumps(tasks, indent=2) + "\n", encoding="utf-8")
        temporary.replace(self.path)

    def add(self, title: str) -> dict:
        title = title.strip()
        if not title: raise StoreError("title must not be empty")
        tasks = self.list()
        task = {"id": max((item["id"] for item in tasks), default=0) + 1, "title": title, "done": False}
        tasks.append(task); self._save(tasks); return task

    def complete(self, task_id: int) -> None:
        tasks = self.list()
        for task in tasks:
            if task["id"] == task_id:
                task["done"] = True; self._save(tasks); return
        raise StoreError(f"unknown task {task_id}")
