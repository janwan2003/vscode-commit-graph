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
  if (m.type === 'authors') setTimeout(() => window.postMessage({ type: 'authors', list: P.authors }, '*'), 10);
  if (m.type === 'ready') {
    window.postMessage({ type: 'settings', settings: ${process.env.TAGS === '1'} ? { dateFormat: 'relative', showAvatars: true, issueLinks: [{ pattern: 'PROJ-[0-9]+', url: 'https://acme.atlassian.net/browse/$0' }] } : { dateFormat: 'relative', rowColors: ${JSON.stringify(process.env.ROWS || 'none')}, ...(${process.env.SIDE === '1'} ? { host: 'view', layout: { w: {}, hidden: ['date', 'author', 'hash'], details: 300 } } : {}) } }, '*');
    // TAGS=1: avatars on, a Jira issue-link rule, and the details of the commit tagged v1.0.0.
    if (${process.env.TAGS === '1'}) P.details = P.tagged;
    window.postMessage({ type: 'repos', repos: [{ root: '/work/acme-app', name: 'acme-app' }], repo: '/work/acme-app' }, '*');
    // OPBAR=1: pretend a rebase stopped on a conflict (the bar above the graph).
    if (${process.env.REVIEW === '1'}) P.details = P.review;
    if (${!!process.env.PATCHMENU}) P.details = null;
    if (${process.env.OPBAR === '1'}) {
      const c = P.data.commits.filter((x) => x.kind === 'commit');
      const onto = (P.data.refs.find((r) => r.type === 'head' && r.name !== P.data.branch) || {}).sha || c[6].sha;
      P.data.op = { kind: 'rebase', branch: P.data.branch, onto, step: 2, total: 5, stopped: c[3].sha, stoppedSubject: c[3].subject, conflicts: ['src/app.ts', 'README.md', 'src/search/index.ts', 'package.json', 'docs/guide.md'] };
    }
    // OPBAR=wait: an interactive rebase waiting for its todo list in an editor tab.
    if (${process.env.OPBAR === 'wait'}) P.data.op = { kind: 'rebase', branch: P.data.branch, onto: null, step: null, total: null, stopped: null, stoppedSubject: null, conflicts: [], waiting: 'todo' };
    // BISECT=1: a git bisect in progress: bad at the newest commit, good further down, one skipped, one under test (detached HEAD).
    if (${process.env.BISECT === '1'}) {
      const c = P.data.commits.filter((x) => x.kind === 'commit');
      P.data.bisect = { terms: ['bad', 'good'], start: P.data.branch, bad: c[0].sha, good: [c[11].sha], skip: [c[7].sha], testing: c[5].sha, testingSubject: c[5].subject, left: 4, steps: 3, firstBad: null, firstBadSubject: null, onlySkipped: null };
      P.data.head = c[5].sha; P.data.branch = null;
      P.details = null;
    }
    window.postMessage(P.data, '*');
    setTimeout(() => {
      if (P.details) {
        const i = P.data.commits.findIndex((c) => c.sha === P.details.sha);
        document.querySelector('.row[data-i="' + i + '"]').click();
        // REVIEW=1: the details pane in review mode, with all but the last two files reviewed.
        if (${process.env.REVIEW === '1'}) { P.details = P.review; P.details.reviewKey = P.details.from + '..' + P.details.sha; P.details.reviewed = P.details.files.slice(0, Math.max(1, P.details.files.length - 2)).map((f) => f.path); }
        setTimeout(() => window.postMessage(P.details, '*'), 30);
        if (P.contains && P.contains[P.details.sha]) setTimeout(() => window.postMessage({ type: 'contains', sha: P.details.sha, ...P.contains[P.details.sha] }, '*'), 45);
      }
      if (!${process.env.NOFIND === '1'}) setTimeout(() => { document.querySelector('#find').value = 'search'; document.querySelector('#find').dispatchEvent(new Event('input')); }, 60);
      if (${MENU}) setTimeout(() => { const b = document.querySelector('.badge.branch:not(.current)'); const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 12 })); }, 120);
      // EDITMENU=1: right-click the commit below HEAD to show the edit-history items.
      if (${process.env.EDITMENU === '1'}) setTimeout(() => { const i = P.data.commits.findIndex((c) => c.sha === P.data.head) + 2; const r = document.querySelector('.row[data-i="' + i + '"]').getBoundingClientRect(); document.querySelector('.row[data-i="' + i + '"] .c-desc, .row[data-i="' + i + '"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 330, clientY: r.top + 10 })); }, 120);
      // DROP=1: drag feature/dark-mode onto the current branch and leave the drop menu open.
      if (${process.env.DROP === '1'}) setTimeout(() => {
        const ev = (el, type, x, y) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
        const s = [...document.querySelectorAll('#rows .badge.branch')].find((b) => b.dataset.ref === 'feature/dark-mode').getBoundingClientRect();
        const d = document.querySelector('#rows .badge.branch.current').getBoundingClientRect();
        ev(document.elementFromPoint(s.left + 8, s.top + 8), 'mousedown', s.left + 8, s.top + 8);
        ev(document, 'mousemove', d.left + 8, d.top + 8);
        ev(document.elementFromPoint(d.left + 8, d.top + 8), 'mouseup', d.left + 8, d.top + 8);
      }, 140);
      // PATCHMENU=1: the toolbar's Patch menu open (apply from a file or the clipboard, save uncommitted changes).
      if (${process.env.PATCHMENU === '1'}) setTimeout(() => document.querySelector('#patchbtn').click(), 140);
      // PATCHMENU=2: a commit's right-click menu, with Ctrl/Cmd-click selection of an older commit (Save commits a…b as patches…).
      if (${process.env.PATCHMENU === '2'}) setTimeout(() => {
        // HEAD and its parent: one line of history.
        const ix = (sha) => P.data.commits.findIndex((c) => c.sha === sha);
        const a = ix(P.data.head), b = ix(P.data.commits[a].parents[0]);
        const row = (i) => document.querySelector('.row[data-i="' + i + '"]');
        row(a).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        setTimeout(() => {
          row(b).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
          setTimeout(() => { const r = row(a).getBoundingClientRect(); row(a).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 360, clientY: r.top + 10 })); }, 60);
        }, 60);
      }, 140);
      // AUTHORS=1: the author checklist open (run with AUTHOR="Grace Hopper <grace@example.com>" for a filtered graph).
      if (${process.env.AUTHORS === '1'}) setTimeout(() => document.querySelector('#authbtn').click(), 140);
      // BRANCHES=1: the branch checklist open with two branches ticked, commits off HEAD dimmed.
      if (${process.env.BRANCHES === '1'}) setTimeout(() => {
        window.postMessage({ type: 'settings', settings: { dateFormat: 'relative', dimOtherCommits: true } }, '*');
        document.querySelector('#branchbtn').click();
        for (const v of ['main', 'release/1.1']) { const i = [...document.querySelectorAll('#blist input')].find((x) => x.value === v); if (i) i.click(); }
      }, 140);
      // DIALOG=1: the commit message editor, open. DIALOG=2: edit it and save; the posted message goes in the title.
      if (${!!process.env.DIALOG}) setTimeout(() => window.postMessage({ type: 'message', sha: P.data.head, message: P.data.commits.find((c) => c.sha === P.data.head).subject + '\\n\\nThe dark palette now follows the editor theme.\\nFixes #128.' }, '*'), 100);
      if (${process.env.DIALOG === '2'}) setTimeout(() => {
        window.__onPost = (m) => { if (m.type === 'action') window.__posted = m; };
        const s = document.querySelector('#dlg-s'); s.value = 'New subject'; s.dispatchEvent(new Event('input'));
        document.querySelector('#dlg-ok').click();
        setTimeout(() => { document.title += ' posted=' + JSON.stringify(window.__posted || null) + ' dlgHidden=' + document.querySelector('#dlg').hidden; }, 50);
      }, 300);
      if (!${INTERACT}) setTimeout(() => { document.title = 'rows=' + document.querySelectorAll('#rows .row').length + ' badges=' + document.querySelectorAll('.badge').length + ' files=' + document.querySelectorAll('.file').length + ' paths=' + document.querySelectorAll('#rows svg path').length; }, 200);
    }, 50);
  }
} });
</script><script>${readFileSync('media/rows.js', 'utf8')}</script><script>${readFileSync('media/graph.js', 'utf8')}</script>${INTERACT ? `<script>${readFileSync('scripts/shot/interact.js', 'utf8')}</script>` : ''}</body></html>`;
writeFileSync(join(tmp, 'h.html'), html);
const common = ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=' + (process.env.SIZE || '1280,800'), '--virtual-time-budget=3000'];
execFileSync(chrome, [...common, `--screenshot=${out}`, 'file://' + join(tmp, 'h.html')], { stdio: 'ignore' });
const dom = execFileSync(chrome, [...common, '--dump-dom', 'file://' + join(tmp, 'h.html')], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
const title = (dom.match(/<title>(.*?)<\/title>/) || [])[1] || '(no title)';
console.log('screenshot:', out, '|', title);
rmSync(tmp, { recursive: true, force: true });
if (INTERACT) { if (!title.startsWith('INTERACT ') || title.includes('"error"')) { console.error('interaction check failed'); process.exit(1); } process.exit(0); }
const m = /rows=(\d+) badges=(\d+) files=(\d+) paths=(\d+)/.exec(title);
if (!m || +m[1] < (process.env.AUTHOR ? 2 : 15) || (!process.env.PAYLOAD && (+m[2] < (process.env.AUTHOR ? 1 : 5) || (+m[3] < 1 && process.env.BISECT !== '1' && !process.env.PATCHMENU))) || +m[4] < 20) { console.error('webview smoke check failed'); process.exit(1); }
