#!/usr/bin/env python3
"""Copy the canonical neutral method into the plugin package deterministically."""
from __future__ import annotations
import argparse
import filecmp
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "method"
TARGET = ROOT / "plugins" / "raw-to-release" / "skills" / "raw-to-release" / "references" / "method"

def files(root: Path) -> set[Path]:
    return {path.relative_to(root) for path in root.rglob("*") if path.is_file()}

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = files(SOURCE)
    actual = files(TARGET) if TARGET.exists() else set()
    drift = expected != actual or any(not filecmp.cmp(SOURCE / path, TARGET / path, shallow=False) for path in expected & actual)
    if args.check:
        if drift:
            print("packaged method differs from canonical method")
            return 1
        print("method package is synchronized")
        return 0
    if TARGET.exists(): shutil.rmtree(TARGET)
    shutil.copytree(SOURCE, TARGET)
    print("synchronized method package")
    return 0

if __name__ == "__main__": raise SystemExit(main())
