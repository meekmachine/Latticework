import { cp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'src/animation/snippets');
const destination = resolve(root, 'dist/snippets');

await rm(destination, { force: true, recursive: true });
await cp(source, destination, { recursive: true });
