import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WaitDir, waitScript, editKind, todoSummary, todoNeedsMessage } from '../src/core/waiteditor';
import { git } from '../src/core/gitlog';
import { readOperation } from '../src/core/progress';

const env = { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const subjects = (d: string) => sh(d, 'log', '--format=%s').split('\n');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), 'mergeline-wait-test-'));
  sh(d, 'init', '-q', '-b', 'main');
  sh(d, 'config', 'commit.gpgsign', 'false');
  sh(d, 'config', 'user.name', 'Ada');
  sh(d, 'config', 'user.email', 'ada@example.com');
  for (const s of ['a', 'b', 'c', 'd']) {
    writeFileSync(join(d, `${s}.txt`), s + '\n');
    sh(d, 'add', '-A');
    sh(d, 'commit', '-q', '-m', s);
  }
  return d;
}

/**
 * Plays the extension: runs git with the wait editors and answers each request with `handle`
 * (which may rewrite the file and returns true for done, false for cancel). Returns the kinds
 * seen and git's error, if any.
 */
async function drive(d: string, args: string[], handle: (kind: string, file: string, n: number) => boolean) {
  const wd = new WaitDir();
  const seen: string[] = [];
  let stop = false;
  const loop = (async () => {
    while (!stop) {
      for (const r of wd.poll()) {
        const file = resolve(d, r.file);
        seen.push(editKind(r.file));
        wd.answer(r.id, handle(editKind(r.file), file, seen.length));
      }
      await sleep(30);
    }
  })();
  let err: string | null = null;
  try {
    await git(d, args, { env: { ...wd.env(), GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' } });
  } catch (e) {
    err = String((e as Error).message);
  }
  stop = true;
  await loop;
  wd.dispose();
  return { seen, err };
}

test('todo helpers: kind from the file name, command counts, steps that ask for a message', () => {
  assert.equal(editKind('/r/.git/rebase-merge/git-rebase-todo'), 'todo');
  assert.equal(editKind('C:\\r\\.git\\rebase-merge\\git-rebase-todo'), 'todo');
  assert.equal(editKind('.git/COMMIT_EDITMSG'), 'message');
  const todo = 'pick 1 a\nr 2 b\n  squash 3 c\nf 4 d\nx make test\n# pick 5 comment\n\ndrop 6 e\n';
  assert.deepEqual(todoSummary(todo), { pick: 1, reword: 1, squash: 1, fixup: 1, exec: 1, drop: 1 });
  assert.equal(todoNeedsMessage(todo), true);
  assert.equal(todoNeedsMessage('pick 1 a\nfixup 2 b\nfixup -C 3 c\n# reword 4 x\n'), false);
  assert.equal(todoNeedsMessage('fixup -c 3 c\n'), true);
  assert.match(waitScript(10), /max=50/);
});

test('rebase -i through the wait editor: reorder, reword (message edited), drop', async () => {
  const d = repo();
  writeFileSync(join(d, 'a.txt'), 'dirty\n'); // --autostash keeps it
  const r = await drive(d, ['rebase', '-i', '--autostash', 'HEAD~3'], (kind, file) => {
    if (kind === 'todo') {
      const lines = readFileSync(file, 'utf8').split('\n').filter((l) => /^pick /.test(l));
      assert.equal(lines.length, 3);
      // b c d → d (reword) b, c dropped
      const [b, c, dd] = lines;
      writeFileSync(file, [dd.replace(/^pick/, 'reword'), b, c.replace(/^pick/, 'drop')].join('\n') + '\n');
    } else {
      assert.match(readFileSync(file, 'utf8'), /^d\n/);
      writeFileSync(file, 'd, reworded\n\nwith a body\n# a comment line\n');
    }
    return true;
  });
  assert.equal(r.err, null);
  assert.deepEqual(r.seen, ['todo', 'message']);
  assert.deepEqual(subjects(d), ['b', 'd, reworded', 'a']);
  assert.equal(sh(d, 'log', '-1', '--skip=1', '--format=%B'), 'd, reworded\n\nwith a body');
  assert.equal(readFileSync(join(d, 'a.txt'), 'utf8'), 'dirty\n');
  assert.equal(existsSync(join(d, 'c.txt')), false);
  assert.equal(await readOperation(d), null);
  rmSync(d, { recursive: true, force: true });
});

test('cancelling the todo aborts the rebase: nothing changes, uncommitted changes come back', async () => {
  const d = repo();
  const head = sh(d, 'rev-parse', 'HEAD');
  writeFileSync(join(d, 'a.txt'), 'dirty\n');
  const r = await drive(d, ['rebase', '-i', '--autostash', 'HEAD~2'], () => false);
  assert.match(r.err ?? '', /problem with the editor/);
  assert.equal(sh(d, 'rev-parse', 'HEAD'), head);
  assert.equal(await readOperation(d), null);
  assert.equal(readFileSync(join(d, 'a.txt'), 'utf8'), 'dirty\n');
  assert.equal(sh(d, 'stash', 'list'), '');
  rmSync(d, { recursive: true, force: true });
});

test('cancelling a message stops the rebase there (the extension then aborts it)', async () => {
  const d = repo();
  const head = sh(d, 'rev-parse', 'HEAD');
  const r = await drive(d, ['rebase', '-i', 'HEAD~2'], (kind, file) => {
    if (kind === 'todo') writeFileSync(file, readFileSync(file, 'utf8').replace(/^pick/gm, 'reword'));
    return kind === 'todo';
  });
  assert.ok(r.err);
  assert.deepEqual(r.seen, ['todo', 'message']);
  assert.equal((await readOperation(d))?.kind, 'rebase');
  sh(d, 'rebase', '--abort');
  assert.equal(sh(d, 'rev-parse', 'HEAD'), head);
  rmSync(d, { recursive: true, force: true });
});

test('dispose answers a waiting script with cancel, so git does not hang', async () => {
  const d = repo();
  const head = sh(d, 'rev-parse', 'HEAD');
  const wd = new WaitDir();
  const run = git(d, ['rebase', '-i', 'HEAD~2'], { env: wd.env() }).then(() => null, (e) => String(e.message));
  for (let i = 0; i < 100 && !wd.poll().length; i++) await sleep(30);
  wd.dispose();
  const err = await run;
  assert.match(err ?? '', /problem with the editor/);
  assert.equal(sh(d, 'rev-parse', 'HEAD'), head);
  rmSync(d, { recursive: true, force: true });
});
