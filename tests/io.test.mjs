import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { snapshot } from '../lib/snapshot.mjs';
import { transaction, statePath } from '../lib/store.mjs';
import { setup } from '../scripts/setup.mjs';
import { fileURLToPath } from 'node:url';

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-mode-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('snapshot changes on edit, new file, deletion and executable content', t => {
  const dir = temporary(t);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one'); const first = snapshot(dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two'); const second = snapshot(dir); assert.notEqual(second, first);
  fs.writeFileSync(path.join(dir, 'b.txt'), 'new'); assert.notEqual(snapshot(dir), second);
  fs.unlinkSync(path.join(dir, 'a.txt')); assert.notEqual(snapshot(dir), second);
});
test('snapshot excludes secrets and private runtime evidence', t => {
  const dir = temporary(t); fs.writeFileSync(path.join(dir, 'source.txt'), 'stable'); const first = snapshot(dir);
  fs.writeFileSync(path.join(dir, '.env'), 'FAKE_SECRET=fixture');
  fs.mkdirSync(path.join(dir, 'private docs')); fs.writeFileSync(path.join(dir, 'private docs', 'evidence.txt'), 'private');
  assert.equal(snapshot(dir), first);
});
test('setup preserves config updates and unrelated global files', t => {
  const home = temporary(t); fs.writeFileSync(path.join(home, 'config.toml'), 'model = "existing"\n');
  setup('install', home); setup('set-model', home, ['reviewer', 'future-review-model', 'high']); setup('install', home);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'advisor-mode/config.json'))).roles.reviewer.model, 'future-review-model');
  assert.equal(fs.readFileSync(path.join(home, 'config.toml'), 'utf8'), 'model = "existing"\n');
});
test('setup refuses preexisting and locally edited agent files', t => {
  const home = temporary(t); fs.mkdirSync(path.join(home, 'agents'));
  const agent = path.join(home, 'agents/advisor_mode_reviewer.toml'); fs.writeFileSync(agent, 'user');
  assert.throws(() => setup('install', home), /overwrite/);
  assert.equal(fs.existsSync(path.join(home, 'advisor-mode/config.json')), false);
  fs.unlinkSync(agent); setup('install', home); fs.appendFileSync(agent, '# user edit');
  assert.throws(() => setup('set-model', home, ['advisor', 'new-model', 'high']), /overwrite/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'advisor-mode/config.json'))).roles.advisor.model, 'gpt-6-astra');
  assert.deepEqual(setup('uninstall', home).preserved, ['agents/advisor_mode_reviewer.toml']);
  assert.ok(fs.existsSync(agent));
});
test('session storage rejects corruption and keeps sessions independent', async t => {
  const dir = temporary(t);
  const state = sessionId => ({ version: 1, sessionId, taskId: 't', agents: {}, reviewers: {} });
  await transaction(dir, 'a', () => ({ state: state('a'), output: {} }));
  await transaction(dir, 'b', () => ({ state: state('b'), output: {} }));
  assert.notEqual(statePath(dir, 'a'), statePath(dir, 'b'));
  fs.writeFileSync(statePath(dir, 'a'), '{broken');
  await assert.rejects(transaction(dir, 'a', () => assert.fail('must not recover corruption')));
  assert.equal(JSON.parse(fs.readFileSync(statePath(dir, 'b'))).sessionId, 'b');
});
test('real concurrent processes serialize the complete read-modify-write transaction', async t => {
  const dir = temporary(t);
  const moduleUrl = new URL('../lib/store.mjs', import.meta.url).href;
  const script = `import {transaction} from ${JSON.stringify(moduleUrl)}; await transaction(process.argv[1], 'parallel', s=>({state:{version:1,sessionId:'parallel',taskId:'t',agents:{},reviewers:{},count:(s?.count||0)+1},output:{}}));`;
  await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, dir], { windowsHide: true, stdio: 'pipe' });
    let error = ''; child.stderr.on('data', b => error += b);
    child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(error)));
  })));
  assert.equal(JSON.parse(fs.readFileSync(statePath(dir, 'parallel'))).count, 8);
});
test('failed model update rolls back applied agents and remains installable', t => {
  const home = temporary(t); setup('install', home);
  const before = fs.readFileSync(path.join(home, 'agents/advisor_mode_reviewer.toml'), 'utf8');
  const rename = fs.renameSync;
  let injected = false;
  fs.renameSync = (source, target) => {
    if (!injected && target === path.join(home, 'advisor-mode/config.json')) { injected = true; throw new Error('injected install failure'); }
    return rename(source, target);
  };
  try { assert.throws(() => setup('set-model', home, ['reviewer', 'future-model', 'high']), /injected/); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(path.join(home, 'agents/advisor_mode_reviewer.toml'), 'utf8'), before);
  assert.doesNotThrow(() => setup('install', home));
});
test('hook config error ends retries after an explicit blocked response', t => {
  const dir = temporary(t);
  const hook = new URL('../scripts/hook.mjs', import.meta.url);
  for (const stop of [{ stop_hook_active: true }, { last_assistant_message: 'ADVISOR_MODE_BLOCKED: configuration missing.' }]) {
    const r = spawnSync(process.execPath, [fileURLToPath(hook), 'Stop'], { input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'failed', cwd: dir, ...stop }), env: { ...process.env, ADVISOR_MODE_DATA: dir }, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0); const output = JSON.parse(r.stdout);
    assert.equal(output.continue, false); assert.equal(output.decision, undefined);
    assert.match(output.systemMessage, /ADVISOR_MODE_BLOCKED/);
  }
});
