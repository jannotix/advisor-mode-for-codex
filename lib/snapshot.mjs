import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const excludedDirs = new Set(['.git', 'node_modules', 'private docs', '.test-artifacts', '.next', '.venv', '__pycache__']);
const secret = name => /^\.env(?:\.|$)/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name) || /^(?:auth|credentials)\.json$/i.test(name);
const eligible = relative => !relative.split(/[\\/]/).some(part => excludedDirs.has(part) || secret(part));
export function snapshot(cwd) {
  const root = fs.realpathSync(cwd);
  let files;
  const git = spawnSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  if (git.status === 0) files = [...new Set(git.stdout.split('\0').filter(Boolean))];
  else {
    files = [];
    function walk(dir) {
      for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const relative = path.join(dir, item.name);
        if (!eligible(relative)) continue;
        if (item.isDirectory()) walk(relative);
        else files.push(relative);
        if (files.length > 20000) throw new Error('Workspace exceeds the 20000-file snapshot limit.');
      }
    }
    walk('');
  }
  const hash = createHash('sha256');
  let bytes = 0;
  files = files.filter(eligible).sort();
  if (files.length > 20000) throw new Error('Workspace exceeds the 20000-file snapshot limit.');
  for (const relative of files) {
    const filename = path.resolve(root, relative);
    const within = path.relative(root, filename);
    if (within.startsWith('..') || path.isAbsolute(within)) throw new Error('Snapshot path escapes workspace.');
    hash.update(JSON.stringify(relative.replaceAll('\\', '/')));
    let stat;
    try { stat = fs.lstatSync(filename); } catch (error) { if (error.code === 'ENOENT') { hash.update('deleted'); continue; } throw error; }
    if (stat.isSymbolicLink()) throw new Error(`Snapshot does not certify symlinks: ${relative}`);
    if (!stat.isFile()) throw new Error(`Snapshot does not certify special files: ${relative}`);
    // Reject an intermediate symlink even when Git supplied the file path.
    const real = fs.realpathSync(filename);
    if (real !== filename && path.relative(root, real).startsWith('..')) throw new Error('Snapshot target escapes workspace.');
    bytes += stat.size;
    if (bytes > 128 * 1024 * 1024) throw new Error('Workspace exceeds the 128 MiB snapshot limit.');
    const data = fs.readFileSync(filename);
    if (data.length !== stat.size) throw new Error('File changed while taking the snapshot.');
    hash.update(String(stat.mode & 0o111));
    hash.update(createHash('sha256').update(data).digest());
  }
  return hash.digest('hex');
}
