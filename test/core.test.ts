import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLog, readState, readStashes, insertStashes, readChanges, readCommitInfo, countStatus, readStatusCount } from '../src/core/gitlog';
import { layout, newLayoutState, Row } from '../src/core/graph';

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
