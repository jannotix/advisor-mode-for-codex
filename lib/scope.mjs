import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const excluded = new Set(['.git', 'node_modules', 'private docs', '.test-artifacts', '.next', '.venv', '__pycache__']);
const key = value => process.platform === 'win32' ? value.toLowerCase() : value;
export const scopeEligible = relative => !relative.split(/[\\/]/).some(part => excluded.has(key(part))
  || /^\.env(?:\.|$)/i.test(part) || /\.(?:pem|key|p12|pfx)$/i.test(part) || /^(?:auth|credentials)\.json$/i.test(part));
export function withinScopeRoot(cwd, target) {
  const relative = path.relative(cwd, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function canonical(entries) {
  const sorted = [...entries].sort((a, b) => key(a.path) < key(b.path) ? -1 : key(a.path) > key(b.path) ? 1 : 0);
  // A Git parent can ignore an explicitly selected child; retain overlapping selections.
  return sorted.filter((entry, index) => index === 0 || key(sorted[index - 1].path) !== key(entry.path));
}
const digest = (mode, entries) => createHash('sha256').update(JSON.stringify({ mode, entries: entries.map(({ path, kind }) => ({ path, kind })) })).digest('hex');
function scope(mode, revision, entries) {
  return { mode, revision, entries, digest: digest(mode, entries) };
}
export function workspaceScope(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('Invalid native workspace path.');
  return scope('workspace', 0, [{ path: path.resolve(cwd), kind: 'directory' }]);
}
export function currentScope(state) {
  const fallback = workspaceScope(state.cwd);
  if (state.scope === undefined) return fallback;
  const value = state.scope;
  if (!value || !['workspace', 'explicit'].includes(value.mode) || !Number.isSafeInteger(value.revision)
    || value.revision < (value.mode === 'workspace' ? 0 : 1) || !Array.isArray(value.entries) || !value.entries.length) throw new Error('Invalid stored task scope.');
  for (const entry of value.entries) {
    if (!entry || typeof entry.path !== 'string' || !path.isAbsolute(entry.path) || path.resolve(entry.path) !== entry.path
      || !['directory', 'file'].includes(entry.kind) || !withinScopeRoot(fallback.entries[0].path, entry.path)
      || !scopeEligible(path.relative(state.cwd, entry.path))) throw new Error('Invalid stored scope entry.');
  }
  if (JSON.stringify(canonical(value.entries)) !== JSON.stringify(value.entries)
    || value.digest !== digest(value.mode, value.entries)
    || (value.mode === 'workspace' && (value.revision !== 0 || value.entries.length !== 1
      || value.entries[0].path !== fallback.entries[0].path || value.entries[0].kind !== 'directory'))) throw new Error('Invalid stored task scope.');
  return value;
}
export function inspectScopePath(cwd, target, allowMissing = false) {
  if (!withinScopeRoot(cwd, target) || !scopeEligible(path.relative(cwd, target))) throw new Error('Scope path is outside the workspace or excluded.');
  const root = path.parse(target).root;
  const components = path.relative(root, target).split(path.sep).filter(Boolean);
  let cursor = root;
  let stat;
  for (let index = 0; index < components.length; index++) {
    cursor = path.join(cursor, components[index]);
    try { stat = fs.lstatSync(cursor); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') return null; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`Scope does not certify symlinks or junctions: ${cursor}`);
    if (index < components.length - 1 && !stat.isDirectory()) throw new Error(`Scope path component changed type: ${cursor}`);
  }
  return stat || fs.lstatSync(root);
}
export function changeScope(state, { sessionId, taskId, operation, paths }) {
  if (!state || state.sessionId !== sessionId || state.taskId !== taskId || !sessionId || !taskId) throw new Error('Scope requires the existing native session and current task.');
  if (!['set', 'add'].includes(operation) || !Array.isArray(paths) || !paths.length || paths.some(value => typeof value !== 'string' || !value)) throw new Error('Expected set or add with at least one path.');
  const previous = currentScope(state);
  if (operation === 'add' && previous.mode === 'workspace') throw new Error('Set an explicit scope before adding paths.');
  const entries = paths.map(value => {
    const target = path.resolve(state.cwd, value);
    // Existing deleted selections remain covered; every newly selected path must exist.
    const existing = previous.mode === 'explicit' && previous.entries.find(entry => key(entry.path) === key(target));
    const stat = inspectScopePath(state.cwd, target, Boolean(existing));
    if (!stat && existing) return existing;
    if (!stat.isDirectory() && !stat.isFile()) throw new Error(`Scope does not certify special files: ${target}`);
    const kind = stat.isDirectory() ? 'directory' : 'file';
    if (existing && existing.kind !== kind) throw new Error(`Scope entry changed type: ${target}`);
    return { path: existing ? existing.path : fs.realpathSync(target), kind };
  });
  const nextEntries = canonical(operation === 'add' ? [...previous.entries, ...entries] : entries);
  const mode = operation === 'add' ? previous.mode : 'explicit';
  const nextDigest = digest(mode, nextEntries);
  if (previous.digest === nextDigest) return state;
  if (operation === 'set' && (previous.mode === 'explicit' || state.approval || Object.keys(state.reviewers || {}).length || state.lastReview)) throw new Error('Scope narrowing is unavailable after selection or review; use add to expand coverage.');
  return { ...state, scope: scope(mode, previous.revision + 1, nextEntries), approval: null, reviewers: {}, lastReview: null,
    continuationHash: null, status: 'PENDING', reason: 'Review scope changed. Start a fresh independent reviewer.' };
}
