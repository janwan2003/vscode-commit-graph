// Decodes the compact rows that src/core/graph.ts (PackedRow) sends to the webview.
// Loaded by the webview as a script and by the unit tests as a CommonJS module.
(function (root) {
  'use strict';
  /**
   * @param {string} above lanes entering the row (the previous row's lanes string, or the layout's start)
   * @param {[number, number, string, number[], number[], number[]]} p packed row
   * @returns {{col: number, color: number, top: number[][], bot: number[][]}}
   */
  function unpackRow(above, p) {
    const col = p[0], lanes = p[2], into = p[3], diag = p[4], fresh = p[5];
    const top = [];
    const bot = [];
    for (let i = 0; i < above.length; i++) {
      const ch = above.charCodeAt(i) - 48; // '.' is negative
      if (ch < 0) continue;
      top.push(into.indexOf(i) >= 0 ? [i, col, ch] : [i, i, ch]);
    }
    for (let i = 0; i < lanes.length; i++) {
      const ch = lanes.charCodeAt(i) - 48;
      if (ch < 0 || fresh.indexOf(i) >= 0) continue;
      bot.push([i, i, ch]);
    }
    for (let k = 0; k < diag.length; k += 3) bot.push([diag[k], diag[k + 1], diag[k + 2]]);
    return { col, color: p[1], top, bot };
  }
  if (typeof module === 'object' && module.exports) module.exports = { unpackRow };
  else root.MergelineRows = { unpackRow };
})(typeof self !== 'undefined' ? self : this);
