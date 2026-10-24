import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { root } from '../lib/config.mjs';
import { packageEntries } from '../scripts/package.mjs';

// Consume a finished release. This test never builds or repairs its input.
const [archiveArgument, executable] = process.argv.slice(2);
if (!archiveArgument || !executable) throw new Error('Expected final ZIP path and actual Codex executable.');
const archive = path.resolve(archiveArgument);
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor release test '));
const extracted = path.join(fixture, 'extracted release');
const home = path.join(fixture, 'isolated codex home');
const evidence = [];
const env = { ...process.env, CODEX_HOME: home, ADVISOR_RELEASE_ZIP: archive, ADVISOR_RELEASE_DEST: extracted };
// Use the disposable CODEX_HOME for settings even if the caller has a custom data directory.
delete env.ADVISOR_MODE_DATA;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: fixture, env, encoding: 'utf8', windowsHide: true, timeout: 45000, ...options });
  evidence.push({ command, args, exit: result.status, error: result.error?.message });
  assert.equal(result.status, 0, `${command} failed: ${result.error?.message || result.stderr}`);
  return result.stdout;
}
function powershell(script) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`$ErrorActionPreference = 'Stop'; ${script}`, 'utf16le').toString('base64')]);
}
function filesUnder(directory, prefix = '') {
  const files = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    assert(!item.isSymbolicLink(), `Unexpected linked source entry: ${item.name}`);
    const relative = prefix + item.name;
    if (item.isDirectory()) files.push(...filesUnder(path.join(directory, item.name), relative + '/'));
    else { assert(item.isFile(), `Unexpected special entry: ${relative}`); files.push(relative); }
  }
  return files;
}
let passed = false;
try {
  assert.equal(process.platform, 'win32', 'The release extractor requires Windows .NET ZipFile.');
  assert(fs.lstatSync(archive).isFile(), 'Expected a regular ZIP archive.');
  const checksum = fs.readFileSync(archive + '.sha256', 'utf8').trim();
  assert.equal(checksum, `${hash(fs.readFileSync(archive))}  ${path.basename(archive)}`, 'ZIP checksum mismatch.');
  const expected = new Map([
    ['INSTALL.md', path.join(root, 'INSTALL.md')],
    ['.agents/plugins/marketplace.json', path.join(root, '.agents/plugins/marketplace.json')]
  ]);
  for (const entry of packageEntries) {
    const source = path.join(root, entry);
    if (fs.statSync(source).isDirectory()) {
      for (const relative of filesUnder(source)) expected.set(`dist/advisor-mode-for-codex/${entry}/${relative}`, path.join(source, relative));
    } else expected.set(`dist/advisor-mode-for-codex/${entry}`, source);
  }
  const inventory = JSON.parse(powershell(`
    Add-Type -AssemblyName System.IO.Compression.FileSystem;
    $zip = [IO.Compression.ZipFile]::OpenRead($env:ADVISOR_RELEASE_ZIP);
    try { ConvertTo-Json -InputObject @($zip.Entries | ForEach-Object { $_.FullName }) -Compress } finally { $zip.Dispose() }
  `));
  assert.equal(new Set(inventory).size, inventory.length, 'Duplicate ZIP entries.');
  const expectedNames = [...expected.keys(), 'BUILD.json'].sort();
  for (const name of inventory) {
    assert(!name.includes('\\') && !name.startsWith('/') && !name.split('/').some(part => part === '..' || part === '.' || part.includes(':')), `Unsafe ZIP path: ${name}`);
    if (name.endsWith('/')) assert(expectedNames.some(file => file.startsWith(name)), `Unexpected ZIP directory: ${name}`);
  }
  assert.deepEqual(inventory.filter(name => !name.endsWith('/')).sort(), expectedNames, 'Archive inventory differs from the release allowlist.');
  powershell(`Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:ADVISOR_RELEASE_ZIP, $env:ADVISOR_RELEASE_DEST)`);
  assert.deepEqual(filesUnder(extracted).sort(), expectedNames);
  for (const [name, source] of expected) assert(fs.readFileSync(path.join(extracted, name)).equals(fs.readFileSync(source)), `Release bytes differ: ${name}`);
  const build = JSON.parse(fs.readFileSync(path.join(extracted, 'BUILD.json'), 'utf8').replace(/^\uFEFF/, ''));
  const version = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin/plugin.json'), 'utf8')).version;
  const sourceCommit = run('git', ['-C', root, 'rev-parse', 'HEAD']).trim();
  assert.deepEqual(build, { sourceCommit, version }, 'Provenance does not match the tested source commit and version.');
  evidence.push({ check: 'archive allowlist, bytes, dot directories, checksum and source provenance', exit: 0, files: expectedNames, sourceCommit, version });
  fs.mkdirSync(home);
  const plugin = path.join(extracted, 'dist/advisor-mode-for-codex');
  run(process.execPath, [path.join(plugin, 'scripts/setup.mjs'), 'install'], { cwd: extracted });
  run(executable, ['--version']);
  run(executable, ['plugin', 'marketplace', 'add', extracted, '--json']);
  const added = JSON.parse(run(executable, ['plugin', 'add', 'advisor-mode-for-codex@advisor-mode-local', '--json']));
  assert.equal(typeof added.installedPath, 'string', 'Native install did not return installedPath.');
  const installed = added.installedPath;
  const packageNames = [...expected.keys()].filter(name => name.startsWith('dist/advisor-mode-for-codex/')).map(name => name.slice('dist/advisor-mode-for-codex/'.length));
  assert.deepEqual(filesUnder(installed).sort(), packageNames.sort(), 'Installed package inventory changed.');
  for (const name of packageNames) assert(fs.readFileSync(path.join(installed, name)).equals(fs.readFileSync(path.join(plugin, name))), `Installed bytes differ: ${name}`);
  const listed = JSON.parse(run(executable, ['plugin', 'list', '--json']));
  assert(JSON.stringify(listed).includes('advisor-mode-for-codex'), 'Plugin list omitted installed plugin.');
  const discovery = JSON.parse(run(process.execPath, [path.join(root, 'tests/native-discovery.mjs'), executable, home, fixture]));
  assert(!discovery.hooks.error, 'Native discovery returned an error.');
  const hooks = discovery.hooks.result.data.flatMap(entry => entry.hooks).filter(hook => hook.pluginId === 'advisor-mode-for-codex@advisor-mode-local');
  const events = hooks.map(hook => hook.eventName).sort();
  assert.deepEqual(events, ['postToolUse', 'sessionStart', 'stop', 'subagentStart', 'subagentStop', 'userPromptSubmit'].sort(), 'Expected exactly six native plugin hook events.');
  // Successful import proves the archived scope CLI and its runtime dependencies load.
  // The malformed call must still reject; discovery does not manufacture native task state.
  const scope = spawnSync(process.execPath, [path.join(installed, 'scripts/scope.mjs'), 'status'], { cwd: fixture, env, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(scope.status, 1);
  assert.match(JSON.parse(scope.stderr).error, /Scope requires --session ID --task ID/);
  evidence.push({ check: 'installed scope CLI rejects missing native task identifiers', exit: scope.status, expectedExit: 1 });
  evidence.push({ check: 'isolated native installation and exact six-hook discovery', exit: 0, installed, events });
  passed = true;
} catch (error) {
  evidence.push({ check: 'release acceptance', exit: 1, error: error.message });
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  const report = { passed, archive, executable, fixture, home, extracted, evidence, limitations: 'Discovery uses no copied authentication and no trust bypass. It does not certify hook execution, model access, normal user trust, or desktop activation.' };
  fs.mkdirSync(path.join(root, 'private docs/evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'private docs/evidence/native-release.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
