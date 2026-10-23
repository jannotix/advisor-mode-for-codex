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

Report missing hooks, unavailable models, mismatched agent files, and rejected reviews. Do not claim activation because files exist. Do not modify global defaults, overwrite user-edited files, grant hook trust, or change permissions without authorization. Never manufacture a review receipt or edit session state to bypass a failed review.

All work requires the configured advisor at decision points and a fresh final reviewer. Request delegation explicitly in your instructions. Model changes take effect in new sessions; active threads may retain earlier agents. Read `rules/craft.md` for the bundled work standards.
