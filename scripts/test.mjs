// Bundle each test/*.test.ts with esbuild into .test-out/ and run them with node --test.
// Usage: node scripts/test.mjs [test/foo.test.ts ...]
import { build } from 'esbuild';
import { readdirSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync('test').filter((f) => f.endsWith('.test.ts')).map((f) => join('test', f));
rmSync('.test-out', { recursive: true, force: true });
mkdirSync('.test-out');
// Tests read fixtures relative to their own URL.
// (no fixtures dir: tests build repos in tmp)
await build({
  entryPoints: files,
  outdir: '.test-out',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outExtension: { '.js': '.mjs' },
  packages: 'external',
  logLevel: 'error',
});
const out = files.map((f) => join('.test-out', basename(f).replace(/\.ts$/, '.mjs')));
const r = spawnSync(process.execPath, ['--test', ...out], { stdio: 'inherit' });
process.exit(r.status ?? 1);
