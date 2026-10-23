import { acceptsNativeFlow } from './native-assertions.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { defaults, root, roles } from '../lib/config.mjs';
import { generated, setup } from '../scripts/setup.mjs';
import { snapshot } from '../lib/snapshot.mjs';

const executable = process.argv[2] || 'codex';
const scenario = process.argv[3] || 'valid';
if (!['valid', 'invalid', 'stale', 'unavailable', 'noncode', 'replacement'].includes(scenario)) throw new Error('Unknown native flow scenario.');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-native-flow-'));
const workspace = path.join(base, 'workspace');
const home = path.join(base, 'profile');
fs.mkdirSync(workspace);
const init = spawnSync('git', ['init', '--quiet'], { cwd: workspace, windowsHide: true });
if (init.status !== 0) throw new Error('Could not initialize isolated fixture repository.');
setup('install', home);
if (scenario === 'unavailable') setup('set-model', home, ['reviewer', 'advisor-mode-unavailable-fixture', 'low']);
if (scenario === 'replacement') {
  setup('set-model', home, ['reviewer', 'gpt-6.1-sol', 'medium']); setup('install', home);
}
const configuredRoles = setup('status', home).config.roles;
if (scenario === 'replacement' && (configuredRoles.reviewer.model !== 'gpt-6.1-sol' || configuredRoles.reviewer.reasoningEffort !== 'medium')) throw new Error('Reinstall lost the replacement reviewer configuration.');
fs.mkdirSync(path.join(workspace, '.codex', 'agents'), { recursive: true });
for (const [file, text] of Object.entries(generated({ ...defaults(), roles: configuredRoles }))) {
  if (file.startsWith('agents/')) fs.writeFileSync(path.join(workspace, '.codex', file), text);
}
fs.writeFileSync(path.join(workspace, 'AGENTS.md'), scenario === 'noncode'
  ? 'For this isolated acceptance fixture, answer 2+2 with exactly 4. Do not edit files. Obtain a fresh configured advisor_mode_reviewer before the final answer. No advisor consultation is required for this trivial question.\n'
  : 'For this isolated acceptance fixture, use the advisor_mode_advisor and a fresh advisor_mode_reviewer. Do not edit files. Verify the exported add function against add(2, 3) = 5. Report blocked if review fails.\n');
if (scenario !== 'noncode') fs.writeFileSync(path.join(workspace, 'sum.mjs'), `export function add(a, b) { return a ${scenario === 'invalid' ? '-' : '+'} b; }\n`);
const log = path.join(base, 'hooks.jsonl');
const wrapper = path.join(base, 'capture.mjs');
fs.writeFileSync(wrapper, `import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import path from 'node:path';
const raw=fs.readFileSync(0,'utf8'); const event=JSON.parse(raw);
const r=spawnSync(process.execPath,[${JSON.stringify(path.join(root, 'scripts/hook.mjs'))},process.argv[2]],{input:raw,encoding:'utf8',windowsHide:true});
let injectedMutation=false;
if (${JSON.stringify(scenario)} === 'stale' && event.hook_event_name === 'SubagentStop' && event.agent_type === 'advisor_mode_reviewer' && !fs.existsSync(${JSON.stringify(path.join(base, 'mutation-applied'))})) {
  const stateFile=path.join(process.env.ADVISOR_MODE_DATA,'sessions',createHash('sha256').update(event.session_id).digest('hex')+'.json');
  const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  if(state.approval?.agentId === event.agent_id) {
    fs.writeFileSync(${JSON.stringify(path.join(workspace, 'sum.mjs'))},'export function add(a, b) { return a - b; }\\n');
    fs.writeFileSync(${JSON.stringify(path.join(base, 'mutation-applied'))},'after accepted independent review'); injectedMutation=true;
  }
}
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({event,status:r.status,output:r.stdout,error:r.stderr,injectedMutation})+'\\n');
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exitCode=r.status??1;`);
const args = ['--no-daemon', 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '-s', 'danger-full-access', '--json', '--dangerously-bypass-hook-trust', '-m', 'gpt-6.1-sol',
  '-c', 'features.plugins=false', '-c', 'features.apps=false', '-c', 'features.memories=false', '-c', 'features.hooks=true', '-c', 'features.multi_agent=true', '-c', 'skills.bundled.enabled=false', '-c', 'agents.enabled=true', '-c', 'model_reasoning_effort="low"',
  '-c', `projects.${JSON.stringify(workspace)}.trust_level="trusted"`];
const fixtureHooks = { hooks: {} };
for (const event of ['SessionStart', 'UserPromptSubmit', 'SubagentStart', 'SubagentStop', 'PostToolUse', 'Stop']) {
  const command = `node "${wrapper}" ${event}`;
  fixtureHooks.hooks[event] = [{ hooks: [{ type: 'command', command, timeout: 20 }] }];
  args.push('-c', `hooks.${event}=[{hooks=[{type="command",command=${JSON.stringify(command)},timeout=20}]}]`);
}
// Process-only role declarations reuse the existing account without installing into its home.
for (const name of Object.values(roles)) args.push('-c', `agents.${name}.config_file=${JSON.stringify(path.join(home, 'agents', name + '.toml'))}`);
fs.writeFileSync(path.join(base, 'overrides.json'), JSON.stringify(args.flatMap((arg, index) => arg === '-c' ? [args[index + 1]] : [])));
fs.writeFileSync(path.join(workspace, '.codex', 'hooks.json'), JSON.stringify(fixtureHooks));
fs.writeFileSync(path.join(workspace, '.codex', 'config.toml'), '[agents]\nenabled = true\n[features]\nhooks = true\nmulti_agent = true\n');
args.push(scenario === 'noncode'
  ? 'What is 2+2? Your final answer must be exactly 4. Do not change workspace files. Before answering, spawn a fresh advisor_mode_reviewer using its configured model to independently verify the arithmetic and the exact final answer requirement. Wait for its structured review. The hook injects the review format. This trivial question does not need an advisor. Do not inspect anything outside this fixture.'
  : 'Perform the isolated acceptance task. Read sum.mjs and verify add(2,3) equals 5. Do not edit files or inspect anything outside this fixture. Consult advisor_mode_advisor using its configured model, then spawn a new advisor_mode_reviewer with the requirements and actual evidence. Wait for the review. Use a fresh context for each role. The hook injects the final review format. If add(2,3) is wrong, the reviewer must include ADD_RESULT_MISMATCH in its concrete finding. If the model, agent, or review protocol is unavailable, report ADVISOR_MODE_BLOCKED: with the exact cause. Keep the work short.');
const initialSnapshot = snapshot(workspace);
const env = { ...process.env, ADVISOR_MODE_DATA: path.join(home, 'advisor-mode'), HERDR_ENV: '0' };
for (const key of ['CODEX_SESSION_ID', 'CODEX_THREAD_ID', 'CODEX_TOOL_CALL_ID', 'CODEX_CI', 'CODEX_PERMISSION_PROFILE']) delete env[key];
const child = spawn(executable, args, { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });
const timeout = setTimeout(() => child.kill(), 180000);
const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
clearTimeout(timeout);
const events = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const stateDir = path.join(home, 'advisor-mode', 'sessions');
const states = fs.existsSync(stateDir) ? fs.readdirSync(stateDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(stateDir, f)))) : [];
const evidence = { scenario, base, executable, configuredRoles, initialSnapshot, finalSnapshot: snapshot(workspace), exit, stdout, stderr, events, states };
fs.mkdirSync(path.join(root, 'private docs/evidence'), { recursive: true });
fs.writeFileSync(path.join(root, `private docs/evidence/native-flow-${scenario}.json`), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ scenario, base, exit, events: events.map(e => ({ name: e.event.hook_event_name, model: e.event.model, agent: e.event.agent_type, session: e.event.session_id, turn: e.event.turn_id, output: e.output.slice(0,220), error: e.error })), states: states.map(s => ({ status: s.status, approval: s.approval, reason: s.reason })), stdout: stdout.slice(-6000), stderr: stderr.slice(-3000) }, null, 2));
process.exitCode = acceptsNativeFlow(evidence) ? 0 : 1;
