// Drives the webview's mouse interactions in headless Chromium (loaded by shot.mjs when INTERACT=1).
// Reports results in document.title as JSON so shot.mjs can check them.
(function () {
  const out = { posted: [] };
  const orig = window.__post;
  window.__onPost = (m) => { if (m.type === 'layout' || m.type === 'fileAction' || m.type === 'details') out.posted.push(m); };
  const $ = (s) => document.querySelector(s);
  const ev = (el, type, x, y, extra) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, ...extra }));
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
      // 7. Keyboard: End selects the last row.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      out.endSelected = !!document.querySelector('#rows .row.sel');
    } catch (e) { out.error = String(e && e.stack || e); }
    setTimeout(() => { document.title = 'INTERACT ' + JSON.stringify(out); }, 50);
  }, 400);
})();
