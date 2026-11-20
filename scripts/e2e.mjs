// End-to-end test in a real VS Code without a display (Electron headless Ozone backend).
// Usage: node scripts/e2e.mjs [path-to-code-electron-binary]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeFixture } from './make-fixture.mjs';

const snap = '/snap/code/current/usr/share/code/code';
const code = process.argv[2] || process.env.VSCODE_BIN || (existsSync(snap) ? snap : 'code');
const root = resolve('.');
const tmp = mkdtempSync(join(tmpdir(), 'mergeline-e2e-'));
const ws = makeFixture(join(tmp, 'repo'));
const report = join(tmp, 'report.txt');
const r = spawnSync(code, [
  ws,
  '--extensionDevelopmentPath=' + root,
  '--extensionTestsPath=' + join(root, 'test/e2e/suite.cjs'),
  '--user-data-dir=' + join(tmp, 'user'),
  '--extensions-dir=' + join(tmp, 'ext'),
  '--disable-gpu', '--no-sandbox', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
  '--ozone-platform=headless',
], { env: { ...process.env, MERGELINE_E2E_REPORT: report, DONT_PROMPT_WSL_INSTALL: '1' }, encoding: 'utf8', timeout: 240000 });
let out = '';
try { out = readFileSync(report, 'utf8'); } catch { out = '(no report)\n' + (r.stdout || '') + (r.stderr || '').split('\n').slice(-30).join('\n'); }
console.log(out);
rmSync(tmp, { recursive: true, force: true });
process.exit(r.status === 0 && !out.includes('FAIL') && out.includes('ok') ? 0 : 1);
