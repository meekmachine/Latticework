import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';

const forbiddenExtensions = new Set(['.cjs', '.js', '.jsx', '.mjs', '.sh']);

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)
  .filter((file) => existsSync(file));

const violations = files.filter((file) => forbiddenExtensions.has(extname(file))).sort();

if (violations.length > 0) {
  console.error('Latticework repo-owned source and automation must be TypeScript.');
  console.error('Rename or replace these files:');
  for (const file of violations) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log(`TypeScript-only check passed for ${files.length} tracked files.`);
