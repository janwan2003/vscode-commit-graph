// Runs inside VS Code (extension host). Started by scripts/e2e.mjs.
const vscode = require('vscode');
const assert = require('assert');
const fs = require('fs');
const { execFileSync } = require('child_process');

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
    assert.equal(panel.lastData.commits.filter((c) => c.kind === 'commit').length, 8, 'clearing the path shows everything again');
  });

  await check('commit order: topology keeps a branch together, saved as a setting', async () => {
    await panel.testMessage({ type: 'order', order: 'topo' });
    assert.equal(vscode.workspace.getConfiguration('mergeline').get('commitOrder'), 'topo');
    const d = await until(() => { const s = panel.lastData.commits.map((c) => c.subject); return s.indexOf('Search: rank by recency') === s.indexOf("Merge branch 'feature/search'") + 1 && panel.lastData; }, 10000, 'topo order');
    assert.ok(d);
    await panel.testMessage({ type: 'order', order: 'date' });
    await until(() => vscode.workspace.getConfiguration('mergeline').get('commitOrder') === 'date', 5000, 'order reset');
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
    await check('remote: delete remote branch (modal confirm)', async () => {
      git('push', '-q', 'origin', 'feature/search');
      git('fetch', '-q', 'origin');
      assert.ok(lsRemote('refs/heads/feature/search'));
      await act({ action: 'deleteRemoteBranch', ref: 'origin/feature/search', refType: 'remote', remote: 'origin' });
      assert.equal(lsRemote('refs/heads/feature/search'), '');
    });
    fs.rmSync(bare, { recursive: true, force: true });
  }
  Object.assign(w, { showInputBox: orig.input, showQuickPick: orig.pick, showWarningMessage: orig.warn });

  fs.writeFileSync(process.env.MERGELINE_E2E_REPORT, results.join('\n') + '\n');
  if (results.some((r) => r.startsWith('FAIL'))) throw new Error('e2e failures');
};
