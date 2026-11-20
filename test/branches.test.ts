import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRANCH_FORMAT, parseBranches, deletable, branchNote, planDelete, restoreArgs, nameList } from '../src/core/branches';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: ENV });
let n = 0;
let t = 1763600000;
const commit = (cwd: string, msg: string) => {
  writeFileSync(join(cwd, `f${n++}.txt`), msg);
  sh(cwd, 'add', '-A');
  t += 60;
  execFileSync('git', ['commit', '-q', '-m', msg], { cwd, env: { ...ENV, GIT_COMMITTER_DATE: `${t} +0000`, GIT_AUTHOR_DATE: `${t} +0000` } });
};

test('reads branches from a real repo: merged, gone upstream, checked out here and in a worktree; deletes and restores them', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ml-branches-'));
  try {
    const up = join(tmp, 'up');
    const d = join(tmp, 'repo');
    execFileSync('git', ['init', '-q', '-b', 'main', up]);
    sh(up, 'config', 'commit.gpgsign', 'false');
    commit(up, 'base');
    sh(up, 'branch', 'remote-gone');
    execFileSync('git', ['clone', '-q', up, d]);
    sh(d, 'config', 'commit.gpgsign', 'false');
    sh(d, 'checkout', '-q', '-b', 'remote-gone', 'origin/remote-gone');
    sh(d, 'checkout', '-q', 'main');
    sh(up, 'branch', '-D', 'remote-gone');
    sh(d, 'fetch', '-q', '--prune');
    sh(d, 'branch', 'merged-old');
    commit(d, 'on main');
    sh(d, 'checkout', '-q', '-b', 'feature');
    commit(d, 'feature work');
    sh(d, 'checkout', '-q', 'main');
    sh(d, 'branch', 'in-worktree');
    sh(d, 'worktree', 'add', '-q', join(tmp, 'wt'), 'in-worktree');
    // Merged into HEAD but ahead of its upstream: plain `git branch -d` refuses it; the plan still deletes it.
    sh(d, 'checkout', '-q', '-b', 'ahead', 'origin/main');
    sh(d, 'branch', '-q', '--set-upstream-to=origin/main');
    sh(d, 'merge', '-q', '--ff-only', 'main');
    sh(d, 'checkout', '-q', 'main');

    const list = parseBranches(sh(d, 'for-each-ref', 'refs/heads', '--format=' + BRANCH_FORMAT), sh(d, 'branch', '--merged', 'HEAD', '--format=%(refname:short)'));
    const by = Object.fromEntries(list.map((b) => [b.name, b]));
    assert.deepEqual(Object.keys(by).sort(), ['ahead', 'feature', 'in-worktree', 'main', 'merged-old', 'remote-gone']);
    assert.equal(by.main.checkedOut, true);
    assert.equal(by['in-worktree'].checkedOut, true);
    assert.equal(by['remote-gone'].gone, true);
    assert.equal(by['remote-gone'].upstream, 'origin/remote-gone');
    assert.equal(by['remote-gone'].merged, true);
    assert.equal(by.feature.merged, false);
    assert.equal(by['merged-old'].merged, true);
    assert.match(by.feature.sha, /^[0-9a-f]{40}$/);

    const offer = deletable(list).map((b) => b.name);
    assert.deepEqual(offer.filter((n) => n !== 'ahead'), ['remote-gone', 'merged-old', 'feature']);
    assert.equal(by.ahead.merged, true);
    assert.throws(() => sh(d, 'branch', '-d', 'ahead'), /not yet merged|not fully merged/);
    sh(d, ...planDelete([by.ahead], false).safe!);
    assert.ok(!sh(d, 'branch', '--format=%(refname:short)').split('\n').includes('ahead'));
    assert.equal(offer[0], 'remote-gone', 'merged and gone first');
    assert.equal(offer[offer.length - 1], 'feature', 'unmerged last');
    assert.ok(!offer.includes('main') && !offer.includes('in-worktree'));
    assert.equal(branchNote(by['remote-gone'], 'main'), 'merged into main · origin/remote-gone deleted on the remote');
    assert.equal(branchNote(by.feature, 'main'), 'not merged into main');

    // Without force the unmerged branch is kept.
    const chosen = [by['remote-gone'], by['merged-old'], by.feature];
    const p = planDelete(chosen, false);
    assert.deepEqual(p.safe, ['branch', '-D', '--', 'remote-gone', 'merged-old']);
    assert.equal(p.force, null);
    assert.deepEqual(p.kept, ['feature']);
    sh(d, ...p.safe!);
    const f = planDelete(chosen, true);
    assert.deepEqual(f.force, ['branch', '-D', '--', 'feature']);
    sh(d, ...f.force!);
    assert.deepEqual(sh(d, 'branch', '--format=%(refname:short)').split('\n').filter(Boolean).sort(), ['in-worktree', 'main']);
    // Undo puts them back at the same commits.
    for (const b of chosen) sh(d, ...restoreArgs(b));
    assert.equal(sh(d, 'rev-parse', 'refs/heads/feature').trim(), by.feature.sha);
    assert.equal(sh(d, 'rev-parse', 'refs/heads/remote-gone').trim(), by['remote-gone'].sha);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('nameList shortens long lists', () => {
  assert.equal(nameList(['a', 'b']), 'a, b');
  assert.equal(nameList(['a', 'b', 'c', 'd'], 2), 'a, b and 2 more');
});
