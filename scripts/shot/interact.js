// Drives the webview's mouse interactions in headless Chromium (loaded by shot.mjs when INTERACT=1).
// Reports results in document.title as JSON so shot.mjs can check them.
(function () {
  const out = { posted: [] };
  const orig = window.__post;
  window.__onPost = (m) => { if (m.type === 'layout' || m.type === 'fileAction' || m.type === 'details' || m.type === 'action') out.posted.push(m); };
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
      // 7. Keyboard: End selects the last row.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      out.endSelected = !!document.querySelector('#rows .row.sel');
    } catch (e) { out.error = String(e && e.stack || e); }
    setTimeout(() => { document.title = 'INTERACT ' + JSON.stringify(out); }, 50);
  }, 400);
})();
