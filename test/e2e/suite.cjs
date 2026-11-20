// Runs inside VS Code (extension host). Started by scripts/e2e.mjs.
const vscode = require('vscode');
const assert = require('assert');
const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000, what = 'condition') {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch {}
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + what);
    await sleep(100);
  }
}

exports.run = async function run() {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push('ok   ' + name); } catch (e) { results.push('FAIL ' + name + ': ' + ((e && e.stack) || e)); }
  };
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  const ext = vscode.extensions.getExtension('plainbyte.mergeline');
  let api, panel;

  await check('extension activates and finds the repository', async () => {
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
    await api.ready;
    await until(() => api.repos.list().length > 0, 15000, 'repos');
    assert.equal(fs.realpathSync(api.repos.list()[0].root), fs.realpathSync(root));
  });

  await check('command opens the graph with all commits, stash and uncommitted row', async () => {
    await vscode.commands.executeCommand('mergeline.show');
    panel = await until(() => api.panel() && api.panel().lastData && api.panel(), 20000, 'graph data');
    const d = panel.lastData;
    const subjects = d.commits.map((c) => c.subject);
    assert.equal(d.commits.filter((c) => c.kind === 'commit').length, 8, subjects.join(' | '));
    assert.equal(d.commits[0].kind, 'uncommitted');
    assert.match(d.commits[0].subject, /Uncommitted changes \(2\)/);
    assert.ok(d.commits.some((c) => c.kind === 'stash' && c.stashRef === 'stash@{0}'));
    assert.equal(d.state.branch, 'main');
    assert.ok(d.state.refs.some((r) => r.name === 'v1.0.0' && r.type === 'tag'));
  });

  await check('webview renders rows', async () => {
    const pong = await until(async () => { await panel.ping(); await sleep(200); return panel.lastPong && panel.lastPong.rows > 0 && panel.lastPong; }, 20000, 'webview pong');
    assert.ok(pong.rows >= 10, 'rows ' + pong.rows);
  });

  const bySubject = (s) => panel.lastData.commits.find((c) => c.subject === s);

  await check('details: commit info and changed files (rename detected)', async () => {
    const c = bySubject('Rename src.txt to parser.txt');
    await panel.testMessage({ type: 'details', sha: c.sha });
    const d = panel.lastDetails;
    assert.equal(d.info.message, 'Rename src.txt to parser.txt');
    assert.deepEqual(d.files.map((f) => [f.status, f.oldPath, f.path]), [['R', 'src.txt', 'parser.txt']]);
  });

  await check('details: uncommitted changes and compare two commits', async () => {
    await panel.testMessage({ type: 'details', sha: '*' });
    assert.deepEqual(panel.lastDetails.files.map((f) => f.status + ':' + f.path).sort(), ['M:README.md', 'U:notes.txt']);
    const a = bySubject('Initial commit'), b = bySubject("Merge branch 'feature/search'");
    await panel.testMessage({ type: 'details', sha: b.sha, compare: a.sha });
    assert.equal(panel.lastDetails.from, a.sha, 'older commit is the left side');
    assert.deepEqual(panel.lastDetails.files.map((f) => f.path).sort(), ['search.txt', 'src.txt']);
  });

  await check('review mode: start, next unreviewed opens a diff, toggle, kept after reselecting, end; none for uncommitted', async () => {
    const a = bySubject('Initial commit'), b = bySubject("Merge branch 'feature/search'");
    const idx = (c) => panel.lastData.commits.indexOf(c);
    const pong = async (ok, what) => until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && ok(panel.lastPong) && panel.lastPong; }, 10000, what);
    const click = (selector, ctrl) => panel.testPost({ type: 'click', selector, ctrl });
    // Select the merge, Ctrl-click the first commit: a comparison of 2 files.
    await panel.testPost({ type: 'reveal', sha: b.sha });
    await until(() => panel.lastDetails && panel.lastDetails.sha === b.sha && !panel.lastDetails.compare, 10000, 'merge details');
    await click(`.row[data-i="${idx(a)}"]`, true);
    await until(() => panel.lastDetails && panel.lastDetails.compare === a.sha, 10000, 'compare details');
    const key = panel.lastDetails.reviewKey;
    assert.equal(key, `${a.sha}..${b.sha}`);
    assert.equal(panel.lastDetails.reviewed, null);
    await pong((p) => p.review === 'Review', 'Review button');
    await click('[data-rv="start"]');
    await pong((p) => /0 of 2 reviewed/.test(p.review), '0 of 2');
    await until(() => panel.reviews()[key] && panel.reviews()[key].files.length === 0, 5000, 'review saved');
    const before = vscode.window.tabGroups.all.flatMap((g) => g.tabs).length;
    await click('[data-rv="next"]');
    let p = await pong((x) => /1 of 2 reviewed/.test(x.review), '1 of 2');
    assert.deepEqual(panel.reviews()[key].files, ['search.txt'], 'tree/list order: search.txt first');
    assert.deepEqual(p.reviewedRows, ['search.txt']);
    await until(() => vscode.window.tabGroups.all.flatMap((g) => g.tabs).some((t) => t.input instanceof vscode.TabInputTextDiff && /search\.txt/.test(t.label)), 10000, 'diff tab for search.txt');
    assert.ok(vscode.window.tabGroups.all.flatMap((g) => g.tabs).length >= before);
    // Tick the other file by its check box, then untick it again and tick it.
    const k = panel.lastDetails.files.findIndex((f) => f.path === 'src.txt');
    await click(`.file[data-k="${k}"] .rv`);
    p = await pong((x) => /2 of 2 reviewed/.test(x.review), '2 of 2');
    await click(`.file[data-k="${k}"] .rv`);
    await pong((x) => /1 of 2 reviewed/.test(x.review), 'untick → 1 of 2');
    await click(`.file[data-k="${k}"] .rv`);
    await pong((x) => /2 of 2 reviewed/.test(x.review), 'tick again → 2 of 2');
    // Select something else, then the same comparison again: the review is still there.
    await panel.testPost({ type: 'reveal', sha: a.sha });
    await until(() => panel.lastDetails && panel.lastDetails.sha === a.sha && !panel.lastDetails.compare, 10000, 'other details');
    await panel.testPost({ type: 'reveal', sha: b.sha });
    await until(() => panel.lastDetails && panel.lastDetails.sha === b.sha && !panel.lastDetails.compare, 10000, 'merge again');
    await click(`.row[data-i="${idx(a)}"]`, true);
    await until(() => panel.lastDetails && panel.lastDetails.compare === a.sha, 10000, 'compare again');
    assert.deepEqual([...panel.lastDetails.reviewed].sort(), ['search.txt', 'src.txt']);
    await pong((x) => /2 of 2 reviewed/.test(x.review) && x.reviewedRows.length === 2, 'restored 2 of 2');
    await click('[data-rv="end"]');
    await pong((x) => x.review === 'Review', 'ended');
    assert.equal(panel.reviews()[key], undefined);
    // The working tree has no review.
    await panel.testPost({ type: 'reveal', sha: '*' });
    await until(() => panel.lastDetails && panel.lastDetails.sha === '*', 10000, 'uncommitted details');
    assert.equal(panel.lastDetails.reviewKey, undefined);
    await pong((x) => x.details && x.review === '', 'no review bar for uncommitted');
    await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputTextDiff));
  });

  await check('open file diff opens a diff editor with historical content', async () => {
    const c = bySubject('Search: rank by recency');
    await panel.testMessage({ type: 'details', sha: c.sha });
    const f = panel.lastDetails.files[0];
    await panel.testMessage({ type: 'openFile', from: panel.lastDetails.from, to: panel.lastDetails.to, path: f.path, status: f.status });
    const docs = await until(() => { const d = vscode.workspace.textDocuments.filter((t) => t.uri.scheme === 'mergeline'); return d.length >= 2 && d; }, 10000, 'mergeline docs');
    const texts = docs.map((d) => d.getText()).sort();
    assert.deepEqual(texts, ['Add search index\n', 'Search: rank by recency\n']);
  });

  await check('file history: command filters the graph to one file, parents rewritten', async () => {
    const p2 = await vscode.commands.executeCommand('mergeline.fileHistory', vscode.Uri.file(root + '/src.txt'));
    assert.ok(p2 === panel, 'same panel');
    const d = await until(() => panel.lastData.commits.every((c) => c.kind === 'commit') && panel.lastData.commits.length < 8 && panel.lastData, 10000, 'file history data');
    assert.deepEqual(d.commits.map((c) => c.subject), ['Rename src.txt to parser.txt', 'Parser: handle empty input', 'Add parser skeleton']);
    const shas = new Set(d.commits.map((c) => c.sha));
    for (const c of d.commits) for (const p of c.parents) assert.ok(shas.has(p), 'parent of ' + c.subject + ' is in the list');
    await panel.testMessage({ type: 'filter', branch: '', remotes: true, path: '' });
    // A refresh already in flight defers this one, so wait for the data rather than assert at once.
    await until(() => panel.lastData.commits.filter((c) => c.kind === 'commit').length === 8, 10000, 'clearing the path shows everything again');
  });

  await check('file history follows a rename (parser.txt was src.txt)', async () => {
    await vscode.commands.executeCommand('mergeline.fileHistory', vscode.Uri.file(root + '/parser.txt'));
    const d = await until(() => panel.lastData.names.length === 2 && panel.lastData, 10000, 'rename-following history');
    assert.deepEqual(d.names, ['parser.txt', 'src.txt']);
    assert.deepEqual(d.commits.map((c) => c.subject), ['Rename src.txt to parser.txt', 'Parser: handle empty input', 'Add parser skeleton']);
    const pong = await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(200); return panel.lastPong && /also as/.test(panel.lastPong.pathbar) && panel.lastPong; }, 10000, 'path bar shows the old name');
    assert.match(pong.pathbar, /parser\.txt.*also as src\.txt/);
    await panel.testMessage({ type: 'filter', branch: '', remotes: true, path: '' });
  });

  await check('find in all history: search beyond the loaded page, load up to the match and select it', async () => {
    await vscode.workspace.getConfiguration('mergeline').update('initialCommits', 3, vscode.ConfigurationTarget.Workspace);
    await until(() => panel.lastData.commits.filter((c) => c.kind === 'commit').length === 3, 10000, 'small page');
    const first = git('rev-list', '--max-parents=0', 'HEAD');
    await panel.testMessage({ type: 'searchHistory', q: 'initial COMMIT' });
    const h = panel.lastHistory;
    assert.equal(h.total, 1);
    assert.equal(h.matches[0].sha, first);
    assert.ok(!panel.lastData.commits.some((c) => c.sha === first), 'not loaded before');
    await panel.testMessage({ type: 'loadTo', sha: first, index: h.matches[0].index });
    await until(() => panel.lastData.commits.some((c) => c.sha === first), 10000, 'loaded after loadTo');
    const pong = await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(200); return panel.lastPong && panel.lastPong.selected === first && panel.lastPong; }, 10000, 'webview selects the match');
    assert.ok(pong.details !== undefined);
    await vscode.workspace.getConfiguration('mergeline').update('initialCommits', undefined, vscode.ConfigurationTarget.Workspace);
    await until(() => panel.lastData.commits.filter((c) => c.kind === 'commit').length === 8, 10000, 'page size restored');
  });

  await check('load more appends only the new rows, and the webview ends up with what a full reload sends', async () => {
    const count = () => panel.lastData.commits.filter((c) => c.kind === 'commit').length;
    const ping = async (n) => until(async () => { panel.lastPong = null; await panel.ping(); await sleep(200); return panel.lastPong && panel.lastPong.loaded === n && panel.lastPong; }, 10000, `webview has ${n} rows`);
    const kinds = [];
    const post0 = panel.post.bind(panel);
    panel.post = (m) => { if (m && (m.type === 'data' || m.type === 'append')) kinds.push(m.type + ':' + m.commits.length); return post0(m); };
    try {
      await vscode.workspace.getConfiguration('mergeline').update('initialCommits', 3, vscode.ConfigurationTarget.Workspace);
      await until(() => count() < 8, 10000, 'small page');
      // Fill the webview's per-data caches (reachability, editable line) while pages are still arriving.
      panel.lastPong = null; await panel.ping(); await until(() => panel.lastPong, 10000, 'first pong');
      // The webview asks for more by itself while the list is shorter than the view; ask once more in case it stopped.
      await until(async () => { if (count() < 8) await panel.testMessage({ type: 'loadMore' }); return count() === 8; }, 15000, 'all pages loaded');
      const appends = kinds.filter((k) => k.startsWith('append'));
      assert.ok(appends.length >= 1, 'pages after the first arrive as appends: ' + kinds.join(' '));
      assert.equal(panel.lastSent.kind, 'append', 'the last page was an append: ' + kinds.join(' '));
      const a = await ping(panel.lastData.commits.length);
      await panel.refresh(true);
      assert.equal(panel.lastSent.kind, 'data', 'a refresh sends everything');
      const b = await ping(panel.lastData.commits.length);
      assert.equal(a.packedJson, b.packedJson, 'appended rows equal the full layout');
      assert.equal(a.moreText, b.moreText);
      assert.equal(a.reachN, b.reachN, 'commits reachable from HEAD (dimming) recomputed after the append');
      assert.equal(a.editableN, b.editableN, 'editable line recomputed after the append');
    } finally {
      panel.post = post0;
      await vscode.workspace.getConfiguration('mergeline').update('initialCommits', undefined, vscode.ConfigurationTarget.Workspace);
    }
    await until(() => count() === 8 && !panel.lastData.hasMore, 10000, 'page size restored');
  });

  await check('commit order: topology keeps a branch together, saved as a setting', async () => {
    await panel.testMessage({ type: 'order', order: 'topo' });
    assert.equal(vscode.workspace.getConfiguration('mergeline').get('commitOrder'), 'topo');
    const d = await until(() => { const s = panel.lastData.commits.map((c) => c.subject); return s.indexOf('Search: rank by recency') === s.indexOf("Merge branch 'feature/search'") + 1 && panel.lastData; }, 10000, 'topo order');
    assert.ok(d);
    await panel.testMessage({ type: 'order', order: 'date' });
    await until(() => vscode.workspace.getConfiguration('mergeline').get('commitOrder') === 'date', 5000, 'order reset');
  });

  await check('first parent only: toolbar setting hides merged-in commits, merges keep one parent, off restores', async () => {
    const before = panel.lastData.commits.length;
    await panel.testMessage({ type: 'firstParent', on: true });
    assert.equal(vscode.workspace.getConfiguration('mergeline').get('firstParentOnly'), true);
    const d = await until(() => panel.lastData.commits.every((c) => c.parents.length <= 1) && panel.lastData, 10000, 'first-parent data');
    const merge = d.commits.find((c) => c.subject === "Merge branch 'feature/search'");
    assert.ok(merge && merge.parents.length === 1, 'merge shown with its first parent only');
    const pong = await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && panel.lastPong.firstParent && panel.lastPong; }, 10000, 'checkbox ticked');
    assert.ok(pong.firstParent);
    await panel.testMessage({ type: 'firstParent', on: false });
    await until(() => vscode.workspace.getConfiguration('mergeline').get('firstParentOnly') === false && panel.lastData.commits.length === before && panel.lastData.commits.some((c) => c.parents.length > 1), 10000, 'first parent off');
  });

  await check('compact graph: toolbar setting folds straight runs, a real click opens one, fold all, off restores', async () => {
    const before = panel.lastData.commits.length;
    const click = (selector) => panel.testPost({ type: 'click', selector });
    await panel.testMessage({ type: 'compact', on: true });
    assert.equal(vscode.workspace.getConfiguration('mergeline').get('compactGraph'), true);
    const d = await until(() => panel.lastData.commits.some((c) => c.kind === 'collapsed') && panel.lastData, 10000, 'compact data');
    const ids = new Set(d.commits.map((c) => c.sha));
    // Every drawn line ends at a row that exists; folded rows stand for 1+ commits, all shown commits plus folded ones add up.
    for (const c of d.commits) for (const p of c.parents) assert.ok(ids.has(p), `parent ${p} of ${c.sha} is loaded`);
    const folds = d.commits.filter((c) => c.kind === 'collapsed');
    const real = d.commits.filter((c) => c.kind === 'commit').length;
    assert.equal(real + folds.reduce((a, c) => a + c.fold.n, 0), Number(git('rev-list', '--count', '--branches', '--tags', '--remotes', 'HEAD')));
    // Refs and HEAD are never folded.
    for (const r of d.state.refs.filter((x) => x.type !== 'stash')) assert.ok(ids.has(r.sha), `ref ${r.name} is shown`);
    const pong = await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && panel.lastPong.compact && panel.lastPong.folds.length && panel.lastPong; }, 10000, 'checkbox ticked and folded rows drawn');
    assert.match(pong.foldHint, /^\d+ of \d+ commits folded$/);
    assert.match(pong.folds[0], /^⋯ \d+ commits?$/);
    // A real click on the first folded row opens it: its commits appear and the newest is selected.
    const first = folds[0];
    await click(`.row[data-i="${d.commits.indexOf(first)}"]`);
    const o = await until(() => !panel.lastData.commits.some((c) => c.sha === first.sha) && panel.lastData, 10000, 'fold opened');
    assert.equal(o.commits.length, d.commits.length - 1 + first.fold.n);
    assert.ok(o.commits.some((c) => c.sha === first.fold.last));
    const p2 = await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && panel.lastPong.selected === first.sha.slice(1) && panel.lastPong; }, 10000, 'newest commit of the opened run selected');
    assert.match(p2.foldHint, /fold all$/);
    await click('#foldhint [data-q="collapse"]');
    await until(() => panel.lastData.commits.length === d.commits.length, 10000, 'folded again');
    await panel.testMessage({ type: 'compact', on: false });
    await until(() => vscode.workspace.getConfiguration('mergeline').get('compactGraph') === false && panel.lastData.commits.length === before && !panel.lastData.commits.some((c) => c.kind === 'collapsed'), 10000, 'compact off');
  });

  await check('pinned branches: default pins main (working tree row on top of it); a pinned hotfix line keeps column 0; pin message edits the setting', async () => {
    const cfg = () => vscode.workspace.getConfiguration('mergeline');
    assert.deepEqual(cfg().get('pinnedBranches'), ['main', 'master', 'develop']);
    const packed = async (want, what) => {
      const p = await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && panel.lastPong.packedJson && want(JSON.parse(panel.lastPong.packedJson)) && JSON.parse(panel.lastPong.packedJson); }, 10000, what);
      return p;
    };
    const colOf = (pk, sha) => pk[1][panel.lastData.commits.findIndex((c) => c.sha === sha)][0];
    const mainLine = git('rev-list', '--first-parent', 'main').split('\n');
    // Default: the working-tree row and all of main's first-parent line in column 0.
    await packed((pk) => panel.lastData.commits[0].sha === '*' && pk[1][0][0] === 0 && mainLine.every((s) => colOf(pk, s) === 0), 'main in column 0');
    // Pin hotfix/crash first: its own commit takes column 0 and main's line (from where they meet down) stays in it;
    // main's newer commits are pinned second, in column 1.
    await cfg().update('pinnedBranches', ['hotfix/crash', 'main'], vscode.ConfigurationTarget.Global);
    const fix = git('rev-parse', 'hotfix/crash');
    const pk = await packed((pk) => colOf(pk, fix) === 0, 'hotfix in column 0');
    const shared = git('rev-list', '--first-parent', 'hotfix/crash').split('\n');
    for (const s of shared) assert.equal(colOf(pk, s), 0, 'hotfix line ' + s);
    const mainOnly = mainLine.filter((s) => !shared.includes(s));
    assert.ok(mainOnly.length > 0);
    for (const s of mainOnly) assert.equal(colOf(pk, s), 1, 'main line ' + s);
    // The branch menu's Pin/Unpin item posts this message: it edits the user setting.
    await panel.testMessage({ type: 'pin', name: 'feature/search', on: true });
    assert.deepEqual(cfg().get('pinnedBranches'), ['hotfix/crash', 'main', 'feature/search']);
    await panel.testMessage({ type: 'pin', name: 'hotfix/crash', on: false });
    assert.deepEqual(cfg().get('pinnedBranches'), ['main', 'feature/search']);
    await cfg().update('pinnedBranches', undefined, vscode.ConfigurationTarget.Global);
    await packed((pk) => mainLine.every((s) => colOf(pk, s) === 0), 'back to default');
  });

  await check('branch colours: setting colours lines and badges, the branch menu sets and removes a colour (real right-click), bad values warn; row colours from the header menu', async () => {
    const cfg = () => vscode.workspace.getConfiguration('mergeline');
    const w = vscode.window;
    const orig = { pick: w.showQuickPick, warn: w.showWarningMessage };
    const pong = async (ok, what) => until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && ok(panel.lastPong) && panel.lastPong; }, 10000, what);
    const rowOf = (sha) => panel.lastData.commits.findIndex((c) => c.sha === sha);
    const node = (p, sha) => (p.nodeColors.find((x) => x.startsWith(rowOf(sha) + ' ')) || '').split(' ')[1];
    const fix = git('rev-parse', 'hotfix/crash'), feat = git('rev-parse', 'feature/search'), head = git('rev-parse', 'HEAD');
    try {
      // Setting: hotfix/* by glob in a hex colour, feature/search by palette name. feature/search's tip is only reached as
      // a merge parent, so this also covers lines opened for a merge's second parent.
      await cfg().update('branchColors', { 'hotfix/*': '#ff0000', 'feature/search': 'purple' }, vscode.ConfigurationTarget.Global);
      let p = await pong((x) => node(x, fix) === '#ff0000' && node(x, feat) === 'var(--lane-4)', 'hotfix red, feature purple');
      const featParent = git('rev-parse', 'feature/search~1');
      assert.equal(node(p, featParent), 'var(--lane-4)', 'the feature line keeps its colour below the tip');
      assert.ok(p.badgeColors.includes('hotfix/crash #ff0000 rgb(255, 0, 0)'), p.badgeColors.join(' | '));
      // Real right-click on the main badge → "Set branch colour…" → the quick pick (stubbed) answers green.
      let pickTitle = '';
      w.showQuickPick = async (items, o) => { const arr = await items; pickTitle = o.title + ': ' + arr.map((i) => i.label).join(', '); return arr.find((i) => i.value === 'green'); };
      await panel.testPost({ type: 'context', selector: '.badge[data-ref="main"]' });
      p = await pong((x) => /Set branch colour…/.test(x.menuText), 'branch menu');
      await panel.testPost({ type: 'menuPick', label: 'Set branch colour…' });
      await until(() => (cfg().get('branchColors') || {}).main === 'green', 10000, 'main green in the setting');
      assert.match(pickTitle, /^Colour for main: 🟦 blue, 🟥 red, 🟩 green/);
      assert.match(pickTitle, /Custom colour…/);
      // main is pinned (default setting): its pinned column, the working-tree row and the HEAD node turn green.
      p = await pong((x) => node(x, head) === 'var(--lane-2)' && (x.nodeColors[0] || '').split(' ')[1] === 'var(--lane-2)', 'main line green');
      for (const s of git('rev-list', '--first-parent', 'main').split('\n')) assert.equal(node(p, s), 'var(--lane-2)', 'main line ' + s);
      // The menu now says "Change", and "Automatic" removes the entry.
      w.showQuickPick = async (items) => (await items).find((i) => i.value === null);
      await panel.testPost({ type: 'context', selector: '.badge[data-ref="main"]' });
      await pong((x) => /Change branch colour…/.test(x.menuText), 'menu says change');
      await panel.testPost({ type: 'menuPick', label: 'Change branch colour…' });
      await until(() => !('main' in (cfg().get('branchColors') || {})), 10000, 'main colour removed');
      // A bad value is skipped with a warning; the good one still applies.
      let warned = '';
      w.showWarningMessage = async (msg) => { warned = msg; return undefined; };
      await cfg().update('branchColors', { 'hotfix/*': 'red;background:url(x)', 'feature/*': '#00ff00' }, vscode.ConfigurationTarget.Global);
      await until(() => /branchColors entries were skipped: "hotfix\/\*"/.test(warned), 10000, 'warning');
      p = await pong((x) => node(x, feat) === '#00ff00' && node(x, fix) !== '#ff0000', 'feature green, hotfix automatic');
      assert.ok(!/url\(/.test(JSON.stringify(p.nodeColors)));
      // Row colours: real right-click on the column header → "Row colours: tint by branch" → the setting, then the rows.
      await panel.testPost({ type: 'context', selector: '#header' });
      await pong((x) => /✓ Row colours: none/.test(x.menuText), 'header menu');
      await panel.testPost({ type: 'menuPick', label: ' Row colours: tint by branch' });
      await until(() => cfg().get('rowColors') === 'tint', 10000, 'rowColors tint');
      p = await pong((x) => /rc-tint/.test(x.rowsClass), 'rows tinted');
      const featRow = p.nodeColors.find((x) => x.startsWith(rowOf(feat) + ' '));
      assert.match(featRow, /#00ff00 /, 'row carries its node colour: ' + featRow);
      assert.doesNotMatch(featRow.split(' #00ff00 ')[1], /^rgba\(0, 0, 0, 0\)/, 'tinted background: ' + featRow);
      await cfg().update('rowColors', 'stripe', vscode.ConfigurationTarget.Global);
      p = await pong((x) => /rc-stripe/.test(x.rowsClass), 'rows striped');
      const striped = p.nodeColors.find((x) => x.startsWith(rowOf(feat) + ' '));
      assert.match(striped, /rgb\(0, 255, 0\) 3px 0px 0px 0px inset$/, 'stripe in the row colour: ' + striped);
    } finally {
      w.showQuickPick = orig.pick;
      w.showWarningMessage = orig.warn;
      await cfg().update('branchColors', undefined, vscode.ConfigurationTarget.Global);
      await cfg().update('rowColors', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  await check('author filter (real clicks in the checklist, rewritten parents, menu), notes (marks, details, editor), hidden branches (hide, unhide)', async () => {
    const pong = async (ok, what) => until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && ok(panel.lastPong) && panel.lastPong; }, 10000, what);
    const click = (selector) => panel.testPost({ type: 'click', selector });
    const commitsOnly = () => panel.lastData.commits.filter((c) => c.kind === 'commit');
    const total = commitsOnly().length;
    const GRACE = 'Grace Hopper <grace.hopper@example.com>';
    // The checklist lists every author with a count (read from the rendered rows).
    await click('#authbtn');
    let p = await pong((x) => x.authorRows.length === 3, 'author list');
    assert.deepEqual(p.authorRows.map((r) => r.slice(4)).sort(), ['Ada Lovelace <ada@example.com>', 'Alan Turing <alan.turing@example.com>', GRACE]);
    // Tick Grace with a real click: only her two commits, the newer one's parent rewritten to the older.
    await click(`#alist input[value="${GRACE}"]`);
    await until(() => commitsOnly().length === 2, 10000, 'filtered to Grace');
    const [newer, older] = commitsOnly();
    assert.deepEqual([newer.subject, older.subject], ['Search: rank by recency', 'Add search index']);
    assert.deepEqual(newer.parents, [older.sha]);
    assert.deepEqual(older.parents, [], 'Ada\'s commits below are not shown, so the line ends');
    p = await pong((x) => x.authBtn === 'Grace Hopper', 'button label');
    await click('#authbtn'); // close
    // The commit menu offers the way back; "All authors" restores everything.
    await panel.testPost({ type: 'reveal', sha: newer.sha });
    p = await pong((x) => x.selected === newer.sha && x.commitMenu.includes('Show commits by all authors'), 'menu: all authors');
    assert.ok(p.commitMenu.includes('Add note…'));
    await click('#authbtn');
    await click('#apop [data-q="all"]');
    await until(() => commitsOnly().length === total, 10000, 'all authors again');
    await click('#authbtn'); // close
    p = await pong((x) => x.authBtn === 'All', 'label All');

    // Notes: set one, the row gets a mark and the details show it; the editor opens with it; remove.
    const c = bySubject('Parser: handle empty input');
    await panel.testMessage({ type: 'setNote', sha: c.sha, note: 'Deployed to staging\nSee #42' });
    assert.equal(git('notes', 'show', c.sha), 'Deployed to staging\nSee #42');
    await until(() => (panel.lastData.notes || []).includes(c.sha), 10000, 'notes in data');
    await panel.testPost({ type: 'reveal', sha: c.sha });
    p = await pong((x) => x.noteMarks.length === 1 && /Note Edit\s*Deployed to staging\s*See #42/.test(x.detailsText), 'note mark and details');
    assert.ok(p.commitMenu.includes('Edit note…') && p.commitMenu.includes('Remove note'));
    await panel.testMessage({ type: 'getNote', sha: c.sha });
    p = await pong((x) => x.dialog && x.dialog.title === `Edit note on ${c.sha.slice(0, 8)}`, 'note editor');
    assert.equal(p.dialog.body, 'Deployed to staging\nSee #42');
    await click('#dlg-c');
    await panel.testMessage({ type: 'setNote', sha: c.sha, note: '' });
    assert.throws(() => git('notes', 'show', c.sha));
    p = await pong((x) => x.noteMarks.length === 0, 'mark gone');

    // Hidden branches: the branch menu's message writes the setting; the checklist shows it with an unhide button.
    const cfg = () => vscode.workspace.getConfiguration('mergeline');
    await panel.testMessage({ type: 'hide', pattern: 'hotfix/*', on: true });
    assert.deepEqual(cfg().get('hiddenBranches'), ['hotfix/*']);
    await until(() => !bySubject('Fix crash on startup') && commitsOnly().length === total - 1, 10000, 'hotfix hidden');
    await click('#branchbtn');
    p = await pong((x) => x.hiddenText.includes('hotfix/* ✕'), 'hidden list');
    await click('#bhidden [data-unhide="hotfix/*"]');
    await until(() => bySubject('Fix crash on startup') && commitsOnly().length === total, 10000, 'hotfix back');
    assert.deepEqual(cfg().get('hiddenBranches'), []);
    await click('#branchbtn');
    await cfg().update('hiddenBranches', undefined, vscode.ConfigurationTarget.Global);
  });

  await check('compare a commit with the working tree', async () => {
    const a = bySubject('Initial commit');
    await panel.testMessage({ type: 'details', sha: a.sha, compare: '*' });
    const d = panel.lastDetails;
    assert.equal(d.from, a.sha);
    assert.equal(d.to, null, 'right side is the working tree');
    assert.ok(d.files.some((f) => f.path === 'README.md' && f.status === 'M'), JSON.stringify(d.files));
  });

  await check('file actions: open at a revision, diff with the working tree, copy paths, file history', async () => {
    const c = bySubject('Add search index');
    await panel.testMessage({ type: 'fileAction', act: 'openAt', ref: c.sha, path: 'search.txt' });
    const ed = await until(() => { const e = vscode.window.activeTextEditor; return e && e.document.uri.scheme === 'mergeline' && JSON.parse(e.document.uri.query).ref === c.sha && e; }, 10000, 'editor at revision');
    assert.equal(ed.document.getText(), 'Add search index\n');
    const first = bySubject('Initial commit');
    await panel.testMessage({ type: 'fileAction', act: 'diffWorking', ref: first.sha, path: 'README.md' });
    const tab = await until(() => { const t = vscode.window.tabGroups.activeTabGroup.activeTab; return t && t.input instanceof vscode.TabInputTextDiff && t; }, 10000, 'diff tab');
    assert.equal(tab.input.original.scheme, 'mergeline');
    assert.equal(fs.realpathSync(tab.input.modified.fsPath), fs.realpathSync(root + '/README.md'));
    await panel.testMessage({ type: 'fileAction', act: 'copyPath', ref: null, path: 'parser.txt' });
    assert.equal(await vscode.env.clipboard.readText(), 'parser.txt');
    await panel.testMessage({ type: 'fileAction', act: 'copyAbs', ref: null, path: '../outside.txt' });
    assert.equal(await vscode.env.clipboard.readText(), 'parser.txt', 'a path outside the repository is ignored');
    await panel.testMessage({ type: 'fileAction', act: 'copyAbs', ref: null, path: 'parser.txt' });
    assert.equal(await vscode.env.clipboard.readText(), require('path').join(panel.repoRoot, 'parser.txt'));
    await panel.testMessage({ type: 'fileAction', act: 'history', ref: c.sha, path: 'search.txt' });
    await until(() => panel.lastData.names[0] === 'search.txt' && panel.lastData.commits.every((x) => x.kind === 'commit'), 10000, 'file history from the details pane');
    await panel.testMessage({ type: 'filter', branch: '', remotes: true, path: '' });
    await until(() => panel.lastData.commits.filter((x) => x.kind === 'commit').length === 8, 10000, 'full graph again');
  });

  await check('column layout is applied, and kept after the panel is closed and reopened', async () => {
    await panel.testMessage({ type: 'layout', layout: { w: { date: 200, graph: 90 }, hidden: ['hash'], details: null }, echo: true });
    const pong = await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(200); return panel.lastPong && panel.lastPong.cols && panel.lastPong.cols.date === 200 && panel.lastPong; }, 10000, 'layout applied');
    assert.equal(pong.cols.hash, 0, 'hash column hidden');
    assert.equal(pong.cols.graph, 90);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await until(() => !api.panel(), 10000, 'panel closed');
    await vscode.commands.executeCommand('mergeline.show');
    panel = await until(() => api.panel() && api.panel().lastData && api.panel(), 20000, 'reopened');
    const p2 = await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(200); return panel.lastPong && panel.lastPong.rows > 0 && panel.lastPong; }, 20000, 'reopened pong');
    assert.deepEqual([p2.cols.date, p2.cols.hash, p2.cols.graph], [200, 0, 90], JSON.stringify(p2.cols));
    await panel.testMessage({ type: 'layout', layout: null, echo: true });
    const p3 = await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(200); return panel.lastPong && panel.lastPong.cols && panel.lastPong.cols.date === 120 && panel.lastPong; }, 10000, 'layout reset');
    assert.equal(p3.cols.hash, 76);
  });

  await check('GitHub remote: details link to the commit page, issue refs and URLs in messages are links', async () => {
    git('remote', 'add', 'gh', 'git@github.com:plainbyte/demo.git');
    fs.writeFileSync(root + '/links.txt', 'x\n');
    git('add', 'links.txt');
    git('commit', '-q', '-m', 'Link test, fixes #42', '-m', 'See https://example.com/doc. Not an issue: a#1');
    const sha = git('rev-parse', 'HEAD');
    await panel.refresh(true);
    await until(() => panel.lastData.web && panel.lastData.commits.some((c) => c.sha === sha), 10000, 'web info');
    assert.equal(panel.lastData.web.commit, 'https://github.com/plainbyte/demo/commit/');
    await panel.testPost({ type: 'reveal', sha });
    const pong = await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(200); return panel.lastPong && panel.lastPong.links && panel.lastPong.links.length >= 3 && panel.lastPong; }, 10000, 'links in details');
    assert.deepEqual(pong.links.sort(), ['https://example.com/doc', 'https://github.com/plainbyte/demo/commit/' + sha, 'https://github.com/plainbyte/demo/issues/42'].sort());
    git('reset', '-q', 'HEAD~1');
    fs.unlinkSync(root + '/links.txt');
    git('remote', 'remove', 'gh');
    await panel.refresh(true);
    await until(() => !panel.lastData.web && !panel.lastData.commits.some((c) => c.sha === sha), 10000, 'cleaned up');
  });

  const act = async (m) => { await panel.testMessage({ type: 'action', ...m }); };

  await check('stash pop applies the stash and removes it', async () => {
    git('checkout', '--', 'README.md');
    await act({ action: 'stashPop', stashRef: 'stash@{0}' });
    assert.equal(git('stash', 'list'), '');
    assert.equal(fs.readFileSync(root + '/README.md', 'utf8'), 'stashed work\n');
    git('checkout', '--', 'README.md');
    fs.unlinkSync(root + '/notes.txt');
  });

  await check('checkout branch, then back', async () => {
    await act({ action: 'checkoutBranch', ref: 'feature/search', refType: 'head' });
    assert.equal(git('branch', '--show-current'), 'feature/search');
    await until(() => panel.lastData.state.branch === 'feature/search', 5000, 'graph shows new branch');
    await act({ action: 'checkoutBranch', ref: 'main', refType: 'head' });
    assert.equal(git('branch', '--show-current'), 'main');
  });

  await check('cherry-pick a commit from another branch, then revert it', async () => {
    const c = bySubject('Fix crash on startup');
    await act({ action: 'cherryPick', sha: c.sha, parents: c.parents, subject: c.subject });
    assert.equal(git('log', '-1', '--format=%s'), 'Fix crash on startup');
    const head = git('rev-parse', 'HEAD');
    await act({ action: 'revert', sha: head, parents: [c.parents[0]], subject: c.subject });
    assert.equal(git('log', '-1', '--format=%s'), 'Revert "Fix crash on startup"');
    await until(() => panel.lastData.commits.some((x) => x.subject === 'Revert "Fix crash on startup"'), 5000, 'graph refreshed');
  });

  await check('copy hash writes to the clipboard', async () => {
    const c = bySubject('Initial commit');
    await act({ action: 'copyHash', sha: c.sha });
    assert.equal(await vscode.env.clipboard.readText(), c.sha);
  });

  await check('find "path:": the webview waits for Enter, then searches the whole history for commits that changed matching paths', async () => {
    const expect = git('log', '--format=%H', '--branches', '--tags', '--remotes', 'HEAD', '--', 'parser.txt', 'src.txt').split('\n').filter(Boolean).sort();
    assert.ok(expect.length >= 1);
    await panel.testMessage({ type: 'searchHistory', q: 'path:PARSER' });
    const h = panel.lastHistory;
    assert.equal(h.q, 'path:PARSER');
    // parser.txt itself (not src.txt: the name differs), case-insensitive.
    const parserOnly = git('log', '--format=%H', '--branches', '--tags', '--remotes', 'HEAD', '--', 'parser.txt').split('\n').filter(Boolean).sort();
    assert.deepEqual(h.matches.map((m) => m.sha).sort(), parserOnly);
    const pong = async (pred, what) => until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && pred(panel.lastPong) && panel.lastPong; }, 10000, what);
    await panel.testPost({ type: 'find', q: 'path:parser' });
    await pong((p) => p.count === 'Enter: search history', 'hint before Enter');
    await panel.testPost({ type: 'find', q: 'path:parser', enter: true });
    const p = await pong((p) => /in history/.test(p.count), 'history count after Enter');
    assert.equal(p.count, `1/${parserOnly.length} in history`);
    assert.ok(parserOnly.includes(p.selected), 'first match selected');
    await panel.testPost({ type: 'find', q: '' });
  });

  await check('details: tags on a commit with tagger and message (annotated) or marked lightweight', async () => {
    const sha = git('rev-parse', 'v1.0.0^{commit}');
    await panel.testMessage({ type: 'details', sha });
    const t = (panel.lastDetails.tags || []).find((x) => x.name === 'v1.0.0');
    assert.ok(t && t.annotated, JSON.stringify(panel.lastDetails.tags));
    assert.equal(t.message, 'Release 1.0.0');
    const light = git('rev-parse', 'v0.1.0^{commit}');
    await panel.testMessage({ type: 'details', sha: light });
    assert.deepEqual(panel.lastDetails.tags, [{ name: 'v0.1.0', annotated: false }]);
    await panel.testPost({ type: 'reveal', sha });
    await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && panel.lastPong.tagBlocks.some((b) => /v1\.0\.0.*Annotated tag by .*Release 1\.0\.0/.test(b)); }, 10000, 'webview shows the annotated tag');
  });

  await check('issue links setting: matches in the message become links; invalid rules are skipped', async () => {
    const cfg = () => vscode.workspace.getConfiguration('mergeline');
    await cfg().update('issueLinks', [{ pattern: '(src)\\.txt', url: 'https://issues.example.com/$1?k=$0' }, { pattern: '(', url: 'https://bad' }], vscode.ConfigurationTarget.Workspace);
    const c = bySubject('Rename src.txt to parser.txt');
    await sleep(500);
    await panel.testPost({ type: 'reveal', sha: c.sha });
    const p = await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && panel.lastPong.selected === c.sha && panel.lastPong.links.length && panel.lastPong; }, 10000, 'issue link in details');
    assert.deepEqual(p.links, ['https://issues.example.com/src?k=src.txt']);
    await cfg().update('issueLinks', undefined, vscode.ConfigurationTarget.Workspace);
    await until(async () => { panel.lastPong = null; await panel.testPost({ type: 'reveal', sha: c.sha }); await panel.ping(); await sleep(200); return panel.lastPong && panel.lastPong.links.length === 0; }, 10000, 'link gone when the setting is removed');
  });

  await check('avatars: off by default (no images, no initials); on shows one per commit row', async () => {
    const cfg = () => vscode.workspace.getConfiguration('mergeline');
    await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && panel.lastPong.avatars === 0; }, 10000, 'no avatars by default');
    await cfg().update('showAvatars', true, vscode.ConfigurationTarget.Workspace);
    await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && panel.lastPong.avatars > 5; }, 10000, 'avatars shown');
    await cfg().update('showAvatars', undefined, vscode.ConfigurationTarget.Workspace);
    await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && panel.lastPong.avatars === 0; }, 10000, 'avatars off again');
  });

  // Actions that prompt: stub the prompts in this API instance. If the extension
  // gets its own API object the stubs do not reach it; then these are skipped.
  const w = vscode.window;
  const orig = { input: w.showInputBox, pick: w.showQuickPick, warn: w.showWarningMessage };
  let stubbed = false;
  try {
    w.showInputBox = async () => 'release/2';
    w.showQuickPick = async (items) => { const arr = await items; return arr.find((i) => (i.label || i) === 'Create only' || (i.label || i) === 'Hard' || (i.label || i) === 'Merge with a merge commit') || arr[0]; };
    w.showWarningMessage = async (msg, opts, ...btns) => (opts && opts.modal ? btns[0] : undefined);
    stubbed = true;
  } catch { stubbed = false; }
  if (stubbed) {
    await check('create branch (prompted) creates it without checkout', async () => {
      const c = bySubject('Initial commit');
      const p = act({ action: 'createBranch', sha: c.sha, subject: c.subject });
      await Promise.race([p, sleep(5000).then(() => { throw new Error('prompt stubs did not reach the extension (separate API object)'); })]);
      assert.equal(git('rev-parse', 'release/2'), c.sha);
      assert.equal(git('branch', '--show-current'), 'main');
    });
    await check('merge branch with --no-ff (prompted)', async () => {
      await act({ action: 'merge', ref: 'hotfix/crash' });
      assert.equal(git('log', '-1', '--format=%P').split(' ').length, 2);
    });
    await check('hard reset (prompted + modal confirm)', async () => {
      const target = bySubject('Rename src.txt to parser.txt');
      await act({ action: 'reset', sha: target.sha });
      assert.equal(git('rev-parse', 'HEAD'), target.sha);
    });
    await check('delete branch (modal confirm)', async () => {
      await act({ action: 'deleteBranch', ref: 'release/2', refType: 'head' });
      assert.equal(git('branch', '--list', 'release/2'), '');
    });
    await check('delete tag locally', async () => {
      await act({ action: 'deleteTag', ref: 'v0.1.0' });
      assert.equal(git('tag', '--list', 'v0.1.0'), '');
    });

    await check('drag and drop: changes since the merge base, rebase a branch onto another, merge into a non-current branch, move a branch', async () => {
      const wf = (f, t) => fs.writeFileSync(root + '/' + f, t);
      const forkSha = git('rev-parse', 'HEAD');
      git('checkout', '-q', '-b', 'dd/topic');
      wf('dd.txt', 'topic\n'); git('add', 'dd.txt'); git('commit', '-q', '-m', 'DD topic work');
      git('checkout', '-q', 'main');
      wf('main-dd.txt', 'main\n'); git('add', 'main-dd.txt'); git('commit', '-q', '-m', 'DD main work');
      await panel.refresh(true);
      const topic = git('rev-parse', 'dd/topic'), main = git('rev-parse', 'main');
      await panel.testMessage({ type: 'details', sha: topic, compare: main, base: true });
      const d = panel.lastDetails;
      assert.equal(d.base, true);
      assert.equal(d.mergeBase, forkSha);
      assert.deepEqual(d.files.map((f) => f.path), ['dd.txt']);
      // Rebase dd/topic (not checked out) onto main.
      await act({ action: 'rebaseBranch', ref: 'dd/topic', target: 'main' });
      assert.equal(git('merge-base', 'main', 'dd/topic'), main, 'dd/topic now sits on main');
      assert.equal(git('log', '-1', '--format=%s', 'dd/topic'), 'DD topic work');
      git('checkout', '-q', 'main');
      git('branch', 'dd/target', 'main');
      await panel.refresh(true);
      // Merge dd/topic into dd/target, which is not the current branch (stub picks --no-ff).
      await act({ action: 'mergeInto', ref: 'dd/topic', target: 'dd/target' });
      assert.equal(git('branch', '--show-current'), 'dd/target');
      assert.equal(git('log', '-1', '--format=%P', 'dd/target').split(' ').length, 2);
      git('checkout', '-q', 'main');
      await panel.refresh(true);
      await act({ action: 'moveBranch', ref: 'dd/target', sha: forkSha });
      assert.equal(git('rev-parse', 'dd/target'), forkSha);
      git('branch', '-q', '-D', 'dd/topic', 'dd/target');
      await panel.refresh(true);
    });

    await check('edit history: menu only on the linear part of HEAD; reword (+undo), squash into parent, squash a range, drop; refuses a merge', async () => {
      const wf = (f, t) => fs.writeFileSync(root + '/' + f, t);
      for (const s of ['E1', 'E2', 'E3']) { wf(s + '.txt', s + '\n'); git('add', s + '.txt'); git('commit', '-q', '-m', 'Edit ' + s); }
      await panel.refresh(true);
      const sha = (s) => panel.lastData.commits.find((c) => c.subject === s).sha;
      const editMenu = async (s) => {
        await panel.testPost({ type: 'reveal', sha: s });
        return (await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && panel.lastPong.selected === s && panel.lastPong; }, 10000, 'pong')).editMenu;
      };
      assert.deepEqual(await editMenu(sha('Edit E2')), ['Edit commit message…', 'Move commit up (newer)', 'Move commit down (older)', 'Squash into parent', 'Stop at this commit to change it…', 'Create fixup commit for this', 'Drop commit…']);
      const merge = panel.lastData.commits.find((c) => c.parents.length > 1 && c.kind === 'commit');
      assert.deepEqual(await editMenu(merge.sha), [], 'no edit items on a merge');
      // Reword an older commit; uncommitted changes survive (autostash).
      const before = git('rev-parse', 'HEAD');
      const readme0 = fs.readFileSync(root + '/README.md', 'utf8');
      wf('README.md', 'dirty\n'); wf('edit-untracked.txt', 'u\n');
      await act({ action: 'reword', sha: sha('Edit E2'), subject: 'Edit E2', message: 'Edit E2, reworded' });
      assert.deepEqual(git('log', '-3', '--format=%s').split('\n'), ['Edit E3', 'Edit E2, reworded', 'Edit E1']);
      assert.equal(fs.readFileSync(root + '/README.md', 'utf8'), 'dirty\n', 'dirty file kept');
      assert.ok(fs.existsSync(root + '/edit-untracked.txt'), 'untracked file kept');
      const after = git('rev-parse', 'HEAD');
      await act({ action: 'undoRewrite', sha: before, target: after });
      assert.equal(git('rev-parse', 'HEAD'), before, 'undo restores the old HEAD');
      await panel.refresh(true);
      // Squash E3 into E2 (keeps E2's message).
      await act({ action: 'fixupCommit', sha: sha('Edit E3'), subject: 'Edit E3' });
      assert.deepEqual(git('log', '-2', '--format=%s').split('\n'), ['Edit E2', 'Edit E1']);
      assert.equal(git('show', '--format=', '--name-only', 'HEAD'), 'E2.txt\nE3.txt');
      await panel.refresh(true);
      // Ctrl-click selection E1 + E2 → the squash item appears; squash them.
      await panel.testPost({ type: 'reveal', sha: sha('Edit E1') });
      await sleep(200);
      const e1 = sha('Edit E1'), e2 = sha('Edit E2');
      await act({ action: 'squashRange', sha: e1, target: e2, message: 'Edit E squashed' });
      assert.equal(git('log', '-1', '--format=%B'), 'Edit E squashed\n\n* Edit E1\n* Edit E2');
      assert.equal(git('show', '--format=', '--name-only', 'HEAD'), 'E1.txt\nE2.txt\nE3.txt');
      await panel.refresh(true);
      // Drop it again.
      const parent = git('rev-parse', 'HEAD~1');
      await act({ action: 'dropCommit', sha: sha('Edit E squashed'), subject: 'Edit E squashed' });
      assert.equal(git('rev-parse', 'HEAD'), parent);
      assert.ok(!fs.existsSync(root + '/E1.txt'));
      // Refused: a merge commit (HEAD unchanged, no rebase started).
      await act({ action: 'dropCommit', sha: merge.sha });
      assert.equal(git('rev-parse', 'HEAD'), parent);
      assert.equal(git('status', '--porcelain', '--untracked-files=no'), 'M README.md');
      wf('README.md', readme0); fs.rmSync(root + '/edit-untracked.txt');
      await panel.refresh(true);
    });

    await check('message editor, move up/down, and a stopped rebase/merge in the bar: continue, skip, abort', async () => {
      const wf = (f, t) => fs.writeFileSync(root + '/' + f, t);
      const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); };
      wf('m.txt', '0\n'); commit('Move M0');
      wf('m.txt', '1\n'); commit('Move M1');
      wf('m.txt', '2\n'); commit('Move M2');
      wf('n.txt', 'n\n'); commit('Move M3');
      await panel.refresh(true);
      const sha = (s) => panel.lastData.commits.find((c) => c.subject === s).sha;
      const pong = async (pred, what) => until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && pred(panel.lastPong) && panel.lastPong; }, 10000, what);
      const start = git('rev-parse', 'HEAD');
      // The message editor opens in the webview with the subject and body split.
      git('commit', '--amend', '-q', '-m', 'Move M3', '-m', 'Body line one.\nBody line two.');
      await panel.refresh(true);
      await panel.testMessage({ type: 'getMessage', sha: sha('Move M3') });
      const p1 = await pong((p) => p.dialog, 'dialog');
      assert.deepEqual(p1.dialog, { title: 'Edit message of ' + sha('Move M3').slice(0, 8), subject: 'Move M3', body: 'Body line one.\nBody line two.' });
      // Saving sends the whole message: subject and body both change (an older commit, so a rebase).
      await act({ action: 'reword', sha: sha('Move M2'), subject: 'Move M2', fullMessage: 'Move M2 (edited)\n\nWhy: a multi-line\nbody.\n\n' });
      assert.equal(git('log', '-1', '--format=%B', 'HEAD~1'), 'Move M2 (edited)\n\nWhy: a multi-line\nbody.');
      assert.equal(git('log', '-1', '--format=%B', 'HEAD'), 'Move M3\n\nBody line one.\nBody line two.');
      await panel.refresh(true);
      // Move M3 (only n.txt) down below M2, then back up: no conflicts.
      await act({ action: 'moveCommit', sha: sha('Move M3'), dir: 'older' });
      assert.deepEqual(git('log', '-3', '--format=%s').split('\n'), ['Move M2 (edited)', 'Move M3', 'Move M1']);
      await panel.refresh(true);
      await act({ action: 'moveCommit', sha: sha('Move M3'), dir: 'newer' });
      assert.deepEqual(git('log', '-3', '--format=%s').split('\n'), ['Move M3', 'Move M2 (edited)', 'Move M1']);
      await panel.refresh(true);
      // Move M2 below M1: both edit m.txt, so the rebase stops. The bar shows it, edit items hide.
      const beforeMove = git('rev-parse', 'HEAD');
      await act({ action: 'moveCommit', sha: sha('Move M2 (edited)'), dir: 'older' });
      await panel.refresh(true);
      assert.equal(panel.lastData.op.kind, 'rebase');
      assert.deepEqual(panel.lastData.op.conflicts, ['m.txt']);
      let p2 = await pong((p) => p.opbar, 'opbar');
      assert.match(p2.opbar, /Rebasing main onto .* step 1 of 3, stopped at .*Move M2 \(edited\).*1 conflicted file/);
      assert.match(p2.opbar, /Continue.*Skip.*Abort.*Source Control/);
      // Continue is refused while m.txt is unmerged.
      await act({ action: 'opContinue' });
      assert.ok(fs.existsSync(root + '/.git/rebase-merge'), 'still rebasing');
      // Resolve, continue: the next commit (M1) conflicts too, and the bar moves to step 2.
      wf('m.txt', '2\n'); git('add', 'm.txt');
      await act({ action: 'opContinue' });
      await panel.refresh(true);
      p2 = await pong((p) => /step 2 of 3/.test(p.opbar), 'opbar step 2');
      assert.match(p2.opbar, /Move M1/);
      assert.deepEqual(p2.editMenu, [], 'no edit items while a rebase is in progress');
      // Skip M1: the rest applies and the rebase ends.
      await act({ action: 'opSkip' });
      await panel.refresh(true);
      assert.equal(panel.lastData.op, null);
      assert.ok(!fs.existsSync(root + '/.git/rebase-merge'));
      assert.deepEqual(git('log', '-3', '--format=%s').split('\n'), ['Move M3', 'Move M2 (edited)', 'Move M0']);
      await pong((p) => p.opbar === '', 'bar gone');
      // A merge started in a terminal shows too; Abort puts it back.
      git('reset', '-q', '--hard', beforeMove);
      git('checkout', '-q', '-b', 'move-side', sha('Move M0'));
      wf('m.txt', 'side\n'); commit('Move side');
      git('checkout', '-q', 'main');
      try { git('merge', '--no-edit', 'move-side'); } catch {}
      await panel.refresh(true);
      const p3 = await pong((p) => /Merging/.test(p.opbar), 'merge bar');
      assert.match(p3.opbar, /Merging move-side into main.*1 conflicted file/);
      assert.ok(!/Skip/.test(p3.opbar), 'no Skip for a merge');
      // The conflicted file is listed by name; a real click on it opens VS Code's merge editor for it.
      assert.match(p3.opbar, /conflicted file:\s*m\.txt/);
      panel.testPost({ type: 'click', selector: '#opbar .op-file' });
      const tab = await until(() => { const t = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((x) => x.input instanceof vscode.TabInputTextMerge); return t; }, 15000, 'merge editor tab');
      assert.equal(fs.realpathSync(tab.input.result.fsPath), fs.realpathSync(root + '/m.txt'));
      await vscode.window.tabGroups.close(tab);
      await act({ action: 'opAbort' });
      assert.ok(!fs.existsSync(root + '/.git/MERGE_HEAD'));
      assert.equal(git('rev-parse', 'HEAD'), beforeMove);
      // Leave the repo as it was for the later checks.
      git('reset', '-q', '--hard', start);
      git('branch', '-q', '-D', 'move-side');
      await panel.refresh(true);
    });

    await check('stop at a commit to change it: the bar shows the stop, Continue amends it with the staged change', async () => {
      const wf = (f, t) => fs.writeFileSync(root + '/' + f, t);
      wf('stop1.txt', 'one\n'); git('add', '-A'); git('commit', '-q', '-m', 'Stop S1');
      wf('stop2.txt', 'two\n'); git('add', '-A'); git('commit', '-q', '-m', 'Stop S2');
      await panel.refresh(true);
      const s1 = git('rev-parse', 'HEAD~1');
      await act({ action: 'editCommit', sha: s1, subject: 'Stop S1', current: 'main' });
      await panel.refresh(true);
      assert.equal(panel.lastData.op && panel.lastData.op.kind, 'rebase');
      assert.equal(panel.lastData.op.stopped, s1);
      const p = await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && panel.lastPong.opbar && panel.lastPong; }, 10000, 'bar');
      assert.match(p.opbar, /stopped at .*Stop S1/);
      wf('stop1.txt', 'one, changed\n'); git('add', 'stop1.txt');
      await act({ action: 'opContinue' });
      await panel.refresh(true);
      assert.equal(panel.lastData.op, null);
      assert.deepEqual(git('log', '-2', '--format=%s').split('\n'), ['Stop S2', 'Stop S1']);
      assert.equal(git('show', 'HEAD~1:stop1.txt'), 'one, changed');
    });

    await check('fixup commit from the commit menu (stages tracked changes when nothing is staged), then squash fixups into their targets', async () => {
      const wf = (f, t) => fs.writeFileSync(root + '/' + f, t);
      wf('fx1.txt', 'one\n'); git('add', '-A'); git('commit', '-q', '-m', 'Fix F1');
      wf('fx2.txt', 'two\n'); git('add', '-A'); git('commit', '-q', '-m', 'Fix F2');
      await panel.refresh(true);
      const f1 = git('rev-parse', 'HEAD~1');
      const menuOf = async (s) => {
        await panel.testPost({ type: 'reveal', sha: s });
        return (await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && panel.lastPong.selected === s && panel.lastPong; }, 10000, 'pong')).editMenu;
      };
      assert.ok((await menuOf(f1)).includes('Create fixup commit for this'));
      assert.ok(!(await menuOf(f1)).some((l) => /fixup commits? into/.test(l)), 'no squash-fixups item before there is one');
      // Nothing staged, nothing changed: refused, no commit.
      const before = git('rev-parse', 'HEAD');
      await act({ action: 'createFixup', sha: f1, subject: 'Fix F1', current: 'main' });
      assert.equal(git('rev-parse', 'HEAD'), before, 'no fixup without changes');
      // An unstaged change to a tracked file plus an untracked file: the (stubbed) dialog stages tracked changes only.
      wf('fx1.txt', 'one, fixed\n'); wf('fx-untracked.txt', 'keep me out\n');
      await act({ action: 'createFixup', sha: f1, subject: 'Fix F1', current: 'main' });
      assert.equal(git('log', '-1', '--format=%s'), 'fixup! Fix F1');
      assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').split('\n'), ['fx1.txt']);
      await panel.refresh(true);
      assert.ok((await menuOf(f1)).includes('Squash 1 fixup commit into its target…'));
      await act({ action: 'autosquash', current: 'main' });
      assert.deepEqual(git('log', '-3', '--format=%s').split('\n').slice(0, 2), ['Fix F2', 'Fix F1']);
      assert.equal(git('show', 'HEAD~1:fx1.txt'), 'one, fixed');
      assert.equal(fs.readFileSync(root + '/fx-untracked.txt', 'utf8'), 'keep me out\n', 'untracked file left alone');
      fs.rmSync(root + '/fx-untracked.txt');
      await panel.refresh(true);
    });

    await check('drag a commit: move it after another, squash it into another; branch checklist; dim other commits', async () => {
      const wf = (f, t) => fs.writeFileSync(root + '/' + f, t);
      const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); };
      const start = git('rev-parse', 'HEAD');
      wf('p1.txt', '1\n'); commit('Place P1');
      wf('p2.txt', '2\n'); commit('Place P2');
      wf('p3.txt', '3\n'); commit('Place P3');
      await panel.refresh(true);
      const sha = (s) => panel.lastData.commits.find((c) => c.subject === s).sha;
      const pong = async (pred, what) => until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && pred(panel.lastPong) && panel.lastPong; }, 10000, what);
      // Move P3 (HEAD) to right after P1; P1 keeps its hash.
      const p1 = sha('Place P1');
      await act({ action: 'placeCommit', sha: sha('Place P3'), target: p1, fold: false, subject: 'Place P3', current: 'main' });
      assert.deepEqual(git('log', '-3', '--format=%s').split('\n'), ['Place P2', 'Place P3', 'Place P1']);
      assert.equal(git('rev-parse', 'HEAD~2'), p1);
      await panel.refresh(true);
      // Squash P2 (HEAD) into P1, two commits down: P1 keeps its message and gains p2.txt.
      await act({ action: 'placeCommit', sha: sha('Place P2'), target: p1, fold: true, subject: 'Place P2', current: 'main' });
      assert.deepEqual(git('log', '-2', '--format=%s').split('\n'), ['Place P3', 'Place P1']);
      assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD~1').split('\n').sort(), ['p1.txt', 'p2.txt']);
      git('reset', '-q', '--hard', start);
      await panel.refresh(true);
      // Branch checklist: two branches show exactly their union.
      const all = panel.lastData.commits.filter((c) => c.kind === 'commit').length;
      await panel.testMessage({ type: 'filter', branches: ['hotfix/crash', 'feature/search'], remotes: true });
      const want = Number(git('rev-list', '--count', 'hotfix/crash', 'feature/search'));
      assert.equal(panel.lastData.commits.filter((c) => c.kind === 'commit').length, want);
      assert.ok(want < all, `filtered ${want} < all ${all}`);
      await pong((p) => p.branchBtn === '2 branches', 'toolbar shows 2 branches');
      await panel.testMessage({ type: 'filter', branches: [], remotes: true });
      assert.equal(panel.lastData.commits.filter((c) => c.kind === 'commit').length, all);
      await pong((p) => p.branchBtn === 'All', 'toolbar shows All');
      // Dim commits outside HEAD's history.
      const outside = Number(git('rev-list', '--count', '--branches', '--tags', '--not', 'HEAD'));
      assert.ok(outside > 0, 'fixture has commits off HEAD');
      await vscode.workspace.getConfiguration('mergeline').update('dimOtherCommits', true, vscode.ConfigurationTarget.Global);
      await panel.testPost({ type: 'reveal', sha: git('rev-parse', 'feature/search') });
      const pd = await pong((p) => p.dimmed > 0, 'dimmed rows');
      assert.ok(pd.dimmed <= outside + 1, `dimmed ${pd.dimmed}, outside ${outside}`);
      await vscode.workspace.getConfiguration('mergeline').update('dimOtherCommits', undefined, vscode.ConfigurationTarget.Global);
      await pong((p) => p.dimmed === 0, 'dimming off');
    });

    await check('worktrees: add one for a branch, its badge shows in the graph, remove it', async () => {
      const wt = root + '-wt';
      const prevInput = w.showInputBox;
      w.showInputBox = async () => wt;
      try {
        await act({ action: 'addWorktree', ref: 'feature/search', refType: 'head' });
      } finally { w.showInputBox = prevInput; }
      assert.ok(fs.existsSync(wt + '/.git'), 'worktree folder');
      assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: wt, encoding: 'utf8' }).trim(), 'feature/search');
      await until(() => panel.lastData.worktrees.some((x) => x.branch === 'feature/search' && !x.current && x.head === git('rev-parse', 'feature/search')), 10000, 'worktree in graph data');
      assert.ok(panel.lastData.worktrees.some((x) => x.current && x.branch === 'main'));
      await panel.testPost({ type: 'reveal', sha: git('rev-parse', 'feature/search') });
      const pong = await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(200); return panel.lastPong && panel.lastPong.wtBadges && panel.lastPong.wtBadges.length && panel.lastPong; }, 10000, 'worktree badge');
      assert.deepEqual(pong.wtBadges, [require('path').basename(wt)]);
      await act({ action: 'removeWorktree', path: wt });
      assert.ok(!fs.existsSync(wt), 'worktree folder removed');
      await until(() => panel.lastData.worktrees.length === 0, 10000, 'worktree gone from graph data');
    });

    // Real remote: a bare repository next to the workspace.
    const bare = root + '-remote.git';
    const lsRemote = (ref) => (git('ls-remote', 'origin', ref).split('\t')[0] || '');
    await check('remote: push branch sets upstream, push tag', async () => {
      execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
      git('remote', 'add', 'origin', bare);
      await act({ action: 'pushBranch', ref: 'main', refType: 'head' });
      assert.equal(lsRemote('refs/heads/main'), git('rev-parse', 'HEAD'));
      assert.equal(git('rev-parse', '--abbrev-ref', 'main@{upstream}'), 'origin/main');
      await act({ action: 'pushTag', ref: 'v1.0.0' });
      assert.ok(lsRemote('refs/tags/v1.0.0'), 'tag on remote');
    });
    await check('remote: fetch shows a new remote commit, pull fast-forwards', async () => {
      const other = root + '-other';
      execFileSync('git', ['clone', '-q', '-b', 'main', bare, other]);
      const og = (...a) => execFileSync('git', a, { cwd: other, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Grace', GIT_AUTHOR_EMAIL: 'g@example.com', GIT_COMMITTER_NAME: 'Grace', GIT_COMMITTER_EMAIL: 'g@example.com' } }).trim();
      fs.writeFileSync(other + '/remote.txt', 'from elsewhere\n');
      og('add', '-A');
      og('commit', '-q', '-m', 'Commit pushed from another clone');
      og('push', '-q', 'origin', 'main');
      const theirs = og('rev-parse', 'HEAD');
      await act({ action: 'fetch' });
      await until(() => git('rev-parse', 'origin/main') === theirs, 10000, 'origin/main updated');
      await until(() => panel.lastData.state.refs.some((r) => r.name === 'origin/main' && r.sha === theirs), 10000, 'graph shows fetched commit');
      await act({ action: 'pull', ref: 'main', refType: 'head' });
      await until(() => git('rev-parse', 'HEAD') === theirs, 10000, 'pull fast-forwarded');
      fs.rmSync(other, { recursive: true, force: true });
    });
    await check('remote: ahead/behind on a branch badge, update a branch that is not checked out, fetch and merge a remote branch into the current one', async () => {
      const other = root + '-other2';
      execFileSync('git', ['clone', '-q', '-b', 'main', bare, other]);
      const og = (...a) => execFileSync('git', a, { cwd: other, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Grace', GIT_AUTHOR_EMAIL: 'g@example.com', GIT_COMMITTER_NAME: 'Grace', GIT_COMMITTER_EMAIL: 'g@example.com' } }).trim();
      og('config', 'commit.gpgsign', 'false');
      git('branch', 'trk', 'main');
      git('push', '-q', '-u', 'origin', 'trk');
      og('fetch', '-q', 'origin');
      og('checkout', '-q', '-b', 'trk', 'origin/trk');
      fs.writeFileSync(other + '/trk.txt', '1\n');
      og('add', '-A'); og('commit', '-q', '-m', 'trk 1');
      fs.writeFileSync(other + '/trk.txt', '2\n');
      og('add', '-A'); og('commit', '-q', '-m', 'trk 2');
      og('push', '-q', 'origin', 'trk');
      const theirs = og('rev-parse', 'HEAD');
      await act({ action: 'fetch' });
      const ref = await until(() => panel.lastData.state.refs.find((r) => r.name === 'trk' && r.behind === 2), 10000, 'trk behind 2');
      assert.deepEqual([ref.upstream, ref.ahead], ['origin/trk', 0]);
      await panel.testPost({ type: 'reveal', sha: ref.sha });
      const pong = await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && panel.lastPong.trk.includes('trk ↓2') && panel.lastPong; }, 10000, 'badge shows ↓2')
        .catch(async (e) => { panel.lastPong = null; await panel.ping(); await sleep(300); throw new Error(e.message + ' trk=' + JSON.stringify(panel.lastPong && panel.lastPong.trk)); });
      assert.ok(pong.trk.includes('trk ↓2'), pong.trk.join(' | '));
      const head0 = git('rev-parse', 'HEAD');
      await act({ action: 'updateBranch', ref: 'trk', refType: 'head', upstream: 'origin/trk' });
      assert.equal(git('rev-parse', 'trk'), theirs, 'trk fast-forwarded');
      assert.equal(git('rev-parse', 'HEAD'), head0, 'current branch untouched');
      assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main');
      await until(() => panel.lastData.state.refs.some((r) => r.name === 'trk' && r.behind === 0 && r.sha === theirs), 10000, 'badge cleared');
      // A remote branch that was pushed after our last fetch: fetch it, then merge it (--no-ff via the pick stub).
      og('checkout', '-q', '-b', 'side2', 'origin/main');
      fs.writeFileSync(other + '/side2.txt', 's\n');
      og('add', '-A'); og('commit', '-q', '-m', 'side2 work');
      og('push', '-q', 'origin', 'side2');
      git('fetch', '-q', 'origin', 'side2');
      og('commit', '-q', '--allow-empty', '-m', 'side2 later');
      og('push', '-q', 'origin', 'side2');
      const tip = og('rev-parse', 'HEAD');
      assert.notEqual(git('rev-parse', 'origin/side2'), tip, 'local remote-tracking ref is stale');
      await act({ action: 'pullInto', ref: 'origin/side2', refType: 'remote', remote: 'origin', current: 'main' });
      assert.equal(git('rev-parse', 'origin/side2'), tip, 'fetched first');
      assert.equal(git('rev-parse', 'HEAD^2'), tip, 'merged the fetched tip');
      assert.match(git('log', '-1', '--format=%s'), /side2/);
      git('reset', '-q', '--hard', head0);
      git('branch', '-q', '-D', 'trk');
      git('push', '-q', 'origin', '--delete', 'trk', 'side2');
      git('fetch', '-q', '--prune', 'origin');
      fs.rmSync(other, { recursive: true, force: true });
    });
    await check('remote: delete remote branch (modal confirm)', async () => {
      git('push', '-q', 'origin', 'feature/search');
      git('fetch', '-q', 'origin');
      assert.ok(lsRemote('refs/heads/feature/search'));
      await act({ action: 'deleteRemoteBranch', ref: 'origin/feature/search', refType: 'remote', remote: 'origin' });
      assert.equal(lsRemote('refs/heads/feature/search'), '');
    });
    await check('create pull request: forge URL for a tracked local branch and a remote branch (nothing opened under test)', async () => {
      git('remote', 'add', 'gh', 'git@github.com:acme/app.git');
      git('branch', 'pr/topic', 'main');
      git('config', 'branch.pr/topic.remote', 'gh');
      git('config', 'branch.pr/topic.merge', 'refs/heads/pr/topic-remote');
      panel.lastUrl = undefined;
      await panel.testMessage({ type: 'openPullRequest', ref: 'pr/topic', refType: 'head' });
      assert.equal(panel.lastUrl, 'https://github.com/acme/app/compare/pr/topic-remote?expand=1');
      await panel.testMessage({ type: 'openPullRequest', ref: 'gh/fix/x', refType: 'remote', remote: 'gh' });
      assert.equal(panel.lastUrl, 'https://github.com/acme/app/compare/fix/x?expand=1');
      // A remote that is not on a forge opens nothing.
      panel.lastUrl = undefined;
      await panel.testMessage({ type: 'openPullRequest', ref: 'origin/main', refType: 'remote', remote: 'origin' });
      assert.equal(panel.lastUrl, undefined);
      git('branch', '-q', '-D', 'pr/topic');
      git('remote', 'remove', 'gh');
    });
    await check('manage remotes: menu lists remotes; add (+fetch), rename, change URL, refuse a taken name, remove with its branches and upstreams', async () => {
      // The command's first menu: every remote with its URL, plus Add remote…
      let seen = null;
      const prevPick = w.showQuickPick;
      w.showQuickPick = async (items) => { seen = await items; return undefined; };
      try { await vscode.commands.executeCommand('mergeline.manageRemotes'); } finally { w.showQuickPick = prevPick; }
      assert.ok(seen, 'remote menu shown');
      assert.ok(seen.some((i) => /origin/.test(i.label) && i.description === bare), seen.map((i) => i.label + ' ' + i.description).join(' | '));
      assert.ok(seen.some((i) => /Add remote/.test(i.label)));
      // Add with fetch.
      await act({ action: 'manageRemotes', op: 'add', message: 'up', url: bare, fetch: true });
      assert.equal(git('remote', 'get-url', 'up'), bare);
      await until(() => git('for-each-ref', '--format=%(refname)', 'refs/remotes/up/').includes('refs/remotes/up/main'), 10000, 'up/main fetched');
      await until(() => panel.lastData.state.refs.some((r) => r.name === 'up/main'), 10000, 'graph shows up/main');
      // A taken name is refused, nothing changes.
      await act({ action: 'manageRemotes', op: 'add', message: 'origin', url: '/nowhere' });
      assert.equal(git('remote', 'get-url', 'origin'), bare);
      // Rename: remote-tracking branches and upstream settings follow.
      git('branch', '-q', '--track', 'via-up', 'up/main');
      await act({ action: 'manageRemotes', op: 'rename', remote: 'up', message: 'upstream2' });
      assert.deepEqual(git('remote').split('\n').sort(), ['origin', 'upstream2']);
      assert.equal(git('config', 'branch.via-up.remote'), 'upstream2');
      await until(() => panel.lastData.state.refs.some((r) => r.name === 'upstream2/main') && !panel.lastData.state.refs.some((r) => r.name === 'up/main'), 10000, 'graph shows renamed refs');
      // Change URL.
      await act({ action: 'manageRemotes', op: 'setUrl', remote: 'upstream2', url: bare + '/' });
      assert.equal(git('remote', 'get-url', 'upstream2'), bare + '/');
      // Remove (modal confirm stub says yes): its refs and the branch's upstream go, the branch stays.
      await act({ action: 'manageRemotes', op: 'remove', remote: 'upstream2' });
      assert.deepEqual(git('remote').split('\n'), ['origin']);
      assert.equal(git('for-each-ref', 'refs/remotes/upstream2/'), '');
      assert.ok(git('rev-parse', '--verify', 'via-up'));
      assert.throws(() => git('config', 'branch.via-up.remote'));
      await until(() => !panel.lastData.state.refs.some((r) => r.name.startsWith('upstream2/')), 10000, 'graph drops removed refs');
      git('branch', '-q', '-D', 'via-up');
    });
    fs.rmSync(bare, { recursive: true, force: true });
    await check('save as archive: zip and tar.gz of a tag with a folder prefix, tracked files only', async () => {
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mergeline-arch-'));
      const prev = w.showSaveDialog;
      try {
        const sha = git('rev-parse', 'v1.0.0^{commit}');
        w.showSaveDialog = async () => vscode.Uri.file(path.join(out, 'rel.tar.gz'));
        await act({ action: 'archive', sha, ref: 'v1.0.0' });
        const list = execFileSync('tar', ['tzf', path.join(out, 'rel.tar.gz')], { encoding: 'utf8' }).split('\n').filter(Boolean);
        const tracked = git('ls-tree', '-r', '--name-only', sha).split('\n');
        assert.deepEqual(list.filter((f) => !f.endsWith('/')).sort(), tracked.map((f) => 'rel/' + f).sort());
        w.showSaveDialog = async () => vscode.Uri.file(path.join(out, 'snap.zip'));
        await act({ action: 'archive', sha, subject: 'x' });
        assert.equal(fs.readFileSync(path.join(out, 'snap.zip')).subarray(0, 2).toString(), 'PK');
        // Cancelled dialog: nothing written.
        w.showSaveDialog = async () => undefined;
        await act({ action: 'archive', sha });
        assert.deepEqual(fs.readdirSync(out).sort(), ['rel.tar.gz', 'snap.zip']);
      } finally {
        w.showSaveDialog = prev;
        fs.rmSync(out, { recursive: true, force: true });
      }
    });
  }
  await check('details: an SSH-signed commit shows its signature status (unchecked, then good with allowed signers)', async () => {
    const key = path.join(os.tmpdir(), 'mergeline-e2e-key-' + process.pid);
    const allowed = key + '-allowed';
    try {
      execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'e2e', '-f', key]);
      const email = git('log', '-1', '--format=%ce');
      git('-c', 'gpg.format=ssh', '-c', 'user.signingkey=' + key + '.pub', 'commit', '-q', '--allow-empty', '-S', '-m', 'Signed commit');
      const sha = git('rev-parse', 'HEAD');
      await panel.refresh(true);
      await panel.testMessage({ type: 'details', sha });
      assert.equal(panel.lastDetails.signature && panel.lastDetails.signature.status, 'unchecked');
      fs.writeFileSync(allowed, email + ' ' + fs.readFileSync(key + '.pub', 'utf8'));
      git('config', 'gpg.ssh.allowedSignersFile', allowed);
      await panel.testPost({ type: 'reveal', sha });
      await panel.testMessage({ type: 'details', sha });
      assert.equal(panel.lastDetails.signature.status, 'good');
      const pong = await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && /Good signature from/.test(panel.lastPong.detailsText) && panel.lastPong; }, 10000, 'signature line');
      assert.match(pong.detailsText, /✓ Good signature from \S+ SHA256:/);
      // An unsigned commit has no signature line.
      await panel.testMessage({ type: 'details', sha: git('rev-parse', 'HEAD~1') });
      assert.equal(panel.lastDetails.signature, null);
      git('reset', '-q', '--hard', 'HEAD~1');
      git('config', '--unset', 'gpg.ssh.allowedSignersFile');
    } finally {
      for (const f of [key, key + '.pub', allowed]) fs.rmSync(f, { force: true });
    }
  });
  await check('bisect: start from the menu, the bar and badges follow, Good/Bad find the commit, a test command in a terminal finds it too, reset', async () => {
    const pong = async (pred, what) => until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && pred(panel.lastPong) && panel.lastPong; }, 15000, what);
    const stashed = git('status', '--porcelain') !== '';
    if (stashed) git('stash', 'push', '-q', '-u', '-m', 'e2e-bisect');
    try {
      await panel.refresh(true);
      assert.equal(panel.lastData.bisect, null);
      const head = git('rev-parse', 'HEAD');
      const root0 = git('rev-list', '--max-parents=0', 'HEAD').split('\n')[0];
      // The commit that "introduced the bug": the oldest first-parent commit after the root's child.
      const fp = git('rev-list', '--first-parent', '--reverse', 'HEAD').split('\n');
      const culprit = fp[Math.floor(fp.length / 2)];
      const isBad = () => { try { execFileSync('git', ['merge-base', '--is-ancestor', culprit, 'HEAD'], { cwd: root }); return true; } catch { return false; } };
      await panel.testPost({ type: 'reveal', sha: head });
      let p = await pong((x) => x.selected === head && x.commitMenu.length, 'commit menu');
      assert.ok(p.commitMenu.includes('Start bisect: this commit is bad'), p.commitMenu.join(' | '));
      assert.ok(p.commitMenu.includes('Start bisect: this commit is good'));
      await act({ action: 'bisectStart', sha: head, mark: 'bad' });
      await until(() => panel.lastData.bisect && panel.lastData.bisect.bad === head, 10000, 'bisect started');
      p = await pong((x) => /mark a good commit/.test(x.bisectbar), 'waiting bar');
      // During a bisect: the bisect items replace Start, and history editing is hidden.
      p = await pong((x) => x.commitMenu.includes('Bisect: mark as good'), 'bisect menu');
      assert.ok(p.commitMenu.includes('Bisect: mark as bad (disabled)'), p.commitMenu.join(' | '));
      assert.ok(p.commitMenu.includes('Bisect: stop and go back (reset)'));
      assert.ok(!p.commitMenu.some((t) => /Edit commit message|Drop commit/.test(t)), p.commitMenu.join(' | '));
      await act({ action: 'bisectMark', sha: root0, mark: 'good' });
      await until(() => panel.lastData.bisect && panel.lastData.bisect.left > 0, 10000, 'testing');
      const b = panel.lastData.bisect;
      assert.equal(b.testing, git('rev-parse', 'HEAD'));
      p = await pong((x) => /Bisecting: testing/.test(x.bisectbar) && x.selected === b.testing, 'testing bar and selection follows HEAD');
      assert.match(p.bisectbar, new RegExp(`${b.left} commits? left, about ${b.steps} steps?`));
      assert.ok(/Good.*Bad.*Skip.*Run a test command….*Reset/.test(p.bisectbar), p.bisectbar);
      assert.ok(p.bisectBadges.some((x) => x.startsWith('bad ')) && p.bisectBadges.some((x) => x.startsWith('good ')), p.bisectBadges.join(','));
      // First answer through a real click on the bar's button, the rest through the same action.
      const before = git('rev-parse', 'HEAD');
      const first = isBad() ? 'bad' : 'good';
      await panel.testPost({ type: 'click', selector: `#bisectbar button[data-mark="${first}"]` });
      await until(() => git('rev-parse', 'HEAD') !== before || (panel.lastData.bisect && panel.lastData.bisect.firstBad), 10000, 'click marked HEAD');
      for (let i = 0; i < 12; i++) {
        await panel.refresh(true);
        if (panel.lastData.bisect.firstBad) break;
        await act({ action: 'bisectMark', mark: isBad() ? 'bad' : 'good' });
      }
      assert.equal(panel.lastData.bisect.firstBad, culprit);
      p = await pong((x) => /First bad commit/.test(x.bisectbar), 'done bar');
      assert.ok(p.bisectbar.includes(culprit.slice(0, 8)), p.bisectbar);
      await act({ action: 'bisectReset' });
      await until(() => panel.lastData.bisect === null, 10000, 'reset');
      assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main');
      p = await pong((x) => x.bisectbar === '' && !x.bisectBadges.length, 'bar gone');
      // git bisect run from the bar's command, in a VS Code terminal; the graph follows along.
      await act({ action: 'bisectStart', sha: head, mark: 'bad' });
      await act({ action: 'bisectMark', sha: root0, mark: 'good' });
      await act({ action: 'bisectRun', command: `if git merge-base --is-ancestor ${culprit} HEAD; then exit 1; else exit 0; fi` });
      assert.ok(vscode.window.terminals.some((t) => t.name === 'Mergeline bisect'), 'terminal opened');
      await until(async () => { await panel.refresh(true); return panel.lastData.bisect && panel.lastData.bisect.firstBad === culprit; }, 60000, 'bisect run finished');
      await act({ action: 'bisectReset' });
      await until(() => panel.lastData.bisect === null, 10000, 'reset after run');
      for (const t of vscode.window.terminals) if (t.name === 'Mergeline bisect') t.dispose();
    } finally {
      try { git('bisect', 'reset'); } catch {}
      if (stashed) git('stash', 'pop', '-q');
    }
  });
  await check('patches: save a commit / a Ctrl-click series / a branch / a diff, copy, and apply them back (git am, git apply, from the clipboard, real clicks)', async () => {
    const pong = async (pred, what) => until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && pred(panel.lastPong) && panel.lastPong; }, 15000, what);
    const click = (selector, ctrl) => panel.testPost({ type: 'click', selector, ctrl });
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mergeline-patch-'));
    const stashed = git('status', '--porcelain') !== '';
    if (stashed) git('stash', 'push', '-q', '-u', '-m', 'e2e-patch');
    const start = git('rev-parse', 'HEAD');
    const prevSave = w.showSaveDialog;
    const read = (f) => fs.readFileSync(path.join(out, f), 'utf8');
    try {
      assert.ok((await vscode.commands.getCommands(true)).includes('mergeline.applyPatch'), 'command registered');
      // Two commits on a side branch; main stays where it is.
      git('checkout', '-q', '-b', 'patch-src');
      fs.writeFileSync(root + '/patch-a.txt', 'one\n'); git('add', '-A'); git('commit', '-q', '-m', 'Patch source one');
      fs.writeFileSync(root + '/patch-a.txt', 'one\ntwo\n'); fs.writeFileSync(root + '/patch-b.txt', 'b\n'); git('add', '-A'); git('commit', '-q', '-m', 'Patch source two');
      const [p1, p2] = [git('rev-parse', 'HEAD~1'), git('rev-parse', 'HEAD')];
      git('checkout', '-q', 'main');
      await panel.refresh(true);
      await until(() => panel.lastData.commits.some((c) => c.sha === p2), 10000, 'side branch loaded');

      // Commit menu items; with a Ctrl-click selection, the series item too (real clicks on the rows).
      await panel.testPost({ type: 'reveal', sha: p2 });
      let p = await pong((x) => x.selected === p2 && x.commitMenu.length, 'commit menu');
      assert.ok(p.commitMenu.includes('Save as a patch…') && p.commitMenu.includes('Copy as a patch'), p.commitMenu.join(' | '));
      const i1 = panel.lastData.commits.findIndex((c) => c.sha === p1);
      await click(`.row[data-i="${i1}"]`, true);
      p = await pong((x) => /Save this diff as a patch…/.test(x.detailsText), 'compare header');
      assert.ok(p.commitMenu.includes(`Save commits ${p1.slice(0, 7)}…${p2.slice(0, 7)} as patches…`), p.commitMenu.join(' | '));
      // "Save this diff" link (real click) → the same bytes as git diff --binary.
      w.showSaveDialog = async () => vscode.Uri.file(path.join(out, 'cmp.diff'));
      await click('[data-patch="diff"]');
      await until(() => fs.existsSync(path.join(out, 'cmp.diff')), 10000, 'diff saved');
      assert.equal(read('cmp.diff'), execFileSync('git', ['diff', '--binary', p1, p2], { cwd: root, encoding: 'utf8' }));

      // One commit, the series, the branch: format-patch output.
      w.showSaveDialog = async (o) => vscode.Uri.file(path.join(out, path.basename(o.defaultUri.fsPath)));
      await act({ action: 'savePatch', patch: 'commit', sha: p2, subject: 'Patch source two', parents: [p1] });
      assert.equal(read('0001-Patch-source-two.patch'), execFileSync('git', ['format-patch', '-1', '--stdout', p2], { cwd: root, encoding: 'utf8' }));
      await act({ action: 'savePatch', patch: 'series', sha: p2, target: p1 });
      const series = read(`${path.basename(root).replace(/[^\w.-]+/g, '-')}-${p1.slice(0, 8)}-${p2.slice(0, 8)}.patch`);
      assert.equal((series.match(/^From [0-9a-f]{40} /gm) || []).length, 2);
      await act({ action: 'savePatch', patch: 'branch', ref: 'patch-src', sha: p2 });
      assert.equal(read('patch-src.patch'), series);
      // Copy to the clipboard.
      await act({ action: 'savePatch', patch: 'commit', sha: p1, subject: 'Patch source one', parents: [start], copy: true });
      assert.equal(await vscode.env.clipboard.readText(), execFileSync('git', ['format-patch', '-1', '--stdout', p1], { cwd: root, encoding: 'utf8' }));

      // Apply the branch's patches onto main with git am: two new commits, same tree as patch-src.
      await act({ action: 'applyPatch', files: [path.join(out, 'patch-src.patch')], mode: 'am' });
      assert.equal(git('rev-list', '--count', `${start}..HEAD`), '2');
      assert.equal(git('rev-parse', 'HEAD^{tree}'), git('rev-parse', 'patch-src^{tree}'));
      assert.equal(git('log', '-1', '--format=%s'), 'Patch source two');
      git('reset', '-q', '--hard', start);
      // A staged change: git am is not run (it would leave an am session behind); declining changes nothing.
      fs.writeFileSync(root + '/staged.txt', 's\n'); git('add', 'staged.txt');
      let warned = '';
      w.showWarningMessage = async (msg) => { warned = msg; return undefined; };
      await act({ action: 'applyPatch', files: [path.join(out, 'patch-src.patch')], mode: 'am' });
      w.showWarningMessage = orig.warn;
      assert.match(warned, /git am needs a clean index/);
      assert.ok(!fs.existsSync(path.join(root, '.git', 'rebase-apply')), 'no am session left');
      assert.equal(git('rev-parse', 'HEAD'), start);
      git('rm', '-q', '--cached', 'staged.txt'); fs.rmSync(root + '/staged.txt');

      // Toolbar Patch menu (real clicks): Apply patch from the clipboard → "Apply the changes only" → staged, no commit.
      await vscode.env.clipboard.writeText(series.replace(/\n$/, '')); // pasted without the final newline
      await panel.refresh(true);
      await click('#patchbtn');
      p = await pong((x) => /Apply patch from the clipboard/.test(x.menuText), 'patch menu');
      assert.match(p.menuText, /Save uncommitted changes as a patch… \(disabled\)/);
      let picked = null;
      w.showQuickPick = async (items, o) => { const arr = await items; picked = { labels: arr.map((i) => i.label), placeHolder: o && o.placeHolder }; return arr.find((i) => i.v === 'apply'); };
      await click('#menu .mi[data-k="1"]');
      await until(() => git('status', '--porcelain').includes('patch-b.txt'), 10000, 'clipboard patch applied');
      assert.deepEqual(picked.labels, ['Create the 2 commits on “main”', 'Apply the changes only, no commit', 'Reverse it (undo these changes)']);
      assert.match(picked.placeHolder, /Patch source one and 1 more \(2 files changed, \+3 −0\)/);
      assert.equal(git('rev-parse', 'HEAD'), start);
      assert.equal(fs.readFileSync(root + '/patch-a.txt', 'utf8'), 'one\ntwo\n');
      assert.match(git('status', '--porcelain'), /^A {2}patch-a\.txt$/m);

      // Uncommitted changes → patch → reverse it → clean again.
      await panel.refresh(true);
      await act({ action: 'savePatch', patch: 'working', copy: true });
      const work = await vscode.env.clipboard.readText();
      assert.match(work, /^diff --git a\/patch-a\.txt b\/patch-a\.txt$/m);
      await act({ action: 'applyPatch', from: 'clipboard', mode: 'reverse' });
      assert.equal(git('status', '--porcelain'), '');
      // Not a patch: an error, nothing changes.
      await vscode.env.clipboard.writeText('just some text');
      await act({ action: 'applyPatch', from: 'clipboard', mode: 'apply' });
      assert.equal(git('status', '--porcelain'), '');
    } finally {
      w.showSaveDialog = prevSave;
      w.showQuickPick = orig.pick;
      w.showWarningMessage = orig.warn;
      try { git('am', '--abort'); } catch {}
      git('reset', '-q', '--hard', start);
      git('checkout', '-q', 'main');
      try { git('branch', '-q', '-D', 'patch-src'); } catch {}
      for (const f of ['patch-a.txt', 'patch-b.txt']) fs.rmSync(root + '/' + f, { force: true });
      if (stashed) git('stash', 'pop', '-q');
      fs.rmSync(out, { recursive: true, force: true });
      await panel.refresh(true);
    }
  });
  Object.assign(w, { showInputBox: orig.input, showQuickPick: orig.pick, showWarningMessage: orig.warn });

  // An unreachable commit holding a notebook and a PNG: it does not change the graph.
  const blob = (buf) => execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: buf }).toString().trim();
  const nb = JSON.stringify({ cells: [{ cell_type: 'markdown', metadata: {}, source: ['# Hello notebook'] }], metadata: {}, nbformat: 4, nbformat_minor: 5 }, null, 1) + '\n';
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360f8cfc0f01f0005000201' + '7e9fa6f00000000049454e44ae426082', 'hex');
  const tree = execFileSync('git', ['mktree'], { cwd: root, input: `100644 blob ${blob(nb)}\tnb.ipynb\n100644 blob ${blob(png)}\tdot.png\n` }).toString().trim();
  const extra = execFileSync('git', ['commit-tree', tree, '-p', 'HEAD', '-m', 'Add notebook'], { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' } }).toString().trim();

  await check('notebook diff opens in the notebook diff editor; images read as exact bytes', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('mergeline.show');
    panel = await until(() => api.panel() && api.panel().lastData && api.panel(), 20000, 'graph again');
    await panel.testMessage({ type: 'openFile', from: git('rev-parse', 'HEAD'), to: extra, path: 'nb.ipynb', status: 'A' });
    const tab = await until(() => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.input instanceof vscode.TabInputNotebookDiff), 20000, 'notebook diff tab');
    assert.equal(tab.input.notebookType, 'jupyter-notebook');
    assert.equal(tab.input.modified.scheme, 'mergeline');
    const doc = await until(() => vscode.workspace.notebookDocuments.find((d) => d.uri.scheme === 'mergeline' && JSON.parse(d.uri.query).ref === extra), 10000, 'notebook document');
    assert.equal(doc.cellAt(0).document.getText(), '# Hello notebook');
    const u = (ref, p) => vscode.Uri.from({ scheme: 'mergeline', path: '/' + p, query: JSON.stringify({ repo: panel.repoRoot, ref }) });
    assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(u(extra, 'dot.png'))), png);
    assert.equal((await vscode.workspace.fs.stat(u(extra, 'dot.png'))).size, png.length);
    assert.equal((await vscode.workspace.fs.readFile(u(null, 'dot.png'))).length, 0, 'no ref = empty');
    assert.equal((await vscode.workspace.fs.readFile(u(extra, 'missing.txt'))).length, 0, 'missing = empty');
    await assert.rejects(Promise.resolve(vscode.workspace.fs.writeFile(u(extra, 'dot.png'), new Uint8Array(1))));
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  await check('delete several branches: merged ones by default, unmerged only when chosen, Undo restores', async () => {
    git('branch', 'old-a', 'HEAD~1');
    git('branch', 'unmerged-b', extra);
    const prev = { pick: w.showQuickPick, warn: w.showWarningMessage, info: w.showInformationMessage };
    let seen = null, warned = null, undo = null;
    try {
      w.showQuickPick = async (items, o) => { const arr = await items; seen = { items: arr.map((i) => [i.label, i.description, !!i.picked]), many: o.canPickMany }; return arr.filter((i) => ['old-a', 'unmerged-b'].includes(i.label)); };
      w.showWarningMessage = async (msg, o, ...btns) => { warned = { msg, btns }; return btns.find((b) => /merged$/.test(b)); };
      w.showInformationMessage = (msg, ...btns) => { if (btns.includes('Undo')) return new Promise((r) => { undo = r; }); return prev.info(msg, ...btns); };
      await panel.testMessage({ type: 'action', action: 'deleteBranches', ref: 'old-a' });
      assert.ok(seen.many);
      const row = (n) => seen.items.find((i) => i[0] === n);
      assert.deepEqual(row('old-a'), ['old-a', 'merged into main', true]);
      assert.deepEqual(row('unmerged-b'), ['unmerged-b', 'not merged into main', false]);
      assert.ok(!row('main'), 'the current branch is not offered');
      assert.match(warned.msg, /unmerged-b is not merged into main/);
      assert.deepEqual(warned.btns, ['Delete all 2', 'Delete the 1 merged']);
      const heads = () => git('for-each-ref', 'refs/heads', '--format=%(refname:short)').split('\n');
      assert.ok(!heads().includes('old-a') && heads().includes('unmerged-b'), heads().join(' '));
      await until(() => undo, 5000, 'undo offer');
      undo('Undo');
      await until(() => heads().includes('old-a'), 10000, 'old-a restored');
      // Now force: both go.
      undo = null;
      w.showWarningMessage = async (msg, o, ...btns) => btns.find((b) => /^Delete all/.test(b));
      await panel.testMessage({ type: 'action', action: 'deleteBranches' });
      assert.ok(!heads().includes('old-a') && !heads().includes('unmerged-b'), heads().join(' '));
      await until(() => !panel.lastData.state.refs.some((r) => r.name === 'unmerged-b'), 10000, 'graph refreshed');
    } finally {
      Object.assign(w, { showQuickPick: prev.pick, showWarningMessage: prev.warn, showInformationMessage: prev.info });
      if (undo) undo(undefined);
      for (const b of ['old-a', 'unmerged-b']) try { git('branch', '-D', b); } catch {}
    }
  });

  await check('tags: filter the graph by a tag; details name the branches and first tag that contain a commit', async () => {
    // An earlier check deletes v0.1.0, so make a tag of our own three first-parent steps back.
    git('tag', 'e2e-rel', 'HEAD~3');
    await vscode.commands.executeCommand('mergeline.show');
    panel = await until(() => api.panel() && api.panel().lastData && api.panel(), 20000, 'editor graph');
    try {
    const want = Number(git('rev-list', '--count', 'e2e-rel'));
    await panel.refresh(true);
    await panel.testMessage({ type: 'filter', branches: ['refs/tags/e2e-rel'], remotes: true });
    await until(() => panel.lastData.commits.filter((c) => c.kind === 'commit').length === want, 10000, `only the ${want} commits in e2e-rel`);
    const inTag = new Set(git('rev-list', 'e2e-rel').split('\n'));
    assert.ok(panel.lastData.commits.filter((c) => c.kind === 'commit').every((c) => inTag.has(c.sha)), 'every row is in the tag');
    let lastBtn = null;
    await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); lastBtn = panel.lastPong && (panel.lastPong.error || panel.lastPong.branchBtn); return lastBtn === '◆ e2e-rel'; }, 10000, 'button names the tag').catch((e) => { throw new Error(e.message + ': ' + JSON.stringify(lastBtn)); });
    await panel.testMessage({ type: 'filter', branches: [], remotes: true });
    await until(() => panel.lastData.commits.filter((c) => c.kind === 'commit').length > want, 10000, 'all branches again');
    // The root commit: in every branch, and git's own oldest tag is the "first tag".
    const rootSha = git('rev-list', '--max-parents=0', 'HEAD').split('\n')[0];
    const first = git('tag', '--contains', rootSha, '--sort=creatordate').split('\n')[0];
    const heads = git('branch', '--contains', rootSha, '--format=%(refname:short)').split('\n').filter(Boolean);
    await panel.testPost({ type: 'reveal', sha: rootSha });
    const p2 = await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && /First tag/.test(panel.lastPong.containsText) && panel.lastPong; }, 10000, 'contained in');
    assert.match(p2.containsText, new RegExp('First tag\\s*' + first.replace(/\./g, '\\.')), p2.containsText);
    if (heads.length <= 6) for (const h of heads) assert.ok(p2.containsText.includes(h), `${h} in: ${p2.containsText}`);
    else assert.match(p2.containsText, new RegExp(`\\+${heads.length - 6} more`), p2.containsText);
    assert.match(p2.containsText, /^Branches/, p2.containsText);
    } finally { git('tag', '-d', 'e2e-rel'); }
  });

  await check('graph in the Source Control sidebar view: narrow toolbar, own layout, open in editor', async () => {
    await vscode.commands.executeCommand('mergeline.show');
    panel = await until(() => api.panel() && api.panel().lastData && api.panel(), 20000, 'editor graph');
    await vscode.commands.executeCommand('mergeline.showInSidebar');
    const view = await until(() => api.view() && api.view().lastData && api.view(), 20000, 'sidebar graph data');
    assert.equal(view.hostKind, 'view');
    assert.equal(view.lastData.commits.length, panel.lastData.commits.length, 'same graph as the editor tab');
    const pong = await until(async () => { view.lastPong = null; await view.ping(); await sleep(150); return view.lastPong && view.lastPong.rows > 0 && view.lastPong; }, 20000, 'sidebar pong');
    assert.equal(pong.side, true);
    assert.equal(pong.patchShown, false, 'wide toolbar buttons are hidden in the sidebar');
    const ed = await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong; }, 10000, 'editor pong');
    assert.equal(ed.side, false);
    // The editor toolbar stays on one line: what does not fit moves into "⋯" (tier 1: Patch/Remotes/Refresh, tier 2: filters too).
    assert.equal(ed.patchShown, ed.narrow === 0, `narrow ${ed.narrow}`);
    assert.equal(ed.moreShown, ed.narrow > 0, `narrow ${ed.narrow}`);
    if (ed.narrow < 2) assert.ok(ed.toolbarH < 42, `toolbar ${ed.toolbarH}px high`);
    assert.equal(pong.moreShown, true, 'the sidebar has the "⋯" menu');
    // "⋯" in the sidebar: lists the hidden filters and toggles First parent.
    const vpong = async (pred, what) => until(async () => { view.lastPong = null; await view.ping(); await sleep(120); return view.lastPong && pred(view.lastPong) && view.lastPong; }, 10000, what);
    await view.testPost({ type: 'click', selector: '#morebtn' });
    const mp = await vpong((p) => p.menuText, 'more menu');
    assert.equal(mp.menuText.replace(/(✓ |\u2003)/g, ''), 'Remote branches | First parent | Order: Date | Order: Topology | Order: Author date | Patch… | Manage remotes… | Refresh');
    assert.match(mp.menuText, /✓ Order: Date/, 'the current order is ticked');
    const fp0 = mp.firstParent;
    await view.testPost({ type: 'click', selector: '#menu .mi[data-k="1"]' });
    const fpSetting = () => !!vscode.workspace.getConfiguration('mergeline').get('firstParentOnly');
    await until(() => fpSetting() !== !!fp0, 10000, 'first parent toggled from "⋯"');
    await view.testPost({ type: 'click', selector: '#morebtn' });
    await vpong((p) => p.menuText.includes(fp0 ? '\u2003First parent' : '✓ First parent'), 'tick follows the state');
    await view.testPost({ type: 'click', selector: '#menu .mi[data-k="1"]' });
    await until(() => fpSetting() === !!fp0, 10000, 'first parent back');
    // Both refresh after a change made outside.
    git('branch', 'side-test');
    await vscode.commands.executeCommand('mergeline.refresh');
    await until(() => view.lastData.state.refs.some((r) => r.name === 'side-test') && panel.lastData.state.refs.some((r) => r.name === 'side-test'), 10000, 'both refreshed');
    git('branch', '-D', 'side-test');
    // Closing the editor tab leaves the sidebar graph working; Open in editor brings the tab back.
    panel.dispose();
    assert.equal(api.panel(), undefined);
    assert.ok(api.view());
    await vscode.commands.executeCommand('mergeline.openInEditor');
    panel = await until(() => api.panel() && api.panel().lastData && api.panel(), 20000, 'editor graph again');
    assert.equal(panel.hostKind, 'editor');
  });

  await check('interactive rebase in editor tabs (#757): todo tab + bar, Cancel changes nothing; Start, reword message tab, Done; drop', async () => {
    const wf = (f, t) => fs.writeFileSync(root + '/' + f, t);
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    for (const s of ['IR1', 'IR2', 'IR3']) { wf(s + '.txt', s + '\n'); git('add', s + '.txt'); git('commit', '-q', '-m', 'Edit ' + s); }
    await panel.refresh(true);
    const base = git('rev-parse', 'HEAD~3');
    const before = git('rev-parse', 'HEAD');
    const tabOf = (name) => vscode.window.visibleTextEditors.find((e) => path.basename(e.document.uri.fsPath) === name);
    const barText = async (re, what) => (await until(async () => { panel.lastPong = null; await panel.ping(); await sleep(150); return panel.lastPong && re.test(panel.lastPong.opbar) && panel.lastPong; }, 10000, what)).opbar;
    // 1. Cancel from the tab's title-bar command: nothing changes.
    let run = act({ action: 'interactiveRebase', sha: base, current: branch });
    let ed = await until(() => tabOf('git-rebase-todo'), 15000, 'todo tab');
    assert.equal(ed.document.languageId, 'git-rebase', 'VS Code highlights it as a rebase todo');
    assert.equal(ed.document.getText().split('\n').filter((l) => l.startsWith('pick ')).length, 3);
    assert.match(await barText(/edit the todo list/, 'waiting bar'), /Start rebase.*Cancel/);
    await vscode.commands.executeCommand('mergeline.editorCancel');
    await run;
    assert.equal(git('rev-parse', 'HEAD'), before, 'cancel leaves HEAD');
    assert.ok(!fs.existsSync(path.join(root, '.git', 'rebase-merge')), 'no rebase left in progress');
    await until(() => !tabOf('git-rebase-todo'), 5000, 'todo tab closed');
    // 2. Edit the todo (drop IR1, reword IR3), Start from the graph's bar, edit the message tab, Done.
    run = act({ action: 'interactiveRebase', sha: base, current: branch });
    ed = await until(() => tabOf('git-rebase-todo'), 15000, 'todo tab again');
    const text = ed.document.getText().split('\n').map((l) => (/^pick \S+ (# )?Edit IR1$/.test(l) ? l.replace(/^pick/, 'drop') : /^pick \S+ (# )?Edit IR3$/.test(l) ? l.replace(/^pick/, 'reword') : l)).join('\n');
    assert.ok(/^drop /m.test(text) && /^reword /m.test(text), text);
    await ed.edit((b) => b.replace(new vscode.Range(0, 0, ed.document.lineCount, 0), text));
    await panel.testPost({ type: 'click', selector: '#opbar button[data-op="waitDone"]' });
    const msg = await until(() => tabOf('COMMIT_EDITMSG'), 15000, 'message tab');
    assert.match(msg.document.getText(), /^Edit IR3\n/);
    assert.match(await barText(/edit the commit message/, 'message bar'), /Done.*Abort rebase/);
    await msg.edit((b) => b.replace(new vscode.Range(0, 0, 1, 0), 'IR3 reworded in a tab\n'));
    await vscode.commands.executeCommand('mergeline.editorDone');
    await run;
    assert.deepEqual(git('log', '-2', '--format=%s').split('\n'), ['IR3 reworded in a tab', 'Edit IR2']);
    assert.ok(!fs.existsSync(root + '/IR1.txt'), 'IR1 dropped');
    assert.ok(!fs.existsSync(path.join(root, '.git', 'rebase-merge')), 'rebase finished');
    await barText(/^$/, 'bar cleared');
    git('reset', '-q', '--keep', before);
    await panel.refresh(true);
    // 3. edit IR2 + reword IR3: the rebase stops at IR2; Continue from the bar opens IR3's message in a tab.
    run = act({ action: 'interactiveRebase', sha: base, current: branch });
    ed = await until(() => tabOf('git-rebase-todo'), 15000, 'todo tab 3');
    const t3 = ed.document.getText().split('\n').map((l) => (/^pick \S+ (# )?Edit IR2$/.test(l) ? l.replace(/^pick/, 'edit') : /^pick \S+ (# )?Edit IR3$/.test(l) ? l.replace(/^pick/, 'reword') : l)).join('\n');
    await ed.edit((b) => b.replace(new vscode.Range(0, 0, ed.document.lineCount, 0), t3));
    await vscode.commands.executeCommand('mergeline.editorDone');
    await run;
    assert.ok(fs.existsSync(path.join(root, '.git', 'rebase-merge')), 'stopped at the edit');
    await panel.refresh(true);
    assert.match(await barText(/Rebasing/, 'stopped bar'), /Continue/);
    const cont = act({ action: 'opContinue', message: 'force' });
    const msg3 = await until(() => tabOf('COMMIT_EDITMSG'), 15000, 'message tab after Continue');
    assert.match(msg3.document.getText(), /^Edit IR3\n/);
    await msg3.edit((b) => b.replace(new vscode.Range(0, 0, 1, 0), 'IR3 after continue\n'));
    await vscode.commands.executeCommand('mergeline.editorDone');
    await cont;
    assert.deepEqual(git('log', '-3', '--format=%s').split('\n'), ['IR3 after continue', 'Edit IR2', 'Edit IR1']);
    assert.ok(!fs.existsSync(path.join(root, '.git', 'rebase-merge')), 'rebase finished after Continue');
    git('reset', '-q', '--keep', before);
    await panel.refresh(true);
  });

  fs.writeFileSync(process.env.MERGELINE_E2E_REPORT, results.join('\n') + '\n');
  if (results.some((r) => r.startsWith('FAIL'))) throw new Error('e2e failures');
};
