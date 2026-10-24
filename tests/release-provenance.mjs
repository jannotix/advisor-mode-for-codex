import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { root } from '../lib/config.mjs';

const [goodArchive, executable] = process.argv.slice(2);
if (!goodArchive || !executable) throw new Error('Expected legitimate final ZIP and actual Codex executable.');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor release provenance '));
const clone = path.join(fixture, 'disposable source');
const archive = path.join(fixture, 'injected release.zip');
const output = path.join(fixture, 'rejected build');
const evidence = [];
// PowerShell 5 must discover its own modules instead of inheriting PowerShell 7 paths.
const powershellEnv = { ...process.env };
delete powershellEnv.PSModulePath;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: fixture, encoding: 'utf8', windowsHide: true, timeout: 60000, ...options });
  evidence.push({ command, args, exit: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
  return result;
}
function success(command, args, options) {
  const result = run(command, args, options);
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  return result.stdout;
}
let passed = false;
try {
  assert.equal(process.platform, 'win32');
  success('git', ['clone', '--local', '--no-hardlinks', root, clone]);
  const head = success('git', ['-C', root, 'rev-parse', 'HEAD']).trim();
  assert.equal(success('git', ['-C', clone, 'rev-parse', 'HEAD']).trim(), head);
  const probe = path.join(clone, 'lib/release-review-probe.tmp');
  fs.writeFileSync(probe, 'ignored release provenance regression\n');
  assert.equal(success('git', ['-C', clone, 'status', '--porcelain', '--untracked-files=all']).trim(), '', 'Probe must leave ordinary Git status clean.');
  const build = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(clone, 'scripts/release.ps1'), '-OutputDirectory', output], { env: powershellEnv });
  assert.notEqual(build.status, 0, 'Builder accepted an ignored uncommitted runtime file.');
  assert.match(build.stderr, /Staged file is absent from source commit: dist\/advisor-mode-for-codex\/lib\/release-review-probe.tmp/);
  assert(!fs.existsSync(output), 'Rejected build must not produce an output directory or archive.');
  fs.copyFileSync(path.resolve(goodArchive), archive);
  const script = `
    $ErrorActionPreference = 'Stop';
    Add-Type -AssemblyName System.IO.Compression.FileSystem;
    Add-Type -AssemblyName System.IO.Compression;
    $zip = [IO.Compression.ZipFile]::Open($env:ADVISOR_PROBE_ZIP, [IO.Compression.ZipArchiveMode]::Update);
    try {
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $env:ADVISOR_PROBE_FILE, 'dist/advisor-mode-for-codex/lib/release-review-probe.tmp', [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    } finally { $zip.Dispose() }
  `;
  success('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env: { ...powershellEnv, ADVISOR_PROBE_ZIP: archive, ADVISOR_PROBE_FILE: probe } });
  const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(archive + '.sha256', `${digest}  ${path.basename(archive)}\n`);
  const acceptance = run(process.execPath, [path.join(clone, 'tests/native-release.mjs'), archive, executable]);
  assert.equal(acceptance.status, 1, 'Acceptance must reject the injected archive.');
  const report = JSON.parse(fs.readFileSync(path.join(clone, 'private docs/evidence/native-release.json'), 'utf8'));
  assert.equal(report.passed, false);
  assert(report.evidence.some(item => item.error?.includes('Archive inventory differs from the committed release allowlist.')), 'Rejection must come from committed inventory, after the recomputed checksum passes.');
  assert(!report.evidence.some(item => item.command === executable || item.args?.some(arg => /setup\.mjs$/.test(arg))), 'Injected archive must be rejected before setup or native installation.');
  evidence.push({ check: 'ignored source file and checksum-valid injected archive rejected before native install', exit: 0, sourceCommit: head });
  passed = true;
} catch (error) {
  evidence.push({ check: 'provenance regression', exit: 1, error: error.message });
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  const report = { passed, fixture, clone, archive, output, evidence };
  fs.mkdirSync(path.join(root, 'private docs/evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'private docs/evidence/release-provenance.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
