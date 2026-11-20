import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planRewrite, runRewrite, buildTodo, rewordMessage, squashMessage, shQuote, RewriteError } from '../src/core/rewrite';

const env = { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
const subjects = (d: string) => sh(d, 'log', '--format=%s').split('\n');

/** main: one → two → three → four (files 1..4.txt), branch side off two with a merge-free commit. */
function repo(): { d: string; sha: Record<string, string> } {
  const d = mkdtempSync(join(tmpdir(), 'mergeline-rw-'));
  sh(d, 'init', '-q', '-b', 'main');
  sh(d, 'config', 'commit.gpgsign', 'false');
  // runRewrite's own git calls do not get the env above (CI has no global identity).
  sh(d, 'config', 'user.name', 'Ada');
  sh(d, 'config', 'user.email', 'ada@example.com');
  const sha: Record<string, string> = {};
  for (const [i, s] of ['one', 'two', 'three', 'four'].entries()) {
    writeFileSync(join(d, `${i + 1}.txt`), s + '\n');
    sh(d, 'add', '-A');
    sh(d, 'commit', '-q', '-m', s + (s === 'three' ? '\n\nBody of three.\nSecond line.' : ''));
    sha[s] = sh(d, 'rev-parse', 'HEAD');
  }
  return { d, sha };
}

test('buildTodo and shQuote', () => {
  const c = ['a1', 'b2', 'c3', 'd4'];
  assert.deepEqual(buildTodo({ kind: 'drop', sha: 'b2' }, c, '/m'), ['pick a1', 'drop b2', 'pick c3', 'pick d4']);
  assert.deepEqual(buildTodo({ kind: 'fixup', sha: 'c3' }, c, '/m'), ['pick a1', 'pick b2', 'fixup c3', 'pick d4']);
  const rw = buildTodo({ kind: 'reword', sha: 'b2', subject: 'x' }, c, '/m');
  assert.equal(rw[2], "exec git commit --amend --only --allow-empty --no-verify --cleanup=verbatim -F '/m'");
  assert.deepEqual(buildTodo({ kind: 'squash', from: 'b2', to: 'd4', message: 'x' }, c, '/m').map((l) => l.split(' ')[0]), ['pick', 'pick', 'fixup', 'fixup', 'exec']);
  assert.equal(shQuote("it's"), `'it'\\''s'`);
  assert.equal(execFileSync('sh', ['-c', `printf %s ${shQuote("a 'b' $c")}`], { encoding: 'utf8' }), "a 'b' $c");
});

test('reword an older commit keeps its body and the tree; reword HEAD amends', async () => {
  const { d, sha } = repo();
  try {
    const tree = sh(d, 'rev-parse', 'HEAD^{tree}');
    const op = { kind: 'reword' as const, sha: sha.three, subject: 'three, reworded' };
    const plan = await planRewrite(d, op);
    assert.equal(plan.rewritten, 2);
    assert.equal(plan.base, sha.two);
    const msg = await rewordMessage(d, sha.three, op.subject);
    assert.equal(msg, 'three, reworded\n\nBody of three.\nSecond line.\n');
    const r = await runRewrite(d, op, plan, msg);
    assert.equal(r.before, sha.four);
    assert.notEqual(r.after, sha.four);
    assert.deepEqual(subjects(d), ['four', 'three, reworded', 'two', 'one']);
    assert.equal(sh(d, 'log', '-1', '--format=%B', 'HEAD~1'), 'three, reworded\n\nBody of three.\nSecond line.');
    assert.equal(sh(d, 'rev-parse', 'HEAD^{tree}'), tree);
    assert.equal(sh(d, 'rev-parse', 'HEAD~2'), sha.two, 'older commits keep their hashes');
    assert.ok(!existsSync(join(d, '.git', 'MERGELINE_MSG')) && !existsSync(join(d, '.git', 'MERGELINE_TODO')), 'temp files removed');
    // HEAD: no rebase, and staged changes stay out of the amended commit.
    writeFileSync(join(d, 'staged.txt'), 'x');
    sh(d, 'add', 'staged.txt');
    const head = sh(d, 'rev-parse', 'HEAD');
    const op2 = { kind: 'reword' as const, sha: head, subject: 'four!' };
    await runRewrite(d, op2, await planRewrite(d, op2), await rewordMessage(d, head, 'four!'));
    assert.equal(subjects(d)[0], 'four!');
    assert.equal(sh(d, 'status', '--porcelain'), 'A  staged.txt');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('drop, fixup into parent and squash a range; uncommitted changes survive', async () => {
  const { d, sha } = repo();
  try {
    writeFileSync(join(d, '1.txt'), 'dirty\n');
    const drop = { kind: 'drop' as const, sha: sha.two };
    await runRewrite(d, drop, await planRewrite(d, drop));
    assert.deepEqual(subjects(d), ['four', 'three', 'one']);
    assert.ok(!existsSync(join(d, '2.txt')));
    assert.equal(readFileSync(join(d, '1.txt'), 'utf8'), 'dirty\n', 'autostash restored the change');
    sh(d, 'checkout', '-q', '--', '1.txt');

    const three = sh(d, 'rev-parse', 'HEAD~1');
    const fix = { kind: 'fixup' as const, sha: sh(d, 'rev-parse', 'HEAD') };
    const plan = await planRewrite(d, fix);
    assert.equal(plan.rewritten, 2, 'parent and the commit');
    await runRewrite(d, fix, plan);
    assert.deepEqual(subjects(d), ['three', 'one']);
    assert.notEqual(sh(d, 'rev-parse', 'HEAD'), three);
    assert.equal(sh(d, 'show', '--format=', '--name-only', 'HEAD'), '3.txt\n4.txt');

    for (const s of ['five', 'six', 'seven']) {
      writeFileSync(join(d, s + '.txt'), s);
      sh(d, 'add', '-A');
      sh(d, 'commit', '-q', '-m', s);
    }
    const [from, to] = [sh(d, 'rev-parse', 'HEAD~2'), sh(d, 'rev-parse', 'HEAD~1')];
    const sq = { kind: 'squash' as const, from, to, message: '' };
    const p2 = await planRewrite(d, sq);
    sq.message = await squashMessage(d, 'five and six', [from, to]);
    await runRewrite(d, sq, p2, sq.message);
    assert.deepEqual(subjects(d), ['seven', 'five and six', 'three', 'one']);
    assert.equal(sh(d, 'log', '-1', '--format=%B', 'HEAD~1'), 'five and six\n\n* five\n* six');
    await assert.rejects(planRewrite(d, { kind: 'squash', from: to, to: from, message: 'x' }), RewriteError);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('refuses merges, other branches and the root fixup; reports pushed commits; conflict stops the rebase', async () => {
  const { d, sha } = repo();
  try {
    await assert.rejects(planRewrite(d, { kind: 'fixup', sha: sha.one }), /no parent/);
    // Root commit can be dropped/reworded (rebase --root).
    const rp = await planRewrite(d, { kind: 'reword', sha: sha.one, subject: 'x' });
    assert.equal(rp.base, null);
    assert.equal(rp.rewritten, 4);
    sh(d, 'checkout', '-q', '-b', 'side', sha.two);
    writeFileSync(join(d, 's.txt'), 's');
    sh(d, 'add', '-A');
    sh(d, 'commit', '-q', '-m', 'side');
    const side = sh(d, 'rev-parse', 'HEAD');
    sh(d, 'checkout', '-q', 'main');
    await assert.rejects(planRewrite(d, { kind: 'drop', sha: side }), /not on the checked-out branch/);
    sh(d, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    await assert.rejects(planRewrite(d, { kind: 'drop', sha: sha.three }), /merge commit between/);
    await assert.rejects(planRewrite(d, { kind: 'drop', sha: sh(d, 'rev-parse', 'HEAD') }), /This is a merge commit/);
    // Fake a pushed branch: a remote-tracking ref containing `four`.
    sh(d, 'reset', '-q', '--hard', sha.four);
    sh(d, 'update-ref', 'refs/remotes/origin/main', sha.three);
    assert.deepEqual((await planRewrite(d, { kind: 'drop', sha: sha.two })).pushed, ['origin/main']);
    assert.deepEqual((await planRewrite(d, { kind: 'drop', sha: sha.four })).pushed, []);
    // Conflict: four edits a file that three created; dropping three conflicts.
    writeFileSync(join(d, '3.txt'), 'changed by five\n');
    sh(d, 'commit', '-q', '-am', 'five edits 3.txt');
    const drop = { kind: 'drop' as const, sha: sha.three };
    await assert.rejects(runRewrite(d, drop, await planRewrite(d, drop)), /conflict|could not apply/i);
    await assert.rejects(planRewrite(d, { kind: 'drop', sha: sha.two }), /already in progress/);
    sh(d, 'rebase', '--abort');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('place: drag a commit onto another to move it there or fold it in', async () => {
  const c = ['a1', 'b2', 'c3', 'd4'];
  assert.deepEqual(buildTodo({ kind: 'place', sha: 'd4', target: 'a1', fold: false }, c, '/m'), ['pick a1', 'pick d4', 'pick b2', 'pick c3']);
  assert.deepEqual(buildTodo({ kind: 'place', sha: 'd4', target: 'b2', fold: true }, c, '/m'), ['pick a1', 'pick b2', 'fixup d4', 'pick c3']);
  assert.deepEqual(buildTodo({ kind: 'place', sha: 'a1', target: 'c3', fold: false }, c, '/m'), ['pick b2', 'pick c3', 'pick a1', 'pick d4']);
  const { d, sha } = repo();
  try {
    // Move four (HEAD) down to sit right on top of one; one keeps its hash.
    let op = { kind: 'place' as const, sha: sha.four, target: sha.one, fold: false };
    let plan = await planRewrite(d, op);
    assert.equal(plan.rewritten, 3);
    await runRewrite(d, op, plan);
    assert.deepEqual(subjects(d), ['three', 'two', 'four', 'one']);
    assert.equal(sh(d, 'rev-parse', 'HEAD~3'), sha.one);
    assert.equal(sh(d, 'show', 'HEAD~2:4.txt'), 'four');
    // Already right after: refused.
    const four = sh(d, 'rev-parse', 'HEAD~2');
    await assert.rejects(planRewrite(d, { kind: 'place', sha: four, target: sha.one, fold: false }), RewriteError);
    // Fold HEAD (three) into four, two commits further down: four's message, both files.
    const three = sh(d, 'rev-parse', 'HEAD');
    op = { kind: 'place', sha: three, target: four, fold: true };
    plan = await planRewrite(d, op);
    assert.equal(plan.rewritten, 3);
    await runRewrite(d, op, plan);
    assert.deepEqual(subjects(d), ['two', 'four', 'one']);
    assert.deepEqual(sh(d, 'show', '--name-only', '--format=', 'HEAD~1').split('\n').sort(), ['3.txt', '4.txt']);
    // Older onto newer: move one (the root) up to the top.
    op = { kind: 'place', sha: sha.one, target: sh(d, 'rev-parse', 'HEAD'), fold: false };
    plan = await planRewrite(d, op);
    assert.equal(plan.base, null);
    await runRewrite(d, op, plan);
    assert.deepEqual(subjects(d), ['one', 'two', 'four']);
    for (const f of ['1.txt', '2.txt', '3.txt', '4.txt']) assert.ok(existsSync(join(d, f)), f);
    // A commit on another branch cannot be placed.
    sh(d, 'checkout', '-q', '-b', 'side', 'HEAD~1');
    writeFileSync(join(d, 's.txt'), 's\n');
    sh(d, 'add', '-A');
    sh(d, 'commit', '-q', '-m', 'side');
    const side = sh(d, 'rev-parse', 'HEAD');
    sh(d, 'checkout', '-q', 'main');
    await assert.rejects(planRewrite(d, { kind: 'place', sha: side, target: sh(d, 'rev-parse', 'HEAD'), fold: true }), RewriteError);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
