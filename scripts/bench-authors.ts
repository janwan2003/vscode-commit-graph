// Times the author filter on a repo: node .test-out/bench-authors.mjs <repo>
// Compares an unfiltered first page with author-filtered pages (busiest author, a rare one) and the author list.
import { readLog, readAuthors } from '../src/core/gitlog';
const repo = process.argv[2];
const time = async <T>(f: () => Promise<T>): Promise<[T, number]> => {
  const t = performance.now();
  const v = await f();
  return [v, performance.now() - t];
};
const best = async <T>(f: () => Promise<T>): Promise<[T, number]> => {
  let r = await time(f);
  for (let k = 0; k < 2; k++) { const s = await time(f); if (s[1] < r[1]) r = s; }
  return r;
};
const [authors, tA] = await best(() => readAuthors(repo, { max: 0 }));
console.log(`authors: ${authors.length} identities in ${tA.toFixed(0)} ms; busiest ${authors[0].key.replace(/<.*>/, '<…>')} (${authors[0].n})`);
const rare = authors.find((a) => a.n === 3)!;
const [base, tB] = await best(() => readLog(repo, { max: 501 }));
console.log(`no filter, first page: ${base.length} rows in ${tB.toFixed(0)} ms`);
for (const [label, a] of [['busiest', authors[0]], ['3-commit author', rare]] as const) {
  for (const max of [501, 5001]) {
    const [log, t] = await best(() => readLog(repo, { max, authors: [a.key] }));
    const shown = new Set(log.map((c) => c.sha));
    const dangling = log.slice(0, -1).filter((c) => c.parents.some((p) => !shown.has(p))).length;
    console.log(`${label} (${a.n} commits), max ${max}: ${log.length} rows in ${t.toFixed(0)} ms; rows except the last with a parent not shown: ${dangling}`);
  }
}
