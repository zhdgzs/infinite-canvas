---
name: remote-docker
description: Inspect a clean Git repository, determine whether unreleased changes are a small or large update, increment the VERSION file, commit the release version, and push the current branch so GitHub Actions publishes Docker images and other release artifacts. Use when the user asks to run remote-docker, publish or release the current repository through its remote Docker workflow, or automatically version and push a completed clean worktree.
---

# Remote Docker

Publish a completed clean repository through its existing push-triggered GitHub Actions release workflow. Decide the update size from the actual changes; do not ask the user to choose it.

## Workflow

1. Locate the repository root with `git rev-parse --show-toplevel` and work from it.
2. Require all of the following before changing anything:
   - `git status --porcelain` is empty, including untracked files.
   - The current branch is not detached and is the repository's release branch (`main` unless project instructions specify another branch).
   - An `origin` remote exists.
   - A root `VERSION` file exists.
3. Run `git fetch origin <branch> --tags` and stop if the local branch is behind or diverged from `origin/<branch>`. Never merge, rebase, reset, or force-push in this skill.
4. Read the current version from `VERSION`. Accept only `vMAJOR.MINOR.PATCH` or `MAJOR.MINOR.PATCH`.
5. Require unreleased commits after the current version tag. If the tag does not exist, inspect changes since the latest reachable `v*` tag. Stop when there are no release changes.
6. Inspect all of these before classifying the update:
   - `git log --oneline <base>..HEAD`
   - `git diff --stat <base>..HEAD`
   - `git diff <base>..HEAD`
   - The `Unreleased` section of `CHANGELOG.md`, when present
7. Classify without asking the user:
   - **Large update**: introduces a user-facing feature, changes an external API or persisted data contract, substantially changes deployment/runtime architecture, or delivers a coherent capability spanning multiple subsystems.
   - **Small update**: fixes bugs, improves performance or UI details, updates documentation/CI/dependencies, or performs internal refactoring without a substantial new capability.
   - When evidence is mixed or ambiguous, choose **small update**.
8. Calculate the next version with `scripts/next_version.py`:
   - Any pre-1.0 current version becomes `v1.0.0` on the first run.
   - Small update increments the third position: `v1.0.0` -> `v1.0.1`.
   - Large update increments the second position and resets the third: `v1.0.1` -> `v1.1.0`.
9. Before editing, committing, or pushing, show one explicit dangerous-operation confirmation using the project's required format. Include the classification evidence, old/new versions, branch, remote, commit message, and the fact that pushing triggers remote publication. Continue only after an explicit confirmation.
10. Update `VERSION` to the new version with a trailing newline. Do not modify unrelated files or automatically rewrite the changelog.
11. Stage only `VERSION`, commit with `chore: release <version>`, then push with `git push origin <branch>`.
12. Report the new version, commit hash, pushed branch, and remote. Do not create another tag or GitHub Release locally; the repository's GitHub Actions release workflow owns those operations.

## Safety Rules

- Stop on a dirty worktree; never auto-commit existing work.
- Stop if `VERSION`, the current tag, and remote tags conflict in a way that makes the release base unclear.
- Never use `git push --force`, destructive Git commands, or automatic conflict resolution.
- Never push without the explicit confirmation required by project instructions.
- Do not claim publication succeeded merely because `git push` succeeded. State that GitHub Actions was triggered and must finish successfully.

## Version Helper

Run:

```bash
python3 .agents/skills/remote-docker/scripts/next_version.py --current v1.0.0 --level small
```

The command prints only the normalized next version.
