import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compactPlan, parseRevList, FOLD } from '../src/core/compact';
import { readCompactLog, readLog } from '../src/core/gitlog';
import { layout, newLayoutState } from '../src/core/graph';

// ---------- the planner, on random histories ----------

function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

/** A random history in child-before-parent order: mostly straight runs, some forks and merges. */
function randomDag(r: () => number, size: number) {
  const parents = new Map<string, string[]>();
  const made: string[] = []; // oldest first
  for (let i = 0; i < size; i++) {
    const sha = 'c' + String(i).padStart(4, '0');
    const ps: string[] = [];
    if (made.length && r() > 0.03) {
      // Usually the newest commit of some line (straight runs); sometimes an older one (a fork).
      ps.push(r() < 0.8 ? made[made.length - 1 - Math.floor(r() * Math.min(3, made.length))] : made[Math.floor(r() * made.length)]);
      if (r() < 0.12 && made.length > 2) {
        const q = made[Math.floor(r() * made.length)];
        if (q !== ps[0]) ps.push(q);
      }
    }
    parents.set(sha, ps);
    made.push(sha);
  }
  return { order: [...made].reverse(), parents };
}

function check(order: string[], parents: Map<string, string[]>, keep: Set<string>, expand: Set<string>) {
  const plan = compactPlan(order, parents, keep, expand);
  const pos = new Map(plan.ids.map((id, i) => [id, i]));
  assert.equal(pos.size, plan.ids.length, 'ids are unique');
  // Kept commits appear in git's order.
  const shown = plan.ids.filter((id) => !id.startsWith(FOLD));
  assert.deepEqual(shown, order.filter((c) => shown.includes(c)));
  for (const k of keep) assert.ok(pos.has(k), `kept ${k} is shown`);
  // Every commit is shown or in exactly one fold.
  const inFold = new Map<string, string>();
  for (const f of plan.folds.values()) {
    assert.ok(f.shas.length >= 1);
    for (const s of f.shas) {
      assert.ok(!inFold.has(s), `${s} is in one fold`);
      inFold.set(s, f.id);
      assert.ok(!pos.has(s), `${s} is hidden`);
      assert.ok(!expand.has(s), `an expanded commit (${s}) is never folded`);
    }
    // A fold is a straight chain: each commit's only parent is the next one, the last one's is `below`.
    for (let k = 0; k < f.shas.length; k++) {
      const ps = parents.get(f.shas[k])!;
      assert.equal(ps.length, 1);
      assert.equal(ps[0], k + 1 < f.shas.length ? f.shas[k + 1] : f.below);
    }
  }
  assert.equal(shown.length + inFold.size, order.length);
  assert.equal(plan.hidden, inFold.size);
  // Drawn parents: shown commits keep their parents, a hidden one becomes its fold; every line goes down.
  for (const id of plan.ids) {
    const drawn = plan.parents.get(id)!;
    if (id.startsWith(FOLD)) assert.deepEqual(drawn, plan.folds.get(id)!.below ? [plan.folds.get(id)!.below] : []);
    else assert.deepEqual(drawn, parents.get(id)!.map((p) => (pos.has(p) ? p : inFold.get(p)!)));
    for (const p of drawn) assert.ok(pos.get(p)! > pos.get(id)!, `${p} is below ${id}`);
  }
  // Nothing foldable is left: every shown commit that is not kept for a reason has a shown neighbour reason.
  const children = new Map<string, number>();
  for (const c of order) for (const p of parents.get(c)!) children.set(p, (children.get(p) ?? 0) + 1);
  for (const c of shown) {
    const plain = !keep.has(c) && parents.get(c)!.length === 1 && children.get(c) === 1;
    if (plain) assert.ok([...expand].some((e) => e === c || inFoldOfOriginal(c, e, parents, order)), `${c} is shown only because a run was opened`);
  }
  // The layout draws it: a node for every row, and lines only to rows that exist.
  const commits = plan.ids.map((id) => ({ sha: id, parents: plan.parents.get(id)!, author: '', email: '', date: 0, subject: '' }));
  const lay = layout(commits, newLayoutState());
  assert.equal(lay.packed.length, commits.length);
  return plan;
}

/** Whether `c` and `e` lie on the same straight run (both plain, connected through plain commits). */
function inFoldOfOriginal(c: string, e: string, parents: Map<string, string[]>, order: string[]): boolean {
  const children = new Map<string, string[]>();
  for (const x of order) for (const p of parents.get(x)!) children.set(p, [...(children.get(p) ?? []), x]);
  const plain = (x: string) => parents.get(x)!.length === 1 && (children.get(x)?.length ?? 0) === 1;
  for (const dir of ['down', 'up'] as const) {
    let x: string | undefined = c;
    while (x && plain(x)) {
      if (x === e) return true;
      x = dir === 'down' ? parents.get(x)![0] : children.get(x)![0];
    }
  }
  return false;
}

test('compactPlan: folds straight runs, keeps structure, on 300 random histories', () => {
  const r = rng(7);
  let folded = 0;
  for (let i = 0; i < 300; i++) {
    const { order, parents } = randomDag(r, 20 + Math.floor(r() * 120));
    const keep = new Set<string>([order[0]]);
    for (const c of order) if (r() < 0.04) keep.add(c);
    const plan = check(order, parents, keep, new Set());
    folded += plan.hidden;
    // Open one fold (by one of its middle commits): its commits show, the rest stay folded.
    const f = [...plan.folds.values()].find((x) => x.shas.length > 2);
    if (f) {
      const mid = f.shas[Math.floor(f.shas.length / 2)];
      const p2 = check(order, parents, keep, new Set([mid]));
      for (const s of f.shas) assert.ok(p2.ids.includes(s));
      assert.equal(p2.hidden, plan.hidden - f.shas.length);
      assert.equal(p2.folds.size, plan.folds.size - 1);
    }
  }
  assert.ok(folded > 1000, `the random histories had runs to fold (${folded})`);
});

test('parseRevList: order, parents, first parent and merges', () => {
  const g = parseRevList('m a b\na c\nb c\nc\n', true);
  assert.deepEqual(g.order, ['m', 'a', 'b', 'c']);
  assert.deepEqual(g.parents.get('m'), ['a']);
  assert.deepEqual([...g.merges], ['m']);
  assert.deepEqual(g.parents.get('c'), []);
});

// ---------- against real git ----------

const BASE = { ...process.env, GIT_COMMITTER_NAME: 'Ci', GIT_COMMITTER_EMAIL: 'ci@example.com', GIT_AUTHOR_NAME: 'Ann', GIT_AUTHOR_EMAIL: 'ann@example.com' };
let t = 1_700_000_000;
let n = 0;
const sh = (cwd: string, a: string[]) => {
  t += 60;
  const date = `${t} +0000`;
  return execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...BASE, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
};
const commit = (cwd: string, msg: string) => {
  writeFileSync(join(cwd, `f${n++}.txt`), msg);
  sh(cwd, ['add', '-A']);
  sh(cwd, ['commit', '-q', '-m', msg]);
  return sh(cwd, ['rev-parse', 'HEAD']).trim();
};

test('readCompactLog: folds runs on a real repo, opens them, pages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ml-compact-'));
  try {
    sh(dir, ['init', '-q', '-b', 'main']);
    const m1 = commit(dir, 'm1');
    for (let i = 2; i <= 6; i++) commit(dir, 'm' + i); // m2..m6 straight on main
    const m6 = sh(dir, ['rev-parse', 'HEAD']).trim();
    sh(dir, ['checkout', '-q', '-b', 'feature']);
    const f1 = commit(dir, 'f1');
    commit(dir, 'f2');
    commit(dir, 'f3');
    sh(dir, ['checkout', '-q', 'main']);
    const m7 = commit(dir, 'm7');
    commit(dir, 'm8');
    sh(dir, ['merge', '-q', '--no-ff', '-m', 'merge feature', 'feature']);
    sh(dir, ['branch', '-D', 'feature']); // merged and deleted: its run has no ref any more
    const merge = sh(dir, ['rev-parse', 'HEAD']).trim();
    sh(dir, ['tag', 'v1', m1]);
    const keep = [merge, m1];
    const all = await readLog(dir, { max: 100 });
    assert.equal(all.length, 12);

    const r = await readCompactLog(dir, { max: 100 }, keep);
    const rows = r.commits.map((c) => (c.kind === 'collapsed' ? `[${c.fold!.n}]` : c.subject));
    // Kept: merge (HEAD), the fork point m6, the root m1 (tag). Folded: m8+m7, f3..f1, m5..m2.
    assert.deepEqual(rows, ['merge feature', '[2]', '[3]', 'm6', '[4]', 'm1']);
    assert.equal(r.total, 12);
    assert.equal(r.hidden, 9);
    const merged = r.commits[0];
    assert.equal(merged.parents.length, 2);
    assert.ok(merged.parents.every((p) => p.startsWith('~')));
    const side = r.commits.find((c) => c.sha === merged.parents[1])!;
    assert.equal(side.fold!.n, 3);
    assert.equal(side.fold!.last, f1);
    assert.deepEqual(side.parents, [m6]);
    assert.equal(side.subject, '3 commits');
    assert.ok(side.fold!.oldest < side.date);
    assert.equal(r.commits.find((c) => c.sha === merged.parents[0])!.fold!.last, m7);

    // Opening the side run by any of its commits shows f1..f3.
    const o = await readCompactLog(dir, { max: 100 }, keep, [f1]);
    assert.deepEqual(o.commits.map((c) => (c.kind === 'collapsed' ? `[${c.fold!.n}]` : c.subject)), ['merge feature', '[2]', 'f3', 'f2', 'f1', 'm6', '[4]', 'm1']);
    assert.equal(o.hidden, 6);

    // A page: the first rows only, metadata read for them.
    const p = await readCompactLog(dir, { max: 3 }, keep);
    assert.equal(p.commits.length, 3);

    // First parent: the merge keeps only main's line; m7/m8 fold, the fork point is plain now.
    const fp = await readCompactLog(dir, { max: 100, firstParent: true }, keep);
    assert.deepEqual(fp.commits.map((c) => (c.kind === 'collapsed' ? `[${c.fold!.n}]` : c.subject)), ['merge feature', '[7]', 'm1']);
    assert.equal(fp.commits[0].parents.length, 1);

    // A ref on a commit inside a run splits it.
    const s = await readCompactLog(dir, { max: 100 }, [...keep, m6, sh(dir, ['rev-parse', 'HEAD~1']).trim()]);
    assert.deepEqual(s.commits.map((c) => (c.kind === 'collapsed' ? `[${c.fold!.n}]` : c.subject)), ['merge feature', 'm8', '[1]', '[3]', 'm6', '[4]', 'm1']);
    void m6;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readCompactLog: empty repository', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ml-compact-'));
  try {
    sh(dir, ['init', '-q', '-b', 'main']);
    const r = await readCompactLog(dir, { max: 100 }, []);
    assert.deepEqual(r, { commits: [], total: 0, hidden: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
