// Times Mergeline's data path on a repo: node .test-out/bench.mjs <repo>
// Payload sizes: "full" = per-row segment lists (0.2.0 protocol), "packed" = what 0.3.0 sends.
import { readLog, readState } from '../src/core/gitlog';
import { layout } from '../src/core/graph';
const repo = process.argv[2];
for (const max of [500, 5000, 100000]) {
  const t0 = performance.now();
  const [log, st] = await Promise.all([readLog(repo, { max }), readState(repo)]);
  const t1 = performance.now();
  const lay = layout(log);
  const t2 = performance.now();
  const full = JSON.stringify({ commits: log, rows: lay.rows, refs: st.refs }).length;
  const packed = JSON.stringify({ commits: log, packed: lay.packed, start: lay.start, refs: st.refs }).length;
  const graphOnly = [JSON.stringify(lay.rows).length, JSON.stringify(lay.packed).length];
  console.log(`max=${max} commits=${log.length} git=${(t1 - t0).toFixed(0)}ms layout=${(t2 - t1).toFixed(0)}ms width=${lay.width} payload full=${(full / 1e6).toFixed(2)}MB packed=${(packed / 1e6).toFixed(2)}MB (graph part ${(graphOnly[0] / 1e6).toFixed(2)} → ${(graphOnly[1] / 1e6).toFixed(2)}MB)`);
}
