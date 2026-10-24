import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gate } from '../lib/gate.mjs';
import { changeScope } from '../lib/scope.mjs';
import { defaults } from '../lib/config.mjs';
import { snapshotScope } from '../lib/snapshot.mjs';

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-scoped-gate-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  for (const dir of ['a', 'b']) { fs.mkdirSync(path.join(cwd, dir)); fs.writeFileSync(path.join(cwd, dir, 'code.txt'), dir); }
  const config = defaults();
  let state = null, n = 0;
  const snapshots = [];
  const run = (name, data = {}, cfg = config) => {
    const result = gate(state, { hook_event_name: name, session_id: 'scoped-session', cwd, model: cfg.roles.executor.model, ...data }, cfg, {
      nonce: () => `id-${++n}`, snapshot: scope => { snapshots.push(scope.digest); return snapshotScope(cwd, scope); }
    });
    state = result.state; return result.output;
  };
  run('UserPromptSubmit', { prompt: 'Review a, then b if scope expands.' });
  const select = (operation, paths) => { state = changeScope(state, { sessionId: state.sessionId, taskId: state.taskId, operation, paths }); };
  const start = (id = 'review-1') => run('SubagentStart', { agent_id: id, agent_type: 'advisor_mode_reviewer', model: config.roles.reviewer.model });
  const receipt = (id = 'review-1') => ({ ...state.reviewers[id], scopeComplete: true, verdict: 'APPROVED', checks: [{ name: 'requested files', status: 'PASS', evidence: 'Compared scope and current files with the request.' }], findings: [] });
  const finish = (review, id = 'review-1') => run('SubagentStop', { agent_id: id, agent_type: 'advisor_mode_reviewer', model: config.roles.reviewer.model, last_assistant_message: `ADVISOR_MODE_REVIEW ${JSON.stringify(review)}` });
  return { cwd, run, select, start, receipt, finish, config, snapshots, get state() { return state; } };
}

test('explicit scope reaches all three gate snapshots and reviewer context', t => {
  const f = fixture(t); f.select('set', ['a']);
  const output = f.start(); assert.ok(output.hookSpecificOutput.additionalContext.includes('a'));
  f.finish(f.receipt()); assert.deepEqual(f.run('Stop'), {});
  assert.deepEqual(f.snapshots, Array(3).fill(f.state.scope.digest));
  assert.equal(f.state.approval.scopeRevision, 1);
  assert.equal(f.state.approval.scopeComplete, true);
});

test('scope expansion cancels a pending reviewer and rejects its old receipt', t => {
  const f = fixture(t); f.select('set', ['a']); f.start(); const old = f.receipt();
  f.select('add', ['b']); f.finish(old);
  assert.equal(f.state.approval, null); assert.equal(f.state.scope.revision, 2);
  assert.equal(f.run('Stop').decision, 'block');
});

test('scope expansion revokes an approval and a new reviewer must approve the union', t => {
  const f = fixture(t); f.select('set', ['a']); f.start(); f.finish(f.receipt());
  assert.equal(f.state.status, 'REVIEWED'); f.select('add', ['b']);
  assert.equal(f.state.approval, null); assert.equal(f.state.status, 'PENDING');
  f.start('review-2'); f.finish(f.receipt('review-2'), 'review-2');
  assert.deepEqual(f.run('Stop'), {}); assert.equal(f.state.approval.scopeRevision, 2);
});

test('resume and continuation retain scope; a fresh user request resets it', t => {
  const f = fixture(t); f.select('set', ['a']); const scope = f.state.scope;
  f.run('SessionStart', { source: 'resume' }); assert.deepEqual(f.state.scope, scope);
  const continuation = f.run('Stop'); f.run('UserPromptSubmit', { prompt: continuation.reason });
  assert.deepEqual(f.state.scope, scope);
  f.run('UserPromptSubmit', { prompt: 'Now inspect another task.' });
  assert.equal(f.state.scope.mode, 'workspace'); assert.equal(f.state.scope.revision, 0);
});

test('model configuration invalidates approval but preserves explicit scope', t => {
  const f = fixture(t); f.select('set', ['a']); f.start(); f.finish(f.receipt());
  const scope = f.state.scope, changed = structuredClone(f.config);
  changed.roles.reviewer.model = 'future-model';
  assert.equal(f.run('Stop', {}, changed).decision, 'block');
  assert.deepEqual(f.state.scope, scope); assert.equal(f.state.approval, null);
});

test('scope completeness is an explicit required reviewer assertion', t => {
  for (const scopeComplete of [false, undefined, 'true']) {
    const f = fixture(t); f.select('set', ['a']); f.start();
    f.finish({ ...f.receipt(), scopeComplete });
    assert.equal(f.state.approval, null); assert.equal(f.run('Stop').decision, 'block');
  }
});

test('adding a Git parent retains explicitly selected ignored files and nested repositories', t => {
  for (const directory of [false, true]) {
    const f = fixture(t);
    assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: f.cwd, windowsHide: true }).status, 0);
    fs.writeFileSync(path.join(f.cwd, '.gitignore'), 'a/\n');
    if (directory) assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: path.join(f.cwd, 'a'), windowsHide: true }).status, 0);
    f.select('set', [directory ? 'a' : 'a/code.txt']); f.select('add', ['.']);
    f.start(); f.finish(f.receipt()); assert.equal(f.state.status, 'REVIEWED');
    fs.writeFileSync(path.join(f.cwd, 'a/code.txt'), 'modified ignored selection');
    assert.equal(f.run('Stop').decision, 'block'); assert.equal(f.state.approval, null);
  }
});

test('adding a parent does not remove original selected file type validation', t => {
  const f = fixture(t); f.select('set', ['a/code.txt']);
  fs.unlinkSync(path.join(f.cwd, 'a/code.txt')); fs.mkdirSync(path.join(f.cwd, 'a/code.txt'));
  f.select('add', ['a']); assert.throws(() => f.start(), /changed type/);
});
