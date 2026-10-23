import { defaults } from '../lib/config.mjs';

export function acceptsNativeFlow({ scenario, exit, events, states, configuredRoles = defaults().roles, initialSnapshot, finalSnapshot, stdout = '' }) {
  const unavailable = scenario === 'unavailable';
  const advisors = events.filter(e => e.event.hook_event_name === 'SubagentStart' && e.event.agent_type === 'advisor_mode_advisor' && e.event.model === configuredRoles.advisor.model);
  const advisorCompleted = advisors.some(start => events.some(end => end.event.hook_event_name === 'SubagentStop' && end.event.agent_id === start.event.agent_id && end.event.agent_type === start.event.agent_type && end.event.model === start.event.model));
  const approvedReviewIsIndependent = states.filter(s => s.approval).every(s => !advisors.some(a => a.event.agent_id === s.approval.agentId)
    && events.some(e => e.event.hook_event_name === 'SubagentStop' && e.event.agent_id === s.approval.agentId && e.event.agent_type === 'advisor_mode_reviewer' && e.event.model === configuredRoles.reviewer.model
      && e.event.agent_id !== e.event.session_id));
  const noncodePassed = scenario !== 'noncode' || (typeof initialSnapshot === 'string' && initialSnapshot.length === 64 && initialSnapshot === finalSnapshot
    && stdout.trim().split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(item => item?.type === 'item.completed' && item.item?.type === 'agent_message').at(-1)?.item.text === '4');
  const passed = exit === 0 && (scenario === 'noncode' || advisorCompleted) && approvedReviewIsIndependent && noncodePassed && (unavailable
    ? states.some(s => s.status === 'BLOCKED' && !s.approval)
      && events.some(e => e.event.hook_event_name === 'SubagentStart' && e.event.agent_type === 'advisor_mode_reviewer' && e.event.model === 'advisor-mode-unavailable-fixture')
      && !events.some(e => e.event.hook_event_name === 'SubagentStart' && e.event.agent_type === 'advisor_mode_reviewer' && e.event.model !== 'advisor-mode-unavailable-fixture')
    : ['valid', 'noncode', 'replacement'].includes(scenario) ? states.some(s => s.status === 'REVIEWED' && s.approval)
    : states.some(s => s.status === 'BLOCKED' && !s.approval && s.lastReview?.model === configuredRoles.reviewer.model
      && s.lastReview.verdict === 'CHANGES_REQUIRED' && JSON.stringify(s.lastReview.findings).includes('ADD_RESULT_MISMATCH')))
    && (scenario !== 'stale' || (events.some(e => e.injectedMutation) && events.some(e => e.event.hook_event_name === 'Stop' && e.output.includes('Workspace content changed after review'))));
  return passed;
}
