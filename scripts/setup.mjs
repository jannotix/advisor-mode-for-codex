import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { defaults, roles, root, validateConfig } from '../lib/config.mjs';
import { replaceFiles } from '../lib/install-files.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const quote = JSON.stringify;
export function generated(config) {
  const files = {};
  const craft = fs.readFileSync(path.join(root, 'rules/craft.md'), 'utf8');
  for (const [role, name] of Object.entries(roles)) {
    const instructions = fs.readFileSync(path.join(root, `agents/${role}.md`), 'utf8') + '\n' + craft;
    files[`agents/${name}.toml`] = `name = ${quote(name)}\ndescription = ${quote(`Advisor Mode ${role}. Use only for this role.`)}\nmodel = ${quote(config.roles[role].model)}\nmodel_reasoning_effort = ${quote(config.roles[role].reasoningEffort)}\ndeveloper_instructions = ${quote(instructions)}\n`;
  }
  files['advisor-mode.config.toml'] = `model = ${quote(config.roles.executor.model)}\nmodel_reasoning_effort = ${quote(config.roles.executor.reasoningEffort)}\n\n[agents]\nenabled = true\n`;
  return files;
}

export function setup(command, home, args = []) {
  home = path.resolve(home);
  fs.mkdirSync(home, { recursive: true });
  const lock = path.join(home, '.advisor-mode-setup.lock');
  try { fs.mkdirSync(lock); } catch (error) { if (error.code === 'EEXIST') throw new Error('Another setup operation is active. Inspect the setup lock before retrying.'); throw error; }
  try { return applySetup(command, home, args); } finally { fs.rmdirSync(lock); }
}

function applySetup(command, home, args) {
  const dir = path.join(home, 'advisor-mode');
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('Refusing linked settings directory.');
  const configFile = path.join(dir, 'config.json');
  const ownedFile = path.join(dir, 'owned.json');
  const owned = fs.existsSync(ownedFile) ? JSON.parse(fs.readFileSync(ownedFile, 'utf8')) : {};
  const allowed = new Set([...Object.values(roles).map(role => `agents/${role}.toml`), 'advisor-mode.config.toml']);
  if (Object.keys(owned).some(key => !allowed.has(key))) throw new Error('Invalid ownership record.');
  const current = fs.existsSync(configFile) ? validateConfig(JSON.parse(fs.readFileSync(configFile, 'utf8'))) : defaults();
  if (command === 'status') return { configured: fs.existsSync(configFile), home, config: current,
    files: Object.keys(generated(current)).map(file => ({ file, matches: fs.existsSync(path.join(home, file)) && hash(fs.readFileSync(path.join(home, file))) === owned[file] })),
    activation: 'UNVERIFIED: file presence does not prove plugin loading or hook trust.' };
  if (command === 'uninstall') {
    const removed = [], preserved = [];
    for (const [file, expected] of Object.entries(owned)) {
      const target = path.join(home, file);
      if (!fs.existsSync(target)) continue;
      if (fs.lstatSync(target).isSymbolicLink() || hash(fs.readFileSync(target)) !== expected) { preserved.push(file); continue; }
      fs.unlinkSync(target); removed.push(file);
    }
    if (fs.existsSync(ownedFile)) fs.unlinkSync(ownedFile);
    return { removed, preserved, settingsPreserved: configFile };
  }
  if (!['install', 'set-model'].includes(command)) throw new Error('Expected install, status, set-model, or uninstall.');
  const config = structuredClone(current);
  if (command === 'set-model') {
    const [role, model, reasoningEffort] = args;
    if (!Object.hasOwn(roles, role) || args.length !== 3) throw new Error('Expected set-model ROLE MODEL EFFORT.');
    config.roles[role] = { model, reasoningEffort }; validateConfig(config);
  }
  const files = generated(config);
  for (const file of Object.keys(files)) {
    const target = path.join(home, file);
    if (fs.existsSync(target) && (fs.lstatSync(target).isSymbolicLink() || hash(fs.readFileSync(target)) !== owned[file])) throw new Error(`Refusing to overwrite user-owned or modified file: ${target}`);
    const parent = path.dirname(target);
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error(`Refusing linked directory: ${parent}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const next = {};
  const changes = {};
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(home, file);
    changes[target] = content; next[file] = hash(content);
  }
  changes[configFile] = JSON.stringify(config, null, 2) + '\n';
  changes[ownedFile] = JSON.stringify(next, null, 2) + '\n';
  replaceFiles(changes);
  return { configured: true, home, configFile, files: Object.keys(files), next: 'Install the native plugin, review its hooks, then start a new session. Existing chats retain earlier settings.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(root, 'scripts/setup.mjs')) {
  try {
    const args = process.argv.slice(2);
    const index = args.indexOf('--home');
    let home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    if (index >= 0) { if (!args[index + 1]) throw new Error('Missing --home path.'); home = args[index + 1]; args.splice(index, 2); }
    console.log(JSON.stringify(setup(args.shift() || 'status', home, args), null, 2));
  } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}
