// Lane layout for a commit graph. Input: commits ordered children-before-parents.
// Output: per row, the node's column and colour plus the line segments in the top
// half (row top edge → node centre) and bottom half (node centre → row bottom edge).

export interface LayoutInput {
  sha: string;
  parents: string[];
}

/** A segment from column `a` to column `b` in one half of a row, drawn in colour `c`. */
export type Seg = [a: number, b: number, c: number];

export interface Row {
  col: number;
  color: number;
  top: Seg[];
  bot: Seg[];
}

/**
 * Compact form of a Row sent to the webview (see media/rows.js for the decoder).
 * [col, color, lanes, into, diag, fresh]:
 * - lanes: the lanes open below this row, one char each: '.' for a free lane, else its colour digit.
 *   The previous row's `lanes` (or the starting state) gives the lanes entering this row.
 * - into: entering lanes that end in this node (drawn as top segments [i, col]); every other
 *   entering lane passes straight through the top half.
 * - diag: bottom-half segments that are not straight, flattened [a, b, c, a, b, c, ...].
 * - fresh: open lanes below that start at the node (drawn only by `diag`); every other open
 *   lane is a straight bottom-half line.
 * Straight pass-through lines are most of a wide graph, so this is several times smaller.
 */
export type PackedRow = [col: number, color: number, lanes: string, into: number[], diag: number[], fresh: number[]];

export interface Layout {
  rows: Row[];
  /** The same rows in compact form. */
  packed: PackedRow[];
  /** Lanes entering the first row of this call, in the `lanes` string format. */
  start: string;
  width: number; // max number of columns used
}

function laneString(lanes: (string | null)[], colors: number[]): string {
  let s = '';
  for (let i = 0; i < lanes.length; i++) s += lanes[i] === null ? '.' : String(colors[i]);
  return s;
}

/**
 * State carried between calls so more commits can be appended (load more)
 * without recomputing the rows already laid out.
 */
export interface LayoutState {
  lanes: (string | null)[];
  colors: number[];
  nextColor: number;
  width: number;
}

export function newLayoutState(): LayoutState {
  return { lanes: [], colors: [], nextColor: 0, width: 0 };
}

const PALETTE = 10;

export function layout(commits: LayoutInput[], st: LayoutState = newLayoutState()): Layout {
  const rows: Row[] = [];
  const packed: PackedRow[] = [];
  const { lanes, colors } = st;
  const start = laneString(lanes, colors);
  const free = (): number => {
    const i = lanes.indexOf(null);
    if (i >= 0) return i;
    lanes.push(null);
    colors.push(0);
    return lanes.length - 1;
  };
  const alloc = (sha: string): number => {
    const i = free();
    lanes[i] = sha;
    colors[i] = st.nextColor++ % PALETTE;
    return i;
  };

  for (const c of commits) {
    const top: Seg[] = [];
    const bot: Seg[] = [];
    const into: number[] = [];
    const diag: number[] = [];
    const before = lanes.slice();
    let col = before.indexOf(c.sha);
    if (col < 0) col = alloc(c.sha); // branch tip: nothing above it
    const color = colors[col];
    for (let i = 0; i < before.length; i++) {
      const l = before[i];
      if (l === null) continue;
      if (l === c.sha) {
        top.push([i, col, colors[i]]);
        into.push(i);
        if (i !== col) lanes[i] = null; // merges into the node
      } else top.push([i, i, colors[i]]);
    }
    // Each sha is awaited by at most one lane (as in `git log --graph`): a parent
    // that another lane already waits for joins that lane instead of opening a
    // duplicate, which keeps busy topic-branch histories narrow.
    const fresh = new Set<number>(); // new lanes opened by this node
    const joins = new Set<number>(); // existing lanes this node connects into
    let folded = -1; // a lane right of the node that folds into the node's lane
    const ps = c.parents;
    lanes[col] = null;
    if (ps.length) {
      const j = lanes.indexOf(ps[0]);
      if (j < 0) lanes[col] = ps[0];
      else if (j < col) joins.add(j);
      else {
        lanes[col] = ps[0];
        lanes[j] = null;
        folded = j;
      }
    }
    for (let k = 1; k < ps.length; k++) {
      if (ps.indexOf(ps[k]) < k) continue;
      const j = lanes.indexOf(ps[k]);
      if (j >= 0) {
        if (j !== col) joins.add(j);
      } else fresh.add(alloc(ps[k]));
    }
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) continue;
      if (fresh.has(i)) {
        bot.push([col, i, colors[i]]);
        diag.push(col, i, colors[i]);
      } else if (i === col) bot.push([col, col, color]);
      else {
        bot.push([i, i, colors[i]]);
        if (joins.has(i)) {
          bot.push([col, i, colors[i]]);
          diag.push(col, i, colors[i]);
        }
      }
    }
    if (folded >= 0) {
      bot.push([folded, col, colors[folded]]);
      diag.push(folded, col, colors[folded]);
    }
    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop();
      colors.pop();
    }
    st.width = Math.max(st.width, lanes.length, col + 1, before.length);
    rows.push({ col, color, top, bot });
    packed.push([col, color, laneString(lanes, colors), into, diag, [...fresh].filter((i) => lanes[i] !== null)]);
  }
  return { rows, packed, start, width: st.width };
}

