// Drives the webview's mouse interactions in headless Chromium (loaded by shot.mjs when INTERACT=1).
// Reports results in document.title as JSON so shot.mjs can check them.
(function () {
  const out = { posted: [] };
  const orig = window.__post;
  window.__onPost = (m) => { if (m.type === 'layout' || m.type === 'fileAction' || m.type === 'details' || m.type === 'action' || m.type === 'filter') out.posted.push(m); };
  const $ = (s) => document.querySelector(s);
  const ev = (el, type, x, y, extra) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, ...extra }));
  const hideAll = () => document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 1, clientY: 1 }));
  const w = (k) => { const el = $('#header .c-' + k); return getComputedStyle(el).display === 'none' ? 0 : el.offsetWidth; };
  setTimeout(() => {
    try {
      // 1. Drag the Date column's right edge 80 px to the right.
      out.before = { date: w('date'), hash: w('hash'), graph: w('graph') };
      const rz = $('.rz[data-col="date"]');
      const r = rz.getBoundingClientRect();
      ev(rz, 'mousedown', r.left + 3, r.top + 5);
      ev(document, 'mousemove', r.left + 83, r.top + 5);
      ev(document, 'mouseup', r.left + 83, r.top + 5);
      out.afterDrag = { date: w('date'), rowDate: $('#rows .row .c-date').offsetWidth };
      // 2. Header menu: hide the Commit column.
      const h = $('#header');
      ev(h, 'contextmenu', 600, 10);
      out.headerMenu = [...document.querySelectorAll('#menu .mi')].map((m) => m.textContent);
      [...document.querySelectorAll('#menu .mi')].find((m) => m.textContent.includes('Commit')).click();
      out.afterHide = { hash: w('hash'), rowHash: getComputedStyle($('#rows .row .c-hash')).display };
      // 3. Double-click the Date edge: back to the default width.
      ev($('.rz[data-col="date"]'), 'dblclick', 0, 0);
      out.afterReset = { date: w('date') };
      // 4. File menu in the details pane.
      const f = $('.file');
      if (f) {
        const fr = f.getBoundingClientRect();
        ev(f, 'contextmenu', fr.left + 30, fr.top + 5);
        out.fileMenu = [...document.querySelectorAll('#menu .mi')].map((m) => m.textContent);
        [...document.querySelectorAll('#menu .mi')].find((m) => m.textContent === 'Copy relative path').click();
      }
      // 5. Drag the splitter up by 100 px.
      const sp = $('#split');
      out.split = { hidden: sp.hidden, h0: $('#details').offsetHeight };
      const sr = sp.getBoundingClientRect();
      ev(sp, 'mousedown', 300, sr.top + 2);
      ev(document, 'mousemove', 300, sr.top - 98);
      ev(document, 'mouseup', 300, sr.top - 98);
      out.split.h1 = $('#details').offsetHeight;
      // 6. Commit menu has the new entries.
      const row = [...document.querySelectorAll('#rows .row')].find((x) => !x.classList.contains('k-uncommitted') && !x.classList.contains('k-stash'));
      const rr = row.querySelector('.c-hash').getBoundingClientRect();
      ev(row.querySelector('.c-date'), 'contextmenu', rr.left, rr.top + 5);
      out.commitMenu = [...document.querySelectorAll('#menu .mi')].map((m) => m.textContent).filter((t) => /Compare|Open on/.test(t));
      [...document.querySelectorAll('#menu .mi')].find((m) => m.textContent === 'Compare with working tree').click();
      // 8. Drag the feature/dark-mode badge onto the current branch's badge: drop menu.
      hideAll();
      const src = [...document.querySelectorAll('#rows .badge.branch')].find((b) => b.dataset.ref === 'feature/dark-mode');
      const dst = document.querySelector('#rows .badge.branch.current');
      const s0 = src.getBoundingClientRect(), d0 = dst.getBoundingClientRect();
      const selBefore = document.querySelector('#rows .row.sel') && document.querySelector('#rows .row.sel').dataset.i;
      ev(src, 'mousedown', s0.left + 8, s0.top + 8);
      ev(document, 'mousemove', s0.left + 20, s0.top + 2);
      out.dragGhost = !$('#ghost').hidden && $('#ghost').textContent;
      ev(document, 'mousemove', d0.left + 8, d0.top + 8);
      out.dropHighlight = !!document.querySelector('#rows .row.drop');
      // Rows re-render during the drag, so target whatever is under the pointer now (as a real mouse does).
      ev(document.elementFromPoint(d0.left + 8, d0.top + 8), 'mouseup', d0.left + 8, d0.top + 8);
      ev(document.elementFromPoint(d0.left + 8, d0.top + 8), 'click', d0.left + 8, d0.top + 8);
      out.menuOpen = !$('#menu').hidden;
      out.dropMenu = [...document.querySelectorAll('#menu .mi')].map((m) => m.textContent);
      out.selAfterDrop = (document.querySelector('#rows .row.sel') && document.querySelector('#rows .row.sel').dataset.i) === selBefore;
      out.ghostHidden = $('#ghost').hidden && !document.querySelector('#rows .row.drop');
      [...document.querySelectorAll('#menu .mi')].find((m) => m.textContent.startsWith('Rebase')).click();
      // 9. Drop onto a plain commit row, then pick "Changes on … since it split from …".
      const src2 = [...document.querySelectorAll('#rows .badge.branch')].find((b) => b.dataset.ref === 'feature/dark-mode');
      const r1 = src2.getBoundingClientRect();
      const plain = [...document.querySelectorAll('#rows .row')].find((x) => !x.querySelector('.badge') && !x.classList.contains('k-stash'));
      const pr = plain.querySelector('.c-date').getBoundingClientRect();
      ev(src2, 'mousedown', r1.left + 8, r1.top + 8);
      ev(document, 'mousemove', pr.left + 10, pr.top + 8);
      ev(document.elementFromPoint(pr.left + 10, pr.top + 8), 'mouseup', pr.left + 10, pr.top + 8);
      out.dropMenu2 = [...document.querySelectorAll('#menu .mi')].map((m) => m.textContent);
      [...document.querySelectorAll('#menu .mi')].find((m) => m.textContent.startsWith('Changes on')).click();
      // 10. Worktree badge and its menu.
      const wtb = document.querySelector('#rows .badge.wt');
      out.wtBadge = wtb && wtb.textContent;
      if (wtb) { const wr = wtb.getBoundingClientRect(); ev(wtb, 'contextmenu', wr.left + 5, wr.top + 5); out.wtMenu = [...document.querySelectorAll('#menu .mi')].map((m) => m.textContent); hideAll(); }
      // 11. Drag a commit from another branch (release/1.1, not merged) onto the HEAD row: cherry-pick.
      hideAll();
      const rowBy = (subj) => [...document.querySelectorAll('#rows .row')].find((x) => x.querySelector('.subj') && x.querySelector('.subj').textContent === subj);
      const dragRow = (from, to) => {
        const f = from.querySelector('.c-date').getBoundingClientRect(), t = to.querySelector('.c-date').getBoundingClientRect();
        ev(from.querySelector('.c-date'), 'mousedown', f.left + 10, f.top + 8);
        ev(document, 'mousemove', f.left + 10, f.top + 20);
        const g = !$('#ghost').hidden && $('#ghost').textContent;
        ev(document, 'mousemove', t.left + 10, t.top + 8);
        ev(document.elementFromPoint(t.left + 10, t.top + 8), 'mouseup', t.left + 10, t.top + 8);
        return g;
      };
      const n0 = out.posted.length;
      out.commitGhost = dragRow(rowBy('Changelog for 1.1'), rowBy('Sync: debounce writes'));
      out.cherryMenu = [...document.querySelectorAll('#menu .mi')].map((m) => m.textContent);
      [...document.querySelectorAll('#menu .mi')].find((m) => m.textContent.startsWith('Cherry-pick')).click();
      // 12. Drag HEAD onto the commit two below it (both on the editable line): squash into / move after.
      dragRow(rowBy('Sync: debounce writes'), rowBy('Show sync status in the toolbar'));
      out.placeMenu = [...document.querySelectorAll('#menu .mi')].map((m) => m.textContent + (m.classList.contains('disabled') ? ' [disabled]' : ''));
      [...document.querySelectorAll('#menu .mi')].find((m) => m.textContent.startsWith('Squash')).click();
      // 13. Branch checklist: tick feature/search, then "Current branch", then Esc.
      $('#branchbtn').click();
      out.bpop = { open: !$('#bpop').hidden, items: document.querySelectorAll('#blist .bp-item').length };
      const box = [...document.querySelectorAll('#blist input')].find((i) => i.value === 'feature/search');
      box.click();
      out.bpop.btn1 = $('#branchbtn').textContent;
      $('#bfind').value = 'rel'; $('#bfind').dispatchEvent(new Event('input'));
      out.bpop.filtered = [...document.querySelectorAll('#blist .bp-item')].map((l) => l.textContent.trim());
      document.querySelector('#bpop [data-q="cur"]').click();
      out.bpop.btn2 = $('#branchbtn').textContent;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      out.bpop.closedByEsc = $('#bpop').hidden;
      out.posted2 = out.posted.slice(n0).map((m) => (m.type === 'filter' ? 'filter ' + JSON.stringify(m.branches) : m.type + ' ' + (m.action || '') + (m.fold !== undefined ? ' fold=' + m.fold : '') + (m.target ? ' target=' + m.target.slice(0, 7) : '')));
      // 14. Ctrl+H selects the HEAD commit.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true }));
      const sel = document.querySelector('#rows .row.sel .subj');
      out.ctrlH = sel && sel.textContent;
      // 15. Dimming: commits outside HEAD's history.
      window.postMessage({ type: 'settings', settings: { dateFormat: 'relative', dimOtherCommits: true } }, '*');
      // 7. Keyboard: End selects the last row.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      out.endSelected = !!document.querySelector('#rows .row.sel');
    } catch (e) { out.error = String(e && e.stack || e); }
    setTimeout(() => { out.dimmed = [...document.querySelectorAll('#rows .row.dim .subj')].map((x) => x.textContent); document.title = 'INTERACT ' + JSON.stringify(out); }, 50);
  }, 400);
})();
