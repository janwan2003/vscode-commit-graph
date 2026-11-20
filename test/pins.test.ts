import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, newLayoutState, pinBranches, extendPins, pinChains, LayoutInput, Row, MAX_PINNED } from '../src/core/graph';
import { pinnedTips, pinMatcher } from '../src/core/pins';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { unpackRow } = require('../media/rows.js');

/**
 * Follows the drawn segments from each node down to the nodes they reach (paths stop at nodes).
 * A correct drawing reaches exactly the commit's loaded parents. Points: N(r) node of row r, M(r,x)
 * middle of row r at column x (a line passing the node), P(r,x) bottom edge of row r at column x.
 */
function reached(rows: Row[]): Set<number>[] {
  const out = new Map<string, string[]>();
  const edge = (a: string, b: string) => (out.get(a) ?? out.set(a, []).get(a)!).push(b);
  rows.forEach((row, r) => {
    for (const [a, b] of row.top) edge(`P${r - 1},${a}`, b === row.col ? `N${r}` : `M${r},${b}`);
    for (const [a, b] of row.bot) edge(a === row.col ? `N${r}` : `M${r},${a}`, `P${r},${b}`);
  });
  return rows.map((_, r) => {
    const hit = new Set<number>();
    const seen = new Set<string>();
    const stack = [...(out.get(`N${r}`) ?? [])];
    while (stack.length) {
      const p = stack.pop()!;
      if (seen.has(p)) continue;
      seen.add(p);
      if (p[0] === 'N') hit.add(+p.slice(1));
      else stack.push(...(out.get(p) ?? []));
    }
    return hit;
  });
}

function checkConnected(commits: LayoutInput[], rows: Row[], what: string) {
  const idx = new Map(commits.map((c, i) => [c.sha, i]));
  const got = reached(rows);
  commits.forEach((c, i) => {
    const want = new Set(c.parents.filter((p) => idx.has(p)).map((p) => idx.get(p)!));
    assert.deepEqual([...got[i]].sort((a, b) => a - b), [...want].sort((a, b) => a - b), `${what}: row ${i} (${c.sha}) reaches its parents`);
  });
}

/** Rows decoded from the packed form must match the full rows (the webview draws the packed form). */
function checkPacked(rows: Row[], packed: any[], start: string, what: string) {
  let above = start;
  packed.forEach((p, i) => {
    const u = unpackRow(above, p);
    const norm = (segs: number[][]) => segs.map((s) => s.join(',')).sort();
    assert.equal(u.col, rows[i].col, `${what}: packed col ${i}`);
    assert.deepEqual(norm(u.top), norm(rows[i].top), `${what}: packed top ${i}`);
    assert.deepEqual(norm(u.bot), norm(rows[i].bot), `${what}: packed bot ${i}`);
    above = p[2];
  });
}

/** A random history built oldest first (branch 0 = main, 1 = develop), returned newest first. */
function randomHistory(seed: number, n: number): { commits: LayoutInput[]; heads: string[] } {
  let x = seed;
  const rnd = (k: number) => ((x = (x * 1103515245 + 12345) % 2147483648), x % k);
  const made: LayoutInput[] = [{ sha: 'c0', parents: [] }];
  const heads = ['c0'];
  for (let i = 1; i < n; i++) {
    const op = rnd(10);
    const sha = 'c' + i;
    if (op < 2 && heads.length < 8) {
      heads.push(made[rnd(made.length)].sha); // new branch from any commit
      continue;
    }
    const b = rnd(heads.length);
    if (op < 4 && heads.length > 1) {
      const o = (b + 1 + rnd(heads.length - 1)) % heads.length;
      if (heads[o] !== heads[b]) {
        made.push({ sha, parents: [heads[b], heads[o]] });
        heads[b] = sha;
        continue;
      }
    }
    made.push({ sha, parents: [heads[b]] });
    heads[b] = sha;
  }
  return { commits: made.reverse(), heads };
}

/** A git-flow history: main gets release merges, develop gets feature merges and back-merges. */
function gitflow(): { commits: LayoutInput[]; main: string; develop: string } {
  const made: LayoutInput[] = [];
  let i = 0;
  const mk = (...parents: string[]) => (made.push({ sha: 'g' + ++i, parents }), 'g' + i);
  let main = mk();
  let develop = mk(main);
  for (let r = 0; r < 4; r++) {
    let f1 = mk(develop);
    let f2 = mk(develop);
    f1 = mk(f1);
    develop = mk(develop);
    f2 = mk(f2);
    develop = mk(develop, f1);
    f2 = mk(f2);
    develop = mk(develop, f2);
    let rel = mk(develop);
    rel = mk(rel);
    main = mk(main, rel);
    develop = mk(develop, main);
  }
  return { commits: made.reverse(), main, develop };
}

test('pinned branches: git-flow main and develop keep straight columns 0 and 1 with fixed colours', () => {
  const { commits, main, develop } = gitflow();
  const st = newLayoutState();
  assert.deepEqual(pinBranches(st, commits, [main, develop]), [main, develop]);
  const lay = layout(commits, st);
  checkConnected(commits, lay.rows, 'gitflow');
  checkPacked(lay.rows, lay.packed, lay.start, 'gitflow');
  const home = pinChains(commits, [main, develop]);
  commits.forEach((c, i) => {
    const h = home.get(c.sha);
    const row = lay.rows[i];
    if (h !== undefined) {
      assert.equal(row.col, h, `${c.sha} on pinned line ${h}`);
      assert.equal(row.color, h);
    } else {
      assert.ok(row.col >= 2, `${c.sha} (not pinned) stays right of the pinned columns, got ${row.col}`);
      assert.ok(row.color >= 2, `${c.sha} does not use a pinned colour`);
    }
    // Lanes 0 and 1 carry only their own colour.
    for (const s of [...row.top, ...row.bot]) if (s[1] < 2 && s[0] === s[1]) assert.equal(s[2], s[1], `row ${i} lane ${s[1]} colour`);
  });
  // Without pins the same history puts develop's commits in more than one column (the problem pinning solves).
  const plain = layout(commits);
  checkConnected(commits, plain.rows, 'gitflow plain');
  const cols = (k: number) => new Set(commits.map((c, i) => (home.get(c.sha) === k ? plain.rows[i].col : -1)).filter((x) => x >= 0));
  assert.ok(cols(0).size + cols(1).size > 2, 'plain layout moves main or develop around');
});

test('pinned branches: random histories stay correctly connected, pinned or not, in one call or appended', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const { commits, heads } = randomHistory(seed, 20 + (seed % 60));
    const tips = [heads[0], heads[1] ?? heads[0], heads[3] ?? heads[0]];
    for (const pins of [[], tips.slice(0, 1), tips]) {
      const what = `seed ${seed} pins ${pins.length}`;
      const st = newLayoutState();
      const kept = pinBranches(st, commits, pins);
      const lay = layout(commits, st);
      checkConnected(commits, lay.rows, what);
      checkPacked(lay.rows, lay.packed, lay.start, what);
      const home = pinChains(commits, kept);
      commits.forEach((c, i) => {
        const h = home.get(c.sha);
        if (h !== undefined) assert.equal(lay.rows[i].col, h, `${what}: ${c.sha} in pinned lane`);
        else assert.ok(lay.rows[i].col >= kept.length, `${what}: ${c.sha} outside pinned lanes`);
      });
      // Load more: the first part with only its own commits known, then the rest appended.
      const cut = Math.floor(commits.length / 2);
      const st2 = newLayoutState();
      pinBranches(st2, commits.slice(0, cut), pins);
      const a = layout(commits.slice(0, cut), st2);
      extendPins(st2, commits);
      const b = layout(commits.slice(cut), st2);
      const rows = [...a.rows, ...b.rows];
      checkConnected(commits, rows, what + ' appended');
      checkPacked(b.rows, b.packed, b.start, what + ' appended');
    }
  }
});

test('pinned branches: at most MAX_PINNED, unloaded and repeated tips dropped', () => {
  const commits: LayoutInput[] = [
    { sha: 'a', parents: ['r'] },
    { sha: 'b', parents: ['r'] },
    { sha: 'c', parents: ['r'] },
    { sha: 'd', parents: ['r'] },
    { sha: 'e', parents: ['r'] },
    { sha: 'r', parents: [] },
  ];
  const st = newLayoutState();
  assert.deepEqual(pinBranches(st, commits, ['zz', 'a', 'a', 'r', 'b', 'c', 'd', 'e']), ['a', 'b', 'c', 'd'].slice(0, MAX_PINNED));
  // 'r' is on a's first-parent line, so it is not a separate pin.
  const lay = layout(commits, st);
  checkConnected(commits, lay.rows, 'fan');
  assert.deepEqual(lay.rows.map((r) => r.col), [0, 1, 2, 3, 4, 0]);
});

test('pinnedTips: patterns in order, local and remote share a name, the newer ref starts the line', () => {
  const order = ['o1', 'm1', 'd1', 'r2', 'r1', 'x'];
  const refs = [
    { name: 'main', type: 'head', sha: 'm1' },
    { name: 'origin/main', type: 'remote', remote: 'origin', sha: 'o1' },
    { name: 'origin/HEAD', type: 'remote', remote: 'origin', sha: 'o1' },
    { name: 'develop', type: 'head', sha: 'd1' },
    { name: 'release/1.0', type: 'head', sha: 'r1' },
    { name: 'origin/release/2.0', type: 'remote', remote: 'origin', sha: 'r2' },
    { name: 'v1', type: 'tag', sha: 'x' },
    { name: 'gone', type: 'head', sha: 'not-loaded' },
  ];
  assert.deepEqual(pinnedTips(['develop', 'main', 'master', 'release/*', 'gone', 'v1'], refs, order), {
    tips: ['d1', 'o1', 'r2', 'r1'],
    names: ['develop', 'main', 'release/2.0', 'release/1.0'],
  });
  // The working-tree row on main's tip starts main's line.
  assert.deepEqual(pinnedTips(['main'], refs, ['*', ...order], { sha: '*', parent: 'o1' }).tips, ['*']);
  assert.deepEqual(pinnedTips(['develop'], refs, ['*', ...order], { sha: '*', parent: 'o1' }).tips, ['d1']);
  assert.deepEqual(pinnedTips('main', refs, order), { tips: [], names: [] });
  assert.deepEqual(pinnedTips([], refs, order), { tips: [], names: [] });
  assert.ok(pinMatcher('feat*/x.y')('feature/x.y'));
  assert.ok(!pinMatcher('feat*/x.y')('feature/xzy'));
  assert.ok(!pinMatcher('main')('main2'));
});
