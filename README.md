# Advisor Mode for Codex

Advisor Mode adds configurable executor, advisor, and independent final reviewer roles to local Codex sessions. Install it once in a personal profile and use it across workspaces.

This is a development prerelease. Native host validation is blocked: installation succeeds, but the tested local exec sessions did not run the plugin hooks. Do not activate this version for production work. A local workflow gate cannot protect its state against a process that has unrestricted access to the same files.

## Workflow

The default executor is `gpt-6.1-sol`. The advisor and final reviewer use `gpt-6-astra` in separate agent contexts. Each role has its own model and reasoning setting. The advisor handles design choices and repeated matching failures. A fresh reviewer reads the requirements, actual files, and verification evidence before completion.

The hook records native reviewer identity and a workspace content digest. It accepts an explicit review only from the expected role and model. A later change invalidates approval. Missing, negative, malformed, or stale reviews request another pass. An unavailable reviewer produces a blocked result, never a successful review record.

The work standards cover small complete changes, meaningful checks, concrete prose, and accessible interfaces. They ship as original instructions and require no third-party skills.

## Requirements

- Node.js 22 or later and Git for Git-aware snapshots.
- A local Codex client with personal TOML agents and SessionStart, UserPromptSubmit, SubagentStart, SubagentStop, PostToolUse, and Stop hooks.
- Access to the configured models in that client. Model access in another client does not prove access here.

## Personal installation

The commands below describe the installation procedure. Use a disposable profile until the native loading blocker is resolved. Build the package from this repository first:

```text
node scripts/package.mjs
node scripts/setup.mjs install
codex plugin marketplace add "/absolute/path/to/Advisor mode for Codex"
codex plugin add advisor-mode-for-codex@advisor-mode-local
```

The marketplace points to the generated `dist/advisor-mode-for-codex` directory. The package allowlist excludes tests, internal planning, evidence, and repository metadata. Keep the source directory available while using a local marketplace.

Review and trust the plugin's hooks in Codex, then start a new session. Installing files does not grant hook trust. In CLI, use `/hooks` to inspect the definitions. Do not use a hook-trust bypass for normal installation.

Setup adds three personal agents, `advisor-mode.config.toml`, and `advisor-mode/config.json` under CODEX_HOME (default `~/.codex`). It does not replace `config.toml`, AGENTS.md, permissions, or existing agents. Use `codex -p advisor-mode` to select the executor in a new CLI session, or select it in the desktop model picker. The plugin does not change the model of an existing chat.

For a disposable profile, add `--home /absolute/test/home` to setup and set CODEX_HOME to that directory for native plugin commands. Do not copy credentials into test artifacts.

## Configuration

```text
node scripts/setup.mjs status
node scripts/setup.mjs set-model reviewer MODEL_ID REASONING_EFFORT
node scripts/setup.mjs set-model advisor MODEL_ID REASONING_EFFORT
node scripts/setup.mjs set-model executor MODEL_ID REASONING_EFFORT
```

Start a new session after changing models. The command validates syntax; the provider determines model availability. It never silently chooses a fallback. Settings live outside the installed package and survive package updates. To pause the workflow, explicitly set `enabled` to `false` in the user configuration. The review protocol cannot be disabled independently while claiming reviewed completion.

## Removal and updates

```text
codex plugin remove advisor-mode-for-codex@advisor-mode-local
node scripts/setup.mjs uninstall
```

Uninstall removes only generated agent/profile files whose content still matches the ownership record. It preserves edited files and the settings/evidence directory. Native marketplace removal is optional if you want to keep the source registered. Rebuild and reinstall the package for updates; rerun setup to refresh unchanged personal agent files. Modified hook definitions require renewed trust.

## Verification and limits

On 2026-10-23, 22 local behavioral tests passed. Package validation and isolated installation passed with the desktop app's `codex-cli 0.163.0-alpha.11.2`. A direct request to `gpt-6.1-sol` succeeded with that executable. The separate PATH executable, `0.157.0`, rejected that model.

Two live workflow probes did not expose the configured custom agents or execute the observed hooks. Two deterministic API fixture probes also completed without hook continuation or review state. These are failed host acceptance tests, not passing review tests. They do not establish whether the cause is configuration discovery, runtime behavior, or another integration constraint. The main user profile remains unchanged. The independent source review and unit suite cannot replace native lifecycle evidence.

```text
node --test tests/*.test.mjs
node scripts/check.mjs
node tests/native-install.mjs /absolute/path/to/codex
node tests/native-flow.mjs /absolute/path/to/codex valid
node tests/native-flow.mjs /absolute/path/to/codex invalid
node tests/native-protocol.mjs /absolute/path/to/codex
```

Snapshots include tracked and untracked non-ignored Git files. Outside Git, the helper scans ordinary files. It excludes `.git`, `node_modules`, `private docs`, `.test-artifacts`, `.next`, `.venv`, `__pycache__`, `.env` files, common private key files, `auth.json`, and `credentials.json`. It rejects symlinks and special files. Limits are 20000 files and 128 MiB per snapshot. Excluded files and remote effects require separate review evidence. Tests must not rely on the snapshot as proof for those effects.

Content equality at review start, review end, and completion does not prove uninterrupted immutability. Stop all writers before review. Hook continuation matching is cooperative, based on an exact generated prompt digest, and is not authentication. Agents inherit the parent permissions; review instructions do not create an independent read-only sandbox.

Hooks can be disabled or untrusted. Host hook failures may continue execution. Stop asks the model to continue and does not retract text already delivered. This plugin records review status and requests correction; it does not provide a tamper-proof security boundary or a guarantee that the model cannot say an unsupported sentence.

The current public plugin directory excludes lifecycle hooks. GitHub distribution, directory acceptance, and official product adoption are separate steps. No publication or submission is part of this prerelease work.

The project has no public license selection yet. Choose a license before publication.
