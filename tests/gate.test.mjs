import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gate } from '../lib/gate.mjs';

const config = JSON.parse(readFileSync(new URL('../advisor-config.json', import.meta.url)));
function fixture() {
  let state = null;
  let snapshot = 'a'.repeat(64);
  let n = 0;
  const run = (event, data = {}) => {
    const result = gate(state, { hook_event_name: event, session_id: 'session-A', cwd: '/workspace', model: config.roles.executor.model, ...data }, config, { snapshot: () => snapshot, nonce: () => `nonce-${++n}` });
    state = result.state;
    return result.output;
  };
  run('UserPromptSubmit', { prompt: 'Implement the approved task.', turn_id: 'turn-1' });
  const start = (data = {}) => run('SubagentStart', { agent_id: 'review-1', agent_type: 'advisor_mode_reviewer', model: config.roles.reviewer.model, ...data });
  const finish = (overrides = {}, data = {}) => {
    const record = state.reviewers['review-1'];
    const review = { taskId: state.taskId, snapshot: record.snapshot, nonce: record.nonce, verdict: 'APPROVED', checks: [{ name: 'acceptance', status: 'PASS', evidence: 'node --test: exit 0; assertion checks the requested behavior' }], findings: [], ...overrides };
    return run('SubagentStop', { agent_id: 'review-1', agent_type: 'advisor_mode_reviewer', model: config.roles.reviewer.model, last_assistant_message: `ADVISOR_MODE_REVIEW ${JSON.stringify(review)}`, ...data });
  };
  return { run, start, finish, get state() { return state; }, change: () => { snapshot = 'b'.repeat(64); } };
}

test('missing review requests continuation and never approves', () => {
  const f = fixture();
  assert.equal(f.run('Stop').decision, 'block');
  assert.equal(f.state.approval, null);
});
test('native reviewer approval permits completion for the current snapshot', () => {
  const f = fixture(); f.start(); f.finish();
  assert.deepEqual(f.run('Stop'), {});
  assert.equal(f.state.approval.agentId, 'review-1');
});
test('negative review cannot approve', () => {
  const f = fixture(); f.start(); f.finish({ verdict: 'CHANGES_REQUIRED', findings: ['Wrong return value.'] });
  assert.equal(f.run('Stop').decision, 'block');
  assert.equal(f.state.approval, null);
});
test('a change during review rejects its verdict', () => {
  const f = fixture(); f.start(); f.change(); f.finish();
  assert.equal(f.state.approval, null);
});
test('a change after review invalidates completion', () => {
  const f = fixture(); f.start(); f.finish(); f.change();
  assert.equal(f.run('Stop').decision, 'block');
  assert.equal(f.state.approval, null);
});
test('wrong model and unrelated role cannot supply a review', () => {
  const f = fixture(); f.start({ model: 'wrong-model' });
  assert.equal(f.state.reviewers['review-1'], undefined);
  f.run('SubagentStop', { agent_id: 'x', agent_type: 'worker', last_assistant_message: 'ADVISOR_MODE_REVIEW {"verdict":"APPROVED"}' });
  assert.equal(f.state.approval, null);
});
test('review must include passed checks, a nonce, and no findings', () => {
  for (const overrides of [{ checks: [] }, { nonce: 'forged' }, { findings: ['Unfixed defect.'] }, { checks: [{ name: 'x', status: 'FAIL', evidence: 'exit 1' }] }]) {
    const f = fixture(); f.start(); f.finish(overrides);
    assert.equal(f.state.approval, null);
  }
});
test('a new user request invalidates earlier approval and late callbacks', () => {
  const f = fixture(); f.start(); const oldTask = f.state.taskId;
  f.run('UserPromptSubmit', { prompt: 'A different task', turn_id: 'turn-2' });
  assert.notEqual(f.state.taskId, oldTask);
  f.run('SubagentStop', { agent_id: 'review-1', agent_type: 'advisor_mode_reviewer', model: config.roles.reviewer.model, last_assistant_message: 'APPROVED' });
  assert.equal(f.state.approval, null);
});
test('hook continuation preserves task and retry budget', () => {
  const f = fixture(); const id = f.state.taskId;
  const first = f.run('Stop');
  f.run('UserPromptSubmit', { prompt: first.reason, turn_id: 'continuation-turn' });
  assert.equal(f.state.taskId, id);
  assert.equal(f.state.continuations, 1);
  f.run('Stop');
  const exhausted = f.run('Stop');
  assert.equal(f.state.status, 'BLOCKED');
  assert.match(exhausted.reason, /ADVISOR_MODE_BLOCKED/);
  assert.deepEqual(f.run('Stop', { last_assistant_message: 'ADVISOR_MODE_BLOCKED: reviewer is unavailable.' }), {});
  assert.equal(f.state.approval, null);
});
test('matching failure requires advisor and successful tools do not clear an open breaker', () => {
  const f = fixture();
  const data = { tool_name: 'Bash', tool_input: { command: 'node test.mjs' }, tool_response: { exit_code: 1, stderr: 'expected 2, got 1' } };
  f.run('PostToolUse', data); f.run('PostToolUse', data);
  assert.equal(f.state.needsAdvisor, true);
  f.run('PostToolUse', { ...data, tool_response: { exit_code: 0 } });
  assert.equal(f.state.needsAdvisor, true);
});
test('different errors do not count as repeated identical failure', () => {
  const f = fixture();
  for (const error of ['one', 'two']) f.run('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'test' }, tool_response: { exit_code: 1, stderr: error } });
  assert.equal(f.state.needsAdvisor, false);
});
test('same session cannot be reused for another workspace', () => {
  const f = fixture();
  assert.throws(() => f.run('Stop', { cwd: '/other' }), /workspace/i);
});
test('an uncooperative completion cannot cause unbounded hook continuations', () => {
  const f = fixture();
  for (let i = 0; i < config.maxReviewContinuations + 1; i++) assert.equal(f.run('Stop').decision, 'block');
  const end = f.run('Stop');
  assert.equal(end.continue, false); assert.equal(end.decision, undefined);
  assert.equal(f.state.approval, null); assert.equal(f.state.status, 'BLOCKED');
});
test('a reused reviewer id cannot approve another attempt', () => {
  const f = fixture(); f.start(); f.finish({ verdict: 'CHANGES_REQUIRED', findings: ['Missing acceptance check.'] });
  f.start(); assert.equal(f.state.reviewers['review-1'], undefined);
  assert.equal(f.state.approval, null);
});
