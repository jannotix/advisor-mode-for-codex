---
name: advisor-mode
description: Configure or inspect the global Advisor Mode executor, advisor, and independent final reviewer workflow. Use when the user asks about Advisor Mode status, models, installation, or review failures.
---

# Advisor Mode

Use the package's `scripts/setup.mjs` for personal agent settings. Resolve this skill's package root two directories above this file. Commands accept `--home <absolute Codex home>` for an isolated profile; the default is CODEX_HOME or the user's `.codex` directory.

- `node <package>/scripts/setup.mjs status` reports configuration and owned agent files.
- `node <package>/scripts/setup.mjs install` creates personal agent settings and a CLI profile, preserving unrelated files. Register and install the plugin with the native commands documented in README.md. Review hook trust in Codex.
- `node <package>/scripts/setup.mjs set-model reviewer <model> <effort>` changes one role and regenerates its personal agent. The role must be executor, advisor, or reviewer. Start a new session afterward.
- `node <package>/scripts/setup.mjs uninstall` removes only unchanged files that setup owns. Native plugin removal is separate.

For a multi-project task, use the session id and task id from the native task context:

```text
node <package>/scripts/scope.mjs set --session SESSION --task TASK --path "project-a" --path "project-b" --path "roadmap.md"
node <package>/scripts/scope.mjs add --session SESSION --task TASK --path "another-project"
node <package>/scripts/scope.mjs status --session SESSION --task TASK
```

Declare all approved directories and files before edits or review. Paths resolve against the native chat workspace. New entries must exist; select an existing containing directory for new files. Set establishes scope once; later use add to expand coverage. The command rejects narrowing and stale session/task ids. Expansion invalidates approval and requires a new reviewer. A new ordinary user prompt starts a new task and resets scope; resume, compaction and hook continuations preserve it. The reviewer must verify scope completeness. This does not confine arbitrary shell commands or certify unselected files or remote effects.

Report missing hooks, unavailable models, mismatched agent files, and rejected reviews. Do not claim activation because files exist. Do not modify global defaults, overwrite user-edited files, grant hook trust, or change permissions without authorization. Never manufacture a review receipt or edit session state to bypass a failed review.

All work requires the configured advisor at decision points and a fresh final reviewer. Request delegation explicitly in your instructions. Model changes take effect in new sessions; active threads may retain earlier agents. Read `rules/craft.md` for the bundled work standards.
