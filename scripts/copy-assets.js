// Copies static dashboard assets (html/css/js) into dist/ after tsc runs,
// since the TypeScript compiler only emits .ts -> .js.
import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(scriptsDir, '..', 'src', 'web', 'public');
const dest = path.join(scriptsDir, '..', 'dist', 'web', 'public');

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied dashboard assets: ${src} -> ${dest}`);
