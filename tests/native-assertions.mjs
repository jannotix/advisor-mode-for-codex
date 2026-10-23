import { defaults } from '../lib/config.mjs';

export function acceptsNativeFlow({ scenario, exit, events, states }) {
  const unavailable = scenario === 'unavailable';
  const advisors = events.filter(e => e.event.hook_event_name === 'SubagentStart' && e.event.agent_type === 'advisor_mode_advisor' && e.event.model === defaults().roles.advisor.model);
  const advisorCompleted = advisors.some(start => events.some(end => end.event.hook_event_name === 'SubagentStop' && end.event.agent_id === start.event.agent_id && end.event.agent_type === start.event.agent_type && end.event.model === start.event.model));
  const approvedReviewIsIndependent = states.filter(s => s.approval).every(s => !advisors.some(a => a.event.agent_id === s.approval.agentId)
    && events.some(e => e.event.hook_event_name === 'SubagentStop' && e.event.agent_id === s.approval.agentId && e.event.agent_type === 'advisor_mode_reviewer' && e.event.model === defaults().roles.reviewer.model));
  const passed = exit === 0 && advisorCompleted && approvedReviewIsIndependent && (unavailable
    ? states.some(s => s.status === 'BLOCKED' && !s.approval)
      && events.some(e => e.event.hook_event_name === 'SubagentStart' && e.event.agent_type === 'advisor_mode_reviewer' && e.event.model === 'advisor-mode-unavailable-fixture')
      && !events.some(e => e.event.hook_event_name === 'SubagentStart' && e.event.agent_type === 'advisor_mode_reviewer' && e.event.model !== 'advisor-mode-unavailable-fixture')
    : scenario === 'valid' ? states.some(s => s.status === 'REVIEWED' && s.approval)
    : states.some(s => s.status === 'BLOCKED' && !s.approval && s.lastReview?.model === defaults().roles.reviewer.model
      && s.lastReview.verdict === 'CHANGES_REQUIRED' && JSON.stringify(s.lastReview.findings).includes('ADD_RESULT_MISMATCH')))
    && (scenario !== 'stale' || (events.some(e => e.injectedMutation) && events.some(e => e.event.hook_event_name === 'Stop' && e.output.includes('Workspace content changed after review'))));
  return passed;
}
