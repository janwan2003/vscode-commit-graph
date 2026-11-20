import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRemotes, readRemotes, remoteNameProblem, remoteUsage } from '../src/core/remotes';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: ENV });

test('parseRemotes: fetch and push URLs, separate push URL, CRLF', () => {
  const rs = parseRemotes('origin\thttps://github.com/a/b.git (fetch)\norigin\thttps://github.com/a/b.git (push)\r\nfork\tgit@github.com:me/b.git (fetch)\nfork\tssh://other/b.git (push)\nweird line\n');
  assert.deepEqual(rs, [
    { name: 'origin', fetch: 'https://github.com/a/b.git', push: 'https://github.com/a/b.git' },
    { name: 'fork', fetch: 'git@github.com:me/b.git', push: 'ssh://other/b.git' },
  ]);
  assert.deepEqual(parseRemotes('p\t/tmp/with space/repo (fetch)\n'), [{ name: 'p', fetch: '/tmp/with space/repo', push: '/tmp/with space/repo' }]);
});

test('remoteNameProblem', () => {
  assert.equal(remoteNameProblem('upstream', ['origin']), undefined);
  assert.equal(remoteNameProblem('team/fork', []), undefined);
  assert.match(remoteNameProblem('origin', ['origin'])!, /already exists/);
  for (const bad of ['', ' ', 'a b', 'a..b', '-x', 'x/', 'x.lock', 'a:b', 'a//b', 'a/.b', 'x.']) assert.ok(remoteNameProblem(bad, []), bad);
});

test('readRemotes and remoteUsage on real repositories', async () => {
  const base = mkdtempSync(join(tmpdir(), 'mergeline-remotes-'));
  try {
    const bare = join(base, 'server.git');
    const work = join(base, 'work');
    sh(base, 'init', '-q', '--bare', '-b', 'main', bare);
    sh(base, 'init', '-q', '-b', 'main', work);
    writeFileSync(join(work, 'a.txt'), 'a\n');
    sh(work, 'add', '-A');
    sh(work, 'commit', '-q', '-m', 'one');
    sh(work, 'remote', 'add', 'origin', bare);
    sh(work, 'remote', 'add', 'mirror', join(base, 'nowhere.git'));
    sh(work, 'remote', 'set-url', '--push', 'mirror', 'ssh://example.invalid/x.git');
    sh(work, 'push', '-q', '-u', 'origin', 'main');
    sh(work, 'push', '-q', 'origin', 'main:gone', 'main:kept');
    sh(work, 'fetch', '-q', 'origin');
    sh(work, 'branch', '-q', '--track', 'local-kept', 'origin/kept');

    const rs = (await readRemotes(work));
    assert.deepEqual(rs.map((r) => r.name).sort(), ['mirror', 'origin']);
    const mirror = rs.find((r) => r.name === 'mirror')!;
    assert.equal(mirror.push, 'ssh://example.invalid/x.git');
    assert.notEqual(mirror.fetch, mirror.push);

    const u = (await remoteUsage(work, 'origin'));
    assert.deepEqual(u.tracking.sort(), ['origin/gone', 'origin/kept', 'origin/main']);
    assert.deepEqual(u.upstreamOf.sort(), ['local-kept', 'main']);
    assert.deepEqual((await remoteUsage(work, 'mirror')), { tracking: [], upstreamOf: [] });

    // A remote with no URL is still listed.
    sh(work, 'config', 'remote.bare-config.fetch', '+refs/heads/*:refs/remotes/bare-config/*');
    assert.ok((await readRemotes(work)).some((r) => r.name === 'bare-config' && r.fetch === ''));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
