import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { root } from '../lib/config.mjs';
import { setup } from '../scripts/setup.mjs';
import { buildPackage } from '../scripts/package.mjs';

const executable = process.argv[2] || 'codex';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-native-install-'));
const evidence = [];
try {
  buildPackage();
  setup('install', home);
  for (const args of [['--version'], ['plugin', 'marketplace', 'add', root, '--json'], ['plugin', 'add', 'advisor-mode-for-codex@advisor-mode-local', '--json'], ['plugin', 'list', '--json']]) {
    const r = spawnSync(executable, args, { cwd: home, env: { ...process.env, CODEX_HOME: home }, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    evidence.push({ args, exit: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error?.message });
    if (r.status !== 0) break;
    if (args[0] === 'plugin' && args[1] === 'add') {
      const installed = JSON.parse(r.stdout).installedPath;
      for (const excluded of ['private docs', 'tests', '.git', '.agents', 'AGENTS.md', 'CLAUDE.md']) {
        if (fs.existsSync(path.join(installed, excluded))) throw new Error(`Private or development file entered package: ${excluded}`);
      }
    }
  }
  console.log(JSON.stringify({ home, evidence }, null, 2));
  process.exitCode = evidence.some(e => e.exit !== 0) ? 1 : 0;
} finally {
  // Keep the isolated profile for inspection. It contains no copied credentials.
  fs.mkdirSync(path.join(root, 'private docs', 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'private docs', 'evidence', 'native-install.json'), JSON.stringify({ home, evidence }, null, 2));
}
