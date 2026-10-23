import fs from 'node:fs';
import path from 'node:path';
import { root } from '../lib/config.mjs';

export const packageEntries = ['.codex-plugin', 'advisor-config.json', 'agents', 'hooks', 'lib', 'locales', 'rules', 'skills', 'scripts/hook.mjs', 'scripts/setup.mjs', 'README.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE'];
export function buildPackage() {
  const target = path.join(root, 'dist', 'advisor-mode-for-codex');
  // Delete only this fixed generated directory, after checking its resolved parent.
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.realpathSync(path.dirname(target)) !== path.join(fs.realpathSync(root), 'dist')) throw new Error('Refusing linked build directory.');
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Refusing linked package directory.');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target);
  for (const entry of packageEntries) {
    const source = path.join(root, entry);
    if (!fs.existsSync(source)) throw new Error(`Missing package file: ${entry}`);
    fs.mkdirSync(path.dirname(path.join(target, entry)), { recursive: true });
    fs.cpSync(source, path.join(target, entry), { recursive: true, dereference: false });
  }
  return target;
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(root, 'scripts/package.mjs')) console.log(buildPackage());
