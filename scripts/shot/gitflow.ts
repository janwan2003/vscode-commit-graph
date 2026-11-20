// Builds a git-flow demo repo (main, develop, feature/release/hotfix branches) and writes the
// webview payload for the pinned-branches screenshots. PINS=none lays it out without pinning.
// Usage: node <bundled gitflow.mjs> out.json   (see docs: PAYLOAD=out.json node scripts/shot/shot.mjs)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { readLog, readState } from '../../src/core/gitlog';
import { avatarMap } from '../../src/core/misc';
import { layout, newLayoutState, pinBranches } from '../../src/core/graph';
import { pinnedTips } from '../../src/core/pins';

const d = mkdtempSync(join(tmpdir(), 'mergeline-flow-'));
let t = Math.floor(Date.now() / 1000) - 86400 * 30;
const people = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Katherine Johnson', 'Linus Pauling'];
let who = 0;
const g = (...a: string[]) => execFileSync('git', a, { cwd: d, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: `${t} +0000`, GIT_COMMITTER_DATE: `${t} +0000`, GIT_COMMITTER_NAME: people[who], GIT_COMMITTER_EMAIL: people[who].split(' ')[0].toLowerCase() + '@example.com', GIT_AUTHOR_NAME: people[who], GIT_AUTHOR_EMAIL: people[who].split(' ')[0].toLowerCase() + '@example.com', GIT_CONFIG_GLOBAL: '/dev/null' } });
const co = (b: string) => g('checkout', '-q', b);
const nb = (b: string, from: string) => g('checkout', '-q', '-b', b, from);
function c(msg: string, w: number) {
  who = w;
  const f = join(d, 'src', msg.replace(/[^a-z]/gi, '').slice(0, 12) + '.ts');
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, msg + '\n' + t + '\n');
  t += 3600 * 3;
  g('add', '-A');
  g('commit', '-q', '-m', msg);
}
const merge = (b: string, msg: string, w = 0) => ((who = w), (t += 3600), g('merge', '-q', '--no-ff', '-m', msg, b));

g('init', '-q', '-b', 'main');
g('config', 'commit.gpgsign', 'false');
c('Initial commit', 0);
nb('develop', 'main');
c('Set up build and CI', 0);
nb('feature/login', 'develop');
c('Login form', 1);
co('develop');
nb('feature/cart', 'develop');
c('Cart model', 2);
co('feature/login');
c('Login: remember me', 1);
co('develop');
merge('feature/login', "Merge branch 'feature/login' into develop");
co('feature/cart');
c('Cart: totals and tax', 2);
co('develop');
merge('feature/cart', "Merge branch 'feature/cart' into develop");
nb('release/1.0', 'develop');
c('Bump version to 1.0.0', 3);
co('main');
merge('release/1.0', "Merge branch 'release/1.0'", 3);
g('tag', 'v1.0.0');
co('develop');
merge('main', "Merge branch 'main' into develop", 3);
nb('feature/search', 'develop');
c('Search index', 4);
nb('hotfix/1.0.1', 'main');
c('Fix crash when the cart is empty', 2);
co('main');
merge('hotfix/1.0.1', "Merge branch 'hotfix/1.0.1'", 2);
g('tag', 'v1.0.1');
co('develop');
merge('main', "Merge branch 'main' into develop", 2);
co('feature/search');
c('Search: fuzzy matching', 4);
nb('feature/checkout', 'develop');
c('Checkout page', 1);
co('feature/search');
c('Search: highlight results', 4);
co('develop');
merge('feature/search', "Merge branch 'feature/search' into develop", 4);
co('feature/checkout');
c('Checkout: card payments', 1);
g('branch', '-D', 'hotfix/1.0.1', 'release/1.0', 'feature/login', 'feature/cart', 'feature/search');

(async () => {
  const [commits, state] = await Promise.all([readLog(d, { max: 500 }), readState(d)]);
  const patterns = process.env.PINS === 'none' ? [] : ['main', 'master', 'develop'];
  const st = newLayoutState();
  const pins = pinnedTips(patterns, state.refs, commits.map((x) => x.sha));
  pinBranches(st, commits, pins.tips);
  const lay = layout(commits, st);
  const out = {
    data: { type: 'data', repo: d, commits, packed: lay.packed, start: lay.start, width: lay.width, refs: state.refs, head: state.head, branch: state.branch, hasMore: false, pinned: pins.names, pinPatterns: patterns, worktrees: [], filter: { branches: [], remotes: true }, branches: state.refs.filter((r) => r.type !== 'tag').map((r) => r.name), avatars: avatarMap(commits.map((x) => x.email)) },
    details: null,
  };
  writeFileSync(process.argv[2], JSON.stringify(out));
  rmSync(d, { recursive: true, force: true });
})();
