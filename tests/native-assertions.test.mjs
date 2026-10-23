import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsNativeFlow } from './native-assertions.mjs';

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
