import fs from 'node:fs';
import { dataRoot, readConfig, root } from '../lib/config.mjs';
import { transaction } from '../lib/store.mjs';
import { snapshotScope } from '../lib/snapshot.mjs';
import { gate } from '../lib/gate.mjs';
import { context, message } from '../lib/messages.mjs';
import path from 'node:path';

let event;
try {
  const raw = fs.readFileSync(0, 'utf8');
  if (Buffer.byteLength(raw) > 8 * 1024 * 1024) throw new Error('Hook input exceeds 8 MiB.');
  event = JSON.parse(raw);
  event.hook_event_name ||= process.argv[2];
  if (event.cwd) event.cwd = fs.realpathSync(event.cwd);
  const config = readConfig();
  const output = await transaction(dataRoot(), event.session_id, state => gate(state, event, config, {
    snapshot: scope => snapshotScope(event.cwd, scope), scopeCommand: [process.execPath, path.join(root, 'scripts/scope.mjs')]
  }));
  if (event.hook_event_name === 'SessionStart' && output.hookSpecificOutput) {
    output.hookSpecificOutput.additionalContext += '\n' + fs.readFileSync(path.join(root, 'rules', 'craft.md'), 'utf8');
  }
  process.stdout.write(JSON.stringify(output));
} catch (error) {
  const text = message('error', { error: error.message });
  const name = event?.hook_event_name || process.argv[2];
  const output = name === 'Stop' ? (event?.stop_hook_active || /^ADVISOR_MODE_BLOCKED:\s*\S/.test(event?.last_assistant_message || '') ? { continue: false, systemMessage: text } : { decision: 'block', reason: text })
    : ['SessionStart', 'UserPromptSubmit', 'SubagentStart', 'PostToolUse'].includes(name) ? context(name, text)
      : { systemMessage: text };
  process.stdout.write(JSON.stringify(output));
  process.stderr.write(text + '\n');
}
