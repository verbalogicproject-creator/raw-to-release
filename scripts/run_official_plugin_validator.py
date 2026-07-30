#!/usr/bin/env python3
"""Fail-closed launcher for the validator shipped with Codex plugin-creator."""
from __future__ import annotations
import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def discover(explicit: str | None) -> Path:
    if explicit: return Path(explicit)
    if os.environ.get("RAW_TO_RELEASE_PLUGIN_VALIDATOR"): return Path(os.environ["RAW_TO_RELEASE_PLUGIN_VALIDATOR"])
    codex_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    return codex_home / "skills" / ".system" / "plugin-creator" / "scripts" / "validate_plugin.py"

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validator")
    parser.add_argument("--plugin", default=str(ROOT / "plugins" / "raw-to-release"))
    args = parser.parse_args()
    validator = discover(args.validator)
    if not validator.is_file():
        print("official plugin validator unavailable; release fails closed", file=sys.stderr)
        return 2
    return subprocess.run([sys.executable, str(validator), args.plugin], cwd=ROOT).returncode

if __name__ == "__main__": raise SystemExit(main())
