import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readState, statePath, transaction } from '../lib/store.mjs';
import { defaults } from '../lib/config.mjs';
import { runScope } from '../scripts/scope.mjs';

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-store-retry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = { version: 1, sessionId: 'session', taskId: 'task', cwd: dir, agents: {}, reviewers: {}, count: 1 };
  await transaction(dir, 'session', () => ({ state, output: null }));
  return { dir, file: statePath(dir, 'session'), state };
}
function noArtifacts(dir, file) {
  assert.deepEqual(fs.readdirSync(path.join(dir, 'sessions')), [path.basename(file)]);
}

test('Windows retries the same atomic rename after deterministic transient sharing errors', { skip: process.platform !== 'win32' }, async t => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) await t.test(code, async t => {
    const { dir, file } = await fixture(t);
    const before = fs.readFileSync(file);
    const rename = fs.renameSync;
    const sources = [];
    let updates = 0;
    t.mock.method(fs, 'renameSync', (source, target) => {
      assert.equal(target, file); assert.ok(fs.existsSync(file + '.lock'));
      assert.deepEqual(fs.readFileSync(file), before);
      sources.push(source);
      if (sources.length < 3) throw Object.assign(new Error(`injected ${code}`), { code });
      return rename(source, target);
    });
    const output = await transaction(dir, 'session', state => { updates++; return { state: { ...state, count: 2 }, output: 'saved' }; });
    assert.equal(output, 'saved'); assert.equal(updates, 1); assert.equal(sources.length, 3);
    assert.equal(new Set(sources).size, 1); assert.equal(readState(dir, 'session').count, 2);
    noArtifacts(dir, file);
  });
});
test('Windows retry exhaustion preserves the old destination, propagates the error and cleans lock and temporary file', { skip: process.platform !== 'win32' }, async t => {
  const { dir, file } = await fixture(t);
  const before = fs.readFileSync(file);
  const error = Object.assign(new Error('injected permanent sharing failure'), { code: 'EPERM' });
  let attempts = 0, updates = 0;
  const sources = new Set();
  const write = fs.writeFileSync, unlink = fs.unlinkSync;
  t.mock.method(fs, 'writeFileSync', (target, ...args) => { assert.notEqual(target, file, 'never replace destination with a non-atomic write'); return write(target, ...args); });
  t.mock.method(fs, 'unlinkSync', target => { assert.notEqual(target, file, 'never delete the old destination'); return unlink(target); });
  t.mock.method(fs, 'renameSync', (source, target) => {
    assert.equal(target, file); assert.ok(fs.existsSync(file + '.lock'));
    assert.deepEqual(fs.readFileSync(file), before); sources.add(source); attempts++; throw error;
  });
  await assert.rejects(transaction(dir, 'session', state => { updates++; return { state: { ...state, count: 2 }, output: null }; }), failure => failure === error);
  assert.equal(attempts, 6); assert.equal(updates, 1); assert.equal(sources.size, 1);
  assert.deepEqual(fs.readFileSync(file), before); noArtifacts(dir, file);
});
test('nonretry rename errors propagate immediately and leave the original state and no artifacts', async t => {
  const { dir, file } = await fixture(t);
  const before = fs.readFileSync(file);
  const error = Object.assign(new Error('injected missing path'), { code: 'ENOENT' });
  let attempts = 0, updates = 0;
  t.mock.method(fs, 'renameSync', () => { attempts++; throw error; });
  await assert.rejects(transaction(dir, 'session', state => { updates++; return { state: { ...state, count: 2 } }; }), failure => failure === error);
  assert.equal(attempts, 1); assert.equal(updates, 1);
  assert.deepEqual(fs.readFileSync(file), before); noArtifacts(dir, file);
});
test('scope mutations read task state once inside the lock while status reads without a lock', async t => {
  const { dir, file } = await fixture(t);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(defaults()));
  const selected = path.join(dir, 'selected'); fs.mkdirSync(selected);
  const read = fs.readFileSync;
  const locked = [];
  t.mock.method(fs, 'readFileSync', (target, ...args) => {
    if (target === file) locked.push(fs.existsSync(file + '.lock'));
    return read(target, ...args);
  });
  await runScope(['set', '--session', 'session', '--task', 'task', '--path', 'selected'], dir);
  assert.deepEqual(locked, [true]);
  locked.length = 0;
  const before = read(file), modified = fs.statSync(file).mtimeMs;
  await runScope(['status', '--session', 'session', '--task', 'task'], dir);
  assert.deepEqual(locked, [false]); assert.deepEqual(read(file), before); assert.equal(fs.statSync(file).mtimeMs, modified);
  noArtifacts(dir, file);
});
