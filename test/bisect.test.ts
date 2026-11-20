import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBisect, markArgs, shQuote, bisectRunLine } from '../src/core/bisect';
import { git } from '../src/core/gitlog';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: ENV });

/** A linear repo of 10 commits c1..c10; f.txt contains "bug" from c7 on. Returns shas oldest first. */
function makeRepo(): { dir: string; shas: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'mergeline-bisect-'));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'commit.gpgsign', 'false');
  sh(dir, 'config', 'user.name', 'Ada');
  sh(dir, 'config', 'user.email', 'ada@example.com');
  const shas: string[] = [];
  for (let i = 1; i <= 10; i++) {
    writeFileSync(join(dir, 'f.txt'), `${i}\n${i >= 7 ? 'bug\n' : ''}`);
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-q', '-m', `c${i}`);
    shas.push(sh(dir, 'rev-parse', 'HEAD').trim());
  }
  return { dir, shas };
}
const hasBug = (dir: string) => readFileSync(join(dir, 'f.txt'), 'utf8').includes('bug');

test('markArgs and shQuote', () => {
  assert.deepEqual(markArgs(['bad', 'good'], 'bad', 'abc'), ['bisect', 'bad', 'abc']);
  assert.deepEqual(markArgs(['new', 'old'], 'good'), ['bisect', 'old']);
  assert.deepEqual(markArgs(['slow', 'fast'], 'skip', 'x'), ['bisect', 'skip', 'x']);
  assert.equal(shQuote('npm'), 'npm');
  assert.equal(shQuote('npm test && echo ok'), `'npm test && echo ok'`);
  assert.equal(shQuote(`it's`), `'it'\\''s'`);
  assert.equal(bisectRunLine('npm test && echo ok'), `git bisect run sh -c 'npm test && echo ok'`);
  assert.equal(bisectRunLine('say "hi"', true), 'git bisect run sh -c "say \\"hi\\""');
});

test('readBisect: none, waiting, testing, skip, first bad commit, reset', async () => {
  const { dir, shas } = makeRepo();
  try {
    assert.equal(await readBisect(dir), null);
    await git(dir, ['bisect', 'start']);
    let st = (await readBisect(dir))!;
    assert.deepEqual(st.terms, ['bad', 'good']);
    assert.equal(st.start, 'main');
    assert.equal(st.bad, null);
    assert.equal(st.left, null);
    await git(dir, markArgs(st.terms, 'bad', shas[9]));
    st = (await readBisect(dir))!;
    assert.equal(st.bad, shas[9]);
    assert.deepEqual(st.good, []);
    await git(dir, markArgs(st.terms, 'good', shas[0]));
    st = (await readBisect(dir))!;
    assert.deepEqual(st.good, [shas[0]]);
    // 8 commits between c1 (good) and c10 (bad); git checks one out in the middle.
    assert.equal(st.left, 8);
    assert.equal(st.steps, 4);
    assert.ok(st.testing && shas.includes(st.testing));
    assert.match(st.testingSubject!, /^c\d+$/);
    assert.equal(st.firstBad, null);
    // Skip the commit under test: one fewer left, it is listed as skipped, git moves on.
    const skipped = st.testing!;
    await git(dir, markArgs(st.terms, 'skip'));
    st = (await readBisect(dir))!;
    assert.deepEqual(st.skip, [skipped]);
    assert.equal(st.left, 7);
    assert.notEqual(st.testing, skipped);
    // Answer truthfully until it finishes.
    for (let i = 0; i < 10 && !st.firstBad; i++) {
      await git(dir, markArgs(st.terms, hasBug(dir) ? 'bad' : 'good'));
      st = (await readBisect(dir))!;
    }
    assert.equal(st.firstBad, shas[6], 'c7 introduced the bug');
    assert.equal(st.firstBadSubject, 'c7');
    assert.equal(st.left, null);
    await git(dir, ['bisect', 'reset']);
    assert.equal(await readBisect(dir), null);
    assert.equal(sh(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readBisect: custom terms, and only skipped commits left', async () => {
  const { dir, shas } = makeRepo();
  try {
    await git(dir, ['bisect', 'start', '--term-new=broken', '--term-old=fine']);
    let st = (await readBisect(dir))!;
    assert.deepEqual(st.terms, ['broken', 'fine']);
    await git(dir, markArgs(st.terms, 'bad', shas[7])); // c8 broken
    await git(dir, markArgs(st.terms, 'good', shas[4])); // c5 fine
    st = (await readBisect(dir))!;
    assert.equal(st.bad, shas[7]);
    assert.deepEqual(st.good, [shas[4]]);
    assert.equal(st.left, 2); // c6, c7
    // Skip both candidates: git cannot decide between c6, c7 and c8.
    await git(dir, ['bisect', 'skip', shas[5], shas[6]]).catch(() => '');
    st = (await readBisect(dir))!;
    assert.equal(st.onlySkipped, 3);
    assert.equal(st.firstBad, null);
    assert.equal(st.left, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('git bisect run with the command quoted as one argument finds the commit', async () => {
  const { dir, shas } = makeRepo();
  try {
    await git(dir, ['bisect', 'start', shas[9], shas[0]]);
    // A shell command with && and !, passed as a single argument (what the terminal line does).
    const cmd = `test -f f.txt && ! grep -q bug f.txt`;
    const script = join(dir, '..', `run-${Date.now()}.sh`);
    writeFileSync(script, `#!/bin/sh\ncd ${shQuote(dir)} && ${bisectRunLine(cmd)}\n`);
    chmodSync(script, 0o755);
    try {
      execFileSync(script, { encoding: 'utf8', env: ENV });
    } finally {
      rmSync(script, { force: true });
    }
    const st = (await readBisect(dir))!;
    assert.equal(st.firstBad, shas[6]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
