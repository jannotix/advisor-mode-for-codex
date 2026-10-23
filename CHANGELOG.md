# Changelog

## 0.1.0-alpha.2 - 2026-10-23

- Apply Apache-2.0 and include LICENSE and NOTICE in the plugin package.
- Use the native compatibility manifest so the verified client loads lifecycle hooks.
- Check all six hooks through the native discovery API after isolated installation.
- Verify live positive review, negative review, and invalidation after an approved artifact changes.
- Stop repeated reviews of unchanged rejected content when corrections are outside authorization.
- Document the native Bash exit-code limitation and separate CLI evidence from desktop activation.

## 0.1.0-alpha.1 - 2026-10-23

- Add personal executor, advisor, and independent reviewer configuration.
- Bind review records to native agent identity, task, configuration, and workspace content.
- Reject missing, negative, stale, malformed, and wrong-model reviews.
- Preserve user settings and edited agent files during setup and removal.
- Package runtime files with an explicit allowlist.
- Add behavioral and isolated native installation checks.

Native runtime certification remains separate from package installation.
