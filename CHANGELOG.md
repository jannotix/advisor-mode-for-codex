# Changelog

## 0.1.0-alpha.4 - 2026-10-24

- Prepare a manual-install release archive with its local marketplace, installation instructions, source commit and checksum.
- Validate installation from the extracted archive without rebuilding it from source.
- Bind release inventory to the source commit and reject ignored local files or added archive entries, even when their checksum is recalculated.

- Select directories and files for one task in a chat containing multiple projects.
- Expand coverage with `scope add`; invalidate pending and accepted reviews when coverage changes.
- Bind reviewer receipts to the selected scope, revision, configuration and content, with an explicit scope-completeness assertion.
- Preserve selected coverage across resume and hook continuations; reset it for a new user request.
- Apply file and byte limits across all selected entries and reject junctions, excluded paths and paths outside the native workspace.
- Retain deleted selections in the snapshot and preserve the review retry budget when changing scope.
- Retain explicit child selections when a Git parent ignores them; count overlapping files once.
- Retry transient Windows state-file rename errors within a bounded interval while preserving atomic replacement and the previous file on failure.

## 0.1.0-alpha.3 - 2026-10-23

- Preserve the native CLI model-availability section when updating the generated profile.
- Keep ownership limited to generated content so uninstall preserves native additions.
- Correct the snapshot deletion assertion and remove an untested executable-mode claim.
- Verify an informational task and an effective reviewer model replacement with live native events.
- Invalidate an existing review when model configuration changes, even with unchanged files.
- Record trusted desktop activation separately from the pending project-root review.

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
