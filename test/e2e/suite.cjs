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

  await check('commit order: topology keeps a branch together, saved as a setting', async () => {
    await panel.testMessage({ type: 'order', order: 'topo' });
    assert.equal(vscode.workspace.getConfiguration('mergeline').get('commitOrder'), 'topo');
    const d = await until(() => { const s = panel.lastData.commits.map((c) => c.subject); return s.indexOf('Search: rank by recency') === s.indexOf("Merge branch 'feature/search'") + 1 && panel.lastData; }, 10000, 'topo order');
    assert.ok(d);
    await panel.testMessage({ type: 'order', order: 'date' });
    await until(() => vscode.workspace.getConfiguration('mergeline').get('commitOrder') === 'date', 5000, 'order reset');
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
