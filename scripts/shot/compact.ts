// Builds a busy demo repo (long straight runs on main and on merged feature branches) and writes
// the webview payload for the compact-graph screenshots. COMPACT=0 lays it out without folding.
// Usage: node <bundled compact.mjs> out.json   (then PAYLOAD=out.json node scripts/shot/shot.mjs out.png)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLog, readState, readCompactLog } from '../../src/core/gitlog';
import { avatarMap } from '../../src/core/misc';
import { layout, newLayoutState, pinBranches } from '../../src/core/graph';
import { pinnedTips } from '../../src/core/pins';

const d = mkdtempSync(join(tmpdir(), 'mergeline-compact-'));
let t = Math.floor(Date.now() / 1000) - 86400 * 40;
const people = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Katherine Johnson', 'Linus Pauling'];
let who = 0;
let n = 0;
const g = (...a: string[]) => execFileSync('git', a, { cwd: d, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: `${t} +0000`, GIT_COMMITTER_DATE: `${t} +0000`, GIT_COMMITTER_NAME: people[who], GIT_COMMITTER_EMAIL: people[who].split(' ')[0].toLowerCase() + '@example.com', GIT_AUTHOR_NAME: people[who], GIT_AUTHOR_EMAIL: people[who].split(' ')[0].toLowerCase() + '@example.com', GIT_CONFIG_GLOBAL: '/dev/null' } });
const SUBJ = ['Fix typo in error message', 'Tidy imports', 'Add a test for the edge case', 'Rename helper', 'Update dependencies', 'Handle empty input', 'Log the request id', 'Small refactor', 'Document the option', 'Speed up the hot path'];
function c(w: number, msg = SUBJ[n % SUBJ.length]) {
  who = w;
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(join(d, 'src', `f${n++}.ts`), msg + '\n' + t + '\n');
  t += 3600 * 2;
  g('add', '-A');
  g('commit', '-q', '-m', msg);
}
const run = (k: number, w: number) => { for (let i = 0; i < k; i++) c(w); };
const merge = (b: string) => ((who = 0), (t += 3600), g('merge', '-q', '--no-ff', '-m', `Merge branch '${b}'`, b));

g('init', '-q', '-b', 'main');
g('config', 'commit.gpgsign', 'false');
c(0, 'Initial commit');
run(14, 0);
g('tag', 'v1.0.0');
g('checkout', '-q', '-b', 'feature/search');
run(9, 1);
g('checkout', '-q', 'main');
run(6, 2);
merge('feature/search');
g('checkout', '-q', '-b', 'feature/billing');
run(7, 3);
g('checkout', '-q', 'main');
run(5, 0);
g('checkout', '-q', '-b', 'fix/timeouts');
run(4, 2);
g('checkout', '-q', 'main');
merge('fix/timeouts');
run(3, 4);
merge('feature/billing');
g('tag', 'v1.1.0');
run(8, 0);
g('checkout', '-q', '-b', 'feature/export');
run(6, 4);
g('checkout', '-q', 'main');
run(4, 1);
g('branch', '-D', 'feature/search', 'feature/billing', 'fix/timeouts');

(async () => {
  const state = await readState(d);
  const compact = process.env.COMPACT !== '0';
  const keep = [...state.refs.map((r) => r.sha), state.head!];
  const r = compact ? await readCompactLog(d, { max: 500 }, keep) : null;
  const commits = r ? r.commits : await readLog(d, { max: 500 });
  const st = newLayoutState();
  const pins = pinnedTips(['main'], state.refs, commits.map((x) => x.sha));
  pinBranches(st, commits, pins.tips);
  const lay = layout(commits, st);
  const out = {
    data: { type: 'data', repo: d, commits, packed: lay.packed, start: lay.start, width: lay.width, refs: state.refs, head: state.head, branch: state.branch, hasMore: false, pinned: pins.names, pinPatterns: ['main'], worktrees: [], filter: { branches: [], remotes: true }, branches: state.refs.filter((x) => x.type !== 'tag').map((x) => x.name), avatars: avatarMap(commits.map((x) => x.email)), compact: r ? { total: r.total, hidden: r.hidden, expanded: false } : null, compactOn: compact },
    details: null,
  };
  writeFileSync(process.argv[2], JSON.stringify(out));
  rmSync(d, { recursive: true, force: true });
})();
