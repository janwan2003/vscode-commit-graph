// Deleting several local branches at once (Git Graph issue #184): which branches can go,
// which are merged, and the git commands for a chosen set.

export interface LocalBranch {
  name: string;
  sha: string;
  /** Unix seconds of the tip commit. */
  date: number;
  /** Short upstream name, '' when none. */
  upstream: string;
  /** The upstream branch was deleted on the remote ("[gone]"). */
  gone: boolean;
  /** Checked out here (HEAD) or in another worktree: git refuses to delete it. */
  checkedOut: boolean;
  /** Reachable from HEAD, so `git branch -d` deletes it without losing commits. */
  merged: boolean;
}

const US = '\x1f';

/** Format for `git for-each-ref refs/heads` read by parseBranches. */
export const BRANCH_FORMAT = ['%(refname:short)', '%(objectname)', '%(committerdate:unix)', '%(upstream:short)', '%(upstream:track,nobracket)', '%(HEAD)', '%(worktreepath)'].join('%1f');

/** Parses for-each-ref output (BRANCH_FORMAT); `merged` is the output of `git branch --merged HEAD --format=%(refname:short)`. */
export function parseBranches(out: string, merged: string): LocalBranch[] {
  const m = new Set(merged.split('\n').map((s) => s.trim()).filter(Boolean));
  const list: LocalBranch[] = [];
  for (const line of out.split('\n')) {
    const f = line.split(US);
    if (f.length < 7 || !f[0]) continue;
    list.push({
      name: f[0],
      sha: f[1],
      date: Number(f[2]) || 0,
      upstream: f[3],
      gone: f[4] === 'gone',
      checkedOut: f[5] === '*' || !!f[6],
      merged: m.has(f[0]),
    });
  }
  return list;
}

/**
 * Branches offered for deletion, most likely to be cleaned up first: merged and upstream gone,
 * then merged, then upstream gone, then the rest; oldest tip first within each group.
 * Checked-out branches are left out (git refuses them).
 */
export function deletable(list: LocalBranch[]): LocalBranch[] {
  const rank = (b: LocalBranch) => (b.merged ? 0 : 2) + (b.gone ? 0 : 1);
  return list.filter((b) => !b.checkedOut).sort((a, b) => rank(a) - rank(b) || a.date - b.date || a.name.localeCompare(b.name));
}

/** One line for the picker: why this branch is (or is not) safe to delete. */
export function branchNote(b: LocalBranch, current: string | null): string {
  const parts: string[] = [];
  parts.push(b.merged ? `merged into ${current ?? 'HEAD'}` : `not merged into ${current ?? 'HEAD'}`);
  if (b.gone) parts.push(`${b.upstream} deleted on the remote`);
  else if (b.upstream) parts.push(`tracks ${b.upstream}`);
  return parts.join(' · ');
}

export interface DeletePlan {
  /**
   * Arguments for the branches merged into HEAD, or null. `-D`, not `-d`: `-d` checks a branch's upstream before
   * HEAD, so it refuses a branch merged into HEAD that has commits its upstream lacks, though nothing would be lost.
   */
  safe: string[] | null;
  /** `git branch -D` arguments (unmerged branches, only when forced), or null. */
  force: string[] | null;
  /** Unmerged branches left alone because force was not chosen. */
  kept: string[];
}

export function planDelete(chosen: LocalBranch[], force: boolean): DeletePlan {
  const merged = chosen.filter((b) => b.merged).map((b) => b.name);
  const unmerged = chosen.filter((b) => !b.merged).map((b) => b.name);
  return {
    safe: merged.length ? ['branch', '-D', '--', ...merged] : null,
    force: force && unmerged.length ? ['branch', '-D', '--', ...unmerged] : null,
    kept: force ? [] : unmerged,
  };
}

/** Undo: recreate each branch at its old tip (`git branch <name> <sha>`); upstreams are restored separately. */
export function restoreArgs(b: Pick<LocalBranch, 'name' | 'sha'>): string[] {
  return ['branch', '--', b.name, b.sha];
}

/** Short list for a dialog: "a, b, c and 4 more". */
export function nameList(names: string[], max = 6): string {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}
