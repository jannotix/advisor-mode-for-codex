import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { snapshot, snapshotScope } from '../lib/snapshot.mjs';
import { workspaceScope, changeScope } from '../lib/scope.mjs';

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-snapshot-scope-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  for (const dir of ['one', 'two', 'outside', '..notes']) fs.mkdirSync(path.join(cwd, dir));
  for (const file of ['one/a.txt', 'two/b.txt', 'container.txt', 'outside/ignored.txt', '..notes/a.txt']) fs.writeFileSync(path.join(cwd, file), 'four');
  const state = { sessionId: 'session', taskId: 'task', cwd, reviewers: {} };
  const select = paths => changeScope(state, { sessionId: 'session', taskId: 'task', operation: 'set', paths }).scope;
  return { cwd, select };
}
test('two repositories and a container file share one snapshot; unrelated content is outside its guarantee', t => {
  const { cwd, select } = fixture(t);
  for (const dir of ['one', 'two']) assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: path.join(cwd, dir), windowsHide: true }).status, 0);
  const scope = select(['one', 'two', 'container.txt']);
  const first = snapshotScope(cwd, scope);
  for (const file of ['one/a.txt', 'two/b.txt', 'container.txt']) {
    fs.writeFileSync(path.join(cwd, file), 'changed');
    assert.notEqual(snapshotScope(cwd, scope), first, file);
    fs.writeFileSync(path.join(cwd, file), 'four');
    assert.equal(snapshotScope(cwd, scope), first);
  }
  fs.writeFileSync(path.join(cwd, 'outside/ignored.txt'), 'outside scope');
  assert.equal(snapshotScope(cwd, scope), first);
});
test('selected file and directory deletions remain tombstones and recreation changes their snapshot', t => {
  const { cwd, select } = fixture(t);
  const scope = select(['one', 'container.txt']);
  const first = snapshotScope(cwd, scope);
  fs.unlinkSync(path.join(cwd, 'container.txt'));
  const missingFile = snapshotScope(cwd, scope); assert.notEqual(missingFile, first);
  fs.rmSync(path.join(cwd, 'one'), { recursive: true });
  const missingBoth = snapshotScope(cwd, scope); assert.notEqual(missingBoth, missingFile);
  assert.equal(snapshotScope(cwd, scope), missingBoth);
  fs.mkdirSync(path.join(cwd, 'one'));
  assert.notEqual(snapshotScope(cwd, scope), missingBoth);
  fs.writeFileSync(path.join(cwd, 'container.txt'), 'new data');
  assert.notEqual(snapshotScope(cwd, scope), missingFile);
});
test('scope snapshots reject changed types, native directory junctions, and junction ancestors', t => {
  const { cwd, select } = fixture(t);
  const file = select(['container.txt']);
  fs.unlinkSync(path.join(cwd, 'container.txt')); fs.mkdirSync(path.join(cwd, 'container.txt'));
  assert.throws(() => snapshotScope(cwd, file), /changed type/);
  const directory = select(['one']);
  fs.rmSync(path.join(cwd, 'one'), { recursive: true }); fs.writeFileSync(path.join(cwd, 'one'), 'different type');
  assert.throws(() => snapshotScope(cwd, directory), /changed type/);
  fs.unlinkSync(path.join(cwd, 'one')); fs.mkdirSync(path.join(cwd, 'one'));
  const nested = path.join(cwd, 'one', 'link');
  fs.symlinkSync(path.join(cwd, 'two'), nested, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => snapshotScope(cwd, directory), /symlinks or junctions/);
});
test('a selected directory replaced with a junction is rejected before reading its target', t => {
  const { cwd, select } = fixture(t);
  const scope = select(['one']);
  fs.rmSync(path.join(cwd, 'one'), { recursive: true });
  fs.symlinkSync(path.join(cwd, 'two'), path.join(cwd, 'one'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => snapshotScope(cwd, scope), /symlinks or junctions/);
});
test('aggregate limits span all selections and cannot be raised above production caps', t => {
  const { cwd, select } = fixture(t);
  const scope = select(['one', 'two']);
  assert.doesNotThrow(() => snapshotScope(cwd, scope, { maxFiles: 2, maxBytes: 8 }));
  assert.throws(() => snapshotScope(cwd, scope, { maxFiles: 1 }), /1-file snapshot limit/);
  assert.throws(() => snapshotScope(cwd, scope, { maxBytes: 7 }), /7-byte snapshot limit/);
  assert.throws(() => snapshotScope(cwd, scope, { maxFiles: 20001 }), /only be reduced/);
  assert.throws(() => snapshotScope(cwd, scope, { maxBytes: 128 * 1024 * 1024 + 1 }), /only be reduced/);
  assert.throws(() => snapshotScope(cwd, scope, { maxFiles: NaN }), /only be reduced/);
  const overlapping = select(['one', 'one/a.txt']);
  assert.doesNotThrow(() => snapshotScope(cwd, overlapping, { maxFiles: 1, maxBytes: 4 }));
});
test('whole-workspace snapshots preserve exclusions, git ignores and eligible ..notes paths', t => {
  const { cwd } = fixture(t);
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd, windowsHide: true }).status, 0);
  fs.writeFileSync(path.join(cwd, '.gitignore'), 'ignored.txt\n');
  const first = snapshot(cwd);
  assert.equal(snapshotScope(cwd, workspaceScope(cwd)), first);
  fs.writeFileSync(path.join(cwd, '.env'), 'FAKE=fixture');
  fs.writeFileSync(path.join(cwd, 'ignored.txt'), 'ignored');
  fs.mkdirSync(path.join(cwd, 'private docs')); fs.writeFileSync(path.join(cwd, 'private docs', 'evidence.txt'), 'ignored');
  assert.equal(snapshot(cwd), first);
  fs.writeFileSync(path.join(cwd, '..notes/a.txt'), 'new');
  assert.notEqual(snapshot(cwd), first);
});
test('git tracked deletions and intermediate junctions are revalidated', t => {
  const { cwd, select } = fixture(t);
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd, windowsHide: true }).status, 0);
  assert.equal(spawnSync('git', ['add', 'one/a.txt'], { cwd, windowsHide: true }).status, 0);
  const scope = select(['one']);
  const before = snapshotScope(cwd, scope);
  fs.unlinkSync(path.join(cwd, 'one/a.txt'));
  assert.notEqual(snapshotScope(cwd, scope), before);
  fs.rmSync(path.join(cwd, 'one'), { recursive: true });
  fs.symlinkSync(path.join(cwd, 'two'), path.join(cwd, 'one'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => snapshot(cwd), /symlinks or junctions/);
});
test('mocked Git enumeration cannot escape its selected directory within the native workspace', t => {
  const { cwd, select } = fixture(t);
  const scope = select(['one']);
  t.mock.method(childProcess, 'spawnSync', () => ({ status: 0, stdout: '../two/b.txt\0' }));
  syncBuiltinESMExports();
  try { assert.throws(() => snapshotScope(cwd, scope), /escapes the selected directory/); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});
