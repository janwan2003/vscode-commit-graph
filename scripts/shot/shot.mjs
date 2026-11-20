// Renders the real webview (media/graph.js + graph.css) in headless Chromium with a
// mocked VS Code API and real data from a demo repo. Writes a screenshot and checks the DOM.
// Usage: node scripts/shot/shot.mjs [out.png] [chrome-binary]
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] || 'docs/screenshot.png');
const MENU = process.env.MENU === '1';
const INTERACT = process.env.INTERACT === '1';
const pw = join(homedir(), '.cache/ms-playwright');
const chrome = process.argv[3] || process.env.CHROME_BIN ||
  (existsSync(pw) ? readdirSync(pw).filter((d) => d.startsWith('chromium-')).flatMap((d) => [join(pw, d, 'chrome-linux/chrome'), join(pw, d, 'chrome-linux64/chrome')]).find(existsSync) : 'chromium');
const tmp = mkdtempSync(join(tmpdir(), 'mergeline-shot-'));
// PAYLOAD=file.json renders a payload made elsewhere (e.g. a real repo) instead of the demo repo.
if (!process.env.PAYLOAD) {
  await build({ entryPoints: ['scripts/shot/data.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(tmp, 'data.mjs'), logLevel: 'error' });
  execFileSync(process.execPath, [join(tmp, 'data.mjs'), join(tmp, 'data.json')]);
}
const payload = readFileSync(process.env.PAYLOAD || join(tmp, 'data.json'), 'utf8');
// THEME=light uses VS Code's Light Modern colours.
const LIGHT = process.env.THEME === 'light';
const vars = readFileSync(LIGHT ? 'scripts/shot/theme-light.css' : 'scripts/shot/theme.css', 'utf8');
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${vars}</style><style>${readFileSync('media/graph.css', 'utf8')}</style></head>
<body class="${LIGHT ? 'vscode-light' : 'vscode-dark'}"><div id="app"></div><script>
const P = ${payload};
window.acquireVsCodeApi = () => ({ getState: () => null, setState() {}, postMessage(m) {
  if (window.__onPost) window.__onPost(m);
  if (m.type === 'ready') {
    window.postMessage({ type: 'settings', settings: { dateFormat: 'relative' } }, '*');
    window.postMessage({ type: 'repos', repos: [{ root: '/work/acme-app', name: 'acme-app' }], repo: '/work/acme-app' }, '*');
    window.postMessage(P.data, '*');
    setTimeout(() => {
      if (P.details) {
        const i = P.data.commits.findIndex((c) => c.sha === P.details.sha);
        document.querySelector('.row[data-i="' + i + '"]').click();
        setTimeout(() => window.postMessage(P.details, '*'), 30);
      }
      setTimeout(() => { document.querySelector('#find').value = 'search'; document.querySelector('#find').dispatchEvent(new Event('input')); }, 60);
      if (${MENU}) setTimeout(() => { const b = document.querySelector('.badge.branch:not(.current)'); const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 12 })); }, 120);
      // DROP=1: drag feature/dark-mode onto the current branch and leave the drop menu open.
      if (${process.env.DROP === '1'}) setTimeout(() => {
        const ev = (el, type, x, y) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
        const s = [...document.querySelectorAll('#rows .badge.branch')].find((b) => b.dataset.ref === 'feature/dark-mode').getBoundingClientRect();
        const d = document.querySelector('#rows .badge.branch.current').getBoundingClientRect();
        ev(document.elementFromPoint(s.left + 8, s.top + 8), 'mousedown', s.left + 8, s.top + 8);
        ev(document, 'mousemove', d.left + 8, d.top + 8);
        ev(document.elementFromPoint(d.left + 8, d.top + 8), 'mouseup', d.left + 8, d.top + 8);
      }, 140);
      if (!${INTERACT}) setTimeout(() => { document.title = 'rows=' + document.querySelectorAll('#rows .row').length + ' badges=' + document.querySelectorAll('.badge').length + ' files=' + document.querySelectorAll('.file').length + ' paths=' + document.querySelectorAll('#rows svg path').length; }, 200);
    }, 50);
  }
} });
</script><script>${readFileSync('media/rows.js', 'utf8')}</script><script>${readFileSync('media/graph.js', 'utf8')}</script>${INTERACT ? `<script>${readFileSync('scripts/shot/interact.js', 'utf8')}</script>` : ''}</body></html>`;
writeFileSync(join(tmp, 'h.html'), html);
const common = ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=1280,800', '--virtual-time-budget=3000'];
execFileSync(chrome, [...common, `--screenshot=${out}`, 'file://' + join(tmp, 'h.html')], { stdio: 'ignore' });
const dom = execFileSync(chrome, [...common, '--dump-dom', 'file://' + join(tmp, 'h.html')], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
const title = (dom.match(/<title>(.*?)<\/title>/) || [])[1] || '(no title)';
console.log('screenshot:', out, '|', title);
rmSync(tmp, { recursive: true, force: true });
if (INTERACT) { if (!title.startsWith('INTERACT ') || title.includes('"error"')) { console.error('interaction check failed'); process.exit(1); } process.exit(0); }
const m = /rows=(\d+) badges=(\d+) files=(\d+) paths=(\d+)/.exec(title);
if (!m || +m[1] < 15 || (!process.env.PAYLOAD && (+m[2] < 5 || +m[3] < 1)) || +m[4] < 20) { console.error('webview smoke check failed'); process.exit(1); }
