// Builds a demo repo, runs Mergeline's core on it and writes the webview payload
// as JSON (for the screenshot harness and the webview smoke test).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { readLog, readState, readStashes, insertStashes, readChanges, readCommitInfo, readStatusCount, readWorktrees, readTags, readSignature, readAuthors, readNote, readNotedCommits, writeNote, readContaining } from '../../src/core/gitlog';
import { avatarMap } from '../../src/core/misc';
import { layout, newLayoutState, pinBranches } from '../../src/core/graph';
import { pinnedTips } from '../../src/core/pins';
import { colorRules, tipColors, refColors, nameColor } from '../../src/core/colors';

const d = mkdtempSync(join(tmpdir(), 'mergeline-demo-'));
let t = Math.floor(Date.now() / 1000) - 86400 * 45;
const people = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Katherine Johnson', 'Linus Pauling'];
function g(...a: string[]) {
  return execFileSync('git', a, { cwd: d, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: `${t} +0000`, GIT_COMMITTER_DATE: `${t} +0000`, GIT_COMMITTER_NAME: 'Ada Lovelace', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_AUTHOR_NAME: 'Ada Lovelace', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_CONFIG_GLOBAL: '/dev/null' } });
}
function c(file: string, msg: string, who = 0) {
  mkdirSync(dirname(join(d, file)), { recursive: true });
  writeFileSync(join(d, file), msg + '\n' + t + '\n');
  t += 3600 * (5 + (msg.length % 31));
  g('add', '-A');
  g('commit', '-q', `--author=${people[who]} <${people[who].split(' ')[0].toLowerCase()}@example.com>`, '-m', msg);
}
g('init', '-q', '-b', 'main');
g('config', 'commit.gpgsign', 'false');
c('README.md', 'Initial commit');
c('src/app.ts', 'Scaffold app and build script');
c('src/config.ts', 'Load config from environment', 2);
g('tag', 'v0.1.0');
g('checkout', '-q', '-b', 'feature/search');
c('src/search.ts', 'Add full-text search index', 1);
c('src/search.ts', 'Search: rank results by recency', 1);
g('checkout', '-q', 'main');
c('src/http.ts', 'Retry failed requests with backoff', 3);
g('checkout', '-q', '-b', 'feature/dark-mode');
c('src/theme.css', 'Add dark theme tokens', 4);
g('checkout', '-q', 'feature/search');
c('src/search.ts', 'Search: highlight matched terms', 1);
g('checkout', '-q', 'main');
c('src/app.ts', 'Fix race on startup', 2);
// The merge is SSH-signed and the key is in the allowed signers file, so its details show a good signature.
const key = d + '-key';
execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'ada', '-f', key]);
writeFileSync(d + '-allowed', 'ada@example.com ' + readFileSync(key + '.pub', 'utf8'));
g('config', 'gpg.ssh.allowedSignersFile', d + '-allowed');
t += 3600; g('-c', 'gpg.format=ssh', '-c', `user.signingkey=${key}.pub`, 'merge', '-q', '-S', '--no-ff', '-m', "Merge branch 'feature/search'", 'feature/search');
g('tag', '-a', 'v1.0.0', '-m', 'Release 1.0.0\n\nFull-text search (PROJ-142) and offline sync (PROJ-157).');
g('checkout', '-q', 'feature/dark-mode');
c('src/theme.css', 'Dark theme: respect prefers-color-scheme', 4);
g('checkout', '-q', 'main');
c('docs/guide.md', 'Write getting-started guide', 0);
g('checkout', '-q', '-b', 'release/1.1');
c('CHANGELOG.md', 'Changelog for 1.1', 3);
g('checkout', '-q', 'main');
c('src/http.ts', 'Cache GET responses for 60 s', 2);
t += 3600; g('merge', '-q', '--no-ff', '-m', "Merge branch 'feature/dark-mode'", 'feature/dark-mode');
c('src/app.ts', 'Show sync status in the toolbar', 0);
g('update-ref', 'refs/remotes/origin/main', 'HEAD~1');
g('update-ref', 'refs/remotes/origin/release/1.1', 'release/1.1');
// main tracks origin/main (2 commits ahead once "Sync" lands); dark-mode tracks a branch deleted on the remote.
g('remote', 'add', 'origin', 'https://git.example.com/acme/app.git');
g('config', 'branch.main.remote', 'origin');
g('config', 'branch.main.merge', 'refs/heads/main');
g('config', 'branch.feature/dark-mode.remote', 'origin');
g('config', 'branch.feature/dark-mode.merge', 'refs/heads/feature/dark-mode');
writeFileSync(join(d, 'src/app.ts'), 'wip\n');
g('stash', 'push', '-q', '-m', 'WIP: toolbar spacing');
c('src/sync.ts', 'Sync: debounce writes', 0);
writeFileSync(join(d, 'src/sync.ts'), 'dirty\n');
writeFileSync(join(d, 'TODO.md'), 'todo\n');
g('worktree', 'add', '-q', d + '-release', 'release/1.1');

(async () => {
  // A git note on the feature/search merge (shown as a mark on its row and in its details).
  const merge = g('log', '--all', '--format=%H %s').split('\n').find((l) => l.endsWith("Merge branch 'feature/search'"))!.split(' ')[0];
  await writeNote(d, merge, 'Deployed to staging 2025-10-02 (build 1184).\nQA sign-off: Katherine');
  // AUTHOR="Name <email>": the graph filtered to that author, as the Authors checklist does.
  const authors = process.env.AUTHOR ? [process.env.AUTHOR] : [];
  const [log, state, stashes, unc, wts, noted] = await Promise.all([readLog(d, { max: 500, authors: authors.length ? authors : undefined }), readState(d), authors.length ? Promise.resolve([]) : readStashes(d), readStatusCount(d), readWorktrees(d), readNotedCommits(d)]);
  // Shown as if the repository were /work/acme-app.
  const worktrees = wts.map((w) => ({ ...w, path: w.path.replace(d, '/work/acme-app'), current: w.path === d }));
  let commits: any[] = insertStashes(log, stashes);
  if (log.some((x) => x.sha === state.head)) commits = [{ sha: '*', parents: [state.head], author: '', email: '', date: Math.floor(Date.now() / 1000), subject: `Uncommitted changes (${unc})`, kind: 'uncommitted' }, ...commits];
  // As the panel does with the default mergeline.pinnedBranches (PINS=none for the plain layout).
  const st = newLayoutState();
  const pins = process.env.PINS === 'none' ? { tips: [], names: [] } : pinnedTips(['main', 'master', 'develop'], state.refs, commits.map((x) => x.sha), commits[0]?.sha === '*' ? { sha: '*', parent: state.head! } : undefined);
  const kept = pinBranches(st, commits, pins.tips);
  // COLORS='{"main":"red",...}': as the panel does with mergeline.branchColors.
  const rules = colorRules(process.env.COLORS ? JSON.parse(process.env.COLORS) : {});
  st.tipColor = tipColors(rules, state.refs, commits[0]?.sha === '*' ? { sha: '*', branch: state.branch } : undefined);
  st.pinColor = kept.map((t, k) => nameColor(rules, pins.names[pins.tips.indexOf(t)]) ?? k);
  const lay = layout(commits, st);
  const sel = log.find((x) => x.subject === "Merge branch 'feature/search'") ?? log[0];
  const info = await readCommitInfo(d, sel.sha);
  const files = await readChanges(d, info.parents[0], sel.sha);
  const signature = await readSignature(d, sel.sha);
  const out = {
    data: { type: 'data', repo: d, commits, packed: lay.packed, start: lay.start, width: lay.width, refs: state.refs, head: state.head, branch: state.branch, hasMore: false, pinned: pins.names, pinPatterns: process.env.PINS === 'none' ? [] : ['main', 'master', 'develop'], worktrees, filter: { branches: [], remotes: true, authors }, notes: commits.filter((x) => noted.has(x.sha)).map((x) => x.sha), branches: state.refs.filter((r) => r.type !== 'tag').map((r) => r.name), colors: rules.colors, refColors: refColors(rules, state.refs), colorPatterns: rules.rules.map((r) => r.pattern), avatars: avatarMap(log.map((x) => x.email)) },
    details: { type: 'details', sha: sel.sha, info, signature, note: await readNote(d, sel.sha), from: info.parents[0], to: sel.sha, files },
    authors: await readAuthors(d, { max: 0 }),
    // The "Contained in" answer for the selected and the tagged commit (posted after their details).
    contains: Object.fromEntries(await Promise.all([sel.sha, state.refs.find((r) => r.name === 'v1.0.0')!.sha].map(async (sha) => [sha, await readContaining(d, sha)]))),
    // TAGS=1 in shot.mjs: the commit tagged v1.0.0, with its tags.
    tagged: await (async () => {
      const sha = state.refs.find((r) => r.name === 'v1.0.0')!.sha;
      const ti = await readCommitInfo(d, sha);
      return { type: 'details', sha, info: ti, tags: await readTags(d, sha), from: ti.parents[0], to: sha, files: await readChanges(d, ti.parents[0], sha) };
    })(),
    // REVIEW=1 in shot.mjs: HEAD compared with the first commit (many files).
    review: await (async () => {
      const first = log[log.length - 1].sha;
      return { type: 'details', sha: state.head, compare: first, from: first, to: state.head, files: await readChanges(d, first, state.head!) };
    })(),
  };
  writeFileSync(process.argv[2], JSON.stringify(out));
  rmSync(d + '-release', { recursive: true, force: true });
  rmSync(d, { recursive: true, force: true });
  for (const f of [key, key + '.pub', d + '-allowed']) rmSync(f, { force: true });
})();
