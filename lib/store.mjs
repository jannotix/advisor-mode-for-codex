import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export function statePath(dir, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 300) throw new Error('Invalid session id.');
  return path.join(dir, 'sessions', createHash('sha256').update(sessionId).digest('hex') + '.json');
}
export function readState(dir, sessionId) {
  let state;
  try { state = JSON.parse(fs.readFileSync(statePath(dir, sessionId), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!state || state.version !== 1 || state.sessionId !== sessionId || typeof state.taskId !== 'string' || !state.agents || !state.reviewers) throw new Error('Invalid stored task state.');
  return state;
}
export async function transaction(dir, sessionId, update) {
  const file = statePath(dir, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = file + '.lock';
  const deadline = Date.now() + 5000;
  let held = false;
  while (!held) {
    try { fs.mkdirSync(lock); held = true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`State is locked: ${lock}. Check for a running hook before removing the lock.`);
      await delay(25);
    }
  }
  try {
    const state = readState(dir, sessionId);
    const result = update(state);
    if (result.state) {
      const temporary = file + '.' + randomUUID() + '.tmp';
      try {
        fs.writeFileSync(temporary, JSON.stringify(result.state, null, 2) + '\n', { flag: 'wx' });
        for (let attempt = 0; ; attempt++) {
          try { fs.renameSync(temporary, file); break; }
          catch (error) {
            if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
            await delay(50);
          }
        }
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    return result.output;
  } finally { fs.rmdirSync(lock); }
}
