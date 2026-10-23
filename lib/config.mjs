import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const roles = { executor: 'advisor_mode_executor', advisor: 'advisor_mode_advisor', reviewer: 'advisor_mode_reviewer' };
export function dataRoot(env = process.env) {
  return path.resolve(env.ADVISOR_MODE_DATA || path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'advisor-mode'));
}
export function validateConfig(config) {
  if (config?.version !== 1 || typeof config.enabled !== 'boolean') throw new Error('Invalid configuration version or enabled flag.');
  for (const role of Object.keys(roles)) {
    const value = config.roles?.[role];
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,150}$/.test(value?.model || '')) throw new Error(`Invalid ${role} model.`);
    if (!['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value?.reasoningEffort)) throw new Error(`Invalid ${role} reasoning effort.`);
  }
  for (const key of ['maxReviewContinuations', 'maxConsecutiveFailures']) {
    if (!Number.isInteger(config[key]) || config[key] < 1 || config[key] > 5) throw new Error(`Invalid ${key}. Expected an integer from 1 to 5.`);
  }
  return config;
}
export function readConfig(dir = dataRoot()) {
  const filename = path.join(dir, 'config.json');
  return validateConfig(JSON.parse(fs.readFileSync(filename, 'utf8')));
}
export function defaults() {
  return validateConfig(JSON.parse(fs.readFileSync(path.join(root, 'advisor-config.json'), 'utf8')));
}
