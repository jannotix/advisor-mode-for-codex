# Install the manual release archive

This archive contains the local marketplace and its prebuilt plugin under `dist/advisor-mode-for-codex`. Extract the entire ZIP into a permanent directory. Keep that directory available while using the local marketplace. No source build is required.

Use Node.js 22 or later, Git, and a Codex client that supports personal TOML agents and all six lifecycle hooks: SessionStart, UserPromptSubmit, SubagentStart, SubagentStop, PostToolUse and Stop. The release procedure is tested on Windows. Host support and access to the configured models must be checked in your client.

Run the commands below from the extracted root. Replace `ABS_EXTRACTED_ROOT` with its absolute path. Check `codex --version` first: an older executable on PATH can differ from the client bundled with the desktop app. If needed, run the commands with the full path to the intended executable.

```text
codex --version
node dist/advisor-mode-for-codex/scripts/setup.mjs install
codex plugin marketplace add "ABS_EXTRACTED_ROOT"
codex plugin add advisor-mode-for-codex@advisor-mode-local
codex plugin list --json
```

Setup adds personal agents, `advisor-mode.config.toml`, and settings under `CODEX_HOME` (default `~/.codex`). It preserves unrelated personal configuration and refuses to overwrite user-owned or modified managed files. Existing settings survive updates. Setup does not change the model of an existing chat. The packaged README explains configuration, scope selection, removal and host limitations.

Review the hook definitions and grant normal hook trust in Codex, then start a new session. Use `/hooks` in the CLI to inspect them. Installing files or listing the plugin does not establish hook trust, model access or successful independent review. Do not bypass trust for normal installation.

`BUILD.json` records the source Git commit and plugin version. The separate `.zip.sha256` file contains the SHA-256 digest of the ZIP. On Windows, compare it with `Get-FileHash -Algorithm SHA256` before extraction. A matching checksum detects changed bytes; it does not authenticate the publisher.

The archive is a local marketplace installation. It does not require a direct GitHub marketplace route or publication in a public plugin directory.
