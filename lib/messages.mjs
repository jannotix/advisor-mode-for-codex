import fs from 'node:fs';
const messages = JSON.parse(fs.readFileSync(new URL('../locales/en.json', import.meta.url), 'utf8'));
export function message(key, values = {}) {
  return messages[key].replace(/\{([a-zA-Z]+)\}/g, (whole, name) => values[name] ?? whole);
}
export function context(event, text) {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}
