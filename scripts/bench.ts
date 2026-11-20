// Times Mergeline's data path on a repo: node .test-out/bench.mjs <repo>
// Payload sizes: "full" = per-row segment lists (0.2.0 protocol), "packed" = what 0.3.0 sends.
import { readLog, readState } from '../src/core/gitlog';
import { layout, newLayoutState } from '../src/core/graph';
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

// Load more, page by page up to 5,000 commits (500 per page, the default): bytes posted to the
// webview when every page re-sends everything (0.9 and earlier) vs only the new rows (0.10).
{
  const page = 500;
  const all = await readLog(repo, { max: 5000 });
  const st = await readState(repo);
  let resend = 0, append = 0, tResend = 0, tAppend = 0;
  const lst = newLayoutState();
  for (let n = page; n <= all.length; n += page) {
    const commits = all.slice(0, n);
    let t = performance.now();
    const lay = layout(commits);
    resend += JSON.stringify({ commits, packed: lay.packed, start: lay.start, refs: st.refs }).length;
    tResend += performance.now() - t;
    t = performance.now();
    const tail = all.slice(n - page, n);
    const part = layout(tail, lst);
    append += n === page ? JSON.stringify({ commits: tail, packed: part.packed, start: part.start, refs: st.refs }).length : JSON.stringify({ commits: tail, packed: part.packed }).length;
    tAppend += performance.now() - t;
  }
  console.log(`load more to ${all.length} in pages of ${page}: posted resend-all=${(resend / 1e6).toFixed(2)}MB append=${(append / 1e6).toFixed(2)}MB; layout+serialise resend-all=${tResend.toFixed(0)}ms append=${tAppend.toFixed(0)}ms`);
}
