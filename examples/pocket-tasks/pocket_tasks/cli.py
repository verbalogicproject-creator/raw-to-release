"""Command-line interface for Pocket Tasks."""
from __future__ import annotations
import argparse
from pathlib import Path
from .store import TaskStore, StoreError

def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(prog="pocket-tasks")
    result.add_argument("--file", type=Path, default=Path("tasks.json"))
    commands = result.add_subparsers(dest="command", required=True)
    add = commands.add_parser("add", help="add a volunteer task")
    add.add_argument("title")
    done = commands.add_parser("done", help="complete a task")
    done.add_argument("id", type=int)
    commands.add_parser("list", help="list tasks")
    return result

def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    store = TaskStore(args.file)
    try:
        if args.command == "add":
            task = store.add(args.title)
            print(f"added {task['id']}")
        elif args.command == "done":
            store.complete(args.id)
            print(f"completed {args.id}")
        else:
            for task in store.list():
                print(f"[{'x' if task['done'] else ' '}] {task['id']}: {task['title']}")
    except StoreError as exc:
        parser().error(str(exc))
    return 0

if __name__ == "__main__": raise SystemExit(main())
