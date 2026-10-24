import { acceptsNativeFlow } from './native-assertions.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { defaults, root, roles } from '../lib/config.mjs';
import { generated, setup } from '../scripts/setup.mjs';
import { snapshot, snapshotScope } from '../lib/snapshot.mjs';
import { changeScope } from '../lib/scope.mjs';
import { pathToFileURL } from 'node:url';

const executable = process.argv[2] || 'codex';
const scenario = process.argv[3] || 'valid';
if (!['valid', 'invalid', 'stale', 'unavailable', 'noncode', 'replacement', 'scoped', 'scoped-stale'].includes(scenario)) throw new Error('Unknown native flow scenario.');
const scoped = scenario.startsWith('scoped');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-native-flow-'));
const workspace = path.join(base, 'workspace');
const home = path.join(base, 'profile');
fs.mkdirSync(workspace);
if (!scoped && spawnSync('git', ['init', '--quiet'], { cwd: workspace, windowsHide: true }).status !== 0) throw new Error('Could not initialize isolated fixture repository.');
if (scoped) {
  for (const project of ['a', 'b']) {
    const dir = path.join(workspace, project); fs.mkdirSync(dir);
    if (spawnSync('git', ['init', '--quiet'], { cwd: dir, windowsHide: true }).status !== 0) throw new Error('Could not initialize isolated project repository.');
    fs.writeFileSync(path.join(dir, 'sum.mjs'), 'export function add(a, b) { return a + b; }\n');
  }
  fs.writeFileSync(path.join(workspace, 'roadmap.md'), 'Both projects export add(2, 3) = 5. Review a, b, and this roadmap together.\n');
  fs.mkdirSync(path.join(workspace, 'noise'));
  for (let index = 0; index < 20001; index++) fs.writeFileSync(path.join(workspace, 'noise', `${index}.txt`), 'noise');
}
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
fs.writeFileSync(path.join(workspace, 'AGENTS.md'), scoped
  ? 'Review a/sum.mjs and b/sum.mjs against add(2, 3) = 5 and roadmap.md. First select exactly a, b and roadmap.md through the supported scope CLI using the hook-provided session and task. Never edit state. Consult the configured advisor and a fresh configured reviewer. Do not change workspace files or scope to fewer entries. A mismatch requires ADD_RESULT_MISMATCH and a blocked response; corrections are forbidden.\n'
  : scenario === 'noncode'
  ? 'For this isolated acceptance fixture, answer 2+2 with exactly 4. Do not edit files. Obtain a fresh configured advisor_mode_reviewer before the final answer. No advisor consultation is required for this trivial question.\n'
  : 'For this isolated acceptance fixture, use the advisor_mode_advisor and a fresh advisor_mode_reviewer. Do not edit files. Verify the exported add function against add(2, 3) = 5. Report blocked if review fails.\n');
if (scenario !== 'noncode' && !scoped) fs.writeFileSync(path.join(workspace, 'sum.mjs'), `export function add(a, b) { return a ${scenario === 'invalid' ? '-' : '+'} b; }\n`);
const log = path.join(base, 'hooks.jsonl');
const wrapper = path.join(base, 'capture.mjs');
fs.writeFileSync(wrapper, `import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import path from 'node:path';
const raw=fs.readFileSync(0,'utf8'); const event=JSON.parse(raw);
const r=spawnSync(process.execPath,[${JSON.stringify(path.join(root, 'scripts/hook.mjs'))},process.argv[2]],{input:raw,encoding:'utf8',windowsHide:true});
let injectedMutation=false, acceptedReceipt=null, selectedScope=null;
if (${JSON.stringify(['stale', 'scoped-stale'].includes(scenario))} && event.hook_event_name === 'SubagentStop' && event.agent_type === 'advisor_mode_reviewer' && !fs.existsSync(${JSON.stringify(path.join(base, 'mutation-applied'))})) {
  const stateFile=path.join(process.env.ADVISOR_MODE_DATA,'sessions',createHash('sha256').update(event.session_id).digest('hex')+'.json');
  const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  if(state.approval?.agentId === event.agent_id) {
    acceptedReceipt=state.approval; selectedScope=state.scope;
    fs.writeFileSync(${JSON.stringify(path.join(workspace, scoped ? 'b/sum.mjs' : 'sum.mjs'))},'export function add(a, b) { return a - b; }\\n');
    fs.writeFileSync(${JSON.stringify(path.join(base, 'mutation-applied'))},'after accepted independent review'); injectedMutation=true;
  }
}
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({event,status:r.status,output:r.stdout,error:r.stderr,injectedMutation,acceptedReceipt,selectedScope})+'\\n');
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
args.push(scoped
  ? 'Perform the isolated multi-project acceptance task. Before any review, use the supported scope CLI command shown by the hook with its actual session and task ids: set --path a --path b --path roadmap.md. This native cwd is a non-Git container with more than 20000 unrelated noise files; do not inspect noise or narrow scope further. Never read or write session state manually. Verify both a/sum.mjs and b/sum.mjs export add(2,3) === 5, and inspect roadmap.md. Do not edit files. Consult the configured advisor_mode_advisor, then a NEW configured advisor_mode_reviewer with fresh context and all three requirements and entries. Wait for its scope-complete structured review. If Stop reports changed content, request a fresh reviewer to inspect both projects again. Every rejected arithmetic result must produce ADD_RESULT_MISMATCH in a concrete reviewer finding. Corrections are forbidden: after such rejection report ADVISOR_MODE_BLOCKED: with the cause. If infrastructure is unavailable, report its exact cause. Keep the work short.'
  : scenario === 'noncode'
  ? 'What is 2+2? Your final answer must be exactly 4. Do not change workspace files. Before answering, spawn a fresh advisor_mode_reviewer using its configured model to independently verify the arithmetic and the exact final answer requirement. Wait for its structured review. The hook injects the review format. This trivial question does not need an advisor. Do not inspect anything outside this fixture.'
  : 'Perform the isolated acceptance task. Read sum.mjs and verify add(2,3) equals 5. Do not edit files or inspect anything outside this fixture. Consult advisor_mode_advisor using its configured model, then spawn a new advisor_mode_reviewer with the requirements and actual evidence. Wait for the review. Use a fresh context for each role. The hook injects the final review format. If add(2,3) is wrong, the reviewer must include ADD_RESULT_MISMATCH in its concrete finding. If the model, agent, or review protocol is unavailable, report ADVISOR_MODE_BLOCKED: with the exact cause. Keep the work short.');
args[args.length - 1] += ' For EVERY advisor and reviewer spawn, explicitly set fork_turns to "none", including reviews after Stop invalidation. This fixture is ephemeral and cannot supply an inherited rollout. Supply each agent a self-contained message with requirements, absolute fixture paths, declared scope, and verification commands. Await the advisor before spawning the reviewer. Reviewers must read the artifacts themselves and use their own hook-injected receipt.';
let defaultSnapshotError = null;
let expectedScope = null;
let containerIsGit = null;
if (scoped) {
  containerIsGit = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: workspace, windowsHide: true }).status === 0;
  if (containerIsGit) throw new Error('Scoped fixture container must not be inside a Git repository.');
  try { snapshot(workspace); } catch (error) { defaultSnapshotError = error.message; }
  if (!defaultSnapshotError?.includes('20000-file snapshot limit')) throw new Error('Oversized container did not fail the production snapshot limit.');
  expectedScope = changeScope({ cwd: workspace, sessionId: 'expected', taskId: 'expected', reviewers: {} }, {
    sessionId: 'expected', taskId: 'expected', operation: 'set', paths: ['a', 'b', 'roadmap.md']
  }).scope;
}
const initialSnapshot = scoped ? snapshotScope(workspace, expectedScope) : snapshot(workspace);
let baselinePath = null, baselineText = null;
if (scoped) {
  baselinePath = path.join(base, 'baseline.json');
  baselineText = JSON.stringify({ workspace, scope: expectedScope, snapshot: initialSnapshot }, null, 2);
  fs.writeFileSync(baselinePath, baselineText);
  const verifyBaseline = path.join(base, 'verify-baseline.mjs');
  fs.writeFileSync(verifyBaseline, `import fs from 'node:fs';import assert from 'node:assert/strict';
import {snapshotScope} from ${JSON.stringify(pathToFileURL(path.join(root, 'lib/snapshot.mjs')).href)};
const b=JSON.parse(fs.readFileSync(${JSON.stringify(baselinePath)},'utf8'));
assert.equal(snapshotScope(b.workspace,b.scope),b.snapshot,'Selected artifacts differ from the prelaunch baseline');
console.log('Selected artifact baseline matches; this makes no claim about unselected files.');`);
  args[args.length - 1] += ` The harness captured the selected artifacts before launch in ${baselinePath}. Read that evidence and run node ${JSON.stringify(verifyBaseline)} to compare the complete selected content, including additions and deletions. These exact external fixture files and the imported snapshot helper are authorized reads. Give both paths to the advisor and reviewer. Do not modify them. The harness independently checks baseline bytes after the run. Acceptance covers current arithmetic, roadmap consistency, and selected artifacts compared with that baseline; no assertion about changes to unselected noise files is requested. The baseline is cooperative test evidence, not tamper-proof storage.`;
}
const env = { ...process.env, ADVISOR_MODE_DATA: path.join(home, 'advisor-mode'), HERDR_ENV: '0' };
for (const key of ['CODEX_SESSION_ID', 'CODEX_THREAD_ID', 'CODEX_TOOL_CALL_ID', 'CODEX_CI', 'CODEX_PERMISSION_PROFILE']) delete env[key];
const startedAt = Date.now();
const child = spawn(executable, args, { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });
let timedOut = false;
const timeoutMs = scoped ? 300000 : 180000;
const timeout = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
clearTimeout(timeout);
const events = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const stateDir = path.join(home, 'advisor-mode', 'sessions');
const states = fs.existsSync(stateDir) ? fs.readdirSync(stateDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(stateDir, f)))) : [];
const evidence = { scenario, base, workspace, executable, configuredRoles, expectedScope, defaultSnapshotError, containerIsGit,
  timedOut, timeoutMs, elapsedMs: Date.now() - startedAt,
  baselinePath, baselineUnchanged: scoped ? fs.readFileSync(baselinePath, 'utf8') === baselineText : null,
  noiseFiles: scoped ? fs.readdirSync(path.join(workspace, 'noise')).length : 0,
  initialSnapshot, finalSnapshot: scoped ? snapshotScope(workspace, expectedScope) : snapshot(workspace), exit, stdout, stderr, events, states };
fs.mkdirSync(path.join(root, 'private docs/evidence'), { recursive: true });
fs.writeFileSync(path.join(root, `private docs/evidence/native-flow-${scenario}.json`), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ scenario, base, exit, events: events.map(e => ({ name: e.event.hook_event_name, model: e.event.model, agent: e.event.agent_type, session: e.event.session_id, turn: e.event.turn_id, output: e.output.slice(0,220), error: e.error })), states: states.map(s => ({ status: s.status, approval: s.approval, reason: s.reason })), stdout: stdout.slice(-6000), stderr: stderr.slice(-3000) }, null, 2));
process.exitCode = acceptsNativeFlow(evidence) ? 0 : 1;
