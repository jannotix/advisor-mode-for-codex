import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsNativeFlow } from './native-assertions.mjs';
import { defaults } from '../lib/config.mjs';

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
