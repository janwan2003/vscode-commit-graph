// Build a small repo with branches, a merge, tags, a stash and dirty files.
// Usage: node scripts/make-fixture.mjs <dir>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export function makeFixture(d) {
  mkdirSync(d, { recursive: true });
  let t = 1763600000;
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Ada Lovelace', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada Lovelace', GIT_COMMITTER_EMAIL: 'ada@example.com' };
  const g = (...a) => execFileSync('git', a, { cwd: d, env: { ...env, GIT_AUTHOR_DATE: `${t} +0000`, GIT_COMMITTER_DATE: `${t} +0000` }, encoding: 'utf8' });
  const commit = (file, msg, who) => {
    writeFileSync(join(d, file), msg + '\n');
    g('add', '-A');
    t += 3600;
    const e = who ? { ...env, GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: who.toLowerCase().replace(/ /g, '.') + '@example.com' } : env;
    execFileSync('git', ['commit', '-q', '-m', msg], { cwd: d, env: { ...e, GIT_AUTHOR_DATE: `${t} +0000`, GIT_COMMITTER_DATE: `${t} +0000` } });
  };
  g('init', '-q', '-b', 'main');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'user.name', 'Ada Lovelace');
  g('config', 'user.email', 'ada@example.com');
  commit('README.md', 'Initial commit');
  commit('src.txt', 'Add parser skeleton');
  g('tag', 'v0.1.0');
  g('checkout', '-q', '-b', 'feature/search');
  commit('search.txt', 'Add search index', 'Grace Hopper');
  commit('search.txt', 'Search: rank by recency', 'Grace Hopper');
  g('checkout', '-q', 'main');
  commit('src.txt', 'Parser: handle empty input');
  g('checkout', '-q', '-b', 'hotfix/crash');
  commit('fix.txt', 'Fix crash on startup', 'Alan Turing');
  g('checkout', '-q', 'main');
  t += 3600;
  g('merge', '-q', '--no-ff', '-m', "Merge branch 'feature/search'", 'feature/search');
  g('tag', '-a', 'v1.0.0', '-m', 'Release 1.0.0');
  renameSync(join(d, 'src.txt'), join(d, 'parser.txt'));
  g('add', '-A');
  t += 3600;
  g('commit', '-q', '-m', 'Rename src.txt to parser.txt');
  writeFileSync(join(d, 'README.md'), 'stashed work\n');
  g('stash', 'push', '-q', '-m', 'WIP: docs');
  writeFileSync(join(d, 'notes.txt'), 'untracked\n');
  writeFileSync(join(d, 'README.md'), 'dirty\n');
  return d;
}
if (process.argv[2]) makeFixture(process.argv[2]);
