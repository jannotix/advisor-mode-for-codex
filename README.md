# Advisor Mode for Codex

Advisor Mode adds configurable executor, advisor, and independent final reviewer roles to local Codex sessions. Install it once in a personal profile and use it across workspaces.

This independent project is a development prerelease tested with the Windows executable bundled with the desktop app, `codex-cli 0.163.0-alpha.11.2`. Native acceptance covers correct work, rejected work, and changes after approval. It is not an official OpenAI plugin. A local workflow gate cannot protect its state against a process that has unrestricted access to the same files.

By default, the plugin snapshots the chat's workspace. A chat containing several projects can select the directories and files involved in its current task. The selection is explicit; mentioning a path in the conversation does not change coverage. Select the scope before starting a reviewer if the parent workspace exceeds the snapshot limits.

## Workflow

The default executor is `gpt-6.1-sol`. The advisor and final reviewer use `gpt-6-astra` in separate agent contexts. Each role has its own model and reasoning setting. The advisor handles design choices and repeated matching failures. A fresh reviewer reads the requirements, actual files, and verification evidence before completion.

The hook records native reviewer identity and a workspace content digest. It accepts an explicit review only from the expected role and model. A later change invalidates approval. Missing, negative, malformed, or stale reviews request another pass. An unavailable reviewer produces a blocked result, never a successful review record.

The work standards cover small complete changes, meaningful checks, concrete prose, and accessible interfaces. They ship as original instructions and require no third-party skills.

## Requirements

- Node.js 22 or later and Git for Git-aware snapshots.
- A local Codex client with personal TOML agents and SessionStart, UserPromptSubmit, SubagentStart, SubagentStop, PostToolUse, and Stop hooks.
- Access to the configured models in that client. Model access in another client does not prove access here.

## Personal installation

Run `codex --version` and use a client that supports the configured models; an older executable on PATH may reject them even when the desktop app supports them.

### From a release archive

Extract the versioned release ZIP and follow its outer `INSTALL.md`. From the extracted root:

```text
node dist/advisor-mode-for-codex/scripts/setup.mjs install
codex plugin marketplace add "/absolute/path/to/extracted-release"
codex plugin add advisor-mode-for-codex@advisor-mode-local
```

The archive includes the built plugin and local marketplace. It needs no source checkout or build step. Keep the extracted directory available while the marketplace is registered. The README you are reading inside `dist/advisor-mode-for-codex` is the plugin's documentation; installation starts from the outer archive directory.

### From a source checkout

The source marketplace points to `dist`, which Git does not track. Build before registering that checkout:

```text
node scripts/package.mjs
node scripts/setup.mjs install
codex plugin marketplace add "/absolute/path/to/Advisor mode for Codex"
codex plugin add advisor-mode-for-codex@advisor-mode-local
```

The marketplace points to the generated `dist/advisor-mode-for-codex` directory. The package allowlist excludes tests, internal planning, evidence, and repository metadata. Keep the source directory available while using its local marketplace. Registering an unbuilt source repository directly as a GitHub marketplace is not a supported installation route.

The package uses `.codex-plugin/plugin.json`. Do not add a root portable `plugin.json`: the verified host selects that format and omits its lifecycle hooks. Native `hooks/list` must report all six plugin hooks before activation. The installation check verifies that condition.

Review and trust the plugin's hooks in Codex, then start a new session. Installing files does not grant hook trust. In CLI, use `/hooks` to inspect the definitions. Do not use a hook-trust bypass for normal installation.

Setup adds three personal agents, `advisor-mode.config.toml`, and `advisor-mode/config.json` under CODEX_HOME (default `~/.codex`). It does not replace `config.toml`, AGENTS.md, permissions, or existing agents. Use `codex -p advisor-mode` to select the executor in a new CLI session, or select it in the desktop model picker. The plugin does not change the model of an existing chat.

For a disposable profile, add `--home /absolute/test/home` to setup and set CODEX_HOME to that directory for native plugin commands. Do not copy credentials into test artifacts.

## Configuration

Run these commands from the plugin root: the source checkout root, or `dist/advisor-mode-for-codex` inside an extracted release.

```text
node scripts/setup.mjs status
node scripts/setup.mjs set-model reviewer MODEL_ID REASONING_EFFORT
node scripts/setup.mjs set-model advisor MODEL_ID REASONING_EFFORT
node scripts/setup.mjs set-model executor MODEL_ID REASONING_EFFORT
```

Start a new session after changing models. The command validates syntax; the provider determines model availability. It never silently chooses a fallback. Settings live outside the installed package and survive package updates. To pause the workflow, explicitly set `enabled` to `false` in the user configuration. The review protocol cannot be disabled independently while claiming reviewed completion.

Codex can append `[tui.model_availability_nux]` to the generated CLI profile during normal use. Setup preserves that separate section byte for byte when the managed prefix is unchanged. It still refuses edits to managed settings or other unsupported profile extensions. Uninstall preserves an extended profile, since the extension belongs to the client or user.

## Chats with multiple projects

The task hook supplies the installed command path, native session ID and current task ID. Use those values to select existing directories or files before editing or starting the reviewer:

```text
node /installed/plugin/scripts/scope.mjs set --session SESSION_ID --task TASK_ID --path "project-a" --path "project-b" --path "roadmap.md"
node /installed/plugin/scripts/scope.mjs status --session SESSION_ID --task TASK_ID
node /installed/plugin/scripts/scope.mjs add --session SESSION_ID --task TASK_ID --path "shared-contracts"
```

Relative paths resolve from the native chat workspace. The command rejects missing paths, excluded files, junctions and paths outside that workspace. Select the containing directory when creating a new file. `status` reads without changing state. The command cannot create a task or approve work.

Coverage can expand within a task, but cannot shrink after selection or review. Adding a parent directory retains explicitly selected children, including eligible files ignored by Git. Overlapping selections count each file once. An expanded scope invalidates pending and accepted reviews, even if content has not changed. The next reviewer must inspect the complete selection and affirm that it covers the requested work. Deleted selections remain represented in the content digest.

Resume and hook continuations retain the selection. A new user request starts a new task with the whole workspace selected. Snapshot limits apply to the aggregate selection: 20000 files and 128 MiB. Selecting several projects does not multiply those limits.

This is a cooperative review scope. It does not restrict shell access or prove that files outside the selection were untouched. The executor must declare the requested paths and external effects; the reviewer must compare them with the task and available change evidence. Out-of-scope files and remote effects need separate evidence.

## Removal and updates

Run setup from the same plugin root used for configuration:

```text
codex plugin remove advisor-mode-for-codex@advisor-mode-local
node scripts/setup.mjs uninstall
```

Uninstall removes only generated agent/profile files whose content still matches the ownership record. It preserves edited files and the settings/evidence directory. Native marketplace removal is optional if you want to keep it registered. For updates, extract the new release and register its directory, or rebuild the source checkout; rerun setup and plugin installation. Modified hook definitions require normal trust review.

## Verification and limits

On 2026-10-24, the alpha.4 source passed 65 local tests and package validation. Real-model scoped tests used a non-Git container with 20001 unrelated files, two selected repositories and one selected container file. The positive case reached REVIEWED. In the stale case, a controlled change to the second project after approval caused Stop to invalidate the receipt; a fresh reviewer proved the arithmetic defect and the task ended BLOCKED with no approval. Both test harnesses exited 0. The corrected package also passed clean-copy isolated installation, six-hook discovery and deterministic Stop continuation.

On 2026-10-23, 30 local behavioral tests passed. Package validation, isolated installation, and discovery of all six hooks passed with the desktop app's `codex-cli 0.163.0-alpha.11.2`. Live tests used `gpt-6.1-sol` with separate `gpt-6-astra` advisor and reviewer agents. Correct work reached REVIEWED. Incorrect work received CHANGES_REQUIRED and ended BLOCKED without approval. A test changed the artifact after accepted review; Stop detected the change, requested a new review, and ended BLOCKED after the reviewer proved the defect. An unavailable reviewer model also ended BLOCKED, with no alternate reviewer model or approval.

Additional live checks verified an informational answer with no workspace changes and a reviewer changed to `gpt-6.1-sol`, retained through reinstall and observed in the actual native callback. The alpha.4 personal desktop installation exposes six enabled, trusted hooks. A fresh Astra reviewer in that desktop chat received a native scope-bound nonce and produced an APPROVED receipt accepted by SubagentStop. A real concurrent edit to a selected shared record was rejected before a subsequent fresh review approved stable content. These observations establish reviewer acceptance; they do not alone prove the parent Stop event's outcome or certify every desktop path.

Earlier probes failed because the portable package format omitted hooks and the live fixture did not expose its roles. The current live fixture passes process-only hook and role declarations to the native client, reusing account authentication without changing the main profile. A separate isolated installed-plugin test verifies package discovery and Stop continuation with a deterministic local API fixture. Those two tests establish different parts of the contract; they do not certify every desktop UI path or host version.

```text
node --test tests/*.test.mjs
node scripts/check.mjs
node tests/native-install.mjs /absolute/path/to/codex
node tests/native-flow.mjs /absolute/path/to/codex valid
node tests/native-flow.mjs /absolute/path/to/codex invalid
node tests/native-flow.mjs /absolute/path/to/codex stale
node tests/native-flow.mjs /absolute/path/to/codex unavailable
node tests/native-flow.mjs /absolute/path/to/codex noncode
node tests/native-flow.mjs /absolute/path/to/codex replacement
node tests/native-flow.mjs /absolute/path/to/codex scoped
node tests/native-flow.mjs /absolute/path/to/codex scoped-stale
node tests/native-protocol.mjs /absolute/path/to/codex
```

The commands above require a source checkout; tests are not included in the release ZIP. Build a release archive from a clean Git checkout on Windows with `powershell.exe -NoProfile -File scripts/release.ps1`. The archive records its source commit and version and has a SHA-256 checksum. Validate that exact archive with `node tests/native-release.mjs /absolute/path/to/archive.zip /absolute/path/to/codex`; this test extracts and installs it in a disposable profile without rebuilding its contents.

Snapshots include tracked and untracked non-ignored Git files. Outside Git, the helper scans ordinary files. It excludes `.git`, `node_modules`, `private docs`, `.test-artifacts`, `.next`, `.venv`, `__pycache__`, `.env` files, common private key files, `auth.json`, and `credentials.json`. It rejects symlinks and special files. Limits are 20000 files and 128 MiB per snapshot. Excluded files and remote effects require separate review evidence. Tests must not rely on the snapshot as proof for those effects.

An explicitly selected eligible file is included even if Git ignores it. Adding its parent keeps that selection. The multi-project native fixtures capture a prelaunch baseline of selected content and verify that the baseline remains unchanged; they make no assertion about unselected files. Native test agents use `fork_turns: "none"` because ephemeral CLI sessions may lack the stored rollout needed for inherited context.

Content equality at review start, review end, and completion does not prove uninterrupted immutability. Stop all writers before review. Hook continuation matching is cooperative, based on an exact generated prompt digest, and is not authentication. Agents inherit the parent permissions; review instructions do not create an independent read-only sandbox.

Automatic repeated-failure counting requires structured exit codes or tool error flags. The verified native Bash callbacks provide output text without an exit code, so that path relies on the agent's two-strike instructions. The plugin does not guess command failure from arbitrary output text. The final review gate still verifies the recorded reviewer and workspace snapshot.

Hooks can be disabled or untrusted. Host hook failures may continue execution. Stop asks the model to continue and does not retract text already delivered. This plugin records review status and requests correction; it does not provide a tamper-proof security boundary or a guarantee that the model cannot say an unsupported sentence.

OpenAI's [distribution documentation](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks), checked on 2026-10-24, permits manual installation of hook-based plugins and excludes them from the public plugin directory. This release uses manual distribution. Official adoption would require a separate decision by OpenAI.

## License

Copyright 2026 Gianluca Iannotta. Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
