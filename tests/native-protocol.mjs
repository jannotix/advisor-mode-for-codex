import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { root } from '../lib/config.mjs';
import { setup } from '../scripts/setup.mjs';
import { buildPackage } from '../scripts/package.mjs';

// A deterministic local API fixture tests host callbacks, not model intelligence.
const executable = process.argv[2] || 'codex';
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-native-protocol-'));
const home = path.join(base, 'home'), workspace = path.join(base, 'workspace');
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(path.join(workspace, 'fixture.txt'), 'native protocol fixture\n');
setup('install', home); buildPackage();
const env = { ...process.env, CODEX_HOME: home, HERDR_ENV: '0' };
for (const key of ['CODEX_SESSION_ID', 'CODEX_THREAD_ID', 'CODEX_TOOL_CALL_ID', 'CODEX_CI', 'CODEX_PERMISSION_PROFILE']) delete env[key];
const setupResults = [];
for (const args of [['plugin', 'marketplace', 'add', root, '--json'], ['plugin', 'add', 'advisor-mode-for-codex@advisor-mode-local', '--json']]) {
  const r = spawnSync(executable, args, { cwd: home, env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  setupResults.push({ args, exit: r.status, stdout: r.stdout, stderr: r.stderr });
  if (r.status !== 0) throw new Error('Native fixture installation failed.');
}
let requests = 0;
const requestShapes = [];
const server = http.createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  let data; try { data = JSON.parse(body); } catch { response.writeHead(400); response.end(); return; }
  requests++;
  requestShapes.push({ model: data.model, tools: data.tools?.map(t => ({ name: t.name, type: t.type })), inputItems: data.input?.length, hasPluginInstructions: JSON.stringify(data.input).includes('Advisor Mode'), hasReviewRole: JSON.stringify(data).includes('advisor_mode_reviewer') });
  const text = requests === 1 ? 'FIXTURE_ATTEMPT_WITHOUT_REVIEW' : 'ADVISOR_MODE_BLOCKED: deterministic fixture does not provide a reviewer.';
  const item = { id: `msg_${requests}`, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] };
  const result = { id: `resp_${requests}`, object: 'response', status: 'completed', model: data.model, output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  emit({ type: 'response.created', response: { ...result, status: 'in_progress', output: [] } });
  emit({ type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
  emit({ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: text });
  emit({ type: 'response.output_item.done', output_index: 0, item });
  emit({ type: 'response.completed', response: result });
  response.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const args = ['--no-daemon', 'exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '--json', '--dangerously-bypass-hook-trust', '-m', 'gpt-6.1-sol',
  '-c', 'model_provider="advisor_fixture"', '-c', `model_providers.advisor_fixture={name="Deterministic local fixture",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",requires_openai_auth=false}`,
  '-c', 'features.multi_agent=true', '-c', 'agents.enabled=true', '-c', 'features.hooks=true', '-c', 'features.plugins=true', '-c', 'features.apps=false', '-c', 'skills.bundled.enabled=false', 'Check the fixture; a final reviewer is required.'];
const child = spawn(executable, args, { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c);
const timer = setTimeout(() => child.kill(), 60000);
const exit = await new Promise((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
clearTimeout(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
const stateDir = path.join(home, 'advisor-mode', 'sessions');
const states = fs.existsSync(stateDir) ? fs.readdirSync(stateDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(stateDir, f)))) : [];
const passed = exit === 0 && requests >= 2 && states.some(s => s.status === 'BLOCKED' && s.continuations >= 1 && !s.approval);
const evidence = { fixtureProvider: true, base, executable, setupResults, exit, requests, requestShapes, states, stdout, stderr, passed };
fs.mkdirSync(path.join(root, 'private docs/evidence'), { recursive: true });
fs.writeFileSync(path.join(root, 'private docs/evidence/native-protocol.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ base, exit, requests, states, passed, stdout: stdout.slice(-3500), stderr: stderr.slice(-3500) }, null, 2));
process.exitCode = passed ? 0 : 1;
