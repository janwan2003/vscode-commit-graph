import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planRewrite, runRewrite, buildTodo, RewriteError } from '../src/core/rewrite';
import { readOperation, unmerged, leftoverMarkers, opArgs, NO_EDITOR } from '../src/core/progress';
import { git } from '../src/core/gitlog';

const env = { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const shTry = (cwd: string, ...args: string[]) => {
  try {
    return sh(cwd, ...args);
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? e);
  }
};
const subjects = (d: string) => sh(d, 'log', '--format=%s').split('\n');

/** main: a → b → c → d, each commit writing its own file, plus f.txt changed by b and c (so swapping them conflicts). */
function repo(): { d: string; sha: Record<string, string> } {
  const d = mkdtempSync(join(tmpdir(), 'mergeline-op-'));
  sh(d, 'init', '-q', '-b', 'main');
  sh(d, 'config', 'commit.gpgsign', 'false');
  sh(d, 'config', 'user.name', 'Ada');
  sh(d, 'config', 'user.email', 'ada@example.com');
  const sha: Record<string, string> = {};
  for (const s of ['a', 'b', 'c', 'd']) {
    writeFileSync(join(d, `${s}.txt`), s + '\n');
    if (s === 'a' || s === 'b' || s === 'c') writeFileSync(join(d, 'f.txt'), `f from ${s}\n`);
    sh(d, 'add', '-A');
    sh(d, 'commit', '-q', '-m', s);
    sha[s] = sh(d, 'rev-parse', 'HEAD');
  }
  return { d, sha };
}

test('buildTodo for move swaps neighbours', () => {
  const c = ['a1', 'b2', 'c3', 'd4'];
  assert.deepEqual(buildTodo({ kind: 'move', sha: 'c3', dir: 'older' }, c, '/m'), ['pick a1', 'pick c3', 'pick b2', 'pick d4']);
  assert.deepEqual(buildTodo({ kind: 'move', sha: 'b2', dir: 'newer' }, c, '/m'), ['pick a1', 'pick c3', 'pick b2', 'pick d4']);
  assert.deepEqual(opArgs('cherry-pick', 'skip'), ['cherry-pick', '--skip']);
  assert.throws(() => opArgs('merge', 'skip'));
});

test('move a commit up and down; refuses the newest up and the root down', async () => {
  const { d, sha } = repo();
  try {
    // d only touches d.txt, so moving it below c does not conflict.
    const op = { kind: 'move' as const, sha: sha.d, dir: 'older' as const };
    const plan = await planRewrite(d, op);
    assert.equal(plan.base, sha.b);
    assert.equal(plan.rewritten, 2);
    const tree = sh(d, 'rev-parse', 'HEAD^{tree}');
    await runRewrite(d, op, plan);
    assert.deepEqual(subjects(d), ['c', 'd', 'b', 'a']);
    assert.equal(sh(d, 'rev-parse', 'HEAD^{tree}'), tree, 'same end result');
    assert.equal(sh(d, 'rev-parse', 'HEAD~2'), sha.b, 'older commits keep their hashes');
    // ...and back up again.
    const dNow = sh(d, 'rev-parse', 'HEAD~1');
    const up = { kind: 'move' as const, sha: dNow, dir: 'newer' as const };
    await runRewrite(d, up, await planRewrite(d, up));
    assert.deepEqual(subjects(d), ['d', 'c', 'b', 'a']);
    await assert.rejects(planRewrite(d, { kind: 'move', sha: sh(d, 'rev-parse', 'HEAD'), dir: 'newer' }), RewriteError);
    await assert.rejects(planRewrite(d, { kind: 'move', sha: sha.a, dir: 'older' }), RewriteError);
    // Moving b below a: the base is the root (--root rebase).
    const root = { kind: 'move' as const, sha: sha.b, dir: 'older' as const };
    const rp = await planRewrite(d, root);
    assert.equal(rp.base, null);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('a conflicting move shows up as a rebase in progress; continue after resolving, abort restores', async () => {
  const { d, sha } = repo();
  try {
    assert.equal(await readOperation(d), null);
    // c and b both rewrite f.txt: putting c first conflicts.
    const op = { kind: 'move' as const, sha: sha.c, dir: 'older' as const };
    await assert.rejects(runRewrite(d, op, await planRewrite(d, op)));
    let st = await readOperation(d);
    assert.ok(st);
    assert.equal(st.kind, 'rebase');
    assert.equal(st.branch, 'main');
    assert.equal(st.onto, sha.a);
    assert.equal(st.step, 1);
    assert.equal(st.total, 3);
    assert.equal(st.stopped, sha.c);
    assert.equal(st.stoppedSubject, 'c');
    assert.deepEqual(st.conflicts, ['f.txt']);
    assert.deepEqual(await unmerged(d), ['f.txt']);
    // Staging the file with the markers still in: no longer unmerged, but flagged.
    sh(d, 'add', 'f.txt');
    assert.deepEqual(await unmerged(d), []);
    assert.deepEqual(await leftoverMarkers(d), ['f.txt']);
    writeFileSync(join(d, 'f.txt'), 'f from c\n');
    sh(d, 'add', 'f.txt');
    assert.deepEqual(await leftoverMarkers(d), []);
    // Continue (no editor): the next pick (b) conflicts again on f.txt.
    await assert.rejects(git(d, opArgs('rebase', 'continue'), { env: NO_EDITOR }));
    st = await readOperation(d);
    assert.equal(st?.step, 2);
    assert.equal(st?.stopped, sha.b);
    assert.deepEqual(st?.conflicts, ['f.txt']);
    // Abort: back to where it started.
    await git(d, opArgs('rebase', 'abort'));
    assert.equal(await readOperation(d), null);
    assert.equal(sh(d, 'rev-parse', 'HEAD'), sha.d);
    assert.deepEqual(subjects(d), ['d', 'c', 'b', 'a']);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('merge, cherry-pick and revert in progress; skip and continue', async () => {
  const { d, sha } = repo();
  try {
    sh(d, 'checkout', '-q', '-b', 'side', sha.b);
    writeFileSync(join(d, 'f.txt'), 'f from side\n');
    sh(d, 'commit', '-q', '-am', 'side change');
    const side = sh(d, 'rev-parse', 'HEAD');
    sh(d, 'checkout', '-q', 'main');
    // merge
    shTry(d, 'merge', '--no-edit', 'side');
    let st = await readOperation(d);
    assert.equal(st?.kind, 'merge');
    assert.equal(st?.onto, side);
    assert.deepEqual(st?.conflicts, ['f.txt']);
    writeFileSync(join(d, 'f.txt'), 'merged\n');
    sh(d, 'add', 'f.txt');
    await git(d, opArgs('merge', 'continue'), { env: NO_EDITOR });
    assert.equal(await readOperation(d), null);
    assert.equal(sh(d, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3, 'merge commit made');
    assert.match(sh(d, 'log', '-1', '--format=%s'), /Merge branch 'side'/, 'prepared message kept, no editor');
    sh(d, 'reset', '-q', '--hard', sha.d);
    // cherry-pick, then skip
    shTry(d, 'cherry-pick', side);
    st = await readOperation(d);
    assert.equal(st?.kind, 'cherry-pick');
    assert.equal(st?.stopped, side);
    assert.equal(st?.stoppedSubject, 'side change');
    await git(d, opArgs('cherry-pick', 'skip'));
    assert.equal(await readOperation(d), null);
    assert.equal(sh(d, 'rev-parse', 'HEAD'), sha.d);
    // revert of b conflicts (c changed f.txt after it)
    shTry(d, 'revert', '--no-edit', sha.b);
    st = await readOperation(d);
    assert.equal(st?.kind, 'revert');
    assert.equal(st?.stopped, sha.b);
    await git(d, opArgs('revert', 'abort'));
    assert.equal(await readOperation(d), null);
    assert.equal(readFileSync(join(d, 'f.txt'), 'utf8'), 'f from c\n');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('edit: stop at an older commit, amend it with staged changes on Continue, later commits replayed; refuses HEAD', async () => {
  const { d, sha } = repo();
  try {
    assert.deepEqual(buildTodo({ kind: 'edit', sha: sha.b }, [sha.b, sha.c, sha.d], '/m'), [`edit ${sha.b}`, `pick ${sha.c}`, `pick ${sha.d}`]);
    await assert.rejects(planRewrite(d, { kind: 'edit', sha: sha.d }), (e) => e instanceof RewriteError && /newest commit/.test(e.message));
    // A dirty file is autostashed and comes back at the end.
    writeFileSync(join(d, 'dirty.txt'), 'wip\n');
    const plan = await planRewrite(d, { kind: 'edit', sha: sha.b });
    assert.equal(plan.rewritten, 3);
    await runRewrite(d, { kind: 'edit', sha: sha.b }, plan);
    const op = await readOperation(d);
    assert.equal(op?.kind, 'rebase');
    assert.equal(op?.stopped, sha.b);
    assert.equal(sh(d, 'rev-parse', 'HEAD'), sha.b, 'stopped with b replayed unchanged');
    writeFileSync(join(d, 'b.txt'), 'b, fixed\n');
    sh(d, 'add', 'b.txt');
    await git(d, opArgs('rebase', 'continue'), { env: NO_EDITOR });
    assert.equal(await readOperation(d), null);
    assert.deepEqual(subjects(d), ['d', 'c', 'b', 'a'], 'same commits, same messages');
    assert.equal(sh(d, 'show', 'HEAD~2:b.txt'), 'b, fixed', 'the change went into b');
    assert.equal(sh(d, 'rev-parse', 'HEAD~3'), sha.a, 'a untouched');
    assert.notEqual(sh(d, 'rev-parse', 'HEAD~2'), sha.b);
    assert.equal(readFileSync(join(d, 'dirty.txt'), 'utf8'), 'wip\n', 'autostash restored');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
