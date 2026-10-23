import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { defaults, root } from '../lib/config.mjs';

defaults();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json')));
const compatibility = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin/plugin.json')));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
assert.equal(manifest.version, compatibility.version);
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.name, compatibility.name);
const hooks = JSON.parse(fs.readFileSync(path.join(root, 'hooks/hooks.json')));
for (const [event, groups] of Object.entries(hooks.hooks)) {
  for (const group of groups) for (const hook of group.hooks) {
    assert.ok(hook.command.includes('${PLUGIN_ROOT}'));
    assert.ok(hook.command.endsWith(event));
    assert.ok(hook.timeout >= 5);
  }
}
for (const file of ['scripts/hook.mjs', 'scripts/setup.mjs', 'skills/advisor-mode/SKILL.md', 'rules/craft.md']) assert.ok(fs.existsSync(path.join(root, file)));
console.log(JSON.stringify({ package: manifest.name, version: manifest.version, hooks: Object.keys(hooks.hooks), result: 'PASS' }));
