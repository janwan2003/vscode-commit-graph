import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLog, readFileHistory, searchLog, readState, readStashes, insertStashes, readChanges, readCommitInfo, countStatus, readStatusCount, parseWorktrees, readWorktrees, mergeBase } from '../src/core/gitlog';
import { layout, newLayoutState, Row } from '../src/core/graph';
import { webRepo, commitUrl, issueUrl, branchUrl, pullRequestUrl } from '../src/core/remote';

function sh(cwd: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' },
  });
}
let t = 1700000000;
function commit(cwd: string, file: string, msg: string) {
  writeFileSync(join(cwd, file), msg + '\n' + Math.random());
  sh(cwd, 'add', '-A');
  t += 60;
  execFileSync('git', ['commit', '-q', '-m', msg], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_AUTHOR_DATE: `${t} +0000`, GIT_COMMITTER_DATE: `${t} +0000` } });
}

export function makeFixture(): string {
  const d = mkdtempSync(join(tmpdir(), 'mergeline-fx-'));
  sh(d, 'init', '-q', '-b', 'main');
  sh(d, 'config', 'commit.gpgsign', 'false');
  commit(d, 'a.txt', 'initial');
  commit(d, 'a.txt', 'second');
  sh(d, 'tag', 'v0.1');
  sh(d, 'checkout', '-q', '-b', 'feature');
  commit(d, 'f.txt', 'feature one');
  commit(d, 'f.txt', 'feature two');
  sh(d, 'checkout', '-q', 'main');
  commit(d, 'b.txt', 'main three');
  sh(d, 'checkout', '-q', '-b', 'hotfix');
  commit(d, 'h.txt', 'hotfix one');
  sh(d, 'checkout', '-q', 'main');
  sh(d, 'merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature');
  sh(d, 'tag', '-a', 'v1.0', '-m', 'release 1.0');
  renameSync(join(d, 'b.txt'), join(d, 'c.txt'));
  sh(d, 'add', '-A');
  sh(d, 'commit', '-q', '-m', 'rename b to c');
  writeFileSync(join(d, 'a.txt'), 'stashed work');
  sh(d, 'stash', 'push', '-q', '-m', 'wip stash');
  writeFileSync(join(d, 'new.txt'), 'untracked');
  writeFileSync(join(d, 'a.txt'), 'dirty');
  return d;
}

function checkContinuity(rows: Row[]) {
  for (let r = 1; r < rows.length; r++) {
    const below = new Set(rows[r - 1].bot.map((s) => s[1]));
    const above = new Set(rows[r].top.map((s) => s[0]));
    assert.deepEqual([...above].sort(), [...below].sort(), `row ${r}: top sources must equal previous row's bottom targets`);
  }
}

test('reads log, refs, stashes and lays out a continuous graph', async () => {
  const d = makeFixture();
  try {
    const commits = await readLog(d, { max: 100 });
    assert.equal(commits.length, 8);
    assert.equal(commits[0].subject, 'rename b to c');
    const merge = commits.find((c) => c.subject === 'Merge feature')!;
    assert.equal(merge.parents.length, 2);

    const st = await readState(d);
    assert.equal(st.branch, 'main');
    assert.equal(st.head, commits[0].sha);
    const v1 = st.refs.find((r) => r.name === 'v1.0')!;
    assert.equal(v1.type, 'tag');
    assert.equal(v1.sha, merge.sha, 'annotated tag is peeled to its commit');
    assert.deepEqual(st.refs.filter((r) => r.type === 'head').map((r) => r.name).sort(), ['feature', 'hotfix', 'main']);

    const stashes = await readStashes(d);
    assert.equal(stashes.length, 1);
    assert.equal(stashes[0].stashRef, 'stash@{0}');
    assert.equal(stashes[0].parents[0], commits[0].sha);
    const all = insertStashes(commits, stashes);
    assert.equal(all[0].kind, 'stash');

    const lay = layout(all);
    assert.equal(lay.rows.length, all.length);
    checkContinuity(lay.rows);
    const mi = all.indexOf(merge);
    assert.equal(lay.rows[mi].bot.filter((s) => s[0] === lay.rows[mi].col).length, 2, 'merge row has two outgoing edges');
    assert.ok(lay.width >= 2 && lay.width <= 4, 'width ' + lay.width);
    const last = lay.rows[lay.rows.length - 1];
    assert.equal(last.bot.length, 0, 'root commit has nothing below');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('layout can be continued across pages (load more)', async () => {
  const d = makeFixture();
  try {
    const commits = await readLog(d, { max: 100 });
    const full = layout(commits);
    const st = newLayoutState();
    const a = layout(commits.slice(0, 4), st);
    const b = layout(commits.slice(4), st);
    assert.deepEqual([...a.rows, ...b.rows], full.rows);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('changes: commit, rename, root commit, working tree, compare', async () => {
  const d = makeFixture();
  try {
    const commits = await readLog(d, { max: 100 });
    const head = commits[0];
    const ren = await readChanges(d, head.parents[0], head.sha);
    assert.deepEqual(ren.map((f) => [f.status, f.oldPath, f.path]), [['R', 'b.txt', 'c.txt']]);
    const root = commits[commits.length - 1];
    const rc = await readChanges(d, null, root.sha);
    assert.equal(rc[0].status, 'A');
    assert.equal(rc[0].additions, 2);
    const wt = await readChanges(d, 'HEAD', null);
    assert.deepEqual(wt.map((f) => f.status + ':' + f.path).sort(), ['M:a.txt', 'U:new.txt']);
    assert.equal(await readStatusCount(d), 2);
    const cmp = await readChanges(d, root.sha, head.sha);
    assert.ok(cmp.length >= 3);
    const info = await readCommitInfo(d, commits.find((c) => c.subject === 'Merge feature')!.sha);
    assert.equal(info.parents.length, 2);
    assert.equal(info.author, 'Ada');
    assert.equal(info.message, 'Merge feature');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('branch filter and empty repo', async () => {
  const d = makeFixture();
  try {
    const feat = await readLog(d, { max: 100, branches: ['feature'] });
    assert.deepEqual(feat.map((c) => c.subject), ['feature two', 'feature one', 'second', 'initial']);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
  const e = mkdtempSync(join(tmpdir(), 'mergeline-empty-'));
  try {
    sh(e, 'init', '-q');
    assert.deepEqual(await readLog(e, { max: 10 }), []);
    const st = await readState(e);
    assert.equal(st.head, null);
  } finally {
    rmSync(e, { recursive: true, force: true });
  }
});

test('countStatus handles renames', () => {
  assert.equal(countStatus('R  new.txt\0old.txt\0 M a.txt\0?? b.txt\0'), 3);
  assert.equal(countStatus(''), 0);
});

test('layout: synthetic octopus merge and crossing branches stay continuous', () => {
  const commits = [
    { sha: 'm', parents: ['a', 'b', 'c'] },
    { sha: 'x', parents: ['b'] },
    { sha: 'a', parents: ['r'] },
    { sha: 'b', parents: ['r'] },
    { sha: 'c', parents: ['q'] },
    { sha: 'q', parents: ['r'] },
    { sha: 'r', parents: [] },
  ];
  const lay = layout(commits);
  checkContinuity(lay.rows);
  assert.equal(lay.rows[0].bot.length, 3);
  assert.equal(lay.rows[6].top.length >= 1, true);
});

test('layout handles 100k linear commits quickly', () => {
  const n = 100000;
  const commits = Array.from({ length: n }, (_, i) => ({ sha: 's' + i, parents: i + 1 < n ? ['s' + (i + 1)] : [] }));
  const t0 = Date.now();
  const lay = layout(commits);
  assert.equal(lay.width, 1);
  assert.ok(Date.now() - t0 < 2000);
});

test('file history: path-limited log rewrites parents so the graph stays connected', async () => {
  const d = makeFixture();
  try {
    const all = await readLog(d, { max: 100 });
    const hist = await readLog(d, { max: 100, paths: ['a.txt'] });
    assert.deepEqual(hist.map((c) => c.subject), ['second', 'initial']);
    assert.deepEqual(hist[0].parents, [hist[1].sha]);
    const b = await readLog(d, { max: 100, paths: ['b.txt'] });
    assert.deepEqual(b.map((c) => c.subject), ['rename b to c', 'main three']);
    const shas = new Set(b.map((c) => c.sha));
    for (const c of b) for (const p of c.parents) assert.ok(shas.has(p), 'rewritten parent is listed');
    const lay = layout(b);
    checkContinuity(lay.rows);
    assert.equal(lay.width, 1);
    // A literal pathspec: glob characters are not expanded.
    assert.deepEqual(await readLog(d, { max: 100, paths: ['*.txt'] }), []);
    assert.equal(all.length, 8);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('topo order keeps a merged branch directly under its merge', async () => {
  const d = makeFixture();
  try {
    const topo = (await readLog(d, { max: 100, order: 'topo' })).map((c) => c.subject);
    assert.equal(topo.indexOf('feature two'), topo.indexOf('Merge feature') + 1);
    assert.equal(topo.length, 8);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('layout: lanes waiting for the same commit collapse into one', () => {
  // Three topic branches forked from the same base b, merged one after another.
  const commits = [
    { sha: 'm3', parents: ['m2', 't3'] },
    { sha: 'm2', parents: ['m1', 't2'] },
    { sha: 'm1', parents: ['b', 't1'] },
    { sha: 't3', parents: ['b'] },
    { sha: 't2', parents: ['b'] },
    { sha: 't1', parents: ['b'] },
    { sha: 'b', parents: [] },
  ];
  const lay = layout(commits);
  checkContinuity(lay.rows);
  // Each topic tip folds into the lane already waiting for b instead of keeping its
  // own lane down to b, so the graph narrows row by row (it used to stay 4 wide).
  assert.deepEqual(lay.rows.map((r) => r.top.length), [0, 2, 3, 4, 3, 2, 1]);
  assert.equal(lay.rows[6].top.length, 1, 'only one line reaches the base');
});

// The webview decoder (plain JS, also loaded as a script by the webview).
// @ts-expect-error plain JS module without type declarations
import rowsJs from '../media/rows.js';
const { unpackRow } = rowsJs as { unpackRow: (above: string, p: unknown) => Row };

function unpackAll(lay: { packed: unknown[]; start: string }): Row[] {
  let above = lay.start;
  return lay.packed.map((p: any) => {
    const r = unpackRow(above, p);
    above = p[2];
    return r;
  });
}
const norm = (rows: Row[]) => rows.map((r) => ({ col: r.col, color: r.color, top: [...r.top].map(String).sort(), bot: [...r.bot].map(String).sort() }));

test('packed rows decode to exactly the full rows (fixture, pages, random DAGs)', async () => {
  const d = makeFixture();
  try {
    const commits = await readLog(d, { max: 100 });
    const full = layout(commits);
    assert.deepEqual(norm(unpackAll(full)), norm(full.rows));
    const st = newLayoutState();
    const a = layout(commits.slice(0, 4), st);
    const b = layout(commits.slice(4), st);
    assert.equal(b.start, a.packed[a.packed.length - 1][2]);
    assert.deepEqual(norm([...unpackAll(a), ...unpackAll(b)]), norm(full.rows));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
  // Random DAGs: parents always come later in the list (children before parents),
  // with merges, octopus merges, many branch tips and shared parents.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let trial = 0; trial < 200; trial++) {
    const n = 5 + Math.floor(rnd() * 120);
    const commits = Array.from({ length: n }, (_, i) => {
      const parents: string[] = [];
      const k = i === n - 1 ? 0 : rnd() < 0.15 ? 2 + Math.floor(rnd() * 2) : 1;
      for (let j = 0; j < k; j++) parents.push('c' + (i + 1 + Math.floor(rnd() * Math.min(12, n - i - 1))));
      return { sha: 'c' + i, parents };
    });
    const lay = layout(commits);
    assert.deepEqual(norm(unpackAll(lay)), norm(lay.rows), `trial ${trial}`);
  }
});

test('searchLog finds commits by message, author, hash and ref with their graph positions', async () => {
  const d = makeFixture();
  try {
    const all = await readLog(d, { max: 100 });
    const pos = (sha: string) => all.findIndex((c) => c.sha === sha);
    const st = await readState(d);
    const one = await searchLog(d, { max: 1 }, 'HOTFIX one', st.refs);
    assert.equal(one.total, 1);
    const hot = all.find((c) => c.subject === 'hotfix one')!;
    assert.deepEqual(one.matches, [{ sha: hot.sha, index: pos(hot.sha) }]);
    // Author (case-insensitive): every commit is by Ada; results are in graph order.
    const ada = await searchLog(d, { max: 1 }, 'ada@EXAMPLE', st.refs);
    assert.deepEqual(ada.matches.map((m) => m.index), all.map((_, i) => i));
    // Hash prefix and ref name (tag v0.1 points at "second").
    const second = all.find((c) => c.subject === 'second')!;
    assert.deepEqual((await searchLog(d, { max: 1 }, second.sha.slice(0, 8), st.refs)).matches.map((m) => m.sha), [second.sha]);
    assert.deepEqual((await searchLog(d, { max: 1 }, 'v0.1', st.refs)).matches.map((m) => m.sha), [second.sha]);
    // Fixed string, not a regex; limit caps the list but not the total.
    assert.equal((await searchLog(d, { max: 1 }, 'f.*e', st.refs)).total, 0);
    const capped = await searchLog(d, { max: 1 }, 'ada', st.refs, 3);
    assert.equal(capped.matches.length, 3);
    assert.equal(capped.total, all.length);
    // Branch-limited: hotfix is not on feature.
    assert.equal((await searchLog(d, { max: 1, branches: ['feature'] }, 'hotfix one')).total, 0);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('file history follows renames and skips a new file that reused the old name', async () => {
  const d = makeFixture();
  try {
    commit(d, 'b.txt', 'new b'); // unrelated file at c.txt's old name
    commit(d, 'c.txt', 'edit c');
    const h = await readFileHistory(d, { max: 100 }, 'c.txt');
    assert.deepEqual(h.names, ['c.txt', 'b.txt']);
    assert.deepEqual(h.commits.map((c) => c.subject), ['edit c', 'rename b to c', 'main three']);
    const shas = new Set(h.commits.map((c) => c.sha));
    for (const c of h.commits) for (const p of c.parents) assert.ok(shas.has(p), 'parent of ' + c.subject + ' is listed');
    assert.equal(h.commits[0].parents[0], h.commits[1].sha, 'parent rewritten past the dropped "new b" commit');
    checkContinuity(layout(h.commits).rows);
    // A file that was never renamed: same as a plain path-limited log.
    const a = await readFileHistory(d, { max: 100 }, 'a.txt');
    assert.deepEqual(a.names, ['a.txt']);
    assert.deepEqual(a.commits, await readLog(d, { max: 100, paths: ['a.txt'] }));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('webRepo turns remote URLs into forge web links, and ignores local or unknown remotes', () => {
  const cases: [string, string | null][] = [
    ['git@github.com:plainbyte/mergeline.git', 'https://github.com/plainbyte/mergeline'],
    ['https://github.com/plainbyte/mergeline.git', 'https://github.com/plainbyte/mergeline'],
    ['https://user:tok@github.com/plainbyte/mergeline', 'https://github.com/plainbyte/mergeline'],
    ['ssh://git@ssh.github.com:443/plainbyte/mergeline.git', 'https://github.com/plainbyte/mergeline'],
    ['git@gitlab.com:group/sub/proj.git', 'https://gitlab.com/group/sub/proj'],
    ['https://gitlab.example.org/team/proj/', 'https://gitlab.example.org/team/proj'],
    ['git@bitbucket.org:team/repo.git', 'https://bitbucket.org/team/repo'],
    ['https://github.corp.example/team/repo.git', 'https://github.corp.example/team/repo'],
    ['/srv/git/repo.git', null],
    ['C:\\repos\\x.git', null],
    ['file:///srv/git/repo.git', null],
    ['git@example.com:team/repo.git', null],
    ['https://github.com/onlyowner', null],
  ];
  for (const [url, want] of cases) assert.equal(webRepo(url)?.base ?? null, want, url);
  const gh = webRepo('git@github.com:o/r.git')!;
  const gl = webRepo('git@gitlab.com:o/r.git')!;
  const bb = webRepo('git@bitbucket.org:o/r.git')!;
  assert.equal(commitUrl(gh, 'abc'), 'https://github.com/o/r/commit/abc');
  assert.equal(commitUrl(gl, 'abc'), 'https://gitlab.com/o/r/-/commit/abc');
  assert.equal(commitUrl(bb, 'abc'), 'https://bitbucket.org/o/r/commits/abc');
  assert.equal(issueUrl(gl, '7'), 'https://gitlab.com/o/r/-/issues/7');
  assert.equal(branchUrl(gh, 'feature/a b'), 'https://github.com/o/r/tree/feature/a%20b');
  assert.equal(pullRequestUrl(gh, 'feature/a b'), 'https://github.com/o/r/compare/feature/a%20b?expand=1');
  assert.equal(pullRequestUrl(gl, 'feature/x'), 'https://gitlab.com/o/r/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Fx');
  assert.equal(pullRequestUrl(bb, 'fix#1'), 'https://bitbucket.org/o/r/pull-requests/new?source=fix%231');
});

test('worktrees: porcelain parsing (-z and newline forms) and a real linked worktree', async () => {
  const H1 = 'a'.repeat(40), H2 = 'b'.repeat(40);
  const z = `worktree /w/main\0HEAD ${H1}\0branch refs/heads/main\0\0worktree /w/feat x\0HEAD ${H2}\0detached\0locked reason here\0\0worktree /w/gone\0HEAD ${H1}\0branch refs/heads/old\0prunable gitdir file points to non-existent location\0\0`;
  const nl = z.replace(/\0/g, '\n');
  for (const out of [z, nl]) {
    const w = parseWorktrees(out);
    assert.deepEqual(w, [
      { path: '/w/main', head: H1, branch: 'main', main: true },
      { path: '/w/feat x', head: H2, branch: null, main: false, locked: true },
      { path: '/w/gone', head: H1, branch: 'old', main: false, prunable: true },
    ]);
  }
  assert.deepEqual(parseWorktrees('worktree /srv/r.git\0bare\0\0'), [{ path: '/srv/r.git', head: null, branch: null, main: true, bare: true }]);
  assert.deepEqual(parseWorktrees(''), []);

  const d = mkdtempSync(join(tmpdir(), 'mergeline-wt-'));
  const linked = d + '-linked';
  try {
    sh(d, 'init', '-q', '-b', 'main');
    sh(d, 'config', 'commit.gpgsign', 'false');
    commit(d, 'a.txt', 'one');
    const base = sh(d, 'rev-parse', 'HEAD').trim();
    sh(d, 'branch', 'topic');
    commit(d, 'a.txt', 'two');
    sh(d, 'worktree', 'add', '-q', linked, 'topic');
    commit(linked, 'b.txt', 'on topic');
    const topic = sh(d, 'rev-parse', 'topic').trim();
    const w = await readWorktrees(d);
    assert.equal(w.length, 2);
    assert.equal(w[0].main, true);
    assert.equal(w[0].branch, 'main');
    assert.equal(w[1].branch, 'topic');
    assert.equal(w[1].head, topic);
    // Same list from inside the linked worktree.
    assert.deepEqual((await readWorktrees(linked)).map((x) => x.branch), ['main', 'topic']);
    assert.equal(await mergeBase(d, 'main', 'topic'), base);
    // Three-dot: changes on topic since it split from main are only b.txt.
    assert.deepEqual((await readChanges(d, base, topic)).map((f) => f.path), ['b.txt']);
    assert.equal(await mergeBase(d, 'main', 'nonexistent-ref'), null);
  } finally {
    rmSync(linked, { recursive: true, force: true });
    rmSync(d, { recursive: true, force: true });
  }
});
