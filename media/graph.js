// Mergeline webview. Plain JS, no framework. Renders only the rows in view.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const ROW = 24;
  const LANE = 14;
  const PAD = 10;
  const MAX_LANES_SHOWN = 30;
  const UNC = '*';

  /** @type {any} */
  let data = null;
  let repos = [];
  let currentRepo = null;
  let settings = { dateFormat: 'relative' };
  let selected = null; // sha
  let compareSha = null;
  let refsBySha = new Map();
  let indexBySha = new Map();
  let matches = [];
  let matchPos = -1;
  let loadingMore = false;
  let details = null;
  /** History search results for query `q`: { q, matches: [{sha, index}], total }; null when off. */
  let hist = null;
  let histPending = null; // query sent, answer not back yet
  let pendingReveal = null; // sha to select once it is loaded

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const short = (s) => (s && s.length === 40 ? s.slice(0, 7) : s || '');
  const $ = (sel) => document.querySelector(sel);

  document.getElementById('app').innerHTML = `
  <div id="toolbar">
    <label class="tb">Repo <select id="repo" title="Repository"></select></label>
    <label class="tb">Branch <select id="branch" title="Show only this branch"></select></label>
    <label class="tb chk"><input type="checkbox" id="remotes"> Remotes</label>
    <label class="tb">Order <select id="order" title="Commit order. Topology keeps each branch's commits together."><option value="date">Date</option><option value="topo">Topology</option><option value="author-date">Author date</option></select></label>
    <span id="orderhint" class="hint" hidden>Busy graph: Topology order keeps each branch together</span>
    <span class="grow"></span>
    <span class="find"><input id="find" type="search" placeholder="Find (subject, author, hash, ref)" spellcheck="false" aria-label="Find">
      <button id="prev" title="Previous match (Shift+Enter)" aria-label="Previous match">▲</button><button id="next" title="Next match (Enter)" aria-label="Next match">▼</button><span id="count"></span><button id="findall" title="Search the whole history (message, author, hash, ref), not just the loaded commits" hidden>All history</button></span>
    <button id="fetch" title="Fetch from all remotes">Fetch</button>
    <button id="refresh" title="Refresh">Refresh</button>
  </div>
  <div id="pathbar" hidden></div>
  <div id="main">
    <div id="header" class="row hdr"><div class="c-graph">Graph</div><div class="c-desc">Description</div><div class="c-date">Date</div><div class="c-author">Author</div><div class="c-hash">Commit</div></div>
    <div id="scroller" tabindex="0"><div id="spacer"></div><div id="rows"></div><div id="more"></div></div>
    <div id="msg" hidden></div>
  </div>
  <div id="details" hidden></div>
  <div id="menu" hidden role="menu"></div>`;

  const scroller = $('#scroller');
  const rowsEl = $('#rows');
  const spacer = $('#spacer');
  const moreEl = $('#more');
  const menu = $('#menu');
  const detailsEl = $('#details');

  // ---------- toolbar ----------
  $('#repo').addEventListener('change', (e) => vscode.postMessage({ type: 'setRepo', repo: e.target.value }));
  $('#branch').addEventListener('change', sendFilter);
  $('#remotes').addEventListener('change', sendFilter);
  $('#order').addEventListener('change', (e) => vscode.postMessage({ type: 'order', order: e.target.value }));
  $('#pathbar').addEventListener('click', (e) => {
    if (e.target.closest('#clearpath')) vscode.postMessage({ type: 'filter', branch: $('#branch').value, remotes: $('#remotes').checked, path: '' });
  });
  $('#refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  $('#fetch').addEventListener('click', () => vscode.postMessage({ type: 'action', action: 'fetch' }));
  $('#find').addEventListener('input', () => runFind(true));
  $('#find').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      // Nothing among the loaded commits: look through the whole history instead.
      if (!matches.length && !hist && data && data.hasMore && e.target.value.trim()) searchAll();
      else step(e.shiftKey ? -1 : 1);
    }
    if (e.key === 'Escape') { e.target.value = ''; runFind(false); scroller.focus(); }
  });
  $('#next').addEventListener('click', () => step(1));
  $('#findall').addEventListener('click', searchAll);
  function searchAll() {
    const q = $('#find').value.trim();
    if (!q) return;
    histPending = q;
    $('#count').textContent = 'searching…';
    vscode.postMessage({ type: 'searchHistory', q });
  }
  $('#prev').addEventListener('click', () => step(-1));
  function sendFilter() {
    vscode.postMessage({ type: 'filter', branch: $('#branch').value, remotes: $('#remotes').checked });
  }

  // ---------- messages ----------
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    switch (m.type) {
      case 'settings': settings = m.settings; $('#order').value = settings.commitOrder || 'date'; render(); break;
      case 'repos': repos = m.repos; currentRepo = m.repo; fillRepos(); break;
      case 'data': setData(m); break;
      case 'details': showDetails(m); break;
      case 'history': gotHistory(m); break;
      case 'reveal': if (indexBySha.has(m.sha)) { pendingReveal = null; select(m.sha, true); } else pendingReveal = m.sha; break;
      case 'empty': showMsg(m.message); break;
      case 'error': showMsg('Error: ' + m.message); break;
      case 'ping': vscode.postMessage({ type: 'pong', rows: rowsEl.children.length, selected, details: !detailsEl.hidden, count: $('#count').textContent, pathbar: $('#pathbar').hidden ? '' : $('#pathbar').textContent }); break;
    }
  });

  function showMsg(t) {
    const el = $('#msg');
    el.textContent = t;
    el.hidden = false;
    spacer.style.height = '0px';
    rowsEl.innerHTML = '';
    moreEl.innerHTML = '';
  }

  function fillRepos() {
    const sel = $('#repo');
    sel.innerHTML = repos.map((r) => `<option value="${esc(r.root)}" title="${esc(r.root)}">${esc(r.name)}</option>`).join('');
    sel.value = currentRepo || '';
    sel.parentElement.style.display = repos.length > 1 ? '' : 'none';
  }

  function setData(m) {
    const repoChanged = !data || data.repo !== m.repo;
    data = m;
    rowCache = new Map();
    loadingMore = false;
    $('#msg').hidden = true;
    refsBySha = new Map();
    for (const r of m.refs) {
      if (!refsBySha.has(r.sha)) refsBySha.set(r.sha, []);
      refsBySha.get(r.sha).push(r);
    }
    indexBySha = new Map(m.commits.map((c, i) => [c.sha, i]));
    const bsel = $('#branch');
    bsel.innerHTML = `<option value="">All branches</option>` + m.branches.map((b) => `<option>${esc(b)}</option>`).join('');
    bsel.value = m.filter.branch || '';
    $('#remotes').checked = m.filter.remotes;
    if (m.order) $('#order').value = m.order;
    $('#orderhint').hidden = !(m.order !== 'topo' && m.width > 20);
    const pb = $('#pathbar');
    if (m.filter.path) {
      pb.innerHTML = `<span class="pb-icon" aria-hidden="true">⟲</span> History of <code title="${esc(m.filter.path)}">${esc(m.filter.path)}</code>${m.names && m.names.length > 1 ? `<span class="pb-n" title="${esc(m.names.slice(1).join('\n'))}">also as ${m.names.slice(1, 3).map((n) => `<code>${esc(n)}</code>`).join(', ')}${m.names.length > 3 ? ` +${m.names.length - 3}` : ''}</span>` : ''}<span class="pb-n">${m.commits.length}${m.hasMore ? '+' : ''} commit${m.commits.length === 1 ? '' : 's'}</span><button id="clearpath" title="Show all commits again">Show all commits</button>`;
      pb.hidden = false;
    } else pb.hidden = true;
    if (repoChanged) { selected = null; compareSha = null; closeDetails(); scroller.scrollTop = 0; }
    else if (selected && !indexBySha.has(selected)) closeDetails();
    const gw = graphWidth();
    document.documentElement.style.setProperty('--graph-w', gw + 'px');
    spacer.style.height = m.commits.length * ROW + 44 + 'px';
    moreEl.style.top = m.commits.length * ROW + 'px';
    moreEl.innerHTML = m.hasMore ? `<button id="loadmore">Load more commits</button>` : m.commits.length ? `<span class="end">${m.commits.length} commits</span>` : '';
    const lm = $('#loadmore');
    if (lm) lm.addEventListener('click', loadMore);
    if (!m.commits.length) showMsg(m.filter.path ? 'No commits touch this file on the shown branches. It may be new or untracked.' : 'This repository has no commits yet.');
    runFind(false);
    if (pendingReveal && indexBySha.has(pendingReveal)) { const r = pendingReveal; pendingReveal = null; select(r, true); }
    render();
  }

  // Rows arrive packed (see media/rows.js); decode the visible ones on demand.
  let rowCache = new Map();
  function rowAt(i) {
    let r = rowCache.get(i);
    if (!r) {
      r = MergelineRows.unpackRow(i ? data.packed[i - 1][2] : data.start, data.packed[i]);
      if (rowCache.size > 2000) rowCache = new Map();
      rowCache.set(i, r);
    }
    return r;
  }

  function graphWidth() {
    // At least wide enough for the "Graph" header; lanes past MAX_LANES_SHOWN are clipped.
    return Math.max(52, PAD * 2 + Math.max(1, Math.min(data ? data.width : 1, MAX_LANES_SHOWN)) * LANE - LANE + 8);
  }

  function loadMore() {
    if (loadingMore || !data || !data.hasMore) return;
    loadingMore = true;
    vscode.postMessage({ type: 'loadMore' });
  }

  // ---------- rendering ----------
  let raf = 0;
  scroller.addEventListener('scroll', () => {
    hideMenu();
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); });
    if (data && data.hasMore && scroller.scrollTop + scroller.clientHeight > data.commits.length * ROW - ROW * 20) loadMore();
  });
  window.addEventListener('resize', () => render());

  const x = (c) => PAD + c * LANE;
  const color = (i) => `var(--lane-${i % 10})`;

  function segPath(s, y0) {
    const xa = x(s[0]), xb = x(s[1]);
    if (xa === xb) return `<path d="M${xa} ${y0}V${y0 + ROW / 2}" stroke="${color(s[2])}"/>`;
    const ym = y0 + ROW / 2;
    return `<path d="M${xa} ${y0}C${xa} ${y0 + ROW / 2 * 0.75} ${xb} ${y0 + ROW / 2 * 0.25} ${xb} ${ym}" stroke="${color(s[2])}"/>`;
  }

  function graphSvg(c, row) {
    let p = '';
    for (const s of row.top) p += segPath(s, 0);
    for (const s of row.bot) p += segPath(s, ROW / 2);
    // A node in a clipped lane is pinned to the right edge, hollow, so it is never invisible.
    const clipped = row.col >= MAX_LANES_SHOWN;
    const cx = x(clipped ? MAX_LANES_SHOWN - 1 : row.col), cy = ROW / 2, col = color(row.color);
    let node;
    if (c.kind === 'stash') node = `<rect x="${cx - 4}" y="${cy - 4}" width="8" height="8" rx="1.5" class="n-stash" stroke="${col}"/>`;
    else if (c.kind === 'uncommitted') node = `<circle cx="${cx}" cy="${cy}" r="4" class="n-unc" stroke="${col}"/>`;
    else if (clipped) node = `<circle cx="${cx}" cy="${cy}" r="4" class="n-unc" stroke="${col}"><title>Lane ${row.col + 1} (off screen)</title></circle>`;
    else if (c.sha === data.head) node = `<circle cx="${cx}" cy="${cy}" r="5.5" class="n-head" stroke="${col}"/><circle cx="${cx}" cy="${cy}" r="2.5" fill="${col}"/>`;
    else node = `<circle cx="${cx}" cy="${cy}" r="4" fill="${col}" class="n"/>`;
    return `<svg width="${graphWidth()}" height="${ROW}" aria-hidden="true">${p}${node}</svg>`;
  }

  function refBadges(c) {
    const out = [];
    if (c.kind === 'uncommitted') return '<span class="badge unc">working tree</span>';
    if (c.kind === 'stash') return `<span class="badge stash" data-kind="stash">${esc(c.stashRef)}</span>`;
    const refs = refsBySha.get(c.sha) || [];
    if (c.sha === data.head && !data.branch) out.push(`<span class="badge head-detached" title="Detached HEAD">HEAD</span>`);
    const locals = refs.filter((r) => r.type === 'head');
    const remotes = refs.filter((r) => r.type === 'remote');
    const used = new Set();
    for (const r of locals) {
      const cur = r.name === data.branch;
      const twins = remotes.filter((rr) => rr.name.slice(rr.remote.length + 1) === r.name);
      twins.forEach((t) => used.add(t.name));
      out.push(`<span class="badge branch${cur ? ' current' : ''}" data-ref="${esc(r.name)}" data-type="head" title="${cur ? 'Current branch ' : 'Branch '}${esc(r.name)}">${cur ? '● ' : ''}${esc(r.name)}${twins.map((t) => `<span class="twin" data-ref="${esc(t.name)}" data-type="remote" data-remote="${esc(t.remote)}" title="${esc(t.name)}">${esc(t.remote)}</span>`).join('')}</span>`);
    }
    for (const r of remotes) if (!used.has(r.name)) out.push(`<span class="badge remote" data-ref="${esc(r.name)}" data-type="remote" data-remote="${esc(r.remote)}" title="Remote branch ${esc(r.name)}">${esc(r.name)}</span>`);
    for (const r of refs.filter((r) => r.type === 'tag')) out.push(`<span class="badge tag" data-ref="${esc(r.name)}" data-type="tag" title="Tag ${esc(r.name)}">${esc(r.name)}</span>`);
    return out.join('');
  }

  function fmtDate(t) {
    const d = new Date(t * 1000);
    if (settings.dateFormat === 'iso') return d.toISOString().slice(0, 16).replace('T', ' ');
    if (settings.dateFormat === 'locale') return d.toLocaleString();
    const s = Math.max(0, Date.now() / 1000 - t);
    const u = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
    for (const [n, name] of u) if (s >= n) { const v = Math.floor(s / n); return `${v} ${name}${v > 1 ? 's' : ''} ago`; }
    return 'just now';
  }

  function render() {
    if (!data) return;
    const n = data.commits.length;
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW) - 10);
    const last = Math.min(n, Math.ceil((scroller.scrollTop + scroller.clientHeight) / ROW) + 10);
    const matchSet = new Set(matches);
    let h = '';
    for (let i = first; i < last; i++) {
      const c = data.commits[i];
      const row = rowAt(i);
      const cls = ['row'];
      if (c.sha === selected) cls.push('sel');
      if (c.sha === compareSha) cls.push('cmp');
      if (matchSet.has(i)) cls.push('match');
      if (matches[matchPos] === i) cls.push('match-cur');
      if (c.kind !== 'commit') cls.push('k-' + c.kind);
      if (c.parents.length > 1) cls.push('merge');
      h += `<div class="${cls.join(' ')}" style="top:${i * ROW}px" data-i="${i}">
        <div class="c-graph">${graphSvg(c, row)}</div>
        <div class="c-desc">${refBadges(c)}<span class="subj" title="${esc(c.subject)}">${esc(c.subject)}</span></div>
        <div class="c-date" title="${c.kind === 'uncommitted' ? '' : esc(new Date(c.date * 1000).toString())}">${c.kind === 'uncommitted' ? '' : esc(fmtDate(c.date))}</div>
        <div class="c-author" title="${esc(c.email)}">${esc(c.author)}</div>
        <div class="c-hash">${c.kind === 'uncommitted' ? '' : esc(short(c.sha))}</div></div>`;
    }
    rowsEl.innerHTML = h;
  }

  // ---------- selection & details ----------
  rowsEl.addEventListener('click', (e) => {
    const r = e.target.closest('.row');
    if (!r) return;
    const c = data.commits[+r.dataset.i];
    if ((e.ctrlKey || e.metaKey) && selected && selected !== c.sha) {
      compareSha = c.sha;
      vscode.postMessage({ type: 'details', sha: selected, compare: c.sha });
    } else if (selected === c.sha && !compareSha && !detailsEl.hidden) {
      closeDetails();
    } else select(c.sha);
    render();
  });
  rowsEl.addEventListener('dblclick', (e) => {
    const b = e.target.closest('.badge.branch, .badge.remote');
    if (b) action({ action: 'checkoutBranch', ref: b.dataset.ref, refType: b.dataset.type, remote: b.dataset.remote });
  });

  function select(sha, scroll) {
    selected = sha;
    compareSha = null;
    vscode.postMessage({ type: 'details', sha });
    if (scroll) scrollTo(indexBySha.get(sha));
    render();
  }

  function scrollTo(i) {
    if (i === undefined) return;
    const top = i * ROW;
    if (top < scroller.scrollTop || top + ROW > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 3);
  }

  function closeDetails() {
    detailsEl.hidden = true;
    details = null;
    selected = null;
    compareSha = null;
    render();
  }

  const STATUS = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed', U: 'Untracked' };

  function showDetails(m) {
    if (m.sha !== selected) return;
    details = m;
    const c = data.commits[indexBySha.get(m.sha)] || {};
    let head = '';
    if (m.compare) {
      head = `<div class="d-title">Comparing ${esc(m.from === UNC ? 'working tree' : short(m.from))} → ${esc(m.to ? short(m.to) : 'working tree')}</div>`;
    } else if (m.info) {
      const i = m.info;
      const body = i.message.split('\n').slice(1).join('\n').trim();
      head = `<div class="d-title">${esc(i.message.split('\n')[0])}</div>
        <div class="d-meta"><span>Commit <code class="link" data-copy="${esc(i.sha)}" title="Copy">${esc(i.sha)}</code></span>
        <span>Parents ${i.parents.map((p) => `<code class="link" data-goto="${esc(p)}">${esc(short(p))}</code>`).join(' ') || 'none'}</span>
        <span>Author <b>${esc(i.author)}</b> &lt;${esc(i.email)}&gt;, ${esc(new Date(i.authorDate * 1000).toLocaleString())}</span>
        ${i.committer !== i.author || i.commitDate !== i.authorDate ? `<span>Committer ${esc(i.committer)}, ${esc(new Date(i.commitDate * 1000).toLocaleString())}</span>` : ''}</div>
        ${body ? `<pre class="d-body">${esc(body)}</pre>` : ''}`;
    } else if (c.kind === 'uncommitted') head = `<div class="d-title">Uncommitted changes</div>`;
    if (m.error) head += `<div class="d-err">${esc(m.error)}</div>`;
    const add = m.files.reduce((n, f) => n + (f.additions || 0), 0);
    const del = m.files.reduce((n, f) => n + (f.deletions || 0), 0);
    const focus = data.filter && data.filter.path ? (data.names && data.names.length ? data.names : [data.filter.path]) : null;
    const files = m.files.map((f, k) => `<li class="file${focus && (focus.includes(f.path) || focus.includes(f.oldPath)) ? ' focus' : ''}" data-k="${k}" title="${esc(STATUS[f.status] || f.status)}: open diff">
        <span class="st st-${esc(f.status)}">${esc(f.status)}</span>
        <span class="fp">${f.oldPath ? esc(f.oldPath) + ' → ' : ''}${esc(f.path)}</span>
        <span class="ad">${f.additions == null ? (f.status === 'U' ? '' : 'bin') : `<i class="plus">+${f.additions}</i> <i class="minus">−${f.deletions}</i>`}</span></li>`).join('');
    detailsEl.innerHTML = `<button class="d-close" title="Close (Esc)" aria-label="Close details">×</button>${head}
      <div class="d-files-h">${m.files.length} file${m.files.length === 1 ? '' : 's'} changed <i class="plus">+${add}</i> <i class="minus">−${del}</i>${m.compare ? '' : ' <span class="hint">Ctrl/Cmd-click another commit to compare</span>'}</div>
      <ul class="d-files">${files}</ul>`;
    detailsEl.hidden = false;
    scrollTo(indexBySha.get(m.sha));
  }

  detailsEl.addEventListener('click', (e) => {
    if (e.target.closest('.d-close')) return closeDetails();
    const g = e.target.closest('[data-goto]');
    if (g) { if (indexBySha.has(g.dataset.goto)) select(g.dataset.goto, true); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) return action({ action: 'copyHash', sha: cp.dataset.copy });
    const f = e.target.closest('.file');
    if (f && details) {
      const file = details.files[+f.dataset.k];
      vscode.postMessage({ type: 'openFile', from: details.from === UNC ? 'HEAD' : details.from, to: details.to, path: file.path, oldPath: file.oldPath, status: file.status });
    }
  });

  // ---------- find ----------
  function runFind(jump) {
    const raw = $('#find').value.trim();
    const q = raw.toLowerCase();
    if (hist && hist.q !== raw) hist = null;
    matches = [];
    if (hist) {
      for (const m of hist.matches) { const i = indexBySha.get(m.sha); if (i !== undefined) matches.push(i); }
    } else if (q && data) {
      data.commits.forEach((c, i) => {
        const refs = (refsBySha.get(c.sha) || []).map((r) => r.name).join(' ');
        if (c.subject.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.sha.startsWith(q) || refs.toLowerCase().includes(q) || (c.stashRef || '').includes(q)) matches.push(i);
      });
    }
    if (!hist || jump) matchPos = (hist ? hist.matches.length : matches.length) ? 0 : -1;
    updateCount();
    $('#findall').hidden = !(q && data && data.hasMore && !hist);
    if (jump && matches.length) scrollTo(matches[0]);
    render();
  }
  function updateCount() {
    const q = $('#find').value.trim();
    let t = '';
    if (hist) {
      const n = hist.matches.length;
      t = n ? `${matchPos + 1}/${hist.total} in history` : 'none in history';
      if (hist.total > n) t += ` (first ${n})`;
    } else if (q) t = matches.length ? `${matchPos + 1}/${matches.length}${data && data.hasMore ? ' loaded' : ''}` : (data && data.hasMore ? 'none loaded' : 'none');
    $('#count').textContent = t;
  }
  function gotHistory(m) {
    if (m.q !== histPending || m.q !== $('#find').value.trim()) return;
    histPending = null;
    hist = { q: m.q, matches: m.matches, total: m.total };
    runFind(false);
    matchPos = -1;
    if (m.error) $('#count').textContent = 'search failed';
    else if (hist.matches.length) step(1);
  }
  function step(d) {
    if (hist) {
      const n = hist.matches.length;
      if (!n) return;
      matchPos = (matchPos + d + n) % n;
      updateCount();
      const m = hist.matches[matchPos];
      if (indexBySha.has(m.sha)) select(m.sha, true);
      else { pendingReveal = m.sha; $('#count').textContent = `loading ${m.index + 1} commits…`; vscode.postMessage({ type: 'loadTo', sha: m.sha, index: m.index }); }
      return;
    }
    if (!matches.length) return;
    matchPos = (matchPos + d + matches.length) % matches.length;
    updateCount();
    select(data.commits[matches[matchPos]].sha, true);
  }

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#find').focus(); $('#find').select(); return; }
    if (e.key === 'Escape') { if (!menu.hidden) hideMenu(); else if (!detailsEl.hidden) closeDetails(); return; }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && data && data.commits.length) {
      e.preventDefault();
      const i = selected != null && indexBySha.has(selected) ? indexBySha.get(selected) + (e.key === 'ArrowDown' ? 1 : -1) : 0;
      if (i >= 0 && i < data.commits.length) select(data.commits[i].sha, true);
    }
  });

  // ---------- context menu ----------
  function action(m) { vscode.postMessage({ type: 'action', ...m }); }

  rowsEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const r = e.target.closest('.row');
    if (!r) return;
    const c = data.commits[+r.dataset.i];
    const badge = e.target.closest('[data-ref]');
    let items;
    if (badge) items = refItems(badge.dataset.ref, badge.dataset.type, badge.dataset.remote, c);
    else items = commitItems(c);
    showMenu(items, e.clientX, e.clientY);
  });

  function commitItems(c) {
    const isHead = c.sha === data.head;
    const cur = data.branch ? `“${data.branch}”` : 'HEAD';
    const base = { sha: c.sha, subject: c.subject, parents: c.parents };
    if (c.kind === 'uncommitted') return [
      ['Stash changes…', { action: 'stashSave' }],
      ['Open Source Control', { action: 'openScm' }],
      null,
      ['Discard all changes…', { action: 'discardAll' }, 'danger'],
    ];
    if (c.kind === 'stash') {
      const s = { ...base, stashRef: c.stashRef };
      return [
        ['Apply stash', { ...s, action: 'stashApply' }],
        ['Pop stash', { ...s, action: 'stashPop' }],
        ['Create branch from stash…', { ...s, action: 'stashBranch' }],
        null,
        ['Drop stash…', { ...s, action: 'stashDrop' }, 'danger'],
        null,
        ['Copy stash hash', { ...s, action: 'copyHash' }],
      ];
    }
    return [
      ['Create branch here…', { ...base, action: 'createBranch' }],
      ['Add tag…', { ...base, action: 'createTag' }],
      ['Check out (detached)', { ...base, action: 'checkoutCommit' }, isHead ? 'disabled' : ''],
      null,
      ['Cherry-pick onto ' + cur, { ...base, action: 'cherryPick' }, isHead ? 'disabled' : ''],
      ['Revert…', { ...base, action: 'revert' }],
      null,
      ['Merge into ' + cur + '…', { ...base, action: 'merge' }, isHead ? 'disabled' : ''],
      ['Rebase ' + cur + ' onto this…', { ...base, action: 'rebase' }, isHead ? 'disabled' : ''],
      ['Interactive rebase from here (terminal)', { ...base, action: 'interactiveRebase' }],
      ['Reset ' + cur + ' to here…', { ...base, action: 'reset' }, isHead ? 'disabled' : ''],
      null,
      ['Copy hash', { ...base, action: 'copyHash' }],
      ['Copy subject', { ...base, action: 'copySubject' }],
    ];
  }

  function refItems(name, type, remote, c) {
    const cur = data.branch;
    const curL = cur ? `“${cur}”` : 'HEAD';
    const r = { ref: name, refType: type, remote, sha: c.sha, subject: c.subject };
    if (type === 'tag') return [
      ['Push tag…', { ...r, action: 'pushTag' }],
      ['Merge tag into ' + curL + '…', { ...r, action: 'merge' }],
      ['Delete tag…', { ...r, action: 'deleteTag' }, 'danger'],
      null,
      ['Copy tag name', { ...r, action: 'copyRef' }],
    ];
    if (type === 'remote') return [
      ['Check out as local branch…', { ...r, action: 'checkoutBranch' }],
      ['Merge into ' + curL + '…', { ...r, action: 'merge' }],
      ['Rebase ' + curL + ' onto ' + name + '…', { ...r, action: 'rebase' }],
      null,
      ['Delete on remote…', { ...r, action: 'deleteRemoteBranch' }, 'danger'],
      null,
      ['Copy branch name', { ...r, action: 'copyRef' }],
    ];
    const isCur = name === cur;
    return [
      ['Check out', { ...r, action: 'checkoutBranch' }, isCur ? 'disabled' : ''],
      ['Merge into ' + curL + '…', { ...r, action: 'merge' }, isCur ? 'disabled' : ''],
      ['Rebase ' + curL + ' onto ' + name + '…', { ...r, action: 'rebase' }, isCur ? 'disabled' : ''],
      null,
      ['Push…', { ...r, action: 'pushBranch' }],
      ...(isCur ? [['Pull', { ...r, action: 'pull' }]] : []),
      ['Rename…', { ...r, action: 'renameBranch' }],
      ['Delete…', { ...r, action: 'deleteBranch' }, isCur ? 'disabled' : 'danger'],
      null,
      ['Copy branch name', { ...r, action: 'copyRef' }],
    ];
  }

  let menuItems = [];
  function showMenu(items, cx, cy) {
    menuItems = items;
    menu.innerHTML = items.map((it, k) => (it ? `<div class="mi ${it[2] || ''}" role="menuitem" data-k="${k}" tabindex="-1">${esc(it[0])}</div>` : '<div class="sep"></div>')).join('');
    menu.hidden = false;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.min(cx, window.innerWidth - w - 4) + 'px';
    menu.style.top = Math.max(0, Math.min(cy, window.innerHeight - h - 4)) + 'px';
  }
  function hideMenu() { menu.hidden = true; }
  menu.addEventListener('click', (e) => {
    const mi = e.target.closest('.mi');
    if (!mi || mi.classList.contains('disabled')) return;
    hideMenu();
    action(menuItems[+mi.dataset.k][1]);
  });
  document.addEventListener('mousedown', (e) => { if (!menu.contains(e.target)) hideMenu(); });
  window.addEventListener('blur', hideMenu);

  vscode.postMessage({ type: 'ready' });
})();
