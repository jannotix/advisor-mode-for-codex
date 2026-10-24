import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsNativeFlow } from './native-assertions.mjs';
import { defaults } from '../lib/config.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const callback = (hook_event_name, agent_type, agent_id, model) => ({ event: { hook_event_name, agent_type, agent_id, model }, output: '{}' });
const advisor = ['SubagentStart', 'SubagentStop'].map(event => callback(event, 'advisor_mode_advisor', 'advisor', 'gpt-6-astra'));
const reviewer = callback('SubagentStop', 'advisor_mode_reviewer', 'reviewer', 'gpt-6-astra');

test('native success requires an actual completed advisor and a distinct configured reviewer', () => {
  const evidence = { scenario: 'valid', exit: 0, events: [...advisor, reviewer], states: [{ status: 'REVIEWED', approval: { agentId: 'reviewer' } }] };
  assert.equal(acceptsNativeFlow(evidence), true);
  assert.equal(acceptsNativeFlow({ ...evidence, events: [reviewer] }), false);
  assert.equal(acceptsNativeFlow({ ...evidence, states: [{ status: 'REVIEWED', approval: { agentId: 'advisor' } }] }), false);
});

test('infrastructure blocking never passes functional rejection or stale-review acceptance', () => {
  for (const scenario of ['invalid', 'stale']) {
    assert.equal(acceptsNativeFlow({ scenario, exit: 0, events: advisor, states: [{ status: 'BLOCKED', approval: null }] }), false);
  }
});
test('noncode requires exact final answer, unchanged content and an independent reviewer without requiring an advisor', () => {
  const evidence = { scenario: 'noncode', exit: 0, events: [reviewer], states: [{ status: 'REVIEWED', approval: { agentId: 'reviewer' } }],
    initialSnapshot: 'a'.repeat(64), finalSnapshot: 'a'.repeat(64), stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '4' } }) };
  assert.equal(acceptsNativeFlow(evidence), true);
  assert.equal(acceptsNativeFlow({ ...evidence, finalSnapshot: 'b'.repeat(64) }), false);
  assert.equal(acceptsNativeFlow({ ...evidence, initialSnapshot: undefined }), false);
  assert.equal(acceptsNativeFlow({ ...evidence, stdout: evidence.stdout.replace('"4"', '"The answer is 4"') }), false);
  assert.equal(acceptsNativeFlow({ ...evidence, events: [] }), false);
});
test('replacement requires the configured reviewer model and a distinct reviewer identity', () => {
  const configuredRoles = defaults().roles; configuredRoles.reviewer = { model: 'gpt-6.1-sol', reasoningEffort: 'medium' };
  const replacement = callback('SubagentStop', 'advisor_mode_reviewer', 'replacement', 'gpt-6.1-sol');
  const evidence = { scenario: 'replacement', exit: 0, configuredRoles, events: [...advisor, replacement], states: [{ status: 'REVIEWED', approval: { agentId: 'replacement' } }] };
  assert.equal(acceptsNativeFlow(evidence), true);
  assert.equal(acceptsNativeFlow({ ...evidence, events: [...advisor, { ...replacement, event: { ...replacement.event, model: 'gpt-6-astra' } }] }), false);
  assert.equal(acceptsNativeFlow({ ...evidence, states: [{ status: 'REVIEWED', approval: { agentId: 'advisor' } }] }), false);
});
function scopedEvidence(scenario = 'scoped') {
  const workspace = path.resolve('/native-container');
  const entries = [{ path: path.join(workspace, 'a'), kind: 'directory' }, { path: path.join(workspace, 'b'), kind: 'directory' }, { path: path.join(workspace, 'roadmap.md'), kind: 'file' }];
  const scope = { mode: 'explicit', revision: 1, entries, digest: createHash('sha256').update(JSON.stringify({ mode: 'explicit', entries })).digest('hex') };
  const receipt = { taskId: 'task', configHash: 'config', agentId: 'reviewer', model: 'gpt-6-astra', scopeDigest: scope.digest, scopeRevision: 1, scopeComplete: true, snapshot: 'a'.repeat(64) };
  const started = callback('SubagentStart', 'advisor_mode_reviewer', 'reviewer', 'gpt-6-astra');
  const events = [...advisor, started, { ...reviewer }];
  const state = { taskId: 'task', configHash: 'config', scope, status: 'REVIEWED', approval: receipt };
  const evidence = { scenario, workspace, expectedScope: scope, defaultSnapshotError: 'Workspace exceeds the 20000-file snapshot limit.', containerIsGit: false,
    noiseFiles: 20001, baselineUnchanged: true, initialSnapshot: 'a'.repeat(64), finalSnapshot: 'a'.repeat(64), exit: 0, events, states: [state] };
  if (scenario === 'scoped-stale') {
    events[events.length - 1] = { ...reviewer, injectedMutation: true, acceptedReceipt: receipt, selectedScope: scope };
    events.push({ event: { hook_event_name: 'Stop' }, output: 'Workspace content changed after review' },
      callback('SubagentStart', 'advisor_mode_reviewer', 'fresh-reviewer', 'gpt-6-astra'), callback('SubagentStop', 'advisor_mode_reviewer', 'fresh-reviewer', 'gpt-6-astra'));
    state.status = 'BLOCKED'; state.approval = null;
    state.lastReview = { agentId: 'fresh-reviewer', model: 'gpt-6-astra', verdict: 'CHANGES_REQUIRED', findings: ['ADD_RESULT_MISMATCH in b/sum.mjs'],
      scopeDigest: scope.digest, scopeRevision: 1, scopeComplete: true };
    evidence.finalSnapshot = 'b'.repeat(64);
  }
  return evidence;
}
test('scoped native acceptance requires all three canonical entries, bound receipt and real completed reviewer', () => {
  const evidence = scopedEvidence();
  assert.equal(acceptsNativeFlow(evidence), true);
  for (const patch of [
    { defaultSnapshotError: null }, { containerIsGit: true }, { noiseFiles: 20000 }, { initialSnapshot: undefined }, { baselineUnchanged: false },
    { finalSnapshot: 'b'.repeat(64) }, { events: advisor }, { exit: 1 },
    { states: [{ ...evidence.states[0], approval: null, status: 'BLOCKED' }] }
  ]) assert.equal(acceptsNativeFlow({ ...evidence, ...patch }), false, JSON.stringify(patch));
  for (const field of [{ scopeComplete: false }, { scopeDigest: 'wrong' }, { scopeRevision: 2 }, { configHash: 'wrong' }, { taskId: 'wrong' }]) {
    const altered = structuredClone(evidence); Object.assign(altered.states[0].approval, field);
    assert.equal(acceptsNativeFlow(altered), false, JSON.stringify(field));
  }
  const partial = structuredClone(evidence); partial.states[0].scope.entries.pop();
  assert.equal(acceptsNativeFlow(partial), false);
  const forgedExpected = structuredClone(evidence); forgedExpected.expectedScope.entries.pop();
  assert.equal(acceptsNativeFlow(forgedExpected), false);
});
test('scoped stale acceptance requires invalidation followed by a fresh concrete rejection of the complete scope', () => {
  const evidence = scopedEvidence('scoped-stale');
  assert.equal(acceptsNativeFlow(evidence), true);
  for (const alter of [
    e => { e.states[0].lastReview.findings = ['infrastructure unavailable']; },
    e => { delete e.states[0].lastReview; },
    e => { e.events = e.events.filter(x => x.event.hook_event_name !== 'Stop'); },
    e => { e.events.find(x => x.injectedMutation).injectedMutation = false; },
    e => { e.events.find(x => x.injectedMutation).acceptedReceipt.scopeComplete = false; },
    e => { e.states[0].lastReview.agentId = 'reviewer'; },
    e => { e.states[0].lastReview.scopeDigest = 'partial'; },
    e => { e.states[0].lastReview.scopeComplete = false; },
    e => { e.events = e.events.filter(x => x.event.agent_id !== 'fresh-reviewer'); },
    e => { e.finalSnapshot = e.initialSnapshot; }
  ]) {
    const altered = structuredClone(evidence); alter(altered);
    assert.equal(acceptsNativeFlow(altered), false, String(alter));
  }
});
