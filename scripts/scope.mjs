import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataRoot, readConfig } from '../lib/config.mjs';
import { readState, transaction } from '../lib/store.mjs';
import { changeScope, currentScope } from '../lib/scope.mjs';

export async function runScope(args, dir = dataRoot()) {
  const [operation, ...options] = args;
  if (!['set', 'add', 'status'].includes(operation)) throw new Error('Expected scope set, add, or status.');
  const request = { operation, paths: [] };
  for (let index = 0; index < options.length; index += 2) {
    const option = options[index], value = options[index + 1];
    if (!['--session', '--task', '--path'].includes(option) || !value || value.startsWith('--')) throw new Error('Expected --session ID --task ID and repeated --path PATH.');
    if (option === '--path') request.paths.push(value);
    else {
      const name = option === '--session' ? 'sessionId' : 'taskId';
      if (request[name]) throw new Error(`Repeated ${option}.`);
      request[name] = value;
    }
  }
  if (!request.sessionId || !request.taskId || (operation === 'status' && request.paths.length)) throw new Error('Scope requires --session ID --task ID; status takes no paths.');
  readConfig(dir);
  const requireTask = state => {
    if (!state || state.sessionId !== request.sessionId || state.taskId !== request.taskId) throw new Error('Scope requires the existing native session and current task.');
    return state;
  };
  const report = state => ({ sessionId: state.sessionId, taskId: state.taskId, cwd: state.cwd, scope: currentScope(state) });
  if (operation === 'status') return report(requireTask(readState(dir, request.sessionId)));
  return transaction(dir, request.sessionId, state => {
    const next = changeScope(requireTask(state), request);
    return { state: next === state ? null : next, output: report(next) };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runScope(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}
