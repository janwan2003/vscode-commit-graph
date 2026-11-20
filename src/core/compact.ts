// Compact graph (Git Graph issue #387): hide straight runs of commits so only the branch
// structure shows. No VS Code dependency.
//
// A commit is kept when something happens there: a ref or HEAD points at it (`keep`), it is a merge,
// a root, a fork point (two or more children) or a tip (no child). Every other commit has exactly one
// parent and one child, so hidden commits form straight chains, each hanging between two kept
// commits. Each chain becomes one placeholder row ("12 commits") whose only parent is the kept
// commit below it, so the graph stays connected. A chain with a commit in `expand` is shown whole.

/** Prefix of a placeholder row's id; the rest is the sha of the newest commit in its chain. */
export const FOLD = '~';

export interface Fold {
  /** Placeholder id: FOLD + top. */
  id: string;
  /** The hidden commits, newest first. */
  shas: string[];
  /** The kept commit the chain hangs from (its last commit's parent), or null when history ends there (shallow clone). */
  below: string | null;
}

export interface CompactPlan {
  /** Row ids in display order: kept commit shas and placeholder ids. */
  ids: string[];
  /** Parents to draw for every id in `ids`. */
  parents: Map<string, string[]>;
  /** Placeholders by id. */
  folds: Map<string, Fold>;
  /** Commits walked and commits hidden, for the toolbar hint. */
  total: number;
  hidden: number;
}

/**
 * Parse `git rev-list --parents` output: commits in the order git listed them, and each one's
 * parents (first parent only when `firstParent`; `merges` still records every real merge).
 */
export function parseRevList(out: string, firstParent = false): { order: string[]; parents: Map<string, string[]>; merges: Set<string> } {
  const order: string[] = [];
  const parents = new Map<string, string[]>();
  const merges = new Set<string>();
  for (const line of out.split('\n')) {
    if (!line) continue;
    const f = line.trim().split(' ');
    order.push(f[0]);
    if (f.length > 2) merges.add(f[0]);
    parents.set(f[0], firstParent ? f.slice(1, 2) : f.slice(1));
  }
  return { order, parents, merges };
}

export function compactPlan(order: string[], parents: Map<string, string[]>, keep: Set<string>, expand: Set<string> = new Set(), merges?: Set<string>): CompactPlan {
  const children = new Map<string, number>();
  for (const c of order) for (const p of parents.get(c) ?? []) if (parents.has(p)) children.set(p, (children.get(p) ?? 0) + 1);
  const kept = (c: string) => keep.has(c) || (merges ? merges.has(c) : false) || (parents.get(c)?.length ?? 0) !== 1 || children.get(c) !== 1;
  // Chains, found from the kept commit (or chain) above each one. A hidden commit has one child, so
  // its chain is reached exactly once.
  const chainOf = new Map<string, Fold>(); // top sha → chain
  const out = new Map<string, string[]>();
  const shown = new Set<string>();
  const ids: string[] = [];
  let hidden = 0;
  for (const c of order) if (kept(c)) shown.add(c);
  const chain = (top: string): Fold => {
    let f = chainOf.get(top);
    if (f) return f;
    const shas: string[] = [];
    let s: string | undefined = top;
    while (s !== undefined && parents.has(s) && !shown.has(s)) {
      shas.push(s);
      s = parents.get(s)![0];
    }
    f = { id: FOLD + top, shas, below: s !== undefined && parents.has(s) ? s : null };
    chainOf.set(top, f);
    return f;
  };
  // Open the chains that hold an expanded commit: their commits are kept too.
  if (expand.size) {
    for (const c of order) {
      if (!shown.has(c)) continue;
      for (const p of parents.get(c) ?? []) {
        if (!parents.has(p) || shown.has(p)) continue;
        const f = chain(p);
        if (f.shas.some((s) => expand.has(s))) for (const s of f.shas) shown.add(s);
      }
    }
    chainOf.clear();
  }
  const folds = new Map<string, Fold>();
  // Parents of shown commits, with hidden parents replaced by their chain's placeholder.
  for (const c of order) {
    if (!shown.has(c)) continue;
    out.set(
      c,
      (parents.get(c) ?? []).map((p) => {
        if (!parents.has(p) || shown.has(p)) return p;
        const f = chain(p);
        folds.set(f.id, f);
        return f.id;
      }),
    );
  }
  for (const c of order) {
    if (shown.has(c)) ids.push(c);
    else {
      hidden++;
      const f = chainOf.get(c);
      if (f) {
        ids.push(f.id);
        out.set(f.id, f.below ? [f.below] : []);
      }
    }
  }
  return { ids, parents: out, folds, total: order.length, hidden };
}
