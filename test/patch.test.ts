import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { patchArgs, patchFileName, inspectPatch, normalizePatch, applyCommands, retryWithoutIndex, conflictedFromApply, numstatSummary, safeName } from '../src/core/patch';
import { git, GitError } from '../src/core/gitlog';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: ENV });

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mergeline-patch-'));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'commit.gpgsign', 'false');
  sh(dir, 'config', 'user.name', 'Ada');
  sh(dir, 'config', 'user.email', 'ada@example.com');
  return dir;
}
const commit = (dir: string, file: string, text: string, msg: string) => {
  writeFileSync(join(dir, file), text);
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', msg);
  return sh(dir, 'rev-parse', 'HEAD').trim();
};
const run = async (dir: string, cmds: string[][]) => {
  for (let i = 0; i < cmds.length; i++) {
    try {
      await git(dir, cmds[i]);
      return { ok: true, i, err: '' };
    } catch (e) {
      const err = (e as GitError).stderr;
      if (i + 1 < cmds.length && retryWithoutIndex(err)) continue;
      return { ok: false, i, err };
    }
  }
  return { ok: false, i: -1, err: '' };
};

test('patchFileName follows git format-patch naming', () => {
  assert.equal(patchFileName('Fix the parser: handle "quotes" (again)'), '0001-Fix-the-parser-handle-quotes-again.patch');
  assert.equal(patchFileName('...', 3), '0003-patch.patch');
  assert.equal(patchFileName('a'.repeat(100)).length, '0001-'.length + 64 + '.patch'.length);
  assert.equal(safeName('feature/login'), 'feature-login');
  assert.equal(safeName('origin/fix bug'), 'origin-fix-bug');
});

test('inspectPatch tells a mailbox from a plain diff and from other text', () => {
  const dir = repo();
  try {
    const base = commit(dir, 'f.txt', 'a\nb\n', 'init');
    commit(dir, 'f.txt', 'a\nB\n', 'Change b to B');
    commit(dir, 'g.txt', 'g\n', '[ui] A very long subject line that git will fold onto a second header line because it is longer than the limit');
    const mbox = sh(dir, ...patchArgs({ kind: 'branch', branch: 'HEAD', base }));
    const i = inspectPatch(mbox);
    assert.equal(i.kind, 'mbox');
    assert.equal(i.commits, 2);
    assert.equal(i.subjects[0], 'Change b to B');
    assert.equal(i.subjects[1], '[ui] A very long subject line that git will fold onto a second header line because it is longer than the limit');
    const diff = sh(dir, ...patchArgs({ kind: 'diff', from: base, to: 'HEAD' }));
    assert.deepEqual(inspectPatch(diff), { kind: 'diff', commits: 0, subjects: [] });
    // A rename has no hunks but is still a diff.
    sh(dir, 'mv', 'g.txt', 'h.txt');
    sh(dir, 'commit', '-q', '-m', 'rename');
    assert.equal(inspectPatch(sh(dir, 'diff', '-M', 'HEAD~1', 'HEAD')).kind, 'diff');
    assert.equal(inspectPatch('hello\nworld\n').kind, 'none');
    assert.equal(inspectPatch('').kind, 'none');
    // Pasted with CRLF line ends.
    assert.equal(inspectPatch(mbox.replace(/\n/g, '\r\n')).commits, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('normalizePatch adds the missing final newline and keeps all-CRLF text', () => {
  assert.equal(normalizePatch('a\nb'), 'a\nb\n');
  assert.equal(normalizePatch('a\r\nb\n'), 'a\nb\n');
  assert.equal(normalizePatch('a\r\nb\r\n'), 'a\r\nb\r\n');
});

test('a commit, a series, a branch, the working tree and a stash round-trip through git am / git apply', async () => {
  const dir = repo();
  try {
    const root = commit(dir, 'f.txt', 'a\nb\nc\n', 'init');
    sh(dir, 'checkout', '-q', '-b', 'feat');
    const c1 = commit(dir, 'f.txt', 'a\nB\nc\n', 'one');
    commit(dir, 'g.txt', 'g\n', 'two');
    const c3 = commit(dir, 'f.txt', 'a\nB\nC\n', 'three');
    sh(dir, 'checkout', '-q', 'main');

    // One commit → git am → same tree change, same author and message.
    const one = sh(dir, ...patchArgs({ kind: 'commit', sha: c1, merge: false }));
    assert.equal(inspectPatch(one).commits, 1);
    const f1 = join(dir, '..', 'one.patch');
    writeFileSync(f1, one);
    assert.ok((await run(dir, applyCommands('am', f1))).ok);
    assert.equal(sh(dir, 'log', '-1', '--format=%s|%an').trim(), 'one|Ada');
    assert.equal(readFileSync(join(dir, 'f.txt'), 'utf8'), 'a\nB\nc\n');
    sh(dir, 'reset', '-q', '--hard', root);

    // Series c1..c3 (both ends included) → 3 commits.
    const series = sh(dir, ...patchArgs({ kind: 'series', oldest: c1, newest: c3, root: false }));
    assert.equal(inspectPatch(series).commits, 3);
    // From the root commit: --root includes it.
    assert.equal(inspectPatch(sh(dir, ...patchArgs({ kind: 'series', oldest: root, newest: c3, root: true }))).commits, 4);
    // Branch feat not on main → the same 3.
    assert.equal(sh(dir, ...patchArgs({ kind: 'branch', branch: 'feat', base: 'main' })), series);
    writeFileSync(f1, series);
    assert.ok((await run(dir, applyCommands('am', f1))).ok);
    assert.equal(sh(dir, 'rev-list', '--count', 'HEAD').trim(), '4');
    assert.equal(sh(dir, 'rev-parse', 'HEAD^{tree}').trim(), sh(dir, 'rev-parse', 'feat^{tree}').trim());
    // Reverse: undoes the whole series in the working tree (staged by --3way).
    assert.ok((await run(dir, applyCommands('reverse', f1))).ok);
    assert.equal(readFileSync(join(dir, 'f.txt'), 'utf8'), 'a\nb\nc\n');
    assert.ok(!existsSync(join(dir, 'g.txt')));
    sh(dir, 'reset', '-q', '--hard', root);

    // Working tree (staged + unstaged) and stash → git apply → same files.
    writeFileSync(join(dir, 'f.txt'), 'x\nb\nc\n');
    sh(dir, 'add', 'f.txt');
    writeFileSync(join(dir, 'f.txt'), 'x\nb\nc\nd\n');
    const work = sh(dir, ...patchArgs({ kind: 'working' }));
    assert.equal(inspectPatch(work).kind, 'diff');
    sh(dir, 'stash', '-q');
    const stash = sh(dir, ...patchArgs({ kind: 'stash', ref: 'stash@{0}' }));
    assert.equal(stash, work);
    // A `git stash -u` keeps untracked files; its patch has them too.
    sh(dir, 'stash', 'pop', '-q');
    writeFileSync(join(dir, 'new.txt'), 'new\n');
    sh(dir, 'stash', '-q', '-u');
    assert.match(sh(dir, ...patchArgs({ kind: 'stash', ref: 'stash@{0}' })), /^diff --git a\/new\.txt b\/new\.txt$/m);
    sh(dir, 'stash', 'drop', '-q');
    writeFileSync(f1, work);
    const r = await run(dir, applyCommands('apply', f1));
    assert.ok(r.ok);
    assert.equal(readFileSync(join(dir, 'f.txt'), 'utf8'), 'x\nb\nc\nd\n');
    rmSync(f1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a merge commit becomes a diff against its first parent', async () => {
  const dir = repo();
  try {
    commit(dir, 'f.txt', 'a\n', 'init');
    sh(dir, 'checkout', '-q', '-b', 'side');
    commit(dir, 's.txt', 's\n', 'side');
    sh(dir, 'checkout', '-q', 'main');
    commit(dir, 'm.txt', 'm\n', 'main');
    sh(dir, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    const out = sh(dir, ...patchArgs({ kind: 'commit', sha: 'HEAD', merge: true }));
    assert.equal(inspectPatch(out).kind, 'diff');
    assert.match(out, /^\+\+\+ b\/s\.txt$/m);
    assert.doesNotMatch(out, /m\.txt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('git apply falls back to the working tree when a touched file has unstaged changes, and reports conflicts', async () => {
  const dir = repo();
  try {
    commit(dir, 'f.txt', '1\n2\n3\n4\n5\n6\n7\n8\n', 'init');
    const patch = join(dir, '..', 'p.diff');
    writeFileSync(join(dir, 'f.txt'), '1\nTWO\n3\n4\n5\n6\n7\n8\n');
    writeFileSync(patch, sh(dir, 'diff'));
    sh(dir, 'checkout', '-q', '--', 'f.txt');
    // Unstaged edit far from the hunk: --3way refuses ("does not match index"), plain apply works.
    writeFileSync(join(dir, 'f.txt'), '1\n2\n3\n4\n5\n6\n7\nEIGHT\n');
    const r = await run(dir, applyCommands('apply', patch));
    assert.ok(r.ok, r.err);
    assert.equal(r.i, 1);
    assert.equal(readFileSync(join(dir, 'f.txt'), 'utf8'), '1\nTWO\n3\n4\n5\n6\n7\nEIGHT\n');
    sh(dir, 'checkout', '-q', '--', 'f.txt');
    // Committed change on the same line: --3way leaves conflict markers and names the file.
    commit(dir, 'f.txt', '1\nZWEI\n3\n4\n5\n6\n7\n8\n', 'other');
    const c = await run(dir, applyCommands('apply', patch));
    assert.ok(!c.ok);
    assert.deepEqual(conflictedFromApply(c.err), ['f.txt']);
    assert.match(readFileSync(join(dir, 'f.txt'), 'utf8'), /^<<<<<<< /m);
    rmSync(patch);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('numstatSummary counts each path once', () => {
  assert.equal(numstatSummary('1\t0\tf\n1\t0\tg\n1\t1\tf\n'), '2 files changed, +3 −1');
  assert.equal(numstatSummary('-\t-\timg.png\n'), '1 file changed, +0 −0');
  assert.equal(numstatSummary(''), '');
});
