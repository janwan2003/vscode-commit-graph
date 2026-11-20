import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchLog, readTags, pathQuery, pathSpecs, parseTags } from '../src/core/gitlog';
import { avatarUrl, avatarMap, archiveFormat } from '../src/core/misc';
import { issueLinkRules, issueLinkUrl } from '../src/core/remote';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: ENV });
function commit(cwd: string, files: Record<string, string>, msg: string) {
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(cwd, f, '..'), { recursive: true });
    writeFileSync(join(cwd, f), c);
  }
  sh(cwd, 'add', '-A');
  sh(cwd, 'commit', '-q', '-m', msg);
}

test('path: search finds commits that changed matching files or folders anywhere in history', async () => {
  const d = mkdtempSync(join(tmpdir(), 'mergeline-path-'));
  try {
    sh(d, 'init', '-q', '-b', 'main');
    sh(d, 'config', 'commit.gpgsign', 'false');
    commit(d, { 'src/Auth/login.ts': '1' }, 'add login');
    commit(d, { 'docs/guide.md': '1', 'README.md': '1' }, 'docs');
    sh(d, 'checkout', '-q', '-b', 'side');
    commit(d, { 'src/auth/token.ts': '1' }, 'token on side');
    sh(d, 'checkout', '-q', 'main');
    commit(d, { 'src/other.ts': '1' }, 'other');
    sh(d, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    const subj = async (q: string) => {
      const r = await searchLog(d, { max: 100 }, q);
      return r.matches.map((m) => sh(d, 'log', '-1', '--format=%s', m.sha).trim()).sort();
    };
    // Substring, case-insensitive, both branches; the merge that only brought "side" in is not a match.
    assert.deepEqual(await subj('path:auth'), ['add login', 'token on side']);
    assert.deepEqual(await subj('path:src/auth'), ['add login', 'token on side']);
    assert.deepEqual(await subj('path:*.md'), ['docs']); // glob at the top and in folders
    assert.deepEqual(await subj('path:README.md'), ['docs']);
    assert.deepEqual(await subj('path:./src/other.ts'), ['other']);
    assert.deepEqual(await subj('path:nothing-here'), []);
    assert.deepEqual(await subj('path:'), []);
    // Positions are rows of the full log, so the webview knows how far to load.
    const all = sh(d, 'log', '--date-order', '--format=%H', '--branches', '--tags', '--remotes', 'HEAD').trim().split('\n');
    const r = await searchLog(d, { max: 100 }, 'path:other');
    assert.equal(all[r.matches[0].index], r.matches[0].sha);
    // Without "path:" the text is a message search, not a path search.
    assert.deepEqual((await searchLog(d, { max: 100 }, 'auth')).matches, []);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('pathQuery and pathSpecs', () => {
  assert.equal(pathQuery('path: src/a '), 'src/a');
  assert.equal(pathQuery('PATH:/x'), 'x');
  assert.equal(pathQuery('fix path:x'), null);
  assert.deepEqual(pathSpecs('a.md'), [':(top,icase,literal)a.md', ':(top,icase,glob)**/*a.md*', ':(top,icase,glob)**/*a.md*/**']);
  assert.equal(pathSpecs('*.md')[0], ':(top,icase,glob)*.md');
});

test('readTags: annotated (tagger, message, signature-free) and lightweight', async () => {
  const d = mkdtempSync(join(tmpdir(), 'mergeline-tags-'));
  try {
    sh(d, 'init', '-q', '-b', 'main');
    sh(d, 'config', 'commit.gpgsign', 'false');
    commit(d, { 'a': '1' }, 'one');
    commit(d, { 'a': '2' }, 'two');
    sh(d, 'tag', '-a', 'v1.0', '-m', 'Release 1.0\n\nFixes PROJ-12.', 'HEAD~1');
    sh(d, 'tag', 'light', 'HEAD~1');
    const sha = sh(d, 'rev-parse', 'HEAD~1').trim();
    const tags = await readTags(d, sha);
    const v = tags.find((t) => t.name === 'v1.0')!;
    assert.equal(v.annotated, true);
    assert.equal(v.tagger, 'Ada');
    assert.equal(v.email, 'ada@example.com');
    assert.ok(v.date && v.date > 1e9);
    assert.equal(v.message, 'Release 1.0\n\nFixes PROJ-12.');
    assert.deepEqual(tags.find((t) => t.name === 'light'), { name: 'light', annotated: false });
    assert.deepEqual(await readTags(d, sh(d, 'rev-parse', 'HEAD').trim()), []);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
  assert.deepEqual(parseTags(''), []);
});

test('avatar URLs: GitHub noreply, Gravatar MD5, nothing for empty', () => {
  assert.equal(avatarUrl('12345+octo@users.noreply.github.com'), 'https://avatars.githubusercontent.com/u/12345?s=40&v=4');
  assert.equal(avatarUrl('octo@users.noreply.github.com'), 'https://avatars.githubusercontent.com/octo?s=40');
  // md5("ada@example.com"), trimmed and lower-cased first.
  const md5 = createHash('md5').update('ada@example.com').digest('hex');
  assert.equal(md5.length, 32);
  assert.equal(avatarUrl(' Ada@Example.com '), `https://www.gravatar.com/avatar/${md5}?s=40&d=404`);
  assert.equal(avatarUrl(''), null);
  assert.equal(avatarUrl('not-an-email'), null);
  assert.deepEqual(Object.keys(avatarMap(['a@x.io', 'a@x.io', '', 'b@x.io'])), ['a@x.io', 'b@x.io']);
});

test('issue link rules: valid entries kept, bad ones reported, URL template filled and encoded', () => {
  const { rules, problems } = issueLinkRules([
    { pattern: '\\b[A-Z]+-\\d+\\b', url: 'https://jira.example.com/browse/$0' },
    { pattern: '(', url: 'https://x' },
    { pattern: 'x*', url: 'https://x' },
    { pattern: 'ABC', url: 'javascript:alert(1)' },
    { pattern: 'ABC' },
  ]);
  assert.deepEqual(rules, [{ pattern: '\\b[A-Z]+-\\d+\\b', url: 'https://jira.example.com/browse/$0' }]);
  assert.equal(problems.length, 4);
  assert.deepEqual(issueLinkRules(undefined), { rules: [], problems: [] });
  assert.equal(issueLinkRules({}).problems.length, 1);
  assert.equal(issueLinkUrl('https://t/$1?q=$0', ['GH 7', 'GH 7']), 'https://t/GH%207?q=GH%207');
});

test('archiveFormat picks the git archive format from the file name', () => {
  assert.deepEqual(archiveFormat('/a/b.ZIP'), { format: 'zip', ext: true });
  assert.deepEqual(archiveFormat('/a/b.tar.gz'), { format: 'tar.gz', ext: true });
  assert.deepEqual(archiveFormat('b.tgz'), { format: 'tar.gz', ext: true });
  assert.deepEqual(archiveFormat('b.tar'), { format: 'tar', ext: true });
  assert.deepEqual(archiveFormat('b'), { format: 'zip', ext: false });
});
