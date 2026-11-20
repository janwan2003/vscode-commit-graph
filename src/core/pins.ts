// Pinned branches (setting mergeline.pinnedBranches): which branch tips get their own lane on the left.

export interface PinRef {
  name: string; // main, origin/main
  type: string; // 'head' | 'remote' | ...
  sha: string;
  remote?: string;
}

/** The branch name without its remote: origin/release/1.2 → release/1.2. */
export function branchPart(r: PinRef): string {
  return r.type === 'remote' && r.remote && r.name.startsWith(r.remote + '/') ? r.name.slice(r.remote.length + 1) : r.name;
}

/** A setting entry as a matcher: an exact branch name, or a glob where `*` matches anything (also `/`). */
export function pinMatcher(pattern: string): (name: string) => boolean {
  const p = pattern.trim();
  if (!p.includes('*')) return (n) => n === p;
  const re = new RegExp('^' + p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return (n) => re.test(n);
}

/**
 * Tips to pin, in priority order: for each pattern in turn, each branch name it matches (local
 * `main` and remote `origin/main` count as one name). A name's tip is whichever of its refs comes
 * first in `order` (the loaded commits, newest first), so an `origin/main` that is ahead of `main`
 * starts the line. Names with no loaded ref are skipped. Returns the tips and their branch names.
 * `uncommitted`: the working-tree row; when it sits on a pinned tip it starts that line instead,
 * so it stays straight above the checked-out branch.
 */
export function pinnedTips(patterns: unknown, refs: PinRef[], order: string[], uncommitted?: { sha: string; parent: string }): { tips: string[]; names: string[] } {
  const pos = new Map<string, number>();
  order.forEach((s, i) => pos.has(s) || pos.set(s, i));
  const best = new Map<string, number>(); // branch name → row of its newest loaded ref
  for (const r of refs) {
    if (r.type !== 'head' && r.type !== 'remote') continue;
    const n = branchPart(r);
    const i = pos.get(r.sha);
    if (n === 'HEAD' || i === undefined) continue;
    if (!best.has(n) || i < best.get(n)!) best.set(n, i);
  }
  const tips: string[] = [];
  const names: string[] = [];
  for (const p of Array.isArray(patterns) ? patterns : []) {
    if (typeof p !== 'string' || !p.trim()) continue;
    const m = pinMatcher(p);
    const hits = [...best.keys()].filter((n) => m(n) && !names.includes(n)).sort((a, b) => best.get(a)! - best.get(b)!);
    for (const n of hits) {
      names.push(n);
      const t = order[best.get(n)!];
      tips.push(uncommitted && t === uncommitted.parent && pos.has(uncommitted.sha) ? uncommitted.sha : t);
    }
  }
  return { tips, names };
}
