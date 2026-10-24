import { createHash, randomUUID } from 'node:crypto';
import { roles } from './config.mjs';
import { message, context } from './messages.mjs';
import { currentScope, workspaceScope } from './scope.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function gate(previous, event, config, io) {
  const name = event.hook_event_name;
  const nonce = io.nonce || randomUUID;
  let state = previous ? structuredClone(previous) : null;
  if (!config.enabled) return { state, output: {} };
  if (!event.session_id || !event.cwd) throw new Error('Missing native session_id or cwd.');
  if (state && (state.sessionId !== event.session_id || state.cwd !== event.cwd)) throw new Error('Session or workspace mismatch.');
  const configHash = digest(config);
  const begin = () => ({ version: 1, sessionId: event.session_id, cwd: event.cwd, taskId: nonce(), configHash,
    scope: workspaceScope(event.cwd),
    reviewers: {}, agents: {}, approval: null, continuations: 0, continuationHash: null,
    status: 'PENDING', failure: null, needsAdvisor: false, reason: 'No valid independent review.' });
  const scopeContext = value => message('scope', {
    entries: JSON.stringify(currentScope(value).entries), revision: currentScope(value).revision,
    command: JSON.stringify([...(io.scopeCommand || ['node', '<plugin>/scripts/scope.mjs']), 'set', '--session', value.sessionId, '--task', value.taskId, '--path', '<approved project or file>'])
  });
  if (state && !state.scope) {
    state.scope = workspaceScope(state.cwd); state.approval = null; state.reviewers = {};
    state.status = 'PENDING'; state.reason = 'A fresh scope-bound review is required.';
  }
  if (name === 'SessionStart') {
    // Child sessions receive their role instructions, not the parent orchestration loop.
    if (event.source === 'fork') return { state, output: {} };
    return { state, output: context(name, message('session', { roles: JSON.stringify(config.roles) }) + (state ? '\n' + scopeContext(state) : '')) };
  }
  if (name === 'UserPromptSubmit') {
    if (typeof event.prompt !== 'string') throw new Error('Missing native user prompt.');
    // This is cooperative continuation matching, not an authentication boundary.
    if (!state || digest(event.prompt) !== state.continuationHash) state = begin();
    return { state, output: context(name, message('task', { taskId: state.taskId }) + '\n' + scopeContext(state)) };
  }
  state ||= begin();
  const scope = currentScope(state);
  if (state.configHash !== configHash) {
    state.configHash = configHash; state.approval = null; state.reviewers = {};
    state.reason = 'Configuration changed. Start a fresh reviewer with the updated model.';
  }
  let output = {};
  if (name === 'SubagentStart') {
    if (!event.agent_id || !event.agent_type || !event.model) throw new Error('Incomplete native agent identity.');
    if (state.agents[event.agent_id]) return { state, output: context(name, message('roleMismatch')) };
    state.agents[event.agent_id] = { type: event.agent_type, model: event.model };
    if (event.agent_type === roles.reviewer) {
      state.approval = null;
      // Only the most recently started independent reviewer can approve.
      state.reviewers = {};
      if (event.model !== config.roles.reviewer.model) {
        state.reason = 'Reviewer model mismatch.'; output = context(name, message('roleMismatch'));
      } else {
        const record = { taskId: state.taskId, configHash, scopeDigest: scope.digest, scopeRevision: scope.revision,
          model: event.model, snapshot: io.snapshot(scope), nonce: nonce() };
        state.reviewers[event.agent_id] = record;
        const example = JSON.stringify({ taskId: state.taskId, configHash, scopeDigest: scope.digest, scopeRevision: scope.revision,
          snapshot: record.snapshot, nonce: record.nonce, scopeComplete: true,
          verdict: 'APPROVED or CHANGES_REQUIRED', checks: [{ name: 'acceptance check', status: 'PASS or FAIL', evidence: 'command, exit code and decisive assertion' }], findings: [] });
        output = context(name, message('review', { taskId: state.taskId, example, entries: JSON.stringify(scope.entries) }));
      }
    }
  } else if (name === 'SubagentStop') {
    const agent = state.agents[event.agent_id];
    if (event.agent_type === roles.advisor && agent?.type === roles.advisor && agent.model === config.roles.advisor.model && event.model === agent.model && event.last_assistant_message?.trim()) {
      state.needsAdvisor = false; state.failure = null;
    }
    const record = state.reviewers[event.agent_id];
    if (record) {
      delete state.reviewers[event.agent_id];
      state.approval = null;
      state.reason = 'Reviewer verdict is missing, rejected, or malformed.';
      const match = event.last_assistant_message?.match(/(?:^|\n)ADVISOR_MODE_REVIEW (\{[^\n]+\})\s*$/);
      let review;
      try { review = match ? JSON.parse(match[1]) : null; } catch { review = null; }
      const identityValid = event.agent_type === roles.reviewer && event.model === record.model
        && record.configHash === configHash && record.taskId === state.taskId
        && record.scopeDigest === scope.digest && record.scopeRevision === scope.revision
        && review?.taskId === state.taskId && review?.configHash === configHash
        && review?.scopeDigest === scope.digest && review?.scopeRevision === scope.revision
        && review?.nonce === record.nonce && review?.snapshot === record.snapshot;
      if (identityValid && ['APPROVED', 'CHANGES_REQUIRED'].includes(review.verdict) && Array.isArray(review.checks) && Array.isArray(review.findings)) {
        state.lastReview = { agentId: event.agent_id, model: event.model, verdict: review.verdict, checks: review.checks, findings: review.findings,
          scopeDigest: scope.digest, scopeRevision: scope.revision, scopeComplete: review.scopeComplete === true };
      }
      const valid = identityValid && Array.isArray(review?.checks) && review.checks.length > 0
        && review.checks.every(c => typeof c.name === 'string' && c.name.trim() && c.status === 'PASS' && typeof c.evidence === 'string' && c.evidence.trim())
        && Array.isArray(review?.findings) && review.findings.length === 0
        && review.verdict === 'APPROVED' && review.scopeComplete === true && !state.needsAdvisor;
      if (valid && io.snapshot(scope) === record.snapshot) {
        state.approval = { ...record, agentId: event.agent_id, checks: review.checks, scopeComplete: true };
        state.status = 'REVIEWED'; state.reason = '';
      }
    }
  } else if (name === 'PostToolUse') {
    const response = event.tool_response;
    // Preserve native nonzero process exit codes; do not count ordinary text containing "error".
    const code = response?.exit_code ?? response?.exitCode ?? response?.exit_code_number;
    const failed = (typeof code === 'number' && code !== 0) || response?.isError === true;
    if (failed) {
      const signature = digest([event.tool_name, event.tool_input, code, response?.stderr ?? response?.output ?? response?.content]);
      const count = state.failure?.signature === signature ? state.failure.count + 1 : 1;
      state.failure = { signature, count };
      if (count >= config.maxConsecutiveFailures) {
        state.needsAdvisor = true; state.approval = null;
        output = context(name, message('failure'));
      }
    } else if (code === 0) state.failure = null;
  } else if (name === 'Stop') {
    if (state.approval && state.approval.scopeDigest === scope.digest && state.approval.scopeRevision === scope.revision
      && state.approval.scopeComplete === true && !state.needsAdvisor && io.snapshot(scope) === state.approval.snapshot) {
      state.status = 'REVIEWED';
    } else {
      state.approval = null;
      if (state.status === 'REVIEWED') state.reason = 'Workspace content changed after review.';
      if (/^ADVISOR_MODE_BLOCKED:\s*\S/.test(event.last_assistant_message || '')) {
        state.status = 'BLOCKED';
      } else if (state.status === 'BLOCKED' && state.continuations > config.maxReviewContinuations) {
        // End hook-driven retries without ever creating a review receipt.
        output = { continue: false, systemMessage: message('blocked', { taskId: state.taskId, reason: state.reason }) };
      } else {
        const exhausted = state.continuations >= config.maxReviewContinuations;
        state.status = exhausted ? 'BLOCKED' : 'PENDING';
        state.continuations++;
        const reason = message(exhausted ? 'blocked' : 'retry', { taskId: state.taskId, reason: state.reason, model: config.roles.reviewer.model });
        state.continuationHash = digest(reason);
        output = { decision: 'block', reason };
      }
    }
  }
  return { state, output };
}
