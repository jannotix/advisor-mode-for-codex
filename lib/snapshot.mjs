import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { currentScope, workspaceScope, scopeEligible, inspectScopePath, withinScopeRoot } from './scope.mjs';

const MAX_FILES = 20000, MAX_BYTES = 128 * 1024 * 1024;
export function snapshot(cwd) {
  const root = fs.realpathSync(cwd);
  return snapshotScope(root, workspaceScope(root));
}
export function snapshotScope(cwd, selected, { maxFiles = MAX_FILES, maxBytes = MAX_BYTES } = {}) {
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > MAX_FILES
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) throw new Error('Snapshot limits may only be reduced.');
  const scope = currentScope({ cwd, scope: selected });
  const files = new Map();
  const deleted = [];
  const add = filename => {
    files.set(filename, path.relative(cwd, filename).replaceAll('\\', '/'));
    if (files.size > maxFiles) throw new Error(`Workspace exceeds the ${maxFiles}-file snapshot limit.`);
  };
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const filename = path.join(dir, item.name);
      if (!scopeEligible(path.relative(cwd, filename))) continue;
      // lstat every descendant too; directory junctions must never be followed.
      const stat = inspectScopePath(cwd, filename);
      if (stat.isDirectory()) walk(filename);
      else add(filename);
    }
  }
  for (const entry of scope.entries) {
    const stat = inspectScopePath(cwd, entry.path, true);
    if (!stat) { deleted.push(entry); if (entry.kind === 'file') add(entry.path); continue; }
    if ((entry.kind === 'file' && !stat.isFile()) || (entry.kind === 'directory' && !stat.isDirectory())) throw new Error(`Scope entry changed type: ${entry.path}`);
    if (entry.kind === 'file') { add(entry.path); continue; }
    const git = spawnSync('git', ['-C', entry.path, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
    if (git.status === 0) {
      for (const relative of git.stdout.split('\0').filter(Boolean)) {
        const filename = path.resolve(entry.path, relative);
        if (!withinScopeRoot(entry.path, filename)) throw new Error('Git snapshot path escapes the selected directory.');
        if (scopeEligible(path.relative(cwd, filename))) {
          inspectScopePath(cwd, filename, true);
          add(filename);
        }
      }
    } else walk(entry.path);
  }
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ mode: scope.mode, entries: scope.entries }));
  hash.update(JSON.stringify(deleted));
  let bytes = 0;
  for (const [filename, relative] of [...files].sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)) {
    hash.update(JSON.stringify(relative));
    const stat = inspectScopePath(cwd, filename, true);
    if (!stat) { hash.update('deleted'); continue; }
    if (!stat.isFile()) throw new Error(`Snapshot does not certify special files: ${relative}`);
    bytes += stat.size;
    if (bytes > maxBytes) throw new Error(`Workspace exceeds the ${maxBytes}-byte snapshot limit.`);
    const data = fs.readFileSync(filename);
    if (data.length !== stat.size) throw new Error('File changed while taking the snapshot.');
    hash.update(String(stat.mode & 0o111));
    hash.update(createHash('sha256').update(data).digest());
  }
  return hash.digest('hex');
}
