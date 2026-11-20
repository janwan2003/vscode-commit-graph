import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, newLayoutState, pinBranches, extendPins, LayoutInput, Row } from '../src/core/graph';
import { cssColor, colorRules, tipColors, refColors, nameColor, CUSTOM_BASE, MAX_CUSTOM } from '../src/core/colors';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { unpackRow } = require('../media/rows.js');

/** Rows decoded from the packed form (what the webview draws) must equal the full rows. */
function checkPacked(rows: Row[], packed: any[], start: string, what: string) {
  let above = start;
  packed.forEach((p, i) => {
    const u = unpackRow(above, p);
    const norm = (segs: number[][]) => segs.map((s) => s.join(',')).sort();
    assert.equal(u.col, rows[i].col, `${what}: packed col ${i}`);
    assert.equal(u.color, rows[i].color, `${what}: packed color ${i}`);
    assert.deepEqual(norm(u.top), norm(rows[i].top), `${what}: packed top ${i}`);
    assert.deepEqual(norm(u.bot), norm(rows[i].bot), `${what}: packed bot ${i}`);
    above = p[2];
  });
}

test('cssColor accepts palette names, hex, rgb/hsl and nothing else', () => {
  assert.equal(cssColor('red'), 'var(--lane-1)');
  assert.equal(cssColor(' Orange '), 'var(--lane-8)');
  assert.equal(cssColor('gray'), 'var(--lane-9)');
  assert.equal(cssColor('#E5534B'), '#e5534b');
  assert.equal(cssColor('#abc'), '#abc');
  assert.equal(cssColor('#abcd1234'), '#abcd1234');
  assert.equal(cssColor('rgb(229, 83, 75)'), 'rgb(229, 83, 75)');
  assert.equal(cssColor('rgba(229,83,75,.5)'), 'rgba(229,83,75,.5)');
  assert.equal(cssColor('hsl(210deg 80% 50%)'), 'hsl(210deg 80% 50%)');
  assert.equal(cssColor('hsl(210 80% 50% / 0.4)'), 'hsl(210 80% 50% / 0.4)');
  for (const bad of ['', 'crimson', '#12', '#12345', 'red;background:url(x)', '"><script>', 'var(--lane-1)', 'rgb(1,2)', 'url(x)', 'rgb(1,2,3) x', 7, null, {}]) {
    assert.equal(cssColor(bad), null, `refused: ${JSON.stringify(bad)}`);
  }
});

test('colorRules keeps setting order, shares equal colours and reports bad entries', () => {
  const r = colorRules({ main: 'red', 'release/*': '#f0883e', develop: 'RED', 'feature/*': 'nope', '': 'blue' });
  assert.deepEqual(r.rules.map((x) => x.pattern), ['main', 'release/*', 'develop']);
  assert.deepEqual(r.colors, ['var(--lane-1)', '#f0883e']);
  assert.deepEqual(r.rules.map((x) => x.color), [CUSTOM_BASE, CUSTOM_BASE + 1, CUSTOM_BASE]);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /feature\/\*/);
  assert.equal(nameColor(r, 'release/1.2'), CUSTOM_BASE + 1);
  assert.equal(nameColor(r, 'release'), undefined);
  for (const v of [undefined, null, 'red', ['main'], 3]) assert.deepEqual(colorRules(v).rules, []);
  const many: Record<string, string> = {};
  for (let i = 0; i < MAX_CUSTOM + 3; i++) many['b' + i] = '#' + (0x100000 + i).toString(16);
  const m = colorRules(many);
  assert.equal(m.colors.length, MAX_CUSTOM);
  assert.equal(m.problems.length, 3);
});

test('tipColors: local and remote branches by name, first rule wins, working tree follows the branch', () => {
  const rules = colorRules({ main: 'red', 'feature/*': 'green', 'feature/login': 'purple' });
  const refs = [
    { name: 'main', type: 'head', sha: 'a' },
    { name: 'origin/main', type: 'remote', sha: 'b', remote: 'origin' },
    { name: 'feature/login', type: 'head', sha: 'c' },
    { name: 'v1', type: 'tag', sha: 'd' },
    { name: 'main', type: 'tag', sha: 'e' },
    { name: 'origin/HEAD', type: 'remote', sha: 'f', remote: 'origin' },
    { name: 'topic', type: 'head', sha: 'a' },
  ];
  const t = tipColors(rules, refs, { sha: 'U', branch: 'feature/login' });
  assert.deepEqual([...t.entries()].sort(), [['U', CUSTOM_BASE + 1], ['a', CUSTOM_BASE], ['b', CUSTOM_BASE], ['c', CUSTOM_BASE + 1]]);
  assert.deepEqual(refColors(rules, refs), { main: 'var(--lane-1)', 'origin/main': 'var(--lane-1)', 'feature/login': 'var(--lane-2)' });
  assert.equal(tipColors(colorRules({}), refs).size, 0);
});

test('a line that starts at a coloured branch keeps its colour, packed with letters, through Load more', () => {
  // main: m3 (merges f2) ← m2 ← m1 ← m0; feature/x: f2 ← f1 ← m1. f2 is reached as a merge parent, not as a tip.
  const commits: LayoutInput[] = [
    { sha: 'm3', parents: ['m2', 'f2'] },
    { sha: 'f2', parents: ['f1'] },
    { sha: 'm2', parents: ['m1'] },
    { sha: 'f1', parents: ['m1'] },
    { sha: 'm1', parents: ['m0'] },
    { sha: 'm0', parents: [] },
  ];
  const rules = colorRules({ main: '#ff0000', 'feature/*': '#00ff00' });
  const refs = [{ name: 'main', type: 'head', sha: 'm3' }, { name: 'feature/x', type: 'head', sha: 'f2' }];
  for (const split of [6, 2, 3]) {
    const st = newLayoutState();
    st.tipColor = tipColors(rules, refs);
    const a = layout(commits.slice(0, split), st);
    const b = split < commits.length ? layout(commits.slice(split), st) : { rows: [], packed: [], start: a.packed.length ? a.packed[a.packed.length - 1][2] : '' };
    const rows = [...a.rows, ...b.rows];
    checkPacked(a.rows, a.packed, a.start, `split ${split} first`);
    if (b.rows.length) checkPacked(b.rows, b.packed, b.start, `split ${split} append`);
    const col = (sha: string) => rows[commits.findIndex((c) => c.sha === sha)].color;
    // main's first-parent line is red (10), the feature line green (11), however the rows arrive.
    for (const s of ['m3', 'm2', 'm1', 'm0']) assert.equal(col(s), CUSTOM_BASE, `split ${split}: ${s} red`);
    for (const s of ['f2', 'f1']) assert.equal(col(s), CUSTOM_BASE + 1, `split ${split}: ${s} green`);
    assert.ok(a.packed.some((p) => /[ab]/.test(p[2])), 'lane strings carry custom colours as letters');
  }
});

test('pinned lanes take the branch colour; uncoloured lines still cycle the palette', () => {
  const commits: LayoutInput[] = [
    { sha: 't1', parents: ['m1'] },
    { sha: 'm1', parents: ['m0'] },
    { sha: 'm0', parents: [] },
  ];
  const st = newLayoutState();
  pinBranches(st, commits, ['m1']);
  st.pinColor = [CUSTOM_BASE + 2];
  const lay = layout(commits, st);
  assert.equal(lay.rows[1].color, CUSTOM_BASE + 2);
  assert.equal(lay.rows[2].color, CUSTOM_BASE + 2);
  assert.ok(lay.rows[0].color < 10, 'topic line uses the palette');
  checkPacked(lay.rows, lay.packed, lay.start, 'pinned');
});

test('random histories with random coloured tips: packed rows decode exactly, coloured tips start coloured lines', () => {
  for (let seed = 1; seed <= 200; seed++) {
    let x = seed;
    const rnd = (k: number) => ((x = (x * 1103515245 + 12345) % 2147483648), x % k);
    const made: LayoutInput[] = [{ sha: 'c0', parents: [] }];
    const heads = ['c0'];
    for (let i = 1; i < 60; i++) {
      const op = rnd(10);
      if (op < 2 && heads.length < 8) { heads.push(made[rnd(made.length)].sha); continue; }
      const b = rnd(heads.length);
      const o = rnd(heads.length);
      made.push({ sha: 'c' + i, parents: op < 4 && heads[o] !== heads[b] ? [heads[b], heads[o]] : [heads[b]] });
      heads[b] = 'c' + i;
    }
    const commits = made.reverse();
    const tipColor = new Map<string, number>();
    for (const h of heads) if (rnd(2)) tipColor.set(h, CUSTOM_BASE + rnd(MAX_CUSTOM));
    const cut = 1 + rnd(commits.length - 1);
    const st = newLayoutState();
    st.tipColor = tipColor;
    pinBranches(st, commits.slice(0, cut), rnd(2) ? [heads[0]] : []);
    const a = layout(commits.slice(0, cut), st);
    extendPins(st, commits);
    const b = layout(commits.slice(cut), st);
    checkPacked(a.rows, a.packed, a.start, `seed ${seed} first`);
    checkPacked(b.rows, b.packed, b.start, `seed ${seed} append`);
    const rows = [...a.rows, ...b.rows];
    // A coloured tip that nothing above points at (a real branch tip) and that is not pinned starts its own coloured line.
    const hasChild = new Set(commits.flatMap((c) => c.parents));
    commits.forEach((c, i) => {
      if (tipColor.has(c.sha) && !hasChild.has(c.sha) && !st.home.has(c.sha)) assert.equal(rows[i].color, tipColor.get(c.sha), `seed ${seed}: ${c.sha}`);
    });
  }
});
