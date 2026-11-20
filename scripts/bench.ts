// Times Mergeline's data path on a repo: node .test-out/bench.mjs <repo>
import { readLog, readState } from '../src/core/gitlog';
import { layout } from '../src/core/graph';
const repo = process.argv[2];
for (const max of [500, 5000, 100000]) {
  const t0 = performance.now();
  const [log, st] = await Promise.all([readLog(repo, { max }), readState(repo)]);
  const t1 = performance.now();
  const lay = layout(log);
  const t2 = performance.now();
  const bytes = JSON.stringify({ commits: log, rows: lay.rows, refs: st.refs }).length;
  console.log(`max=${max} commits=${log.length} git=${(t1 - t0).toFixed(0)}ms layout=${(t2 - t1).toFixed(0)}ms width=${lay.width} payload=${(bytes / 1e6).toFixed(1)}MB`);
}
