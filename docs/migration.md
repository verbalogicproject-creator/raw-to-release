# Migration from Codex Model Team

Raw to Release is a clean break and never assumes ownership of legacy personal
configuration. There is no in-place upgrade.

Existing users can inspect and run the legacy uninstaller from the preserved
local tag without checking out over current work:

```sh
git show codex-model-team-v0.1.0:teamctl.py > /tmp/teamctl-v0.1.0.py
python /tmp/teamctl-v0.1.0.py uninstall --dry-run
python /tmp/teamctl-v0.1.0.py uninstall
```

Review the dry run first. Raw to Release itself does not edit legacy global
files. The tag must remain at the pre-clean-break commit and must not be moved.
