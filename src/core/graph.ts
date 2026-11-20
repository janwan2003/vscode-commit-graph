// Lane layout for a commit graph. Input: commits ordered children-before-parents.
// Output: per row, the node's column and colour plus the line segments in the top
// half (row top edge → node centre) and bottom half (node centre → row bottom edge).

import { colorChar } from './colors';

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
 * - lanes: the lanes open below this row, one char each: '.' for a free lane, else its colour
 *   ('0'..'9' for the palette, 'a'..'z' for custom colours 10..35 from mergeline.branchColors).
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
  for (let i = 0; i < lanes.length; i++) s += lanes[i] === null ? '.' : colorChar(colors[i]);
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
  /**
   * Pinned branches (setting mergeline.pinnedBranches): the tip of each, in lane order. Lane k
   * (k < tips.length) belongs to tip k's first-parent line and always has colour k; no other
   * line is drawn in it. Set by `pinBranches`.
   */
  tips: string[];
  /** sha → pinned lane, for every commit on a pinned first-parent line (plus the first unloaded one). */
  home: Map<string, number>;
  /** Per pinned lane, the sha its line expects next (null once the line has ended). */
  expect: (string | null)[];
  /**
   * Branch colours (setting mergeline.branchColors): sha → colour for commits a coloured branch points at.
   * A line that starts at one of them gets that colour instead of the next one in the cycle.
   */
  tipColor: Map<string, number>;
  /** Per pinned lane, its colour (default: the lane number). */
  pinColor: number[];
}

export function newLayoutState(): LayoutState {
  return { lanes: [], colors: [], nextColor: 0, width: 0, tips: [], home: new Map(), expect: [], tipColor: new Map(), pinColor: [] };
}

const PALETTE = 10;
/** At most this many pinned lanes, so the other lines keep at least six colours. */
export const MAX_PINNED = 4;

/**
 * Walks each pinned tip's first-parent line through `commits`, in priority order. A commit already
 * claimed by an earlier tip ends the walk (the later line joins the earlier one there). The first
 * parent that is not loaded is claimed too, so the line runs on to the bottom and a later Load more
 * continues it in the same lane.
 */
export function pinChains(commits: LayoutInput[], tips: string[]): Map<string, number> {
  const bySha = new Map<string, LayoutInput>();
  for (const c of commits) bySha.set(c.sha, c);
  const home = new Map<string, number>();
  tips.forEach((t, k) => {
    let s: string | undefined = t;
    while (s && !home.has(s)) {
      home.set(s, k);
      const c = bySha.get(s);
      if (!c) break;
      s = c.parents[0];
    }
  });
  return home;
}

/**
 * Pins the given branch tips (ordered by priority) before the first `layout` call. Tips that are
 * not among `commits`, repeated, or on an earlier tip's first-parent line are dropped. Returns the
 * tips kept.
 */
export function pinBranches(st: LayoutState, commits: LayoutInput[], tips: string[]): string[] {
  const loaded = new Set(commits.map((c) => c.sha));
  const kept: string[] = [];
  let home = new Map<string, number>();
  for (const t of tips) {
    if (kept.length >= MAX_PINNED || !loaded.has(t) || home.has(t)) continue;
    kept.push(t);
    home = pinChains(commits, kept);
  }
  st.tips = kept;
  st.home = home;
  st.expect = kept.slice();
  return kept;
}

/** Before laying out appended commits: extends the pinned lines into them. */
export function extendPins(st: LayoutState, allCommits: LayoutInput[]): void {
  if (st.tips.length) st.home = pinChains(allCommits, st.tips);
}

export function layout(commits: LayoutInput[], st: LayoutState = newLayoutState()): Layout {
  const rows: Row[] = [];
  const packed: PackedRow[] = [];
  const { lanes, colors, home, expect } = st;
  const P = st.tips.length;
  const start = laneString(lanes, colors);
  const grow = (n: number) => {
    while (lanes.length < n) {
      lanes.push(null);
      colors.push(0);
    }
  };
  // Pinned lanes 0..P-1 are never handed out to other lines.
  const free = (): number => {
    for (let i = P; i < lanes.length; i++) if (lanes[i] === null) return i;
    grow(Math.max(P, lanes.length) + 1);
    return lanes.length - 1;
  };
  const alloc = (sha: string): number => {
    const i = free();
    lanes[i] = sha;
    const fixed = st.tipColor.get(sha);
    colors[i] = fixed ?? P + (st.nextColor++ % (PALETTE - P));
    return i;
  };
  const pinColor = (h: number): number => st.pinColor[h] ?? h;
  /** The pinned lane `sha` may go into now: its line's lane, when that line expects it next. */
  const pinLane = (sha: string): number => {
    const h = home.get(sha);
    if (h === undefined || expect[h] !== sha) return -1;
    return lanes[h] === null || lanes[h] === sha || h >= lanes.length ? h : -1;
  };

  for (const c of commits) {
    const top: Seg[] = [];
    const bot: Seg[] = [];
    const into: number[] = [];
    const diag: number[] = [];
    const before = lanes.slice();
    const h0 = P ? home.get(c.sha) : undefined;
    let col = h0 !== undefined && before[h0] === c.sha ? h0 : before.indexOf(c.sha);
    if (col < 0) {
      // branch tip: nothing above it
      const h = P ? pinLane(c.sha) : -1;
      if (h >= 0) {
        grow(h + 1);
        lanes[h] = c.sha;
        colors[h] = pinColor(h);
        col = h;
      } else col = alloc(c.sha);
    }
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
    // This node continues a pinned line: the line now expects its first parent, if that is still on it.
    if (h0 !== undefined && expect[h0] === c.sha) expect[h0] = ps.length && home.get(ps[0]) === h0 ? ps[0] : null;
    /** Sends parent `p` into its pinned lane when its line expects it. False when it has none. */
    const toPinned = (p: string): boolean => {
      const h = P ? pinLane(p) : -1;
      if (h < 0) return false;
      grow(h + 1);
      if (lanes[h] === p) joins.add(h);
      else {
        lanes[h] = p;
        colors[h] = pinColor(h);
        if (h !== col) fresh.add(h);
      }
      return true;
    };
    if (ps.length && !toPinned(ps[0])) {
      const j = lanes.indexOf(ps[0]);
      if (col < P) {
        // A pinned lane only carries its own line: a parent that is not on it goes elsewhere.
        if (j >= 0) joins.add(j);
        else fresh.add(alloc(ps[0]));
      } else if (j < 0) lanes[col] = ps[0];
      else if (j < col) joins.add(j);
      else {
        lanes[col] = ps[0];
        lanes[j] = null;
        folded = j;
      }
    }
    for (let k = 1; k < ps.length; k++) {
      if (ps.indexOf(ps[k]) < k) continue;
      if (toPinned(ps[k])) continue;
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

