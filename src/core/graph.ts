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

export interface Layout {
  rows: Row[];
  width: number; // max number of columns used
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
  const { lanes, colors } = st;
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
    const before = lanes.slice();
    let col = before.indexOf(c.sha);
    if (col < 0) col = alloc(c.sha); // branch tip: nothing above it
    const color = colors[col];
    for (let i = 0; i < before.length; i++) {
      const l = before[i];
      if (l === null) continue;
      if (l === c.sha) {
        top.push([i, col, colors[i]]);
        if (i !== col) lanes[i] = null; // merges into the node
      } else top.push([i, i, colors[i]]);
    }
    const fresh = new Set<number>();
    const joins = new Set<number>();
    const ps = c.parents;
    lanes[col] = ps.length ? ps[0] : null;
    for (let k = 1; k < ps.length; k++) {
      const j = lanes.indexOf(ps[k]);
      if (j >= 0) {
        if (j !== col) joins.add(j);
      } else fresh.add(alloc(ps[k]));
    }
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) continue;
      if (i === col) bot.push([col, col, color]);
      else if (fresh.has(i)) bot.push([col, i, colors[i]]);
      else {
        bot.push([i, i, colors[i]]);
        if (joins.has(i)) bot.push([col, i, colors[i]]);
      }
    }
    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop();
      colors.pop();
    }
    st.width = Math.max(st.width, lanes.length, col + 1, before.length);
    rows.push({ col, color, top, bot });
  }
  return { rows, width: st.width };
}

