import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readContaining, parseContaining } from '../src/core/gitlog';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: ENV }).trim();
let n = 0;
const commit = (cwd: string, msg: string, date: string) => {
  writeFileSync(join(cwd, `f${n++}.txt`), msg);
  sh(cwd, 'add', '-A');
  execFileSync('git', ['commit', '-q', '-m', msg], { cwd, env: { ...ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  return sh(cwd, 'rev-parse', 'HEAD');
};

test('parseContaining splits heads, remotes (no HEAD) and tags, tags oldest first with peeled shas', () => {
  const US = '\x1f';
  const c = parseContaining([
    ['refs/tags/v2', 't2', 'c2', '200'],
    ['refs/heads/main', 'c3', '', '300'],
    ['refs/remotes/origin/HEAD', 'c3', '', '300'],
    ['refs/remotes/origin/main', 'c3', '', '300'],
    ['refs/tags/v1', 'c1', '', '100'],
    ['refs/tags/a-same-day', 'c1', '', '100'],
  ].map((r) => r.join(US)).join('\n') + '\n');
  assert.deepEqual(c.heads, [{ name: 'main', sha: 'c3' }]);
  assert.deepEqual(c.remotes, [{ name: 'origin/main', sha: 'c3' }]);
  assert.deepEqual(c.tags.map((t) => [t.name, t.sha]), [['a-same-day', 'c1'], ['v1', 'c1'], ['v2', 'c2']]);
});

test('readContaining: the first release with a fix, branches that have it, and none for a dangling commit', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ml-contains-'));
  try {
    sh(d, 'init', '-q', '-b', 'main');
    sh(d, 'config', 'commit.gpgsign', 'false');
    sh(d, 'config', 'tag.gpgsign', 'false');
    commit(d, 'start', '2024-01-01T00:00:00Z');
    sh(d, 'tag', 'v1.0');
    const fix = commit(d, 'fix', '2024-02-01T00:00:00Z');
    sh(d, 'checkout', '-q', '-b', 'release/1.x');
    commit(d, 'release work', '2024-03-01T00:00:00Z');
    // An annotated tag made later than the lightweight one, on an older commit's descendant.
    execFileSync('git', ['tag', '-a', 'v1.2', '-m', 'v1.2'], { cwd: d, env: { ...ENV, GIT_COMMITTER_DATE: '2024-05-01T00:00:00Z' } });
    sh(d, 'checkout', '-q', 'main');
    commit(d, 'later', '2024-04-01T00:00:00Z');
    sh(d, 'tag', 'v1.1');
    sh(d, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    sh(d, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    const c = await readContaining(d, fix);
    assert.deepEqual(c.heads.map((h) => h.name).sort(), ['main', 'release/1.x']);
    assert.deepEqual(c.remotes.map((r) => r.name), ['origin/main']);
    assert.deepEqual(c.tags.map((t) => t.name), ['v1.1', 'v1.2'], 'v1.0 predates the fix; v1.1 (April) is older than v1.2 (May)');
    assert.equal(c.tags[1].sha, sh(d, 'rev-parse', 'release/1.x'), 'annotated tag peeled to its commit');
    // A commit no ref reaches.
    sh(d, 'checkout', '-q', '--detach');
    const lost = commit(d, 'lost', '2024-06-01T00:00:00Z');
    sh(d, 'checkout', '-q', 'main');
    const none = await readContaining(d, lost);
    assert.deepEqual([none.heads.length, none.remotes.length, none.tags.length], [0, 0, 0]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
