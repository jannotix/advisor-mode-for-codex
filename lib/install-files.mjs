import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function replaceFiles(files) {
  const staged = [], applied = [];
  try {
    for (const [target, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error(`Refusing linked file: ${target}`);
      const before = fs.existsSync(target) ? fs.readFileSync(target) : null;
      const temporary = target + '.' + randomUUID() + '.tmp';
      staged.push({ target, temporary, before });
      fs.writeFileSync(temporary, content, { flag: 'wx' });
    }
    for (const item of staged) { fs.renameSync(item.temporary, item.target); applied.push(item); }
  } catch (error) {
    const failures = [];
    for (const { target, before } of applied.reverse()) {
      try { if (before === null) fs.unlinkSync(target); else fs.writeFileSync(target, before); }
      catch (rollback) { failures.push(`${target}: ${rollback.message}`); }
    }
    if (failures.length) throw new Error(`Install failed: ${error.message}. Rollback also failed: ${failures.join('; ')}`);
    throw error;
  } finally {
    for (const { temporary } of staged) if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
