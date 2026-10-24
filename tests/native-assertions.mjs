import { defaults } from '../lib/config.mjs';
import path from 'node:path';
import { currentScope } from '../lib/scope.mjs';

export function acceptsNativeFlow({ scenario, exit, events, states, configuredRoles = defaults().roles, initialSnapshot, finalSnapshot, stdout = '', workspace, expectedScope, defaultSnapshotError, containerIsGit, noiseFiles, baselineUnchanged }) {
  const unavailable = scenario === 'unavailable';
  const advisors = events.filter(e => e.event.hook_event_name === 'SubagentStart' && e.event.agent_type === 'advisor_mode_advisor' && e.event.model === configuredRoles.advisor.model);
  const advisorCompleted = advisors.some(start => events.some(end => end.event.hook_event_name === 'SubagentStop' && end.event.agent_id === start.event.agent_id && end.event.agent_type === start.event.agent_type && end.event.model === start.event.model));
  const approvedReviewIsIndependent = states.filter(s => s.approval).every(s => !advisors.some(a => a.event.agent_id === s.approval.agentId)
    && events.some(e => e.event.hook_event_name === 'SubagentStop' && e.event.agent_id === s.approval.agentId && e.event.agent_type === 'advisor_mode_reviewer' && e.event.model === configuredRoles.reviewer.model
      && e.event.agent_id !== e.event.session_id));
  const noncodePassed = scenario !== 'noncode' || (typeof initialSnapshot === 'string' && initialSnapshot.length === 64 && initialSnapshot === finalSnapshot
    && stdout.trim().split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(item => item?.type === 'item.completed' && item.item?.type === 'agent_message').at(-1)?.item.text === '4');
  const scoped = ['scoped', 'scoped-stale'].includes(scenario);
  const reviewerCompleted = id => {
    if (typeof id !== 'string' || !id) return false;
    const start = events.findIndex(e => e.event.hook_event_name === 'SubagentStart' && e.event.agent_type === 'advisor_mode_reviewer'
      && e.event.agent_id === id && e.event.model === configuredRoles.reviewer.model && e.event.agent_id !== e.event.session_id
      && !advisors.some(a => a.event.agent_id === id));
    return start >= 0 && events.some((e, index) => index > start && e.event.hook_event_name === 'SubagentStop'
      && e.event.agent_id === id && e.event.agent_type === 'advisor_mode_reviewer' && e.event.model === configuredRoles.reviewer.model
      && e.event.session_id === events[start].event.session_id);
  };
  let scopedPassed = !scoped;
  if (scoped && typeof workspace === 'string' && expectedScope && containerIsGit === false && noiseFiles > 20000 && baselineUnchanged === true
    && defaultSnapshotError?.includes('20000-file snapshot limit') && /^[a-f0-9]{64}$/.test(initialSnapshot || '') && /^[a-f0-9]{64}$/.test(finalSnapshot || '')) {
    const entries = [{ path: path.join(workspace, 'a'), kind: 'directory' }, { path: path.join(workspace, 'b'), kind: 'directory' }, { path: path.join(workspace, 'roadmap.md'), kind: 'file' }];
    const validScope = value => {
      try { return currentScope({ cwd: workspace, scope: value }).mode === 'explicit' && value.digest === expectedScope.digest
        && JSON.stringify(value.entries) === JSON.stringify(entries); } catch { return false; }
    };
    const bound = (scope, receipt) => validScope(scope) && receipt?.scopeDigest === scope.digest
      && receipt.scopeRevision === scope.revision && receipt.scopeComplete === true;
    const receiptValid = (state, receipt) => bound(state.scope, receipt) && receipt.taskId === state.taskId
      && receipt.configHash === state.configHash && receipt.model === configuredRoles.reviewer.model && reviewerCompleted(receipt.agentId);
    scopedPassed = validScope(expectedScope) && (scenario === 'scoped'
      ? initialSnapshot === finalSnapshot && states.some(s => s.status === 'REVIEWED' && receiptValid(s, s.approval) && s.approval.snapshot === finalSnapshot)
      : initialSnapshot !== finalSnapshot && events.some((mutation, mutationIndex) => mutation.injectedMutation
        && bound(mutation.selectedScope, mutation.acceptedReceipt) && reviewerCompleted(mutation.acceptedReceipt.agentId)
        && mutation.event.agent_id === mutation.acceptedReceipt.agentId && mutation.event.hook_event_name === 'SubagentStop'
        && mutation.acceptedReceipt.model === configuredRoles.reviewer.model
        && mutation.acceptedReceipt.snapshot === initialSnapshot
        && events.some((stop, stopIndex) => stopIndex > mutationIndex && stop.event.hook_event_name === 'Stop' && stop.output.includes('Workspace content changed after review'))
        && states.some(s => s.status === 'BLOCKED' && !s.approval && bound(s.scope, s.lastReview)
          && s.taskId === mutation.acceptedReceipt.taskId && s.configHash === mutation.acceptedReceipt.configHash
          && s.lastReview.verdict === 'CHANGES_REQUIRED' && s.lastReview.model === configuredRoles.reviewer.model
          && s.lastReview.agentId !== mutation.acceptedReceipt.agentId && reviewerCompleted(s.lastReview.agentId)
          && events.some((start, index) => index > mutationIndex && start.event.hook_event_name === 'SubagentStart' && start.event.agent_id === s.lastReview.agentId)
          && JSON.stringify(s.lastReview.findings).includes('ADD_RESULT_MISMATCH'))));
  }
  const passed = exit === 0 && (scenario === 'noncode' || advisorCompleted) && approvedReviewIsIndependent && noncodePassed && scopedPassed && (unavailable
    ? states.some(s => s.status === 'BLOCKED' && !s.approval)
      && events.some(e => e.event.hook_event_name === 'SubagentStart' && e.event.agent_type === 'advisor_mode_reviewer' && e.event.model === 'advisor-mode-unavailable-fixture')
      && !events.some(e => e.event.hook_event_name === 'SubagentStart' && e.event.agent_type === 'advisor_mode_reviewer' && e.event.model !== 'advisor-mode-unavailable-fixture')
    : ['valid', 'noncode', 'replacement', 'scoped'].includes(scenario) ? states.some(s => s.status === 'REVIEWED' && s.approval)
    : states.some(s => s.status === 'BLOCKED' && !s.approval && s.lastReview?.model === configuredRoles.reviewer.model
      && s.lastReview.verdict === 'CHANGES_REQUIRED' && JSON.stringify(s.lastReview.findings).includes('ADD_RESULT_MISMATCH')))
    && (!['stale', 'scoped-stale'].includes(scenario) || (events.some(e => e.injectedMutation) && events.some(e => e.event.hook_event_name === 'Stop' && e.output.includes('Workspace content changed after review'))));
  return passed;
}
