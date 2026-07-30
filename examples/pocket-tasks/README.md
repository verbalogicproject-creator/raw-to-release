# Pocket Tasks: learn Raw to Release by shipping one CLI

Pocket Tasks is a volunteer-task tracker that compounds through the entire Phase
1 lifecycle. It is an example, not a required project template. Later roadmap
phases extend this same project with an API, schema, UI, and release packs.

## Choose a path

- **Novice:** complete checkpoints 1–6 in order and let the Five-Dot interview
  explain each decision.
- **Expert:** read the confirmed intent below, inspect the approved-plan shape,
  then jump to checkpoints 4–6.
- **One feature:** run checkpoint 0, ask `$raw-to-release` for a change such as
  priorities, and require it to preserve the confirmed boundaries.

## Checkpoint 0 — prove the starting project

```sh
cd examples/pocket-tasks
python -m unittest discover -s tests -v
python -m pocket_tasks --file /tmp/pocket-tasks.json add "Call volunteers"
python -m pocket_tasks --file /tmp/pocket-tasks.json list
```

Verify: three tests pass and the task appears unchecked. On Windows, replace the
temporary file path with a path in your temporary directory.

## Checkpoint 1 — confirm the five Dots

Start a fresh Codex CLI thread in this repository:

```text
Use $raw-to-release for Pocket Tasks. Interview me one Dot at a time.
```

The worked intent is: build a volunteer-task CLI; help small coordinators avoid
losing commitments; local JSON and standard library only, no accounts/network/UI;
greenfield teaching project; prefer explicit errors, atomic persistence, and
tests. Edit these answers—the point is confirmation, not copying.

Verify: `.raw-to-release/runtime/<run-id>/` contains drafts, the five Dots show
individual confirmation times, and no `tasks.json` exists before all five pass.

## Checkpoint 2 — approve an evidence-led plan

Reconnaissance should discover `pyproject.toml`, the package split, and the test
command. The plan should map each task to Dots, name files, exclude API/UI work,
and require add/list/done plus failure-path tests.

Verify: reject the plan once and confirm state returns to `intent_confirmed`;
approve the revised plan and confirm the branch is `r2r/<run-id>` with committed
intent and plan.

## Checkpoint 3 — implement within boundaries

Workers may change only the example files assigned to them. They must not install
dependencies or add a network service. JSON writes use a temporary sibling and
atomic replace; invalid stores and unknown IDs fail without data loss.

Verify: `git diff --check` passes and every completed task record contains linked
acceptance evidence.

## Checkpoint 4 — test as a fresh observer

```sh
cd examples/pocket-tasks
python -m unittest discover -s tests -v
```

Verify: the record contains this exact command, exit code 0, three passed tests,
time, observer, and criterion—not merely “tests pass.”

## Checkpoint 5 — fail and repair review

For the teaching run, ask the reviewer to inspect atomic-write and invalid-store
acceptance directly. If either is missing, it must FAIL and return bounded
findings. Repair, recommit, retest, and review again; do not exceed two cycles.

Verify: the final reviewer is not an implementer and cites intent, plan, diff,
source, and fresh test evidence.

## Checkpoint 6 — inspect the handoff

Verify: the worktree is clean after the handoff commit; `handoff.md` records the
branch, verified implementation SHA, files, tests, verdict, risks, rollback, and
manual next steps. Final state is `release_ready`. Confirm that no merge, push,
PR, deployment, or publication occurred.
