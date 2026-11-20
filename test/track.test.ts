import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readState, readLog, parseRefs, parseSignature, readSignature, searchLog } from '../src/core/gitlog';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: ENV });
let n = 0;
const commit = (cwd: string, msg: string) => {
  writeFileSync(join(cwd, `f${n++}.txt`), msg);
  sh(cwd, 'add', '-A');
  sh(cwd, 'commit', '-q', '-m', msg);
};
const init = (d: string) => {
  sh(d, 'init', '-q', '-b', 'main');
  sh(d, 'config', 'commit.gpgsign', 'false');
};

test('parseRefs reads upstream, ahead/behind and gone; old 3-field lines still parse', () => {
  const US = '\x1f';
  const refs = parseRefs(
    [
      ['a1', 'refs/heads/main', '', 'origin/main', 'ahead 2, behind 3'],
      ['a2', 'refs/heads/f', '', 'origin/f', 'gone'],
      ['a3', 'refs/heads/g', '', 'origin/g', ''],
      ['a4', 'refs/heads/local', '', '', ''],
      ['a5', 'refs/heads/old', ''],
      ['a6', 'refs/remotes/origin/main', '', '', ''],
    ]
      .map((f) => f.join(US))
      .join('\n'),
  );
  assert.deepEqual(refs[0], { name: 'main', full: 'refs/heads/main', type: 'head', sha: 'a1', upstream: 'origin/main', ahead: 2, behind: 3 });
  assert.deepEqual(refs[1], { name: 'f', full: 'refs/heads/f', type: 'head', sha: 'a2', upstream: 'origin/f', gone: true });
  assert.equal(refs[2].ahead, 0);
  assert.equal(refs[2].behind, 0);
  assert.equal(refs[3].upstream, undefined);
  assert.equal(refs[4].name, 'old');
  assert.equal(refs[5].type, 'remote');
  assert.equal(refs[5].upstream, undefined);
});

test('readState: ahead/behind against a real remote, and gone after the remote branch is deleted', () => {
  const base = mkdtempSync(join(tmpdir(), 'mergeline-track-'));
  try {
    const bare = join(base, 'bare.git');
    sh(base, 'init', '-q', '--bare', '-b', 'main', bare);
    const a = join(base, 'a');
    sh(base, 'clone', '-q', bare, a);
    init(a);
    commit(a, 'one');
    sh(a, 'push', '-q', '-u', 'origin', 'main');
    sh(a, 'checkout', '-q', '-b', 'feat');
    commit(a, 'feat 1');
    sh(a, 'push', '-q', '-u', 'origin', 'feat');
    sh(a, 'checkout', '-q', 'main');
    // Someone else pushes two commits to main.
    const b = join(base, 'b');
    sh(base, 'clone', '-q', bare, b);
    sh(b, 'config', 'commit.gpgsign', 'false');
    commit(b, 'theirs 1');
    commit(b, 'theirs 2');
    sh(b, 'push', '-q', 'origin', 'main');
    commit(a, 'mine');
    sh(a, 'fetch', '-q');
    return readState(a).then(async (st) => {
      const main = st.refs.find((r) => r.full === 'refs/heads/main')!;
      assert.deepEqual([main.upstream, main.ahead, main.behind], ['origin/main', 1, 2]);
      const feat = st.refs.find((r) => r.full === 'refs/heads/feat')!;
      assert.deepEqual([feat.upstream, feat.ahead, feat.behind, feat.gone], ['origin/feat', 0, 0, undefined]);
      sh(b, 'push', '-q', 'origin', '--delete', 'feat');
      sh(a, 'fetch', '-q', '--prune');
      const st2 = await readState(a);
      assert.equal(st2.refs.find((r) => r.full === 'refs/heads/feat')!.gone, true);
    });
  } finally {
    setTimeout(() => rmSync(base, { recursive: true, force: true }), 2000).unref();
  }
});

test('first-parent log: only each line\'s own commits, merges keep one parent; search follows the same view', async () => {
  const d = mkdtempSync(join(tmpdir(), 'mergeline-fp-'));
  try {
    init(d);
    commit(d, 'base');
    sh(d, 'checkout', '-q', '-b', 'side');
    commit(d, 'side 1');
    commit(d, 'side 2');
    sh(d, 'checkout', '-q', 'main');
    commit(d, 'main 1');
    sh(d, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    sh(d, 'branch', '-q', '-D', 'side');
    const all = await readLog(d, { max: 100 });
    assert.equal(all.length, 5);
    const fp = await readLog(d, { max: 100, firstParent: true });
    const subj = (sha: string) => sh(d, 'log', '-1', '--format=%s', sha).trim();
    assert.deepEqual(fp.map((c) => c.subject), ['merge side', 'main 1', 'base']);
    assert.ok(fp.every((c) => c.parents.length <= 1));
    // Every parent is a loaded commit, so lanes stay connected.
    const shas = new Set(fp.map((c) => c.sha));
    assert.ok(fp.every((c) => c.parents.every((p) => shas.has(p))));
    assert.equal(subj(fp[0].parents[0]), 'main 1');
    const r = await searchLog(d, { max: 100, firstParent: true }, 'side');
    assert.deepEqual(r.matches.map((m) => subj(m.sha)), ['merge side']);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('parseSignature maps %G? codes; N and junk are unsigned', () => {
  const US = '\x1f';
  assert.deepEqual(parseSignature(`G${US}Ada <ada@example.com>${US}ABCD1234\n`), { status: 'good', signer: 'Ada <ada@example.com>', key: 'ABCD1234' });
  assert.equal(parseSignature(`B${US}x${US}y`)!.status, 'bad');
  assert.equal(parseSignature(`E${US}${US}K`)!.status, 'unchecked');
  assert.equal(parseSignature(`R${US}${US}`)!.status, 'revoked');
  assert.equal(parseSignature(`N${US}${US}\n`), null);
  assert.equal(parseSignature(''), null);
});

test('readSignature: SSH-signed commit is good with an allowed signers file, unchecked without, unsigned is null', async () => {
  const d = mkdtempSync(join(tmpdir(), 'mergeline-sig-'));
  try {
    init(d);
    commit(d, 'plain');
    const key = join(d, '..', `mlkey-${process.pid}-${Date.now()}`);
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'ada', '-f', key]);
    sh(d, 'config', 'gpg.format', 'ssh');
    sh(d, 'config', 'user.signingkey', key + '.pub');
    writeFileSync(join(d, 'f-signed.txt'), 's');
    sh(d, 'add', '-A');
    sh(d, 'commit', '-q', '-S', '-m', 'signed');
    const signed = sh(d, 'rev-parse', 'HEAD').trim();
    const plain = sh(d, 'rev-parse', 'HEAD~1').trim();
    assert.equal(await readSignature(d, plain), null);
    const unchecked = await readSignature(d, signed);
    assert.equal(unchecked?.status, 'unchecked');
    const allowed = join(d, '..', `mlallowed-${process.pid}-${Date.now()}`);
    writeFileSync(allowed, `ada@example.com ${readFileSync(key + '.pub', 'utf8')}`);
    sh(d, 'config', 'gpg.ssh.allowedSignersFile', allowed);
    const good = await readSignature(d, signed);
    assert.equal(good?.status, 'good');
    assert.equal(good?.signer, 'ada@example.com');
    assert.match(good!.key, /^SHA256:/);
    for (const f of [key, key + '.pub', allowed]) rmSync(f, { force: true });
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
