import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLog, nearestShown, searchLog, readAuthors, authorKey, breExact, readNote, readNotedCommits, writeNote } from '../src/core/gitlog';

const BASE = { ...process.env, GIT_COMMITTER_NAME: 'Ci', GIT_COMMITTER_EMAIL: 'ci@example.com' };
let n = 0;
let t = 1_700_000_000;
const sh = (cwd: string, a: string[], who = 'Ann <ann@example.com>') => {
  const m = /^(.*) <(.*)>$/.exec(who)!;
  t += 60;
  const date = `${t} +0000`;
  return execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...BASE, GIT_AUTHOR_NAME: m[1], GIT_AUTHOR_EMAIL: m[2], GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
};
const commit = (cwd: string, msg: string, who?: string) => {
  writeFileSync(join(cwd, `f${n++}.txt`), msg);
  sh(cwd, ['add', '-A'], who);
  sh(cwd, ['commit', '-q', '-m', msg], who);
  return sh(cwd, ['rev-parse', 'HEAD']).trim();
};
const ANN = 'Ann <ann@example.com>';
const BOB = 'Bob <bob@example.com>';
const JOANN = 'JoAnn <ann@example.com>'; // contains "Ann <ann@example.com>" as a substring

/** Reference: kept commits reachable from c through non-kept commits only (brute force over all paths). */
function reference(c: string, parents: Map<string, string[]>, kept: Set<string>): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  const walk = (s: string) => {
    if (seen.has(s)) return;
    seen.add(s);
    if (kept.has(s)) return void out.add(s);
    for (const p of parents.get(s) ?? []) walk(p);
  };
  for (const p of parents.get(c) ?? []) walk(p);
  return out;
}

test('nearestShown equals the brute-force nearest kept ancestors on 300 random DAGs', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let g = 0; g < 300; g++) {
    const N = 2 + Math.floor(rnd() * 60);
    const parents = new Map<string, string[]>();
    // commit i's parents are older commits (higher index)
    for (let i = 0; i < N; i++) {
      const ps: string[] = [];
      if (i < N - 1) ps.push('c' + (i + 1 + Math.floor(rnd() * Math.min(4, N - i - 1))));
      if (i < N - 2 && rnd() < 0.25) {
        const q = 'c' + (i + 1 + Math.floor(rnd() * (N - i - 1)));
        if (!ps.includes(q)) ps.push(q);
      }
      parents.set('c' + i, ps);
    }
    const kept = new Set([...parents.keys()].filter(() => rnd() < 0.35));
    for (const c of kept) {
      const got = nearestShown(parents.get(c)!, parents, (s) => kept.has(s));
      assert.equal(new Set(got).size, got.length, 'no duplicates');
      assert.deepEqual(new Set(got), reference(c, parents, kept), `dag ${g} commit ${c}`);
      // the first parent's side comes first: a kept first parent is always first
      const fp = parents.get(c)![0];
      if (fp && kept.has(fp)) assert.equal(got[0], fp);
    }
  }
});

test('author filter: exact identities, connected parents across pages, search and author list', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ml-authors-'));
  try {
    sh(d, ['init', '-q', '-b', 'main']);
    sh(d, ['config', 'commit.gpgsign', 'false']);
    const a1 = commit(d, 'a1', ANN);
    commit(d, 'b1', BOB);
    sh(d, ['checkout', '-q', '-b', 'side']);
    const a2 = commit(d, 'a2 on side', ANN);
    commit(d, 'b2 on side', BOB);
    commit(d, 'j1 by JoAnn', JOANN);
    sh(d, ['checkout', '-q', 'main']);
    commit(d, 'b3', BOB);
    const a3 = commit(d, 'a3', ANN);
    sh(d, ['merge', '-q', '--no-ff', '-m', 'merge side', 'side'], BOB);
    const a4 = commit(d, 'a4', ANN);

    const all = { max: 100, order: 'date' as const };
    const log = (await readLog(d, { ...all, authors: [ANN] }));
    assert.deepEqual(log.map((c) => c.subject), ['a4', 'a3', 'a2 on side', 'a1'], 'only Ann, not JoAnn (same email, name contains Ann)');
    const by = new Map(log.map((c) => [c.subject, c.parents]));
    // a4 -> merge (Bob) -> [a3 via main, a2 via side (j1, b2 are not Ann's)]
    assert.deepEqual(by.get('a4'), [a3, a2]);
    assert.deepEqual(by.get('a3'), [a1], 'b3 and b1 skipped');
    assert.deepEqual(by.get('a2 on side'), [a1]);
    assert.deepEqual(by.get('a1'), []);
    // every drawn parent is a shown commit
    const shown = new Set(log.map((c) => c.sha));
    for (const c of log) for (const p of c.parents) assert.ok(shown.has(p));

    // Two authors at once: any of them.
    const two = (await readLog(d, { ...all, authors: [ANN, JOANN] }));
    assert.equal(two.length, 5);

    // A page of 2: the last row points at the next page's Ann commit, not past it.
    const page = (await readLog(d, { ...all, max: 2, authors: [ANN] }));
    assert.deepEqual(page.map((c) => c.subject), ['a4', 'a3']);
    assert.deepEqual(page[1].parents, [a1]);
    assert.deepEqual(page[0].parents, [a3, a2]);

    // First parent: a4's line is a4 -> merge -> a3 -> b3 -> b1 -> a1.
    const fp = (await readLog(d, { ...all, authors: [ANN], firstParent: true, branches: ['main'] }));
    assert.deepEqual(fp.map((c) => c.subject), ['a4', 'a3', 'a1']);
    assert.deepEqual(fp[0].parents, [a3]);

    // History search keeps the author filter and does not OR the query with it.
    const s1 = (await searchLog(d, { ...all, authors: [ANN] }, 'bob'));
    assert.equal(s1.total, 0, 'Bob wrote nothing among Ann-only rows');
    const s2 = (await searchLog(d, { ...all, authors: [ANN] }, 'on side'));
    assert.deepEqual(s2.matches.map((m) => m.sha), [a2]);
    assert.equal(s2.matches[0].index, 2);

    // A .mailmap mapping JoAnn to Ann: the filter still matches the raw identities the graph shows.
    writeFileSync(join(d, '.mailmap'), `Ann <ann@example.com> JoAnn <ann@example.com>\n`);
    assert.equal((await readLog(d, { ...all, authors: [JOANN] })).length, 1, 'alias identity still found');
    assert.equal((await readLog(d, { ...all, authors: [ANN] })).length, 4, 'main identity not widened by the mailmap');
    rmSync(join(d, '.mailmap'));
    const authors = (await readAuthors(d, all));
    assert.deepEqual(authors.map((a) => `${a.key} ${a.n}`), [`${ANN} 4`, `${BOB} 4`, `${JOANN} 1`]);
    assert.equal(authorKey({ author: 'Ann', email: 'ann@example.com' }), ANN);
    assert.equal(breExact('A.n [x]* <a\\b$^>'), '^A\\.n \\[x\\]\\* <a\\\\b\\$\\^>$');
    void a4;
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('hidden branches: --exclude globs leave out local and remote branches, HEAD stays', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ml-exclude-'));
  try {
    sh(d, ['init', '-q', '-b', 'main']);
    sh(d, ['config', 'commit.gpgsign', 'false']);
    commit(d, 'base');
    sh(d, ['checkout', '-q', '-b', 'dependabot/npm/x']);
    const dep = commit(d, 'bump x');
    sh(d, ['checkout', '-q', '-b', 'renovate/y', 'main']);
    const ren = commit(d, 'bump y');
    sh(d, ['update-ref', 'refs/remotes/origin/dependabot/npm/z', ren]);
    sh(d, ['update-ref', 'refs/remotes/origin/feature', dep]);
    sh(d, ['checkout', '-q', 'main']);
    const subjects = async (o: object) => (await readLog(d, { max: 50, ...o })).map((c) => c.subject).sort();
    assert.deepEqual(await subjects({}), ['base', 'bump x', 'bump y']);
    // origin/feature still brings "bump x" in: only refs matching the globs are left out.
    assert.deepEqual(await subjects({ exclude: ['dependabot/*', 'renovate/*'] }), ['base', 'bump x']);
    assert.deepEqual(await subjects({ exclude: ['dependabot/*', 'renovate/*', 'feature'] }), ['base']);
    assert.deepEqual(await subjects({ exclude: ['dependabot/*', 'renovate/*', 'feature'], remotes: false }), ['base']);
    // A chosen branch list ignores the globs.
    assert.deepEqual(await subjects({ exclude: ['renovate/*'], branches: ['renovate/y'] }), ['base', 'bump y']);
    // HEAD on an excluded branch is still shown.
    sh(d, ['checkout', '-q', 'renovate/y']);
    assert.deepEqual(await subjects({ exclude: ['dependabot/*', 'renovate/*', 'feature'] }), ['base', 'bump y']);
    // Options-looking globs are dropped.
    assert.deepEqual(await subjects({ exclude: ['--all'] }), ['base', 'bump x', 'bump y']);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('notes: add, list, replace, multi-line, remove', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ml-notes-'));
  try {
    sh(d, ['init', '-q', '-b', 'main']);
    // git notes add commits to refs/notes/commits, so it needs an identity (CI has no global one).
    sh(d, ['config', 'user.name', 'Ci']);
    sh(d, ['config', 'user.email', 'ci@example.com']);
    const a = commit(d, 'a');
    const b = commit(d, 'b');
    assert.equal((await readNotedCommits(d)).size, 0, 'no notes ref yet');
    assert.equal((await readNote(d, a)), '');
    assert.equal((await writeNote(d, a, 'Reviewed-by: QA\n')), 'set');
    assert.equal((await readNote(d, a)), 'Reviewed-by: QA');
    assert.deepEqual([...(await readNotedCommits(d))], [a]);
    assert.equal((await writeNote(d, a, 'line 1\n\nline 3  ')), 'set');
    assert.equal((await readNote(d, a)), 'line 1\n\nline 3');
    assert.equal(sh(d, ['log', '-1', '--format=%N', a]).trim(), 'line 1\n\nline 3', 'git log shows it');
    assert.equal((await writeNote(d, b, '  \n')), 'none');
    assert.equal((await writeNote(d, a, '')), 'removed');
    assert.equal((await readNotedCommits(d)).size, 0);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
