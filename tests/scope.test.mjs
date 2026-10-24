import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { workspaceScope, currentScope, changeScope } from '../lib/scope.mjs';
import { defaults } from '../lib/config.mjs';
import { readState, statePath, transaction } from '../lib/store.mjs';
import { runScope } from '../scripts/scope.mjs';

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-scope-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  for (const dir of ['one', 'two', 'one/nested', '..notes']) fs.mkdirSync(path.join(cwd, dir), { recursive: true });
  for (const file of ['one/a.txt', 'two/b.txt', 'container.txt', '..notes/readme.txt']) fs.writeFileSync(path.join(cwd, file), file);
  const state = { version: 1, sessionId: 'session', taskId: 'task', cwd, agents: {}, reviewers: {}, approval: null,
    lastReview: null, continuations: 2, failure: { signature: 'failed', count: 2 }, needsAdvisor: true, continuationHash: 'old', status: 'PENDING' };
  const change = (s, operation, paths, extra = {}) => changeScope(s, { sessionId: 'session', taskId: 'task', operation, paths, ...extra });
  return { cwd, state, change };
}
async function stored(t) {
  const f = fixture(t);
  const dir = path.join(f.cwd, 'data'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(defaults()));
  await transaction(dir, 'session', () => ({ state: f.state, output: null }));
  return { ...f, dir };
}
const args = (operation, paths = [], task = 'task', session = 'session') => [operation, '--session', session, '--task', task, ...paths.flatMap(p => ['--path', p])];

test('workspace scope is pure and stored scopes reject malformed entries, digest and revision', () => {
  const cwd = path.resolve('/nonexistent-native-fixture');
  assert.deepEqual(currentScope({ cwd }), workspaceScope(cwd));
  const valid = workspaceScope(cwd);
  assert.equal(currentScope({ cwd, scope: { ...valid, entries: [{ kind: 'directory', path: cwd }] } }).digest, valid.digest);
  assert.throws(() => currentScope({ cwd, scope: { ...valid, revision: 1 } }), /Invalid/);
  assert.throws(() => currentScope({ cwd, scope: { ...valid, digest: 'forged' } }), /Invalid/);
  assert.throws(() => currentScope({ cwd, scope: { ...valid, entries: [{ path: '..', kind: 'file' }] } }), /Invalid/);
});
test('canonical scope unions deduplicate exact entries, retain descendants and reject narrowing', t => {
  const { cwd, state, change } = fixture(t);
  assert.throws(() => change(state, 'add', ['one']), /Set an explicit scope/);
  const first = change(state, 'set', ['two/b.txt', 'one/a.txt', 'one', 'container.txt', 'one/a.txt']);
  assert.deepEqual(first.scope.entries.map(e => path.relative(cwd, e.path)), ['container.txt', 'one', path.join('one', 'a.txt'), path.join('two', 'b.txt')]);
  assert.equal(first.scope.revision, 1);
  assert.equal(currentScope({ cwd, scope: { ...first.scope, revision: 2 } }).digest, first.scope.digest);
  assert.strictEqual(change(first, 'set', ['one', 'one/a.txt', 'container.txt', 'two/b.txt']), first);
  assert.strictEqual(change(first, 'add', ['one/a.txt']), first);
  if (process.platform === 'win32') assert.strictEqual(change(first, 'set', ['ONE', 'ONE/A.TXT', 'CONTAINER.TXT', 'TWO/B.TXT']), first);
  assert.throws(() => change(first, 'set', ['one']), /narrowing/);
  const broader = change(first, 'add', ['two']);
  assert.equal(broader.scope.revision, 2);
  assert.notEqual(broader.scope.digest, first.scope.digest);
  assert.deepEqual(broader.scope.entries.map(e => path.relative(cwd, e.path)), ['container.txt', 'one', path.join('one', 'a.txt'), 'two', path.join('two', 'b.txt')]);
  const parent = change(broader, 'add', ['.']);
  assert.deepEqual(parent.scope.entries, [{ path: cwd, kind: 'directory' }, ...broader.scope.entries]);
  assert.strictEqual(change(parent, 'add', ['two/b.txt']), parent);
});
test('expansion clears receipts and candidates but preserves failure history and continuation count', t => {
  const { state, change } = fixture(t);
  const selected = change(state, 'set', ['one']);
  const reviewed = { ...selected, approval: { agentId: 'r' }, reviewers: { r: {} }, lastReview: { verdict: 'APPROVED' }, continuationHash: 'resume', status: 'REVIEWED' };
  const expanded = change(reviewed, 'add', ['two']);
  assert.equal(expanded.approval, null); assert.deepEqual(expanded.reviewers, {}); assert.equal(expanded.lastReview, null);
  assert.equal(expanded.continuationHash, null); assert.equal(expanded.status, 'PENDING');
  assert.equal(expanded.continuations, 2); assert.deepEqual(expanded.failure, state.failure); assert.equal(expanded.needsAdvisor, true);
  assert.equal(reviewed.status, 'REVIEWED');
  for (const review of [{ approval: {} }, { reviewers: { candidate: {} } }, { lastReview: {} }]) {
    assert.throws(() => change({ ...state, ...review }, 'set', ['one']), /narrowing/);
  }
});
test('scope rejects outside, secret, runtime, missing, changed-type and wrong identity paths without mutation', t => {
  const { state, cwd, change } = fixture(t);
  fs.writeFileSync(path.join(cwd, '.env'), 'fixture');
  fs.mkdirSync(path.join(cwd, 'node_modules')); fs.writeFileSync(path.join(cwd, 'node_modules', 'x.txt'), 'x');
  const before = JSON.stringify(state);
  for (const target of ['../outside', '.env', 'node_modules/x.txt', 'missing']) assert.throws(() => change(state, 'set', [target]));
  for (const identity of [{ sessionId: 'wrong' }, { taskId: 'stale' }]) assert.throws(() => change(state, 'set', ['one'], identity), /existing native session/);
  assert.equal(JSON.stringify(state), before);
  assert.equal(change(state, 'set', ['..notes']).scope.entries[0].path, path.join(cwd, '..notes'));
  const first = change(state, 'set', ['one/a.txt']);
  fs.unlinkSync(path.join(cwd, 'one/a.txt')); fs.mkdirSync(path.join(cwd, 'one/a.txt'));
  assert.throws(() => change(first, 'add', ['one/a.txt']), /changed type/);
});
test('adding unrelated roots retains deleted selections', t => {
  const { state, cwd, change } = fixture(t);
  const first = change(state, 'set', ['one/a.txt', 'two']);
  fs.unlinkSync(path.join(cwd, 'one/a.txt')); fs.rmSync(path.join(cwd, 'two'), { recursive: true });
  const expanded = change(first, 'add', ['container.txt']);
  assert.ok(expanded.scope.entries.some(e => e.path === path.join(cwd, 'one/a.txt') && e.kind === 'file'));
  assert.ok(expanded.scope.entries.some(e => e.path === path.join(cwd, 'two') && e.kind === 'directory'));
  assert.strictEqual(change(expanded, 'set', expanded.scope.entries.map(e => e.path)), expanded);
});
test('directory junctions or symlinks and their descendants cannot enter scope', t => {
  const { cwd, state, change } = fixture(t);
  const link = path.join(cwd, 'linked');
  fs.symlinkSync(path.join(cwd, 'one'), link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => change(state, 'set', ['linked']), /symlinks or junctions/);
  assert.throws(() => change(state, 'set', ['linked/a.txt']), /symlinks or junctions/);
});
test('mocked special files cannot enter scope', t => {
  const { cwd, state, change } = fixture(t);
  const target = path.join(cwd, 'container.txt');
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (filename, options) => filename === target
    ? { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => false } : lstat(filename, options));
  assert.throws(() => change(state, 'set', ['container.txt']), /special files/);
  t.mock.restoreAll();
});
test('CLI status is read-only and stale or missing task/session never creates or changes state', async t => {
  const { dir } = await stored(t);
  const file = statePath(dir, 'session'), before = fs.readFileSync(file), stat = fs.statSync(file);
  const status = await runScope(args('status'), dir);
  assert.equal(status.scope.mode, 'workspace');
  assert.deepEqual(fs.readFileSync(file), before); assert.equal(fs.statSync(file).mtimeMs, stat.mtimeMs);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'sessions')), [path.basename(file)]);
  for (const operation of ['status', 'set', 'add']) {
    await assert.rejects(runScope(args(operation, operation === 'status' ? [] : ['one'], 'stale'), dir), /existing native session/);
    await assert.rejects(runScope(args(operation, operation === 'status' ? [] : ['one'], 'task', 'missing'), dir), /existing native session/);
  }
  assert.equal(readState(dir, 'missing'), null);
  assert.deepEqual(fs.readFileSync(file), before);
  const missingDir = path.join(dir, 'absent');
  assert.equal(readState(missingDir, 'missing'), null); assert.equal(fs.existsSync(missingDir), false);
  fs.writeFileSync(file, '{corrupt');
  assert.throws(() => readState(dir, 'session'), SyntaxError);
  await assert.rejects(transaction(dir, 'session', () => assert.fail('must not run with corrupt state')), SyntaxError);
  assert.equal(fs.readFileSync(file, 'utf8'), '{corrupt');
});
test('CLI resolves paths against native cwd and serializes concurrent adds without lost entries', async t => {
  const { dir, cwd } = await stored(t);
  const cli = fileURLToPath(new URL('../scripts/scope.mjs', import.meta.url));
  const env = { ...process.env, ADVISOR_MODE_DATA: dir };
  const first = spawnSync(process.execPath, [cli, ...args('set', ['one'])], { cwd: os.tmpdir(), env, encoding: 'utf8', windowsHide: true });
  assert.equal(first.status, 0, first.stderr);
  await Promise.all(['two', 'container.txt', '..notes'].map(target => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args('add', [target])], { cwd: os.tmpdir(), env, windowsHide: true, stdio: 'pipe' });
    let error = ''; child.stderr.on('data', text => error += text);
    child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(error)));
  })));
  const state = readState(dir, 'session');
  assert.deepEqual(state.scope.entries.map(e => path.relative(cwd, e.path)), ['..notes', 'container.txt', 'one', 'two']);
  assert.equal(state.scope.revision, 4);
  const before = fs.statSync(statePath(dir, 'session')).mtimeMs;
  await runScope(args('add', ['one']), dir);
  assert.equal(fs.statSync(statePath(dir, 'session')).mtimeMs, before);
});
