import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { root } from '../lib/config.mjs';

const [executable, home, workspace = home, overridesFile] = process.argv.slice(2);
if (!executable || !home) throw new Error('Expected executable and disposable CODEX_HOME.');
const extra = overridesFile ? JSON.parse(fs.readFileSync(overridesFile, 'utf8')).flatMap(value => ['-c', value]) : [];
const child = spawn(executable, ['-c', 'features.hooks=true', '-c', 'features.plugins=true', '-c', 'features.multi_agent=true', '-c', 'agents.enabled=true', ...extra, 'app-server', '--stdio'], {
  cwd: workspace, env: { ...process.env, CODEX_HOME: home, HERDR_ENV: '0' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
});
const results = {};
let stderr = '';
child.stderr.on('data', b => stderr += b);
const send = (id, method, params) => child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
const timer = setTimeout(() => child.kill(), 25000);
readline.createInterface({ input: child.stdout }).on('line', line => {
  let data; try { data = JSON.parse(line); } catch { return; }
  if (data.id === 1) {
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    send(2, 'hooks/list', { cwds: [workspace] });
    send(3, 'configRequirements/read', {});
    send(4, 'config/read', { cwd: workspace, includeLayers: true });
    send(5, 'plugin/list', { cwds: [workspace], marketplaceKinds: ['local'], forceRefetch: false });
    send(6, 'plugin/read', { marketplacePath: path.join(root, '.agents/plugins/marketplace.json'), pluginName: 'advisor-mode-for-codex' });
  } else if (data.id === 2) results.hooks = data;
  else if (data.id === 3) results.requirements = { error: data.error, allowManagedHooksOnly: data.result?.requirements?.allowManagedHooksOnly, featureRequirements: data.result?.requirements?.featureRequirements };
  else if (data.id === 4) results.config = { error: data.error, features: data.result?.config?.features, agents: data.result?.config?.agents, hooks: data.result?.config?.hooks, layers: data.result?.layers?.map(l => ({ name: l.name, keys: Object.keys(l.config || {}), disabledReason: l.disabledReason })) };
  else if (data.id === 5) results.plugins = data;
  else if (data.id === 6) results.plugin = data;
  if (results.hooks && results.requirements && results.config && results.plugins && results.plugin) child.kill();
});
send(1, 'initialize', { clientInfo: { name: 'advisor-mode-diagnostic', version: '0.1.0' }, capabilities: { experimentalApi: true } });
await new Promise((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
clearTimeout(timer);
const evidence = { executable, home, workspace, ...results, stderr };
fs.mkdirSync(path.join(root, 'private docs/evidence'), { recursive: true });
fs.writeFileSync(path.join(root, 'private docs/evidence/native-discovery-detailed.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
process.exitCode = results.hooks && !results.hooks.error ? 0 : 1;
