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
  /** Loaded commits that have a git note (refs/notes/commits). */
  let noteSet = new Set();
  let wtBySha = new Map(); // other worktrees by the commit they have checked out
  let bisectBy = new Map(); // sha → 'bad' | 'good' | 'skip' while a git bisect runs
  let lastTesting = null; // bisect: the commit under test last time, to follow it when it changes
  let wtByBranch = new Map(); // other worktrees by the branch they have checked out
  let cmpInfo = null; // { base, a, b }: labels for a branch comparison in the details pane
  let dropIndex = -1; // row under a dragged branch
  let indexBySha = new Map();
  let matches = [];
  let matchPos = -1;
  let loadingMore = false;
  let details = null;
  /** History search results for query `q`: { q, matches: [{sha, index}], total }; null when off. */
  let hist = null;
  let histPending = null; // query sent, answer not back yet
  /** Avatar image URL by author email (only when mergeline.showAvatars is on); failed URLs are not tried again. */
  let avatarBy = {};
  const avatarFailed = new Set();
  let pendingReveal = null; // sha to select once it is loaded
  /** Saved layout: column widths in px (graph null = automatic), hidden columns, details height. */
  const COLS = { graph: 'Graph', date: 'Date', author: 'Author', hash: 'Commit' };
  const DEFAULT_W = { date: 120, author: 150, hash: 76 };
  let lay = { w: {}, hidden: [], details: null };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const short = (s) => (s && s.length === 40 ? s.slice(0, 7) : s || '');
  const $ = (sel) => document.querySelector(sel);

  document.getElementById('app').innerHTML = `
  <div id="toolbar">
    <label class="tb"><span class="tbl">Repo</span> <select id="repo" title="Repository"></select></label>
    <span class="tb"><span class="tbl">Branches</span> <button id="branchbtn" class="secondary drop" title="Show only some branches or tags" aria-haspopup="true" aria-expanded="false">All</button></span>
    <span class="tb"><span class="tbl">Authors</span> <button id="authbtn" class="secondary drop" title="Show only commits by some authors" aria-haspopup="true" aria-expanded="false">All</button></span>
    <label class="tb chk full" title="Show remote-tracking branches"><input type="checkbox" id="remotes"> Remote branches</label>
    <label class="tb chk full" title="Follow only the first parent of merges (git log --first-parent): each branch's own line, merged commits hidden behind their merge"><input type="checkbox" id="firstparent"> First parent</label>
    <label class="tb chk" title="Fold straight runs of commits into one row, so only branch tips, tags, merges and the points where branches split are shown. Click a folded row to open it."><input type="checkbox" id="compact"> Compact</label><span id="foldhint" class="hint" hidden></span>
    <label class="tb full">Order <select id="order" title="Commit order. Topology keeps each branch's commits together."><option value="date">Date</option><option value="topo">Topology</option><option value="author-date">Author date</option></select></label>
    <span id="orderhint" class="hint" hidden>Busy graph: Topology order keeps each branch together</span>
    <span class="grow"></span>
    <span class="find"><input id="find" type="search" placeholder="Find (subject, author, hash, ref, path:…)" title="Find in loaded commits. Type path:src/auth or path:*.md and press Enter to find commits that changed matching files anywhere in history." spellcheck="false" aria-label="Find">
      <button id="prev" title="Previous match (Shift+Enter)" aria-label="Previous match">▲</button><button id="next" title="Next match (Enter)" aria-label="Next match">▼</button><span id="count"></span><button id="findall" title="Search the whole history (message, author, hash, ref, or path:… for changed files), not just the loaded commits" hidden>All history</button></span>
    <button id="patchbtn" class="secondary drop full lo" title="Apply a patch from a file or the clipboard, or save uncommitted changes as a patch" aria-haspopup="true">Patch</button>
    <button id="remotesbtn" class="secondary full lo" title="Manage remotes: add, fetch, prune, change URL, rename, remove">Remotes…</button>
    <button id="fetch" title="Fetch from all remotes">Fetch</button>
    <button id="refresh" class="full lo" title="Refresh">Refresh</button>
    <button id="morebtn" class="secondary drop" title="More: remote branches, first parent, commit order, patches, remotes, refresh" aria-haspopup="true" aria-label="More options">⋯</button>
  </div>
  <div id="opbar" hidden role="status"></div>
  <div id="bisectbar" hidden role="status"></div>
  <div id="pathbar" hidden></div>
  <div id="main">
    <div id="header" class="row hdr" title="Drag a column edge to resize it (double-click: reset). Right-click to show or hide columns."><div class="c-graph">Graph<span class="rz" data-col="graph"></span></div><div class="c-desc">Description</div><div class="c-date">Date<span class="rz" data-col="date"></span></div><div class="c-author">Author<span class="rz" data-col="author"></span></div><div class="c-hash">Commit<span class="rz" data-col="hash"></span></div></div>
    <div id="scroller" tabindex="0"><div id="spacer"></div><div id="rows"></div><div id="more"></div></div>
    <div id="msg" hidden></div>
  </div>
  <div id="split" hidden title="Drag to resize the details pane (double-click: reset)"></div>
  <div id="details" hidden></div>
  <div id="menu" hidden role="menu"></div>
  <div id="bpop" hidden role="dialog" aria-label="Branches to show"><input id="bfind" type="search" placeholder="Filter branches and tags" spellcheck="false" aria-label="Filter branches">
    <div class="bp-quick"><button type="button" data-q="all" class="secondary">All branches</button><button type="button" data-q="cur" class="secondary">Current branch</button></div>
    <div id="blist"></div><div id="bhidden" class="hint bp-hint" hidden></div><div class="hint bp-hint">Tick branches or tags to show only their history.</div></div>
  <div id="apop" hidden role="dialog" aria-label="Authors to show"><input id="afind" type="search" placeholder="Filter authors" spellcheck="false" aria-label="Filter authors">
    <div class="bp-quick"><button type="button" data-q="all" class="secondary">All authors</button></div>
    <div id="alist"></div><div class="hint bp-hint">Tick authors to show only their commits. Each one links to its nearest shown ancestor.</div></div>
  <div id="dlg" hidden role="dialog" aria-modal="true" aria-labelledby="dlg-t"><form id="dlg-f">
    <div id="dlg-t"></div>
    <label for="dlg-s" id="dlg-sl">Subject</label><input id="dlg-s" type="text" spellcheck="true" autocomplete="off">
    <label for="dlg-b" id="dlg-bl">Body <span class="hint">(optional)</span></label><textarea id="dlg-b" rows="9" spellcheck="true"></textarea>
    <div id="dlg-n" class="hint"></div>
    <div class="dlg-btns"><span class="hint">Ctrl/Cmd+Enter to save, Esc to cancel</span><button type="button" id="dlg-c" class="secondary">Cancel</button><button type="submit" id="dlg-ok">Save message</button></div>
  </form></div>`;

  const scroller = $('#scroller');
  const rowsEl = $('#rows');
  const spacer = $('#spacer');
  const moreEl = $('#more');
  const menu = $('#menu');
  const detailsEl = $('#details');

  // ---------- toolbar ----------
  $('#repo').addEventListener('change', (e) => vscode.postMessage({ type: 'setRepo', repo: e.target.value }));
  $('#remotes').addEventListener('change', sendFilter);
  $('#firstparent').addEventListener('change', (e) => vscode.postMessage({ type: 'firstParent', on: e.target.checked }));
  $('#compact').addEventListener('change', (e) => vscode.postMessage({ type: 'compact', on: e.target.checked }));
  $('#foldhint').addEventListener('click', (e) => { if (e.target.closest('[data-q="collapse"]')) { e.preventDefault(); vscode.postMessage({ type: 'collapse' }); } });
  // Compact graph: open a folded row (the extension reloads and selects its newest commit).
  function expandFold(c) {
    $('#count').textContent = `opening ${c.fold ? c.fold.n : ''} commits…`;
    vscode.postMessage({ type: 'expand', sha: c.sha });
  }
  $('#order').addEventListener('change', (e) => vscode.postMessage({ type: 'order', order: e.target.value }));
  $('#pathbar').addEventListener('click', (e) => {
    if (e.target.closest('#clearpath')) vscode.postMessage({ type: 'filter', branches: selBranches, remotes: $('#remotes').checked, path: '' });
  });
  $('#opbar').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-op]');
    if (!b) return;
    if (b.dataset.op === 'scm') vscode.postMessage({ type: 'action', action: 'openScm' });
    else action({ action: b.dataset.op });
  });
  $('#refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  $('#fetch').addEventListener('click', () => vscode.postMessage({ type: 'action', action: 'fetch' }));
  $('#remotesbtn').addEventListener('click', () => action({ action: 'manageRemotes' }));
  $('#patchbtn').addEventListener('click', (e) => { e.stopPropagation(); patchMenu(e.currentTarget.getBoundingClientRect()); });
  function patchMenu(r) {
    const dirty = data && data.commits.length && data.commits[0].kind === 'uncommitted' ? '' : 'disabled';
    showMenu([
      ['Apply patch from a file…', { action: 'applyPatch', from: 'file' }],
      ['Apply patch from the clipboard…', { action: 'applyPatch', from: 'clipboard' }],
      null,
      ['Save uncommitted changes as a patch…', { action: 'savePatch', patch: 'working' }, dirty],
      ['Copy uncommitted changes as a patch', { action: 'savePatch', patch: 'working', copy: true }, dirty],
    ], r.left, r.bottom + 2);
  }
  // "⋯": the controls a narrow toolbar hides (the sidebar view, or an editor tab too narrow for one line).
  function moreItems() {
    const tick = (on, label) => (on ? '✓ ' : '\u2003') + label;
    const toggle = (id) => () => { const el = $('#' + id); el.checked = !el.checked; el.dispatchEvent(new Event('change')); };
    const order = $('#order');
    const setOrder = (v) => () => { order.value = v; order.dispatchEvent(new Event('change')); };
    const r = $('#morebtn').getBoundingClientRect();
    return [
      [tick($('#remotes').checked, 'Remote branches'), toggle('remotes')],
      [tick($('#firstparent').checked, 'First parent'), toggle('firstparent')],
      null,
      ...[...order.options].map((o) => [tick(order.value === o.value, 'Order: ' + o.textContent), setOrder(o.value)]),
      null,
      ['Patch…', () => patchMenu(r)],
      ['Manage remotes…', { action: 'manageRemotes' }],
      ['Refresh', () => vscode.postMessage({ type: 'refresh' })],
    ];
  }
  $('#morebtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(moreItems(), r.right - 220, r.bottom + 2);
  });
  // Narrow: hide the wide controls (they move into "⋯") as soon as the toolbar would need a second line.
  const toolbar = $('#toolbar');
  function fitToolbar() {
    if (document.body.classList.contains('side')) return;
    const cl = document.body.classList;
    const wraps = () => {
      const mids = [...toolbar.children].filter((c) => c.offsetParent && c.offsetHeight).map((c) => c.offsetTop + c.offsetHeight / 2);
      return mids.length > 0 && Math.max(...mids) > Math.min(...mids) + 10;
    };
    // Tier 1 hides the buttons on the right (Patch, Remotes…, Refresh); tier 2 also the filters.
    cl.remove('narrow', 'narrow1');
    if (!wraps()) return;
    cl.add('narrow1');
    if (wraps()) cl.replace('narrow1', 'narrow');
  }
  const fitObs = new ResizeObserver(() => fitToolbar());
  fitObs.observe(document.body);
  fitObs.observe(toolbar);
  $('#find').addEventListener('input', () => runFind(true));
  $('#find').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      // Nothing among the loaded commits: look through the whole history instead.
      if (!hist && isPathQuery(e.target.value) && data) searchAll();
      else if (!matches.length && !hist && data && data.hasMore && e.target.value.trim()) searchAll();
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
    vscode.postMessage({ type: 'filter', branches: selBranches, remotes: $('#remotes').checked, authors: selAuthors });
  }

  // ---------- branch checklist (show only some branches) ----------
  /** Branches ticked in the checklist; empty = all. */
  let selBranches = [];
  const bpop = $('#bpop');
  function branchLabel() {
    const b = $('#branchbtn');
    const n = selBranches.length, nTags = selBranches.filter((x) => x.startsWith(TAGP)).length;
    b.textContent = !n ? 'All' : n === 1 ? refLabel(selBranches[0]) : `${n} ${nTags === n ? 'tags' : nTags ? 'refs' : 'branches'}`;
    b.title = selBranches.length ? 'Showing only: ' + selBranches.map(refLabel).join(', ') : 'Show only some branches or tags';
    b.classList.toggle('on', selBranches.length > 0);
  }
  // Tags are listed under the branches and sent as refs/tags/<name>, so a tag never gets mistaken for a branch of the same name.
  const TAGP = 'refs/tags/';
  const refLabel = (v) => (v.startsWith(TAGP) ? '◆ ' + v.slice(TAGP.length) : v);
  const MAX_TAGS = 50;
  function fillBranchList() {
    if (!data) return;
    const q = $('#bfind').value.trim().toLowerCase();
    const sel = new Set(selBranches);
    const hit = (name) => !q || name.toLowerCase().includes(q);
    const item = (v, label, cur) => `<label class="bp-item${cur ? ' cur' : ''}" title="${esc(label)}"><input type="checkbox" value="${esc(v)}"${sel.has(v) ? ' checked' : ''}> <span>${esc(label)}</span></label>`;
    // Ticked branches or tags that no longer exist stay listed so they can be unticked.
    const all = [...new Set([...data.branches, ...selBranches.filter((b) => !b.startsWith(TAGP))])];
    const shown = all.filter(hit);
    // Tags: highest version first (v10 above v9), ticked ones always shown, the rest capped unless filtered.
    const tagNames = [...new Set([...data.refs.filter((r) => r.type === 'tag').map((r) => r.name), ...selBranches.filter((b) => b.startsWith(TAGP)).map((b) => b.slice(TAGP.length))])]
      .filter(hit).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    const tagShown = tagNames.filter((t, k) => k < MAX_TAGS || sel.has(TAGP + t));
    let html = shown.map((b) => item(b, b, b === data.branch)).join('');
    if (tagNames.length) {
      html += `<div class="bp-sec">Tags</div>` + tagShown.map((t) => item(TAGP + t, '◆ ' + t, false)).join('');
      if (tagNames.length > tagShown.length) html += `<div class="hint bp-hint">${tagNames.length - tagShown.length} more tags: type to find them.</div>`;
    }
    $('#blist').innerHTML = html || '<div class="hint">No branch or tag matches.</div>';
    bpop.querySelector('[data-q="cur"]').disabled = !data.branch;
    const hid = data.hidden || [];
    const bh = $('#bhidden');
    bh.hidden = !hid.length;
    bh.innerHTML = hid.length ? 'Hidden (mergeline.hiddenBranches): ' + hid.map((g) => `<span class="bp-unhide" data-unhide="${esc(g)}" title="Show ${esc(g)} again">${esc(g)} ✕</span>`).join(' ') : '';
  }
  $('#bhidden').addEventListener('click', (e) => {
    const u = e.target.closest('[data-unhide]');
    if (u) vscode.postMessage({ type: 'hide', pattern: u.dataset.unhide, on: false });
  });
  function openBranches() {
    const r = $('#branchbtn').getBoundingClientRect();
    bpop.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 300)) + 'px';
    bpop.style.top = r.bottom + 4 + 'px';
    bpop.hidden = false;
    $('#branchbtn').setAttribute('aria-expanded', 'true');
    $('#bfind').value = '';
    fillBranchList();
    $('#bfind').focus();
  }
  function closeBranches() { bpop.hidden = true; $('#branchbtn').setAttribute('aria-expanded', 'false'); }
  $('#branchbtn').addEventListener('click', () => (bpop.hidden ? openBranches() : closeBranches()));
  $('#bfind').addEventListener('input', fillBranchList);
  $('#bfind').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeBranches(); $('#branchbtn').focus(); }
    if (e.key === 'Enter') { const first = $('#blist input'); if (first) { first.checked = !first.checked; first.dispatchEvent(new Event('change', { bubbles: true })); } }
  });
  $('#blist').addEventListener('change', (e) => {
    const v = e.target.value;
    selBranches = e.target.checked ? [...selBranches.filter((b) => b !== v), v] : selBranches.filter((b) => b !== v);
    branchLabel();
    sendFilter();
  });
  bpop.querySelector('.bp-quick').addEventListener('click', (e) => {
    const q = e.target.closest('[data-q]');
    if (!q) return;
    selBranches = q.dataset.q === 'cur' && data && data.branch ? [data.branch] : [];
    branchLabel();
    fillBranchList();
    sendFilter();
  });
  document.addEventListener('mousedown', (e) => { if (!bpop.hidden && !bpop.contains(e.target) && !e.target.closest('#branchbtn')) closeBranches(); });

  // ---------- author checklist (show only commits by some authors) ----------
  /** "Name <email>" ticked in the checklist; empty = everyone. */
  let selAuthors = [];
  /** [{ key, n }] from the extension, most commits first; null until it answers. */
  let authorList = null;
  const apop = $('#apop');
  const authorKey = (c) => `${c.author} <${c.email}>`;
  const authorName = (k) => k.replace(/ <[^<]*>$/, '');
  function authorLabel() {
    const b = $('#authbtn');
    b.textContent = !selAuthors.length ? 'All' : selAuthors.length === 1 ? authorName(selAuthors[0]) : `${selAuthors.length} authors`;
    const fileMode = !!(data && data.filter.path);
    b.title = fileMode ? 'The author filter is off in file history' : selAuthors.length ? 'Showing only commits by: ' + selAuthors.join(', ') : 'Show only commits by some authors';
    b.classList.toggle('on', selAuthors.length > 0 && !fileMode);
    b.disabled = fileMode;
  }
  function fillAuthorList() {
    const el = $('#alist');
    if (!authorList) { el.innerHTML = '<div class="hint">Reading authors…</div>'; return; }
    const q = $('#afind').value.trim().toLowerCase();
    const sel = new Set(selAuthors);
    // Ticked authors stay listed (at the top) so they can be unticked.
    const all = [...selAuthors.map((k) => authorList.find((a) => a.key === k) || { key: k, n: 0 }), ...authorList.filter((a) => !sel.has(a.key))];
    const shown = all.filter((a) => !q || a.key.toLowerCase().includes(q)).slice(0, 300);
    el.innerHTML = shown.length
      ? shown.map((a) => `<label class="bp-item" title="${esc(a.key)}${a.n ? ` — ${a.n} commit${a.n === 1 ? '' : 's'}` : ''}"><input type="checkbox" value="${esc(a.key)}"${sel.has(a.key) ? ' checked' : ''}> <span>${esc(authorName(a.key))} <span class="ap-mail">${esc(a.key.slice(authorName(a.key).length + 1))}</span></span><span class="ap-n">${a.n || ''}</span></label>`).join('')
      : '<div class="hint">No author matches.</div>';
  }
  function openAuthors() {
    const r = $('#authbtn').getBoundingClientRect();
    apop.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 340)) + 'px';
    apop.style.top = r.bottom + 4 + 'px';
    apop.hidden = false;
    $('#authbtn').setAttribute('aria-expanded', 'true');
    $('#afind').value = '';
    authorList = null;
    vscode.postMessage({ type: 'authors' });
    fillAuthorList();
    $('#afind').focus();
  }
  function closeAuthors() { apop.hidden = true; $('#authbtn').setAttribute('aria-expanded', 'false'); }
  function setAuthors(list) { selAuthors = list; authorLabel(); if (!apop.hidden) fillAuthorList(); sendFilter(); }
  $('#authbtn').addEventListener('click', () => (apop.hidden ? openAuthors() : closeAuthors()));
  $('#afind').addEventListener('input', fillAuthorList);
  $('#afind').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeAuthors(); $('#authbtn').focus(); }
    if (e.key === 'Enter') { const first = $('#alist input:not(:checked)') || $('#alist input'); if (first) { first.checked = !first.checked; first.dispatchEvent(new Event('change', { bubbles: true })); } }
  });
  $('#alist').addEventListener('change', (e) => {
    const v = e.target.value;
    setAuthors(e.target.checked ? [...selAuthors.filter((a) => a !== v), v] : selAuthors.filter((a) => a !== v));
  });
  apop.querySelector('.bp-quick').addEventListener('click', (e) => { if (e.target.closest('[data-q="all"]')) setAuthors([]); });
  document.addEventListener('mousedown', (e) => { if (!apop.hidden && !apop.contains(e.target) && !e.target.closest('#authbtn')) closeAuthors(); });

  // ---------- messages ----------
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    switch (m.type) {
      case 'settings': settings = m.settings; document.body.classList.toggle('side', settings.host === 'view'); $('#order').value = settings.commitOrder || 'date'; applyLayout(settings.layout); render(); fitToolbar(); break;
      case 'repos': repos = m.repos; currentRepo = m.repo; fillRepos(); break;
      case 'data': setData(m); break;
      case 'append': appendData(m); break;
      case 'details': showDetails(m); break;
      case 'contains': if (details && details.sha === m.sha && details.info) { details.contains = m; renderContains(); } break;
      case 'history': gotHistory(m); break;
      case 'message': openMessageEditor(m.sha, m.message); break;
      case 'note': openNoteEditor(m.sha, m.note); break;
      case 'authors': authorList = m.list || []; if (!apop.hidden) fillAuthorList(); break;
      case 'reveal': if (indexBySha.has(m.sha)) { pendingReveal = null; select(m.sha, true); } else pendingReveal = m.sha; break;
      // Test hook (only the extension can post here): click an element, optionally with Ctrl.
      case 'find': { const f = $('#find'); f.value = m.q; f.dispatchEvent(new Event('input')); if (m.enter) f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); break; }
      case 'click': { const el = document.querySelector(m.selector); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: !!m.ctrl })); break; }
      // Test hooks: right-click an element; click the open menu's item with this label.
      case 'context': { const el = document.querySelector(m.selector); if (el) { const b = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 2, clientY: b.top + 2 })); } break; }
      case 'menuPick': { const mi = [...menu.querySelectorAll('.mi')].find((x) => x.textContent === m.label); if (mi) mi.dispatchEvent(new MouseEvent('click', { bubbles: true })); break; }
      case 'empty': showMsg(m.message); break;
      case 'error': showMsg('Error: ' + m.message); break;
      case 'ping': try { vscode.postMessage({ type: 'pong', side: document.body.classList.contains('side'), narrow: document.body.classList.contains('narrow') ? 2 : document.body.classList.contains('narrow1') ? 1 : 0, toolbarH: toolbar.offsetHeight, moreShown: getComputedStyle($('#morebtn')).display !== 'none', patchShown: getComputedStyle($('#patchbtn')).display !== 'none', rowsClass: rowsEl.className, nodeColors: [...rowsEl.querySelectorAll('.row')].map((r) => { const n = r.querySelector('.c-graph svg > :last-child'); return r.dataset.i + ' ' + (n ? n.getAttribute('fill') || n.getAttribute('stroke') : '') + ' ' + (r.style.getPropertyValue('--rc') || '-') + ' ' + getComputedStyle(r).backgroundColor + ' ' + getComputedStyle(r.querySelector('.c-desc')).boxShadow; }), badgeColors: [...rowsEl.querySelectorAll('.badge.bc')].map((b) => b.dataset.ref + ' ' + b.style.getPropertyValue('--bc') + ' ' + getComputedStyle(b).borderTopColor), menuText: menu.hidden ? '' : [...menu.querySelectorAll('.mi')].map((x) => x.textContent + (x.classList.contains('disabled') ? ' (disabled)' : '')).join(' | '), authBtn: $('#authbtn').textContent, authorRows: [...$('#alist').querySelectorAll('input')].map((i) => (i.checked ? '[x] ' : '[ ] ') + i.value), noteMarks: [...rowsEl.querySelectorAll('.nt')].map((x) => x.closest('.row').dataset.i), hiddenText: $('#bhidden').hidden ? '' : $('#bhidden').textContent, firstParent: $('#firstparent').checked, compact: $('#compact').checked, foldHint: $('#foldhint').hidden ? '' : $('#foldhint').textContent, folds: [...rowsEl.querySelectorAll('.row.k-collapsed .fold')].map((x) => x.textContent), trk: [...rowsEl.querySelectorAll('.trk')].map((t) => t.parentElement.dataset.ref + ' ' + t.textContent), loaded: data ? data.commits.length : 0, reachN: data ? headReach().size : 0, editableN: data ? editableSet().size : 0, packedJson: data ? JSON.stringify([data.start, data.packed, data.width, data.hasMore]) : '', moreText: moreEl.textContent, branchBtn: $('#branchbtn').textContent, dimmed: rowsEl.querySelectorAll('.row.dim').length, avatars: rowsEl.querySelectorAll('.av').length, tagBlocks: [...detailsEl.querySelectorAll('.d-tag')].map((t) => t.textContent), containsText: (detailsEl.querySelector('.d-contains') || {}).textContent || '', rows: rowsEl.children.length, selected, details: !detailsEl.hidden, count: $('#count').textContent, pathbar: $('#pathbar').hidden ? '' : $('#pathbar').textContent, cols: colWidths(), detailsH: detailsEl.hidden ? 0 : detailsEl.offsetHeight, detailsText: detailsEl.hidden ? '' : detailsEl.textContent, links: [...detailsEl.querySelectorAll('[data-url]')].map((a) => a.dataset.url), wtBadges: [...rowsEl.querySelectorAll('.badge.wt')].map((b) => b.textContent), fileRows: [...detailsEl.querySelectorAll('.d-files li')].map((li) => (li.classList.contains('dir') ? 'D ' : 'F ') + li.querySelector('.fp').textContent), editMenu: selected && indexBySha.has(selected) ? editItems(data.commits[indexBySha.get(selected)], {}).filter(Boolean).map((it) => it[0]) : [], opbar: $('#opbar').hidden ? '' : $('#opbar').textContent, bisectbar: $('#bisectbar').hidden ? '' : $('#bisectbar').textContent, bisectBadges: [...rowsEl.querySelectorAll('.badge.bisect')].map((b) => b.className.split(' ').pop() + ' ' + b.closest('.row').dataset.i), commitMenu: selected && indexBySha.has(selected) ? commitItems(data.commits[indexBySha.get(selected)]).filter((it) => it && typeof it[0] === 'string').map((it) => it[0] + (it[2] === 'disabled' ? ' (disabled)' : '')) : [], review: detailsEl.hidden ? '' : (detailsEl.querySelector('.rvbar') || {}).textContent || '', reviewedRows: [...detailsEl.querySelectorAll('.file.reviewed .fp')].map((x) => x.textContent), dialog: $('#dlg').hidden ? null : { title: $('#dlg-t').textContent, subject: $('#dlg-s').value, body: $('#dlg-b').value } }); } catch (err) { vscode.postMessage({ type: 'pong', error: String(err && err.stack || err) }); } break;
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
    avatarBy = m.avatars || {};
    rowCache = new Map();
    loadingMore = false;
    $('#msg').hidden = true;
    refsBySha = new Map();
    for (const r of m.refs) {
      if (!refsBySha.has(r.sha)) refsBySha.set(r.sha, []);
      refsBySha.get(r.sha).push(r);
    }
    indexBySha = new Map(m.commits.map((c, i) => [c.sha, i]));
    bisectBy = new Map();
    if (m.bisect) {
      for (const s of m.bisect.good) bisectBy.set(s, 'good');
      for (const s of m.bisect.skip) bisectBy.set(s, 'skip');
      if (m.bisect.bad) bisectBy.set(m.bisect.bad, 'bad');
    }
    wtBySha = new Map();
    wtByBranch = new Map();
    for (const w of m.worktrees || []) {
      if (w.current || w.bare) continue;
      if (w.head) { if (!wtBySha.has(w.head)) wtBySha.set(w.head, []); wtBySha.get(w.head).push(w); }
      if (w.branch) wtByBranch.set(w.branch, w);
    }
    selBranches = m.filter.branches || [];
    selAuthors = m.filter.authors || [];
    noteSet = new Set(m.notes || []);
    authorLabel();
    branchLabel();
    if (!bpop.hidden) fillBranchList();
    $('#remotes').checked = m.filter.remotes;
    if (m.order) $('#order').value = m.order;
    $('#firstparent').checked = !!m.firstParent;
    $('#compact').checked = !!m.compactOn;
    const fh = $('#foldhint');
    fh.hidden = !m.compactOn;
    if (m.compact) {
      const opened = foldOpened(m);
      fh.innerHTML = `${m.compact.hidden.toLocaleString()} of ${m.compact.total.toLocaleString()} commits folded${opened ? ' · <a href="#" data-q="collapse" title="Fold the runs you opened again">fold all</a>' : ''}`;
      fh.title = 'Compact graph: straight runs of commits are folded into one row each';
    } else if (m.compactOn) {
      fh.textContent = 'not in file history or with an author filter';
      fh.title = 'Compact graph is off while the graph is already filtered';
    }
    $('#orderhint').hidden = !(m.order !== 'topo' && m.width > 20);
    renderOpBar(m.op);
    renderBisectBar(m.bisect);
    const pb = $('#pathbar');
    if (m.filter.path) {
      pb.innerHTML = `<span class="pb-icon" aria-hidden="true">⟲</span> History of <code title="${esc(m.filter.path)}">${esc(m.filter.path)}</code>${m.names && m.names.length > 1 ? `<span class="pb-n" title="${esc(m.names.slice(1).join('\n'))}">also as ${m.names.slice(1, 3).map((n) => `<code>${esc(n)}</code>`).join(', ')}${m.names.length > 3 ? ` +${m.names.length - 3}` : ''}</span>` : ''}<span class="pb-n pb-count">${countLabel(m)}</span><button id="clearpath" title="Show all commits again">Show all commits</button>`;
      pb.hidden = false;
    } else pb.hidden = true;
    if (repoChanged) { selected = null; compareSha = null; closeDetails(); scroller.scrollTop = 0; }
    else if (selected && !indexBySha.has(selected)) closeDetails();
    sizeList();
    if (!m.commits.length) showMsg(m.filter.path ? 'No commits touch this file on the shown branches. It may be new or untracked.' : 'This repository has no commits yet.');
    runFind(false);
    if (pendingReveal && indexBySha.has(pendingReveal)) { const r = pendingReveal; pendingReveal = null; select(r, true); }
    render();
  }

  // Whether any run was opened: the extension sends that as `expanded` in the compact counts.
  function foldOpened(m) { return !!(m.compact && m.compact.expanded); }
  function countLabel(m) { return `${m.commits.length}${m.hasMore ? '+' : ''} commit${m.commits.length === 1 ? '' : 's'}`; }

  function sizeList() {
    const m = data;
    setGraphWidth();
    spacer.style.height = m.commits.length * ROW + 44 + 'px';
    moreEl.style.top = m.commits.length * ROW + 'px';
    moreEl.innerHTML = m.hasMore ? `<button id="loadmore">Load more commits</button>` : m.commits.length ? `<span class="end">${m.compact ? `${m.commits.length} rows, ${m.compact.total.toLocaleString()} commits (${m.compact.hidden.toLocaleString()} folded)` : `${m.commits.length} commits`}</span>` : '';
    const lm = $('#loadmore');
    if (lm) lm.addEventListener('click', loadMore);
  }

  // Load more: the extension sends only the new rows; they continue the packed lanes of the last row.
  function appendData(m) {
    loadingMore = false;
    if (!data) return;
    const n0 = data.commits.length;
    for (let i = 0; i < m.commits.length; i++) {
      data.commits.push(m.commits[i]);
      data.packed.push(m.packed[i]);
      indexBySha.set(m.commits[i].sha, n0 + i);
    }
    data.width = m.width;
    data.hasMore = m.hasMore;
    if (m.avatars) Object.assign(avatarBy, m.avatars);
    for (const s of m.notes || []) noteSet.add(s);
    reachFor = null; // caches keyed on `data`, which was extended in place
    editableFor = null;
    $('#orderhint').hidden = !(data.order !== 'topo' && data.width > 20);
    const pc = $('#pathbar .pb-count');
    if (pc) pc.textContent = countLabel(data);
    sizeList();
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

  function setGraphWidth() {
    document.documentElement.style.setProperty('--graph-w', (lay.w.graph || graphWidth()) + 'px');
  }

  // ---------- columns & layout ----------
  function applyLayout(l) {
    lay = { w: {}, hidden: [], details: null, ...(l || {}) };
    const st = document.documentElement.style;
    for (const k of ['date', 'author', 'hash']) st.setProperty('--w-' + k, (lay.w[k] || DEFAULT_W[k]) + 'px');
    for (const k of Object.keys(COLS)) document.body.classList.toggle('hide-' + k, lay.hidden.includes(k));
    if (data) setGraphWidth();
    detailsEl.style.flexBasis = lay.details ? lay.details + 'px' : '';
  }
  function saveLayout() { vscode.postMessage({ type: 'layout', layout: lay }); }
  function colWidths() {
    const o = {};
    for (const k of Object.keys(COLS)) { const el = $('#header .c-' + k); o[k] = el && getComputedStyle(el).display !== 'none' ? el.offsetWidth : 0; }
    return o;
  }
  $('#header').addEventListener('mousedown', (e) => {
    const rz = e.target.closest('.rz');
    if (!rz || e.button !== 0) return;
    e.preventDefault();
    const col = rz.dataset.col;
    const cell = rz.parentElement;
    const x0 = e.clientX, w0 = cell.offsetWidth;
    document.body.classList.add('resizing');
    const move = (ev) => {
      const w = Math.max(col === 'graph' ? 24 : 40, Math.min(900, Math.round(w0 + ev.clientX - x0)));
      lay.w = { ...lay.w, [col]: w };
      if (col === 'graph') setGraphWidth(); else document.documentElement.style.setProperty('--w-' + col, w + 'px');
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing');
      saveLayout();
      render();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  $('#header').addEventListener('dblclick', (e) => {
    const rz = e.target.closest('.rz');
    if (!rz) return;
    const w = { ...lay.w };
    delete w[rz.dataset.col];
    applyLayout({ ...lay, w });
    saveLayout();
    render();
  });
  $('#header').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const items = Object.entries(COLS).map(([k, label]) => [(lay.hidden.includes(k) ? '\u2003' : '✓ ') + label, () => {
      const hidden = lay.hidden.includes(k) ? lay.hidden.filter((h) => h !== k) : [...lay.hidden, k];
      applyLayout({ ...lay, hidden });
      saveLayout();
      render();
    }]);
    items.push(null, ['Reset column widths', () => { applyLayout({ ...lay, w: {} }); saveLayout(); render(); }]);
    const rcNow = settings.rowColors || 'none';
    items.push(null, ...[['none', 'Row colours: none'], ['stripe', 'Row colours: stripe by branch'], ['tint', 'Row colours: tint by branch']].map(([v, label]) => [(rcNow === v ? '✓ ' : '\u2003') + label, () => vscode.postMessage({ type: 'rowColors', value: v })]));
    showMenu(items, e.clientX, e.clientY);
  });
  const split = $('#split');
  split.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const y0 = e.clientY, h0 = detailsEl.offsetHeight;
    document.body.classList.add('resizing-v');
    const move = (ev) => {
      const max = Math.max(140, window.innerHeight - 120);
      lay.details = Math.max(80, Math.min(max, Math.round(h0 - (ev.clientY - y0))));
      detailsEl.style.flexBasis = lay.details + 'px';
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing-v');
      saveLayout();
      render();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  split.addEventListener('dblclick', () => { lay.details = null; detailsEl.style.flexBasis = ''; saveLayout(); render(); });

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
  // 0..9: the theme palette; 10+: custom colours from mergeline.branchColors (validated CSS from the extension).
  const color = (i) => (i >= 10 && data && data.colors && data.colors[i - 10]) || `var(--lane-${i % 10})`;
  /** style attribute for a branch badge whose branch has a colour in mergeline.branchColors. */
  const badgeColor = (name) => { const c = data.refColors && data.refColors[name]; return c ? ` style="--bc:${esc(c)}"` : ''; };

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
    if (c.kind === 'collapsed') node = `<g class="n-fold" fill="${col}"><circle cx="${cx}" cy="${cy - 5}" r="1.6"/><circle cx="${cx}" cy="${cy}" r="1.6"/><circle cx="${cx}" cy="${cy + 5}" r="1.6"/></g>`;
    else if (c.kind === 'stash') node = `<rect x="${cx - 4}" y="${cy - 4}" width="8" height="8" rx="1.5" class="n-stash" stroke="${col}"/>`;
    else if (c.kind === 'uncommitted') node = `<circle cx="${cx}" cy="${cy}" r="4" class="n-unc" stroke="${col}"/>`;
    else if (clipped) node = `<circle cx="${cx}" cy="${cy}" r="4" class="n-unc" stroke="${col}"><title>Lane ${row.col + 1} (off screen)</title></circle>`;
    else if (c.sha === data.head) node = `<circle cx="${cx}" cy="${cy}" r="5.5" class="n-head" stroke="${col}"/><circle cx="${cx}" cy="${cy}" r="2.5" fill="${col}"/>`;
    else node = `<circle cx="${cx}" cy="${cy}" r="4" fill="${col}" class="n"/>`;
    return `<svg width="${graphWidth()}" height="${ROW}" aria-hidden="true">${p}${node}</svg>`;
  }

  // A folded run in the compact graph: "⋯ 12 commits" and the dates it spans.
  function foldHtml(c) {
    const f = c.fold || { n: 0, oldest: c.date };
    const a = f.oldest ? fmtDate(f.oldest) : '', b = fmtDate(c.date);
    const span = a && a !== b ? `${a} – ${b}` : b;
    return `<span class="fold" title="Show these ${f.n} commits">⋯ ${esc(c.subject)}</span><span class="fold-span">${esc(span)}</span>`;
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
      out.push(`<span class="badge branch${cur ? ' current' : ''}${badgeColor(r.name) ? ' bc' : ''}"${badgeColor(r.name)} data-ref="${esc(r.name)}" data-type="head" title="${cur ? 'Current branch ' : 'Branch '}${esc(r.name)}${wtByBranch.has(r.name) ? ' (checked out in worktree ' + esc(wtByBranch.get(r.name).path) + ')' : ''}. Drag onto another branch or commit to merge, rebase or move it.">${cur ? '● ' : ''}${esc(r.name)}${trackHtml(r)}${twins.map((t) => `<span class="twin" data-ref="${esc(t.name)}" data-type="remote" data-remote="${esc(t.remote)}" title="${esc(t.name)}">${esc(t.remote)}</span>`).join('')}</span>`);
    }
    for (const r of remotes) if (!used.has(r.name)) out.push(`<span class="badge remote${badgeColor(r.name) ? ' bc' : ''}"${badgeColor(r.name)} data-ref="${esc(r.name)}" data-type="remote" data-remote="${esc(r.remote)}" title="Remote branch ${esc(r.name)}. Drag onto a branch to merge it there.">${esc(r.name)}</span>`);
    for (const w of wtBySha.get(c.sha) || []) out.push(`<span class="badge wt${w.prunable ? ' gone' : ''}" data-wt="${esc(w.path)}" title="Worktree at ${esc(w.path)}${w.branch ? ' on ' + esc(w.branch) : ' (detached)'}${w.prunable ? ': its folder is missing' : ''}${w.locked ? ', locked' : ''}">${esc(w.path.split(/[\\/]/).filter(Boolean).pop() || w.path)}</span>`);
    const bm = bisectBy.get(c.sha);
    if (bm) { const t = data.bisect.terms; const word = bm === 'bad' ? t[0] : bm === 'good' ? t[1] : 'skip'; out.push(`<span class="badge bisect ${bm}" title="git bisect: marked ${esc(word)}">${esc(word)}</span>`); }
    for (const r of refs.filter((r) => r.type === 'tag')) out.push(`<span class="badge tag" data-ref="${esc(r.name)}" data-type="tag" title="Tag ${esc(r.name)}">${esc(r.name)}</span>`);
    return out.join('');
  }

  /** Ahead/behind marks on a local branch badge: ↑ commits to push, ↓ commits to pull (from the last fetch). */
  function trackHtml(r) {
    if (!r.upstream) return '';
    if (r.gone) return `<span class="trk gone" title="Its upstream ${esc(r.upstream)} was deleted on the remote">✕</span>`;
    if (!r.ahead && !r.behind) return '';
    const t = [r.ahead ? `${r.ahead} commit${r.ahead === 1 ? '' : 's'} to push` : '', r.behind ? `${r.behind} to pull` : ''].filter(Boolean).join(', ');
    return `<span class="trk" title="Compared with ${esc(r.upstream)} as of the last fetch: ${t}">${r.ahead ? '↑' + r.ahead : ''}${r.behind ? '↓' + r.behind : ''}</span>`;
  }

  const SIG = { good: ['ok', 'Good signature'], untrusted: ['ok', 'Good signature, key not trusted'], expired: ['warn', 'Good signature, but it has expired'], expiredKey: ['warn', 'Good signature from an expired key'], revoked: ['bad', 'Signed with a revoked key'], bad: ['bad', 'BAD signature'], unchecked: ['warn', 'Signed, but it could not be checked (missing key or gpg/ssh signer setup)'] };
  function signatureHtml(sg) {
    if (!sg) return '';
    const [cls, text] = SIG[sg.status] || SIG.unchecked;
    return `<span class="sig ${cls}" title="Verified by git with your own keyring (git log --show-signature)">${cls === 'ok' ? '✓' : cls === 'bad' ? '✕' : '?'} ${esc(text)}${sg.signer ? ' from ' + esc(sg.signer) : ''}${sg.key ? ` <code>${esc(sg.key)}</code>` : ''}</span>`;
  }

  /** Initials in a coloured circle, with the author's image on top when avatars are on and it loads. */
  function avatarHtml(name, email, url) {
    const words = String(name || email || '?').replace(/[<>]/g, '').trim().split(/\s+/).filter(Boolean);
    const ini = ((words[0] || '?')[0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
    let h = 0;
    for (const ch of String(email || name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const img = url && !avatarFailed.has(url) ? `<img class="av-img" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
    return `<span class="av" style="--av:var(--lane-${h % 8})" aria-hidden="true">${esc(ini)}${img}</span>`;
  }
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.classList.contains('av-img')) { avatarFailed.add(t.getAttribute('src')); t.remove(); }
  }, true);

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
    const dim = settings.dimOtherCommits && data.head ? headReach() : null;
    // Setting mergeline.rowColors: colour each row by its node's line (Git Graph issue #254).
    const rc = settings.rowColors === 'stripe' || settings.rowColors === 'tint' ? settings.rowColors : '';
    rowsEl.classList.toggle('rc-stripe', rc === 'stripe');
    rowsEl.classList.toggle('rc-tint', rc === 'tint');
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
      if (i === dropIndex) cls.push('drop');
      if (dim && c.kind === 'commit' && !dim.has(c.sha)) cls.push('dim');
      h += `<div class="${cls.join(' ')}" style="top:${i * ROW}px${rc ? ';--rc:' + color(row.color) : ''}" data-i="${i}">
        <div class="c-graph">${graphSvg(c, row)}</div>
        <div class="c-desc">${c.kind === 'collapsed' ? foldHtml(c) : refBadges(c)}${noteSet.has(c.sha) ? '<span class="nt" title="This commit has a git note (shown in its details)">note</span>' : ''}${c.kind === 'collapsed' ? '' : `<span class="subj" title="${esc(c.subject)}">${esc(c.subject)}</span>`}</div>
        <div class="c-date" title="${c.kind === 'uncommitted' ? '' : esc(new Date(c.date * 1000).toString())}">${c.kind === 'uncommitted' ? '' : esc(fmtDate(c.date))}</div>
        <div class="c-author" title="${esc(c.email)}">${settings.showAvatars && c.kind !== 'uncommitted' ? avatarHtml(c.author, c.email, avatarBy[c.email]) : ''}${esc(c.author)}</div>
        <div class="c-hash">${c.kind === 'uncommitted' || c.kind === 'collapsed' ? '' : esc(short(c.sha))}</div></div>`;
    }
    rowsEl.innerHTML = h;
  }

  // ---------- selection & details ----------
  rowsEl.addEventListener('click', (e) => {
    if (justDropped) return;
    const r = e.target.closest('.row');
    if (!r) return;
    const c = data.commits[+r.dataset.i];
    if (c.kind === 'collapsed') { expandFold(c); return; }
    // (A selected folded row has nothing to compare: a plain click then.)
    if ((e.ctrlKey || e.metaKey) && selected && selected !== c.sha && !selected.startsWith('~')) {
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
    // A folded row has no details: it is selected (Enter opens it) and the pane closes.
    const fc = indexBySha.has(sha) ? data.commits[indexBySha.get(sha)] : null;
    if (fc && fc.kind === 'collapsed') { detailsEl.hidden = true; split.hidden = true; details = null; }
    else vscode.postMessage({ type: 'details', sha });
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
    split.hidden = true;
    details = null;
    selected = null;
    compareSha = null;
    render();
  }

  // URLs, #123 issue references (when the remote is on a known forge), full commit hashes and
  // matches of the user's mergeline.issueLinks rules (e.g. Jira keys) in a commit message become
  // links. Where two overlap, the one that starts first wins. Everything else is escaped.
  const LINK_RE = /\bhttps?:\/\/[^\s<>"'`]*[^\s<>"'`.,;:!?)\]}]|(?<![\w/&#])#(\d{1,7})\b|\b([0-9a-f]{40})\b/g;
  let ruleCache = null, ruleKey = '';
  function issueRules() {
    const list = settings.issueLinks || [];
    const key = JSON.stringify(list);
    if (key !== ruleKey) {
      ruleKey = key;
      ruleCache = [];
      for (const r of list) { try { ruleCache.push({ re: new RegExp(r.pattern, 'g'), url: r.url }); } catch { /* checked by the extension */ } }
    }
    return ruleCache;
  }
  function issueUrl(tpl, m) { return tpl.replace(/\$(\d)/g, (_, d) => encodeURIComponent(m[+d] == null ? '' : m[+d])); }
  function linkify(text) {
    const spans = [];
    let m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(text))) {
      let a = null;
      if (m[1] !== undefined) { if (data.web) a = `<span class="link" data-url="${esc(data.web.issue + m[1])}" title="${esc(data.web.issue + m[1])}">`; }
      else if (m[2] !== undefined) { if (indexBySha.has(m[2])) a = `<span class="link" data-goto="${m[2]}" title="Go to commit">`; }
      else a = `<span class="link" data-url="${esc(m[0])}" title="${esc(m[0])}">`;
      if (a) spans.push([m.index, m.index + m[0].length, a]);
    }
    for (const r of issueRules()) {
      r.re.lastIndex = 0;
      let guard = 0;
      while ((m = r.re.exec(text)) && guard++ < 1000) {
        if (!m[0]) { r.re.lastIndex++; continue; }
        const u = issueUrl(r.url, m);
        spans.push([m.index, m.index + m[0].length, `<span class="link issue" data-url="${esc(u)}" title="${esc(u)}">`]);
      }
    }
    spans.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
    let out = '', last = 0;
    for (const [a, b, open] of spans) {
      if (a < last) continue;
      out += esc(text.slice(last, a)) + open + esc(text.slice(a, b)) + '</span>';
      last = b;
    }
    return out + esc(text.slice(last));
  }

  /** The tags on a commit: annotated ones with tagger, date and message; lightweight ones by name. */
  function tagsHtml(tags) {
    if (!tags || !tags.length) return '';
    return `<div class="d-tags">${tags.map((t) => `<div class="d-tag" data-tag="${esc(t.name)}"><span class="badge tag">${esc(t.name)}</span>${t.annotated
      ? `<span class="tmeta">Annotated tag by ${esc(t.tagger || 'unknown')}${t.date ? ', ' + esc(new Date(t.date * 1000).toLocaleString()) : ''}</span>${t.message ? `<pre>${linkify(t.message)}</pre>` : ''}`
      : '<span class="tmeta">Lightweight tag (no message)</span>'}</div>`).join('')}</div>`;
  }

  /** "Contained in": the branches and tags whose history has this commit (filled in by a later 'contains' message). */
  function containsHtml(m) {
    const c = m.contains;
    if (!c) return '<span class="dc-h">Contained in</span> <span class="hint">looking…</span>';
    if (c.error) return `<span class="dc-h">Contained in</span> <span class="hint">${c.error === 'timeout' ? 'git took too long to answer (over 8 s); skipped' : esc(c.error)}</span>`;
    if (!c.heads.length && !c.remotes.length && !c.tags.length) return '<span class="dc-h">Contained in</span> <span class="hint">no branch or tag (reachable only from a stash or the reflog)</span>';
    const MAX = 6;
    const names = (list, kind, key) => {
      const all = m.containsAll && m.containsAll[key];
      const shown = all ? list : list.slice(0, MAX);
      return shown.map((r) => `<span class="badge ${kind} link" data-goto="${esc(r.sha)}" title="${esc(r.name)}${indexBySha.has(r.sha) ? ': go to its tip' : ' (tip not loaded)'}">${esc(r.name)}</span>`).join(' ')
        + (list.length > shown.length ? ` <span class="link" data-cmore="${key}">+${list.length - shown.length} more</span>` : '');
    };
    // The current branch first: it is the one people check.
    const heads = [...c.heads].sort((a, b) => (b.name === data.branch) - (a.name === data.branch));
    const parts = [];
    if (heads.length) parts.push(`<span class="dc-row"><span class="dc-h">Branches</span> ${names(heads, 'branch', 'heads')}</span>`);
    if (c.remotes.length) parts.push(`<span class="dc-row"><span class="dc-h">Remote</span> ${names(c.remotes, 'remote', 'remotes')}</span>`);
    if (c.tags.length) parts.push(`<span class="dc-row"><span class="dc-h">First tag</span> <span class="badge tag link" data-goto="${esc(c.tags[0].sha)}" title="The oldest tag whose history has this commit: the first release with it">${esc(c.tags[0].name)}</span>${c.tags.length > 1 ? ` <span class="hint">in ${c.tags.length} tags:</span> ${names(c.tags, 'tag', 'tags')}` : ''}</span>`);
    else parts.push('<span class="dc-row"><span class="dc-h">Tags</span> <span class="hint">not in any tag yet</span></span>');
    return parts.join('');
  }
  function renderContains() {
    const el = detailsEl.querySelector('.d-contains');
    if (el && details) el.innerHTML = containsHtml(details);
  }

  const STATUS = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed', U: 'Untracked' };

  function showDetails(m) {
    if (m.sha !== selected) return;
    details = m;
    const c = data.commits[indexBySha.get(m.sha)] || {};
    let head = '';
    if (m.compare && m.base) {
      const la = cmpInfo && cmpInfo.a ? cmpInfo.a : short(m.sha), lb = cmpInfo && cmpInfo.b ? cmpInfo.b : short(m.compare);
      head = `<div class="d-title">Changes on ${esc(la)} since it split from ${esc(lb)}</div>
        <div class="d-meta">${m.mergeBase ? `<span>Merge base <code class="link" data-goto="${esc(m.mergeBase)}">${esc(short(m.mergeBase))}</code></span>` : ''}<span>What merging ${esc(la)} into ${esc(lb)} would bring in (git diff ${esc(lb)}...${esc(la)})</span><span><span class="link" data-patch="branch" title="git format-patch ${esc(lb)}..${esc(la)}: one patch per commit, merges skipped">Save these commits as patches…</span></span></div>`;
    } else if (m.compare) {
      const rng = squashRange();
      head = `<div class="d-title">Comparing ${esc(m.from === UNC ? 'working tree' : short(m.from))} → ${esc(m.to ? short(m.to) : 'working tree')}</div><div class="d-meta">${rng ? `<span><span class="link" data-squash="1" title="Squash ${short(rng.from)}…${short(rng.to)} on the current branch into one commit">Squash these ${rng.n} commits into one…</span></span>` : ''}${m.from && m.from !== UNC ? `<span><span class="link" data-patch="diff" title="git diff --binary: the changes shown below as one patch">Save this diff as a patch…</span> · <span class="link" data-patch="diff-copy" title="Copy the changes shown below as one patch">Copy</span></span>` : ''}</div>`;
    } else if (m.info) {
      const i = m.info;
      const body = i.message.split('\n').slice(1).join('\n').trim();
      head = `<div class="d-title">${linkify(i.message.split('\n')[0])}</div>
        <div class="d-meta"><span>Commit <code class="link" data-copy="${esc(i.sha)}" title="Copy">${esc(i.sha)}</code></span>
        <span>Parents ${i.parents.map((p) => `<code class="link" data-goto="${esc(p)}">${esc(short(p))}</code>`).join(' ') || 'none'}</span>
        <span>Author ${settings.showAvatars ? avatarHtml(i.author, i.email, m.avatar) : ''}<b>${esc(i.author)}</b> &lt;${esc(i.email)}&gt;, ${esc(new Date(i.authorDate * 1000).toLocaleString())}</span>
        ${i.committer !== i.author || i.commitDate !== i.authorDate ? `<span>Committer ${esc(i.committer)}, ${esc(new Date(i.commitDate * 1000).toLocaleString())}</span>` : ''}
        ${signatureHtml(m.signature)}
        ${data.web ? `<span><span class="link" data-url="${esc(data.web.commit + i.sha)}" title="${esc(data.web.commit + i.sha)}">Open on ${esc(data.web.name)}</span></span>` : ''}</div>
        <div class="d-contains">${containsHtml(m)}</div>
        ${tagsHtml(m.tags)}
        ${body ? `<pre class="d-body">${linkify(body)}</pre>` : ''}
        ${m.note ? `<div class="d-note"><span class="d-note-h">Note</span> <span class="link" data-note="${esc(i.sha)}" title="Edit this note (git notes)">Edit</span><pre>${linkify(m.note)}</pre></div>` : ''}`;
    } else if (c.kind === 'uncommitted') head = `<div class="d-title">Uncommitted changes</div>`;
    if (m.error) head += `<div class="d-err">${esc(m.error)}</div>`;
    const add = m.files.reduce((n, f) => n + (f.additions || 0), 0);
    const del = m.files.reduce((n, f) => n + (f.deletions || 0), 0);
    const focus = data.filter && data.filter.path ? (data.names && data.names.length ? data.names : [data.filter.path]) : null;
    filesFocus = focus;
    const nested = m.files.some((f) => f.path.includes('/'));
    detailsEl.innerHTML = `<button class="d-close" title="Close (Esc)" aria-label="Close details">×</button>${head}
      <div class="d-files-h">${m.files.length} file${m.files.length === 1 ? '' : 's'} changed <i class="plus">+${add}</i> <i class="minus">−${del}</i>${m.compare ? '' : ' <span class="hint">Ctrl/Cmd-click another commit to compare</span>'}<span class="rvbar"></span>${nested ? `<span class="fv" role="group" aria-label="File view"><button data-fv="tree" title="Show files in folders">Tree</button><button data-fv="list" title="Show full paths">List</button></span>` : ''}</div>
      <ul class="d-files"></ul>`;
    // Review mode: started from the commit menu, or already in progress for this diff.
    if (m.reviewKey && pendingReview === m.sha && !m.reviewed) { m.reviewed = []; saveReview(); }
    if (pendingReview === m.sha) pendingReview = null;
    renderFiles();
    detailsEl.hidden = false;
    split.hidden = false;
    scrollTo(indexBySha.get(m.sha));
  }

  // ---------- review: mark the files of a commit or comparison as reviewed ----------
  let pendingReview = null; // sha whose details should open in review mode
  const reviewing = () => !!(details && details.reviewKey && details.reviewed);
  function saveReview() { if (details && details.reviewKey) vscode.postMessage({ type: 'review', key: details.reviewKey, files: details.reviewed }); }
  /** File indexes in the order the tree (or list) shows them, folders before files, ignoring collapsed folders. */
  function fileOrder() {
    const files = details.files;
    const tree = (lay.files || 'tree') === 'tree';
    const cmp = (a, b) => {
      if (!tree) return 0;
      const pa = files[a].path.split('/'), pb = files[b].path.split('/');
      for (let i = 0; ; i++) {
        const da = i < pa.length - 1, db = i < pb.length - 1; // is part i a folder?
        if (da !== db) return da ? -1 : 1;
        const c = pa[i].localeCompare(pb[i]);
        if (c || !da) return c;
      }
    };
    return files.map((_, k) => k).sort(cmp);
  }
  function renderReviewBar() {
    const bar = detailsEl.querySelector('.rvbar');
    if (!bar || !details) return;
    if (!details.reviewKey || !details.files.length) { bar.innerHTML = ''; return; }
    if (!reviewing()) { bar.innerHTML = `<button data-rv="start" class="secondary" title="Tick off files as you review them; kept for this diff until you end the review">Review</button>`; return; }
    const done = details.files.filter((f) => details.reviewed.includes(f.path)).length;
    const all = details.files.length;
    bar.innerHTML = `<span class="rvcount${done === all ? ' done' : ''}">${done} of ${all} reviewed</span>`
      + `<button data-rv="next" class="secondary" title="Open the next unreviewed file's diff and mark it reviewed"${done === all ? ' disabled' : ''}>Next unreviewed</button>`
      + `<button data-rv="end" class="secondary" title="Forget which files were reviewed">End review</button>`;
  }
  function markReviewed(path, on) {
    if (!reviewing()) return;
    const has = details.reviewed.includes(path);
    if (on === has) return;
    details.reviewed = on ? [...details.reviewed, path] : details.reviewed.filter((p) => p !== path);
    saveReview();
    renderFiles();
  }
  function openDiff(file) {
    vscode.postMessage({ type: 'openFile', from: details.from === UNC ? 'HEAD' : details.from, to: details.to, path: file.path, oldPath: file.oldPath, status: file.status });
    markReviewed(file.path, true);
  }
  function reviewCmd(what) {
    if (!details || !details.reviewKey) return;
    if (what === 'start') { details.reviewed = []; saveReview(); }
    else if (what === 'end') { details.reviewed = null; vscode.postMessage({ type: 'review', key: details.reviewKey, files: null }); }
    else if (what === 'next' && reviewing()) {
      const k = fileOrder().find((i) => !details.reviewed.includes(details.files[i].path));
      if (k === undefined) return;
      const f = details.files[k];
      // Unfold the folders around it so the row is visible.
      for (const dir of [...collapsedDirs]) if (f.path.startsWith(dir + '/')) collapsedDirs.delete(dir);
      openDiff(f);
      const li = detailsEl.querySelector(`.file[data-k="${k}"]`);
      if (li) li.scrollIntoView({ block: 'nearest' });
      return;
    }
    renderFiles();
  }

  // Changed files as a flat list of paths, or as a folder tree (lay.files, kept across sessions).
  let filesFocus = null;
  const collapsedDirs = new Set();
  function fileRow(f, k, name, pad) {
    const focus = filesFocus && (filesFocus.includes(f.path) || filesFocus.includes(f.oldPath));
    const rv = reviewing(), done = rv && details.reviewed.includes(f.path);
    const tip = `${STATUS[f.status] || f.status}: ${f.oldPath ? f.oldPath + ' → ' : ''}${f.path}. Click to open the diff${rv ? ' (marks it reviewed)' : ''}`;
    return `<li class="file${focus ? ' focus' : ''}${done ? ' reviewed' : ''}" data-k="${k}" title="${esc(tip)}"${pad ? ` style="padding-left:${pad}px"` : ''}>
        ${rv ? `<span class="rv" role="checkbox" aria-checked="${done}" aria-label="Reviewed" title="${done ? 'Reviewed. Click to unmark' : 'Mark as reviewed'}">${done ? '✓' : ''}</span>` : ''}
        <span class="st st-${esc(f.status)}">${esc(f.status)}</span>
        <span class="fp">${name}</span>
        <span class="ad">${f.additions == null ? (f.status === 'U' ? '' : 'bin') : `<i class="plus">+${f.additions}</i> <i class="minus">−${f.deletions}</i>`}</span></li>`;
  }
  function renderFiles() {
    const ul = detailsEl.querySelector('.d-files');
    if (!ul || !details) return;
    const files = details.files;
    renderReviewBar();
    const tree = (lay.files || 'tree') === 'tree' && files.some((f) => f.path.includes('/'));
    detailsEl.querySelectorAll('[data-fv]').forEach((b) => b.classList.toggle('on', b.dataset.fv === (tree ? 'tree' : 'list')));
    if (!tree) {
      ul.innerHTML = files.map((f, k) => fileRow(f, k, (f.oldPath ? esc(f.oldPath) + ' → ' : '') + esc(f.path))).join('');
      return;
    }
    const root = { dirs: new Map(), files: [] };
    files.forEach((f, k) => {
      const parts = f.path.split('/');
      let n = root;
      for (const p of parts.slice(0, -1)) {
        if (!n.dirs.has(p)) n.dirs.set(p, { dirs: new Map(), files: [] });
        n = n.dirs.get(p);
      }
      n.files.push(k);
    });
    const count = (n) => n.files.length + [...n.dirs.values()].reduce((a, d) => a + count(d), 0);
    const out = [];
    const walk = (n, prefix, depth) => {
      for (const name of [...n.dirs.keys()].sort((a, b) => a.localeCompare(b))) {
        let d = n.dirs.get(name), label = name;
        // A folder that only holds one folder is shown as one row: src/core/
        while (d.files.length === 0 && d.dirs.size === 1) { const [k2, d2] = [...d.dirs.entries()][0]; label += '/' + k2; d = d2; }
        const full = prefix + label;
        const shut = collapsedDirs.has(full);
        out.push(`<li class="dir" data-dir="${esc(full)}" style="padding-left:${depth * 14 + 4}px" title="${esc(full)}/"><span class="tw" aria-hidden="true">${shut ? '▸' : '▾'}</span><span class="fp">${esc(label)}/</span><span class="ad">${count(d)}</span></li>`);
        if (!shut) walk(d, full + '/', depth + 1);
      }
      for (const k of n.files.sort((a, b) => files[a].path.localeCompare(files[b].path))) {
        const f = files[k];
        const base = f.path.slice(f.path.lastIndexOf('/') + 1);
        const old = f.oldPath ? (f.oldPath.slice(0, f.oldPath.lastIndexOf('/') + 1) === prefix ? f.oldPath.slice(prefix.length) : f.oldPath) : '';
        out.push(fileRow(f, k, (old ? `<span class="old">${esc(old)} → </span>` : '') + esc(base), depth * 14 + 4));
      }
    };
    walk(root, '', 0);
    ul.innerHTML = out.join('');
  }

  detailsEl.addEventListener('click', (e) => {
    if (e.target.closest('.d-close')) return closeDetails();
    const fv = e.target.closest('[data-fv]');
    if (fv) { lay.files = fv.dataset.fv; saveLayout(); renderFiles(); return; }
    const dir = e.target.closest('.dir');
    if (dir) { const p = dir.dataset.dir; if (collapsedDirs.has(p)) collapsedDirs.delete(p); else collapsedDirs.add(p); renderFiles(); return; }
    const nb = e.target.closest('[data-note]');
    if (nb) { vscode.postMessage({ type: 'getNote', sha: nb.dataset.note }); return; }
    const cm = e.target.closest('[data-cmore]');
    if (cm && details) { details.containsAll = { ...(details.containsAll || {}), [cm.dataset.cmore]: true }; renderContains(); return; }
    const g = e.target.closest('[data-goto]');
    if (g) { if (indexBySha.has(g.dataset.goto)) select(g.dataset.goto, true); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) return action({ action: 'copyHash', sha: cp.dataset.copy });
    const pt = e.target.closest('[data-patch]');
    if (pt && details) {
      const k = pt.dataset.patch;
      if (k === 'branch') return action({ action: 'savePatch', patch: 'branch', ref: cmpInfo && cmpInfo.a ? cmpInfo.a : undefined, sha: details.sha, target: details.compare });
      return action({ action: 'savePatch', patch: 'diff', sha: details.from, target: details.to || null, copy: k === 'diff-copy' });
    }
    if (e.target.closest('[data-squash]')) { const rng = squashRange(); if (rng) action({ action: 'squashRange', sha: rng.from, target: rng.to }); return; }
    const u = e.target.closest('[data-url]');
    if (u) return vscode.postMessage({ type: 'openUrl', url: u.dataset.url });
    const rb = e.target.closest('[data-rv]');
    if (rb) return reviewCmd(rb.dataset.rv);
    const f = e.target.closest('.file');
    if (f && details) {
      const file = details.files[+f.dataset.k];
      if (e.target.closest('.rv')) return markReviewed(file.path, !details.reviewed.includes(file.path));
      openDiff(file);
    }
  });

  detailsEl.addEventListener('contextmenu', (e) => {
    const f = e.target.closest('.file');
    if (!f || !details) return;
    e.preventDefault();
    const file = details.files[+f.dataset.k];
    const at = details.to; // null = working tree
    const fa = (act, p = file.path, ref = at) => () => vscode.postMessage({ type: 'fileAction', act, ref, path: p });
    const gone = file.status === 'D';
    const items = [
      ['Open changes', () => openDiff(file)],
      ...(reviewing() ? [[details.reviewed.includes(file.path) ? 'Mark as not reviewed' : 'Mark as reviewed', () => markReviewed(file.path, !details.reviewed.includes(file.path))]] : []),
      ['Open file', fa('openWorking')],
      ...(at ? [
        ['Open file at ' + short(at), fa('openAt'), gone ? 'disabled' : ''],
        ['Compare ' + short(at) + ' with working tree', fa('diffWorking'), gone ? 'disabled' : ''],
      ] : []),
      null,
      ['Show file history', fa('history')],
      ['Reveal in Explorer', fa('reveal')],
      null,
      ['Copy relative path', fa('copyPath')],
      ['Copy absolute path', fa('copyAbs')],
    ];
    showMenu(items, e.clientX, e.clientY);
  });

  // ---------- find ----------
  /** "path:<text>" searches the whole history for commits that changed a matching file or folder. */
  function isPathQuery(v) { return /^path:\s*\S/i.test(String(v).trim()); }
  function runFind(jump) {
    const raw = $('#find').value.trim();
    const q = raw.toLowerCase();
    if (hist && hist.q !== raw) hist = null;
    matches = [];
    if (!hist && isPathQuery(raw)) {
      // Only git knows which commits touched a path: wait for Enter (or All history).
      matchPos = -1;
      $('#count').textContent = histPending === raw ? 'searching…' : 'Enter: search history';
      $('#findall').hidden = false;
      render();
      return;
    }
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
    if (!$('#dlg').hidden) { if (e.key === 'Escape') { e.preventDefault(); closeDialog(); } return; }
    if (e.key === 'Escape') { if (!bpop.hidden) closeBranches(); else if (!apop.hidden) closeAuthors(); else if (!menu.hidden) hideMenu(); else if (!detailsEl.hidden) closeDetails(); return; }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
      // Jump to the checked-out commit.
      e.preventDefault();
      if (data && data.head && indexBySha.has(data.head)) select(data.head, true);
      return;
    }
    if (e.key === 'Enter' && data && selected && indexBySha.has(selected) && data.commits[indexBySha.get(selected)].kind === 'collapsed') {
      e.preventDefault();
      expandFold(data.commits[indexBySha.get(selected)]);
      return;
    }
    const page = Math.max(1, Math.floor(scroller.clientHeight / ROW) - 1);
    const MOVE = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page };
    if ((e.key in MOVE || e.key === 'Home' || e.key === 'End') && data && data.commits.length) {
      e.preventDefault();
      const n = data.commits.length;
      const cur = selected != null && indexBySha.has(selected) ? indexBySha.get(selected) : -1;
      let i = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : cur < 0 ? 0 : cur + MOVE[e.key];
      i = Math.max(0, Math.min(n - 1, i));
      if (i !== cur) select(data.commits[i].sha, true);
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
    const wtb = e.target.closest('[data-wt]');
    let items;
    if (wtb) items = worktreeItems(wtb.dataset.wt);
    else if (badge) items = refItems(badge.dataset.ref, badge.dataset.type, badge.dataset.remote, c);
    else items = commitItems(c);
    showMenu(items, e.clientX, e.clientY);
  });

  function commitItems(c) {
    const isHead = c.sha === data.head;
    const cur = data.branch ? `“${data.branch}”` : 'HEAD';
    const base = { sha: c.sha, subject: c.subject, parents: c.parents };
    if (c.kind === 'collapsed') return [
      [`Show these ${c.fold ? c.fold.n : ''} commits`, () => expandFold(c)],
      ...(foldOpened(data) ? [['Fold opened runs again', () => vscode.postMessage({ type: 'collapse' })]] : []),
      null,
      ['Turn off Compact graph', () => vscode.postMessage({ type: 'compact', on: false })],
    ];
    if (c.kind === 'uncommitted') return [
      ['Stash changes…', { action: 'stashSave' }],
      ['Open Source Control', { action: 'openScm' }],
      null,
      ['Save changes as a patch…', { action: 'savePatch', patch: 'working' }],
      ['Copy changes as a patch', { action: 'savePatch', patch: 'working', copy: true }],
      ['Apply a patch…', { action: 'applyPatch' }],
      null,
      ['Discard all changes…', { action: 'discardAll' }, 'danger'],
    ];
    if (c.kind === 'stash') {
      const s = { ...base, stashRef: c.stashRef };
      return [
        ['Apply stash', { ...s, action: 'stashApply' }],
        ['Pop stash', { ...s, action: 'stashPop' }],
        ['Create branch from stash…', { ...s, action: 'stashBranch' }],
        ['Save stash as a patch…', { ...s, action: 'savePatch', patch: 'stash' }],
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
      ...editItems(c, base),
      ...bisectItems(c, base),
      ['Review changes file by file', () => { pendingReview = c.sha; select(c.sha, true); }],
      ['Compare with working tree', () => compare(c.sha, UNC)],
      ['Create worktree here (detached)…', { ...base, action: 'addWorktree' }],
      ['Save as archive (zip, tar.gz)…', { ...base, action: 'archive' }],
      ...patchItems(c, base),
      ...(data.web ? [['Open on ' + data.web.name, () => vscode.postMessage({ type: 'openUrl', url: data.web.commit + c.sha })]] : []),
      null,
      [noteSet.has(c.sha) ? 'Edit note…' : 'Add note…', () => vscode.postMessage({ type: 'getNote', sha: c.sha })],
      ...(noteSet.has(c.sha) ? [['Remove note', () => vscode.postMessage({ type: 'setNote', sha: c.sha, note: '' })]] : []),
      ...(data.filter.path ? [] : [selAuthors.length === 1 && selAuthors[0] === authorKey(c)
        ? ['Show commits by all authors', () => setAuthors([])]
        : ['Show only commits by ' + c.author, () => setAuthors([authorKey(c)])]]),
      null,
      ['Copy hash', { ...base, action: 'copyHash' }],
      ['Copy subject', { ...base, action: 'copySubject' }],
    ];
  }

  /** Save/copy a commit as a patch; with a Ctrl/Cmd-click selection ending here, the whole series. */
  function patchItems(c, base) {
    const merge = c.parents.length > 1;
    const items = [
      [merge ? 'Save as a patch (diff against first parent)…' : 'Save as a patch…', { ...base, action: 'savePatch', patch: 'commit' }],
      ['Copy as a patch', { ...base, action: 'savePatch', patch: 'commit', copy: true }],
    ];
    const other = selected === c.sha ? compareSha : compareSha === c.sha ? selected : null;
    if (other && other !== UNC && indexBySha.has(other) && data.commits[indexBySha.get(other)].kind === 'commit') {
      const [a, b] = indexBySha.get(other) > indexBySha.get(c.sha) ? [other, c.sha] : [c.sha, other];
      if (reaches(b, a)) items.push(['Save commits ' + short(a) + '…' + short(b) + ' as patches…', { action: 'savePatch', patch: 'series', sha: a, target: b }]);
    }
    return items;
  }

  /** True when `to` is in the history of `from`, walking loaded commits only. */
  function reaches(from, to) {
    const seen = new Set(), stack = [from];
    while (stack.length) {
      const sha = stack.pop();
      if (sha === to) return true;
      if (seen.has(sha) || !indexBySha.has(sha)) continue;
      seen.add(sha);
      for (const p of data.commits[indexBySha.get(sha)].parents) stack.push(p);
    }
    return false;
  }

  /** Loaded commits reachable from HEAD (its history). Used to dim the rest and to offer cherry-pick on drop. */
  let reach = null, reachFor = null;
  function headReach() {
    if (reachFor === data) return reach;
    reachFor = data;
    reach = new Set();
    const stack = data.head ? [data.head] : [];
    while (stack.length) {
      const sha = stack.pop();
      if (reach.has(sha) || !indexBySha.has(sha)) continue;
      reach.add(sha);
      for (const p of data.commits[indexBySha.get(sha)].parents) stack.push(p);
    }
    return reach;
  }

  // ---------- edit history (reword, drop, squash) ----------
  /** Commits on HEAD's first-parent line up to the first merge: the ones a linear rebase can rewrite. */
  let editable = null, editableFor = null;
  const FIXUP_RE = /^(fixup|squash|amend)! /;
  function editableSet() {
    if (editableFor === data) return editable;
    editableFor = data;
    editable = new Set();
    let sha = data.head;
    while (sha && indexBySha.has(sha)) {
      const c = data.commits[indexBySha.get(sha)];
      if (c.kind !== 'commit' && c.kind) break;
      if (c.parents.length > 1) break;
      editable.add(sha);
      sha = c.parents[0];
    }
    return editable;
  }
  /** Older and newer end of the Ctrl/Cmd-click selection when both are editable, else null. */
  function squashRange() {
    if (!selected || !compareSha || selected === compareSha) return null;
    const set = editableSet();
    if (!set.has(selected) || !set.has(compareSha)) return null;
    const a = indexBySha.get(selected), b = indexBySha.get(compareSha);
    // Count the commits, not the rows: a stash row can sit between two commits.
    let n = 0;
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) if (set.has(data.commits[k].sha)) n++;
    return a > b ? { from: selected, to: compareSha, n } : { from: compareSha, to: selected, n };
  }
  function editItems(c, base) {
    if (data.op || data.bisect) return []; // finish or abort what is in progress first (see the bar)
    const set = editableSet();
    if (!set.has(c.sha)) return [];
    const cur = data.branch ? `“${data.branch}”` : 'HEAD';
    const rng = squashRange();
    const items = [];
    if (rng && (c.sha === rng.from || c.sha === rng.to)) items.push([`Squash ${rng.n} commits into one…`, { action: 'squashRange', sha: rng.from, target: rng.to, current: data.branch }]);
    // Folding into or moving below a merge parent is refused by the planner; grey it out here.
    const par = c.parents.length && indexBySha.has(c.parents[0]) ? data.commits[indexBySha.get(c.parents[0])] : null;
    const below = !c.parents.length || (par && par.parents.length > 1) ? 'disabled' : '';
    items.push(
      ['Edit commit message…', () => vscode.postMessage({ type: 'getMessage', sha: c.sha })],
      ['Move commit up (newer)', { ...base, action: 'moveCommit', dir: 'newer' }, c.sha === data.head ? 'disabled' : ''],
      ['Move commit down (older)', { ...base, action: 'moveCommit', dir: 'older' }, below],
      ['Squash into parent', { ...base, action: 'fixupCommit' }, below],
      ['Stop at this commit to change it…', { ...base, action: 'editCommit' }, c.sha === data.head ? 'disabled' : ''],
      ['Create fixup commit for this', { ...base, action: 'createFixup' }],
      ['Drop commit…', { ...base, action: 'dropCommit' }, 'danger'],
    );
    // fixup!/squash!/amend! commits on the editable line: fold them in (git rebase --autosquash).
    let fix = 0;
    for (const s of set) if (FIXUP_RE.test(data.commits[indexBySha.get(s)].subject)) fix++;
    if (fix) items.push([`Squash ${fix} fixup commit${fix === 1 ? '' : 's'} into ${fix === 1 ? 'its target' : 'their targets'}…`, { action: 'autosquash', current: data.branch }]);
    items.push(null);
    return items;
  }

  // ---------- git bisect: menu items, the bar, following the commit under test ----------
  function bisectItems(c, base) {
    const b = data.bisect;
    if (data.op) return [];
    if (!b) return [
      ['Start bisect: this commit is bad', { ...base, action: 'bisectStart', mark: 'bad' }],
      ['Start bisect: this commit is good', { ...base, action: 'bisectStart', mark: 'good' }],
      null,
    ];
    const [bad, good] = b.terms;
    const m = bisectBy.get(c.sha);
    return [
      [`Bisect: mark as ${bad}`, { ...base, action: 'bisectMark', mark: 'bad' }, m === 'bad' ? 'disabled' : ''],
      [`Bisect: mark as ${good}`, { ...base, action: 'bisectMark', mark: 'good' }, m === 'good' ? 'disabled' : ''],
      ['Bisect: skip this commit', { ...base, action: 'bisectMark', mark: 'skip' }, m === 'skip' ? 'disabled' : ''],
      ['Bisect: stop and go back (reset)', { action: 'bisectReset' }],
      null,
    ];
  }
  function renderBisectBar(b) {
    const bar = $('#bisectbar');
    if (!b) { bar.hidden = true; bar.innerHTML = ''; lastTesting = null; return; }
    const sh = (s) => (s ? s.slice(0, 8) : '');
    const shaHtml = (s, subj) => `<code class="op-sha" data-sha="${esc(s)}" title="Show this commit">${sh(s)}</code>${subj ? ` “${esc(subj.slice(0, 80))}”` : ''}`;
    const [bad, good] = b.terms;
    const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
    const from = b.start ? ` <span class="op-ok">(started from ${esc(b.start.length === 40 ? sh(b.start) : b.start)})</span>` : '';
    const reset = `<button data-bis="bisectReset" class="secondary" title="git bisect reset: stop and check out ${esc(b.start || 'where you started')} again">Reset</button>`;
    let html;
    if (b.firstBad) {
      html = `<span class="op-what">First ${esc(bad)} commit: ${shaHtml(b.firstBad, b.firstBadSubject)}</span>${from}<span class="grow"></span>`
        + `<button data-bis="show" data-sha="${esc(b.firstBad)}" title="Select it in the graph">Show</button>` + reset;
    } else if (b.onlySkipped) {
      html = `<span class="op-what">Only skipped commits are left: the first ${esc(bad)} commit is one of ${b.onlySkipped} commits</span>${from}<span class="grow"></span>`
        + `<button data-bis="bisectMark" data-mark="good" title="Mark the checked-out commit ${esc(good)}">${esc(cap(good))}</button><button data-bis="bisectMark" data-mark="bad" title="Mark the checked-out commit ${esc(bad)}">${esc(cap(bad))}</button>` + reset;
    } else if (!b.bad || !b.good.length) {
      const need = !b.bad ? bad : good;
      html = `<span class="op-what">Bisecting: mark a${/^[aeiou]/.test(need) ? 'n' : ''} ${esc(need)} commit</span> <span class="op-ok">(right-click a commit${b.testing && !b.bad ? `, or use the button for the checked-out one` : ''})</span>${from}<span class="grow"></span>`
        + (!b.bad && b.testing ? `<button data-bis="bisectMark" data-mark="bad" class="secondary" title="Mark the checked-out commit ${esc(bad)}">Checked-out commit is ${esc(bad)}</button>` : '') + reset;
    } else {
      const left = `${b.left} commit${b.left === 1 ? '' : 's'} left, about ${b.steps} step${b.steps === 1 ? '' : 's'}`;
      html = `<span class="op-what">Bisecting: testing ${b.testing ? shaHtml(b.testing, b.testingSubject) : 'HEAD'} — ${left}</span>${from}<span class="grow"></span>`
        + `<button data-bis="bisectMark" data-mark="good" title="It works here: git bisect ${esc(good)}">${esc(cap(good))}</button>`
        + `<button data-bis="bisectMark" data-mark="bad" title="The problem is here: git bisect ${esc(bad)}">${esc(cap(bad))}</button>`
        + `<button data-bis="bisectMark" data-mark="skip" class="secondary" title="Can't test this one (e.g. it doesn't build): git bisect skip">Skip</button>`
        + `<button data-bis="bisectRun" class="secondary" title="Let a command decide for every step: git bisect run (exit 0 = ${esc(good)}, 1-127 = ${esc(bad)}, 125 = skip)">Run a test command…</button>` + reset;
    }
    bar.innerHTML = `<span class="op-icon" aria-hidden="true">⌖</span>` + html;
    bar.hidden = false;
    // Follow the commit under test: select it when it changes (after Good/Bad/Skip, or a terminal run).
    const target = b.firstBad || b.testing;
    if (target && target !== lastTesting && indexBySha.has(target)) setTimeout(() => select(target, true), 0);
    lastTesting = target;
  }
  $('#bisectbar').addEventListener('click', (e) => {
    const c = e.target.closest('.op-sha');
    if (c) { if (indexBySha.has(c.dataset.sha)) select(c.dataset.sha, true); return; }
    const btn = e.target.closest('button[data-bis]');
    if (!btn) return;
    const what = btn.dataset.bis;
    if (what === 'show') { if (indexBySha.has(btn.dataset.sha)) select(btn.dataset.sha, true); return; }
    action({ action: what, mark: btn.dataset.mark });
  });

  // ---------- operation in progress (rebase, merge, cherry-pick, revert, am) ----------
  function renderOpBar(op) {
    const bar = $('#opbar');
    if (!op) { bar.hidden = true; bar.innerHTML = ''; return; }
    const sh = (s) => (s ? s.slice(0, 8) : '');
    const ref = (sha) => { const r = sha && (refsBySha.get(sha) || []).find((x) => x.type === 'head' || x.type === 'remote'); return r ? r.name : sh(sha); };
    let what;
    if (op.kind === 'rebase') what = `Rebasing <b>${esc(op.branch || 'HEAD')}</b>${op.onto ? ` onto <code>${esc(ref(op.onto))}</code>` : ''}`;
    else if (op.kind === 'merge') what = `Merging <code>${esc(ref(op.onto))}</code> into <b>${esc(data && data.branch ? data.branch : 'HEAD')}</b>`;
    else if (op.kind === 'cherry-pick') what = 'Cherry-picking';
    else if (op.kind === 'revert') what = 'Reverting';
    else what = 'Applying patches (git am)';
    const step = op.step && op.total ? ` — step ${op.step} of ${op.total}` : '';
    const at = op.stopped ? `${op.kind === 'rebase' ? ', stopped at' : ''} <code class="op-sha" data-sha="${esc(op.stopped)}" title="Show this commit">${sh(op.stopped)}</code>${op.stoppedSubject ? ` “${esc(op.stoppedSubject.slice(0, 80))}”` : ''}` : '';
    const n = op.conflicts.length;
    // Conflicted files: the first few by name (click → merge editor), the rest behind a menu.
    const SHOW = 3;
    const fileBtn = (f) => `<button class="op-file link" data-path="${esc(f)}" title="Open ${esc(f)} in the merge editor">${esc(f.split('/').pop())}</button>`;
    const conf = n
      ? `<span class="op-conf">${n} conflicted file${n === 1 ? '' : 's'}:</span><span class="op-files">${op.conflicts.slice(0, SHOW).map(fileBtn).join('')}${n > SHOW ? `<button class="op-more link" title="All conflicted files">+${n - SHOW} more ▾</button>` : ''}</span>`
      : `<span class="op-ok">no conflicts left</span>`;
    bar.innerHTML = `<span class="op-icon" aria-hidden="true">⚠</span><span class="op-what">${what}${step}${at}</span>${conf}<span class="grow"></span>`
      + `<button data-op="opContinue" title="${n ? 'Resolve and stage the conflicted files first' : 'Go on (keeps the prepared commit message; no editor opens)'}"${n ? ' class="secondary"' : ''}>Continue</button>`
      + (op.kind !== 'merge' ? `<button data-op="opSkip" class="secondary" title="Leave this commit out and go on">Skip</button>` : '')
      + `<button data-op="opAbort" class="secondary" title="Stop and put everything back as it was before">Abort</button>`
      + `<button data-op="scm" class="secondary" title="Open the Source Control view to resolve and stage">Source Control</button>`;
    bar.hidden = false;
  }
  $('#opbar').addEventListener('click', (e) => {
    const f = e.target.closest('.op-file');
    if (f) { vscode.postMessage({ type: 'fileAction', act: 'resolve', ref: null, path: f.dataset.path }); return; }
    if (e.target.closest('.op-more') && data && data.op) {
      const r = e.target.getBoundingClientRect();
      showMenu(data.op.conflicts.map((p) => [`Open ${p} in the merge editor`, () => vscode.postMessage({ type: 'fileAction', act: 'resolve', ref: null, path: p })]), r.left, r.bottom);
      e.stopPropagation();
      return;
    }
    const c = e.target.closest('.op-sha');
    if (c && indexBySha.has(c.dataset.sha)) select(c.dataset.sha, true);
  });

  // ---------- commit message editor (Edit commit message…) ----------
  let dlgSha = null, dlgOrig = '';
  let dlgMode = 'msg';
  function dialogMode(mode) {
    dlgMode = mode;
    const note = mode === 'note';
    $('#dlg-s').hidden = note;
    $('#dlg-sl').hidden = note;
    $('#dlg-bl').innerHTML = note ? 'Note <span class="hint">(leave empty to remove it)</span>' : 'Body <span class="hint">(optional)</span>';
    $('#dlg-ok').textContent = note ? 'Save note' : 'Save message';
  }
  /** Add or edit the git note on `sha` (refs/notes/commits). */
  function openNoteEditor(sha, note) {
    dialogMode('note');
    dlgSha = sha;
    dlgOrig = note || '';
    $('#dlg-t').textContent = `${note ? 'Edit' : 'Add'} note on ${sha.slice(0, 8)}`;
    $('#dlg-b').value = note || '';
    $('#dlg').hidden = false;
    updateDlg();
    $('#dlg-b').focus();
  }
  function openMessageEditor(sha, message) {
    dialogMode('msg');
    const nl = message.indexOf('\n');
    const subject = nl < 0 ? message : message.slice(0, nl);
    const body = nl < 0 ? '' : message.slice(nl + 1).replace(/^\n/, '');
    dlgSha = sha;
    dlgOrig = message;
    $('#dlg-t').textContent = `Edit message of ${sha.slice(0, 8)}`;
    $('#dlg-s').value = subject;
    $('#dlg-b').value = body;
    $('#dlg').hidden = false;
    updateDlg();
    $('#dlg-s').focus();
    $('#dlg-s').select();
  }
  function dlgMessage() {
    const subject = $('#dlg-s').value.trim();
    const body = $('#dlg-b').value.replace(/\s+$/, '').replace(/^\s*\n/, '');
    return body ? `${subject}\n\n${body}` : subject;
  }
  function updateDlg() {
    if (dlgMode === 'note') {
      const v = $('#dlg-b').value.replace(/\s+$/, '');
      $('#dlg-n').textContent = 'Notes live in refs/notes/commits and are not pushed with branches (git push origin refs/notes/commits).';
      $('#dlg-ok').disabled = v === dlgOrig.replace(/\s+$/, '') || (!v && !dlgOrig);
      return;
    }
    const len = $('#dlg-s').value.trim().length;
    $('#dlg-n').textContent = !len ? 'Enter a subject.' : len > 72 ? `Subject is ${len} characters; many tools cut it at 50–72.` : '';
    $('#dlg-ok').disabled = !len || dlgMessage() === dlgOrig.replace(/\s+$/, '');
  }
  function closeDialog() { $('#dlg').hidden = true; dlgSha = null; scroller.focus(); }
  $('#dlg-s').addEventListener('input', updateDlg);
  $('#dlg-b').addEventListener('input', updateDlg);
  $('#dlg-c').addEventListener('click', closeDialog);
  $('#dlg').addEventListener('mousedown', (e) => { if (e.target.id === 'dlg') closeDialog(); });
  $('#dlg-f').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#dlg-f').requestSubmit(); }
  });
  $('#dlg-f').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('#dlg-ok').disabled || !dlgSha) return;
    if (dlgMode === 'note') { vscode.postMessage({ type: 'setNote', sha: dlgSha, note: $('#dlg-b').value }); closeDialog(); return; }
    const c = indexBySha.has(dlgSha) ? data.commits[indexBySha.get(dlgSha)] : null;
    action({ action: 'reword', sha: dlgSha, subject: c ? c.subject : '', current: data.branch, fullMessage: dlgMessage() });
    closeDialog();
  });

  /** Show the changes between commit `a` and `b` (UNC = working tree) in the details pane. */
  function compare(a, b, base, la, lb) {
    selected = a;
    compareSha = b;
    cmpInfo = base ? { a: la, b: lb } : null;
    vscode.postMessage({ type: 'details', sha: a, compare: b, base: !!base });
    scrollTo(indexBySha.get(a));
    render();
  }
  const webBranch = (branch) => data.web.branch + branch.split('/').map(encodeURIComponent).join('/');

  function refItems(name, type, remote, c) {
    const cur = data.branch;
    const curL = cur ? `“${cur}”` : 'HEAD';
    const r = { ref: name, refType: type, remote, sha: c.sha, subject: c.subject };
    if (type === 'tag') return [
      ['Show tag details', () => select(c.sha, true)],
      ['Push tag…', { ...r, action: 'pushTag' }],
      ['Merge tag into ' + curL + '…', { ...r, action: 'merge' }],
      ['Save as archive (zip, tar.gz)…', { ...r, action: 'archive' }],
      ['Delete tag…', { ...r, action: 'deleteTag' }, 'danger'],
      null,
      ['Copy tag name', { ...r, action: 'copyRef' }],
    ];
    if (type === 'remote') return [
      ['Check out as local branch…', { ...r, action: 'checkoutBranch' }],
      ['Merge into ' + curL + '…', { ...r, action: 'merge' }],
      ['Fetch and merge into ' + curL + ' (pull)…', { ...r, action: 'pullInto' }, cur ? '' : 'disabled'],
      ['Rebase ' + curL + ' onto ' + name + '…', { ...r, action: 'rebase' }],
      ...(data.head && c.sha !== data.head ? [['Compare with ' + curL, () => compare(c.sha, data.head)], ['Changes since it split from ' + curL, () => compare(c.sha, data.head, true, name, cur || 'HEAD')]] : []),
      ['Check out in new worktree…', { ...r, action: 'addWorktree' }],
      ['Save as archive (zip, tar.gz)…', { ...r, action: 'archive' }],
      ['Save commits not on ' + curL + ' as patches…', { ...r, action: 'savePatch', patch: 'branch' }],
      ...(data.web && remote === data.web.remote ? [['Open on ' + data.web.name, () => vscode.postMessage({ type: 'openUrl', url: webBranch(name.slice(remote.length + 1)) })], ['Create pull request on ' + data.web.name + '…', () => vscode.postMessage({ type: 'openPullRequest', ref: name, refType: 'remote', remote })]] : []),
      null,
      ['Delete on remote…', { ...r, action: 'deleteRemoteBranch' }, 'danger'],
      null,
      ['Manage remote “' + remote + '”…', { action: 'manageRemotes', remote }],
      pinItem(name.slice(remote.length + 1)),
      ...colorItems(name.slice(remote.length + 1)),
      ...hideItems(name.slice(remote.length + 1), false),
      ['Copy branch name', { ...r, action: 'copyRef' }],
    ];
    const isCur = name === cur;
    const wt = wtByBranch.get(name);
    const lref = (refsBySha.get(c.sha) || []).find((x) => x.type === 'head' && x.name === name);
    return [
      wt ? ['Open its worktree in new window', { action: 'openWorktree', path: wt.path }] : ['Check out', { ...r, action: 'checkoutBranch' }, isCur ? 'disabled' : ''],
      ['Merge into ' + curL + '…', { ...r, action: 'merge' }, isCur ? 'disabled' : ''],
      ['Rebase ' + curL + ' onto ' + name + '…', { ...r, action: 'rebase' }, isCur ? 'disabled' : ''],
      ...(data.head && c.sha !== data.head ? [['Compare with ' + curL, () => compare(c.sha, data.head)], ['Changes since it split from ' + curL, () => compare(c.sha, data.head, true, name, cur || 'HEAD')]] : []),
      ...(isCur || wt ? [] : [['Check out in new worktree…', { ...r, action: 'addWorktree' }]]),
      ['Save as archive (zip, tar.gz)…', { ...r, action: 'archive' }],
      ...(isCur ? [] : [['Save commits not on ' + curL + ' as patches…', { ...r, action: 'savePatch', patch: 'branch' }]]),
      null,
      ['Push…', { ...r, action: 'pushBranch' }],
      ...(isCur ? [['Pull', { ...r, action: 'pull' }]] : []),
      ...(!isCur && lref && lref.upstream && !lref.gone ? [['Update from ' + lref.upstream + ' (fast-forward)', { ...r, action: 'updateBranch', upstream: lref.upstream }]] : []),
      ...(data.web ? [['Create pull request on ' + data.web.name + '…', () => vscode.postMessage({ type: 'openPullRequest', ref: name, refType: 'head' })]] : []),
      ['Rename…', { ...r, action: 'renameBranch' }],
      ['Delete…', { ...r, action: 'deleteBranch' }, isCur ? 'disabled' : 'danger'],
      ['Delete several branches…', { action: 'deleteBranches', ...(isCur ? {} : { ref: name }) }],
      null,
      pinItem(name),
      ...colorItems(name),
      ...hideItems(name, isCur),
      ['Copy branch name', { ...r, action: 'copyRef' }],
    ];
  }

  // Setting mergeline.pinnedBranches: a pinned branch keeps its own straight column on the left.
  function pinItem(n) {
    const pats = data.pinPatterns || [];
    if (pats.includes(n)) return ['Unpin (stop keeping it in its own column)', () => vscode.postMessage({ type: 'pin', name: n, on: false })];
    if ((data.pinned || []).includes(n)) return ['Pinned by a pattern in mergeline.pinnedBranches', null, 'disabled'];
    return ['Pin to its own column on the left', () => vscode.postMessage({ type: 'pin', name: n, on: true })];
  }

  // Setting mergeline.branchColors: a fixed colour for a branch (or all branches with its prefix).
  function colorItems(n) {
    const set = (p) => () => vscode.postMessage({ type: 'branchColor', pattern: p });
    const pats = data.colorPatterns || [];
    const items = [[pats.includes(n) ? 'Change branch colour…' : 'Set branch colour…', set(n)]];
    const k = n.indexOf('/');
    if (k > 0) {
      const g = n.slice(0, k) + '/*';
      items.push([`${pats.includes(g) ? 'Change' : 'Set'} colour of all ${n.slice(0, k)}/… branches…`, set(g)]);
    }
    return items;
  }

  // Setting mergeline.hiddenBranches: globs left out of the graph when it shows all branches.
  function hideItems(n, isCur) {
    if (isCur) return [['Hide (the checked-out branch is always shown)', null, 'disabled']];
    const hide = (g) => () => vscode.postMessage({ type: 'hide', pattern: g, on: true });
    const items = [['Hide this branch', hide(n)]];
    const k = n.indexOf('/');
    if (k > 0) items.push([`Hide all ${n.slice(0, k)}/… branches`, hide(n.slice(0, k) + '/*')]);
    return items;
  }

  function worktreeItems(p) {
    const w = (data.worktrees || []).find((x) => x.path === p) || { path: p };
    if (w.prunable) return [['Prune missing worktrees', { action: 'pruneWorktrees' }], null, ['Copy path', () => vscode.postMessage({ type: 'copy', text: p })]];
    return [
      ['Open in new window', { action: 'openWorktree', path: p }],
      ['Copy path', () => vscode.postMessage({ type: 'copy', text: p })],
      null,
      ['Remove worktree…', { action: 'removeWorktree', path: p }, w.main ? 'disabled' : 'danger'],
    ];
  }

  // ---------- drag and drop: a branch badge, or a commit row, onto another branch or commit ----------
  let drag = null; // { name, type ('head' | 'remote' | 'commit'), remote, sha, x0, y0, active }
  let justDropped = false;
  const ghost = document.createElement('div');
  ghost.id = 'ghost';
  ghost.hidden = true;
  document.body.appendChild(ghost);
  rowsEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !data) return;
    const b = e.target.closest('[data-ref]');
    if (!b || (b.dataset.type !== 'head' && b.dataset.type !== 'remote')) {
      // A commit row (not a tag, stash or the working tree): cherry-pick, move or squash on drop.
      const row = e.target.closest('.row');
      if (!row || e.target.closest('[data-wt], [data-kind]')) return;
      const c = data.commits[+row.dataset.i];
      if (!c || c.kind !== 'commit') return;
      drag = { name: `${short(c.sha)} ${c.subject.length > 40 ? c.subject.slice(0, 40) + '…' : c.subject}`, type: 'commit', sha: c.sha, c, x0: e.clientX, y0: e.clientY, active: false };
      return;
    }
    const row = b.closest('.row');
    e.preventDefault(); // no text selection while dragging
    drag = { name: b.dataset.ref, type: b.dataset.type, remote: b.dataset.remote, sha: data.commits[+row.dataset.i].sha, x0: e.clientX, y0: e.clientY, active: false };
  });
  function dropTarget(x, y) {
    const el = document.elementFromPoint(x, y);
    const row = el && el.closest('#rows .row');
    if (!row) return null;
    const c = data.commits[+row.dataset.i];
    if (!c || c.kind !== 'commit') return null;
    const b = el.closest('[data-ref]');
    return { i: +row.dataset.i, c, ref: b && b.dataset.type !== 'tag' ? b.dataset.ref : null, refType: b ? b.dataset.type : null };
  }
  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 6) return;
      drag.active = true;
      hideMenu();
      const ws = window.getSelection();
      if (ws) ws.removeAllRanges();
      document.body.classList.add('dragging');
      ghost.textContent = drag.name;
      ghost.hidden = false;
    }
    ghost.style.left = e.clientX + 14 + 'px';
    ghost.style.top = e.clientY + 10 + 'px';
    const sr = scroller.getBoundingClientRect();
    if (e.clientY < sr.top + ROW) scroller.scrollTop -= ROW / 2;
    else if (e.clientY > sr.bottom - ROW) scroller.scrollTop += ROW / 2;
    const t = dropTarget(e.clientX, e.clientY);
    const i = t ? t.i : -1;
    if (i !== dropIndex) { dropIndex = i; render(); }
  });
  document.addEventListener('mouseup', (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.active) return;
    document.body.classList.remove('dragging');
    ghost.hidden = true;
    dropIndex = -1;
    justDropped = true;
    setTimeout(() => { justDropped = false; }, 0);
    const t = dropTarget(e.clientX, e.clientY);
    render();
    const items = t && dropItems(d, t);
    if (items) showMenu(items, e.clientX, e.clientY);
  });

  /**
   * Menu shown when commit `s` is dropped on row `t`. On the current branch: squash into it or move
   * next to it (both commits on the editable line); from elsewhere onto the current branch: cherry-pick.
   */
  function commitDropItems(s, t) {
    const c = t.c, cur = data.branch;
    if (c.sha === s.sha) return null;
    const curL = cur ? `“${cur}”` : 'HEAD';
    const items = [];
    const onHead = t.ref ? t.ref === cur && t.refType === 'head' : c.sha === data.head;
    const set = editableSet();
    if (!data.op && set.has(s.sha) && set.has(c.sha)) {
      const m = { action: 'placeCommit', sha: s.sha, subject: s.c.subject, target: c.sha, targetSubject: c.subject, current: cur };
      items.push([`Squash ${short(s.sha)} into ${short(c.sha)}…`, { ...m, fold: true }]);
      items.push([`Move ${short(s.sha)} to right after ${short(c.sha)}…`, { ...m, fold: false }, s.c.parents[0] === c.sha ? 'disabled' : '']);
    } else if (onHead && !headReach().has(s.sha)) {
      items.push([`Cherry-pick ${short(s.sha)} onto ${curL}`, { action: 'cherryPick', sha: s.sha, subject: s.c.subject, parents: s.c.parents }, data.op ? 'disabled' : '']);
    }
    if (items.length) items.push(null);
    items.push([`Compare ${short(s.sha)} with ${t.ref && t.refType !== 'tag' ? `“${t.ref}”` : short(c.sha)}`, () => compare(s.sha, c.sha)]);
    return items;
  }

  /** Menu shown when branch `s` is dropped on row `t`: merge, rebase, move, compare. Null when it is a no-op. */
  function dropItems(s, t) {
    if (s.type === 'commit') return commitDropItems(s, t);
    const cur = data.branch;
    const c = t.c;
    // Target: the branch badge under the pointer, else the current branch when this is the HEAD row, else the commit.
    let tName = null, tType = null;
    if (t.ref && t.ref !== s.name) { tName = t.ref; tType = t.refType; }
    else if (!t.ref && c.sha === data.head && cur && cur !== s.name) { tName = cur; tType = 'head'; }
    if (c.sha === s.sha && !tName) return null;
    const sL = `“${s.name}”`, tL = tName ? `“${tName}”` : short(c.sha);
    const items = [];
    if (tType === 'head') {
      const into = tName === cur;
      if (wtByBranch.has(tName)) items.push([`Merge ${sL} into ${tL} (checked out in another worktree)`, {}, 'disabled']);
      else items.push([`Merge ${sL} into ${tL}${into ? '' : ' (checks it out)'}…`, into ? { action: 'merge', ref: s.name } : { action: 'mergeInto', ref: s.name, target: tName }]);
    }
    if (s.type === 'head') {
      items.push([`Rebase ${sL} onto ${tL}…`, { action: 'rebaseBranch', ref: s.name, target: tName || c.sha }, wtByBranch.has(s.name) ? 'disabled' : '']);
      if (c.sha !== s.sha) {
        if (s.name === cur) items.push([`Reset ${sL} to ${short(c.sha)}…`, { action: 'reset', sha: c.sha, subject: c.subject }]);
        else items.push([`Move ${sL} to ${short(c.sha)}…`, { action: 'moveBranch', ref: s.name, sha: c.sha, subject: c.subject }, wtByBranch.has(s.name) ? 'disabled' : '']);
      }
    }
    if (c.sha !== s.sha) {
      if (items.length) items.push(null);
      items.push([`Compare ${sL} with ${tL}`, () => compare(s.sha, c.sha)]);
      items.push([`Changes on ${sL} since it split from ${tL}`, () => compare(s.sha, c.sha, true, s.name, tName || short(c.sha))]);
    }
    return items.length ? items : null;
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
    const it = menuItems[+mi.dataset.k][1];
    if (typeof it === 'function') it(); else action(it);
  });
  document.addEventListener('mousedown', (e) => { if (!menu.contains(e.target)) hideMenu(); });
  window.addEventListener('blur', hideMenu);

  vscode.postMessage({ type: 'ready' });
})();
