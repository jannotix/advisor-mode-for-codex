import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { defaults, root } from '../lib/config.mjs';

defaults();
const manifest = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin/plugin.json')));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.name, pkg.name);
assert.equal(fs.existsSync(path.join(root, 'plugin.json')), false, 'A portable manifest disables hooks in the verified host.');
assert.equal(manifest.license, 'Apache-2.0');
assert.equal(pkg.license, manifest.license);
assert.ok(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').includes('Version 2.0, January 2004'));
assert.ok(fs.readFileSync(path.join(root, 'NOTICE'), 'utf8').includes('Copyright 2026 Gianluca Iannotta'));
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
