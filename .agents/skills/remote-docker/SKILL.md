---
name: remote-docker
description: Inspect a clean Git repository, reconcile release notes, determine whether unreleased changes are a small or large update, increment the VERSION file, commit the release version, and push the current branch so GitHub Actions publishes the Docker image. Use when the user asks to run remote-docker, publish or release the current repository through its remote Docker workflow, or automatically version and push a completed clean worktree.
---

# Remote Docker

Publish a completed clean repository through its existing push-triggered Docker workflow. Decide the update size from the actual changes; do not ask the user to choose it.

## Workflow

1. Locate the repository root with `git rev-parse --show-toplevel` and work from it.
2. Require all of the following before changing anything:
   - `git status --porcelain` is empty, including untracked files.
   - The current branch is not detached and is the repository's release branch (`main` unless project instructions specify another branch).
   - An `origin` remote exists.
   - A root `VERSION` file exists.
3. Run `git fetch origin <branch>` and stop if the local branch is behind or diverged from `origin/<branch>`. Never merge, rebase, reset, or force-push in this skill.
4. Read the current version from `VERSION`. Accept only `vMAJOR.MINOR.PATCH` or `MAJOR.MINOR.PATCH`.
5. Find the reachable commit with message `chore: release <current version>` and require unreleased commits after it. If there is no matching commit, inspect the full reachable history as the initial release baseline. Stop when there are no release changes.
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
9. Before editing, committing, or pushing, show one explicit dangerous-operation confirmation using the project's required format. Include the classification evidence, old/new versions, branch, remote, commit message, the automatic changelog synchronization, and the fact that pushing triggers remote publication. Continue only after an explicit confirmation. Do not ask for a separate confirmation to update `CHANGELOG.md`.
10. Synchronize `CHANGELOG.md` from the inspected release history before the release commit:
   - Ensure `## Unreleased` exists and contains concise `[新增]` / `[调整]` / `[修复]` / `[优化]` entries that cover user-visible unreleased changes. If it is absent or does not cover the inspected changes, add the missing entries based on the Git history.
   - Move the completed `Unreleased` entries into `## <next version> - <YYYY-MM-DD>` using the local date, then retain an empty `## Unreleased` heading.
   - Do not rewrite already released version sections unless they are malformed or conflict with the reachable release history.
11. Update `VERSION` to the new version with a trailing newline.
12. Stage only `VERSION` and `CHANGELOG.md`, commit with `chore: release <version>`, then push with `git push origin <branch>`.
13. Report the new version, commit hash, pushed branch, remote, and Docker image name. Do not create a Git tag or GitHub Release locally; the push-triggered Docker workflow owns image publication.

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
