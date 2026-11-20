// A rebase, merge, cherry-pick, revert or `git am` that stopped part-way (usually on a
// conflict), read from the files git keeps in the git dir, and the commands that go on
// from there. No VS Code dependency.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { git, GitError } from './gitlog';

export type OpKind = 'rebase' | 'merge' | 'cherry-pick' | 'revert' | 'am';

export interface OpState {
  kind: OpKind;
  /** Branch being rebased (short name), when known. */
  branch: string | null;
  /** Rebase: the commit it is replaying onto. Merge: the commit being merged in. */
  onto: string | null;
  /** 1-based step and step count of a rebase or `am`, when known. */
  step: number | null;
  total: number | null;
  /** The commit being applied when it stopped (rebase, cherry-pick, revert). */
  stopped: string | null;
  stoppedSubject: string | null;
  /** Paths with unresolved conflicts (unmerged in the index). */
  conflicts: string[];
}

const read = (p: string) => {
  try {
    return readFileSync(p, 'utf8').trim();
  } catch {
    return '';
  }
};
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);

/** What is in progress in the working tree at `cwd`, or null when nothing is. */
export async function readOperation(cwd: string): Promise<OpState | null> {
  const names = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'];
  const out = (await git(cwd, ['rev-parse', ...names.flatMap((n) => ['--git-path', n])])).split('\n').filter(Boolean);
  if (out.length !== names.length) return null;
  const p = Object.fromEntries(names.map((n, i) => [n, resolvePath(cwd, out[i])])) as Record<string, string>;
  let st: Omit<OpState, 'conflicts' | 'stoppedSubject'> | null = null;
  const branchOf = (dir: string) => {
    const h = read(join(dir, 'head-name'));
    return h.startsWith('refs/heads/') ? h.slice(11) : null;
  };
  if (existsSync(p['rebase-merge'])) {
    const d = p['rebase-merge'];
    st = { kind: 'rebase', branch: branchOf(d), onto: read(join(d, 'onto')) || null, step: num(read(join(d, 'msgnum'))), total: num(read(join(d, 'end'))), stopped: read(join(d, 'stopped-sha')) || null };
  } else if (existsSync(p['rebase-apply'])) {
    const d = p['rebase-apply'];
    const am = existsSync(join(d, 'applying'));
    st = { kind: am ? 'am' : 'rebase', branch: am ? null : branchOf(d), onto: am ? null : read(join(d, 'onto')) || null, step: num(read(join(d, 'next'))), total: num(read(join(d, 'last'))), stopped: am ? null : read(join(d, 'original-commit')) || null };
  } else if (existsSync(p.MERGE_HEAD)) {
    st = { kind: 'merge', branch: null, onto: read(p.MERGE_HEAD).split('\n')[0] || null, step: null, total: null, stopped: null };
  } else if (existsSync(p.CHERRY_PICK_HEAD)) {
    st = { kind: 'cherry-pick', branch: null, onto: null, step: null, total: null, stopped: read(p.CHERRY_PICK_HEAD) || null };
  } else if (existsSync(p.REVERT_HEAD)) {
    st = { kind: 'revert', branch: null, onto: null, step: null, total: null, stopped: read(p.REVERT_HEAD) || null };
  }
  if (!st) return null;
  // An empty rebase-merge dir can be left behind briefly while git starts or finishes.
  if (st.kind === 'rebase' && existsSync(p['rebase-merge']) && !readdirSync(p['rebase-merge']).length) return null;
  const [conflicts, stoppedSubject] = await Promise.all([
    unmerged(cwd),
    st.stopped ? git(cwd, ['show', '-s', '--format=%s', st.stopped]).then((s) => s.trim(), () => null) : Promise.resolve(null),
  ]);
  return { ...st, conflicts, stoppedSubject };
}

/** Paths that are still unmerged (conflicted) in the index. */
export async function unmerged(cwd: string): Promise<string[]> {
  const out = await git(cwd, ['diff', '--name-only', '-z', '--diff-filter=U']);
  return [...new Set(out.split('\0').filter(Boolean))];
}

/** Staged files that still contain conflict markers (`<<<<<<<` and friends). */
export async function leftoverMarkers(cwd: string): Promise<string[]> {
  let out = '';
  try {
    await git(cwd, ['diff', '--cached', '--check']);
  } catch (e) {
    // --check exits non-zero and lists problems on stdout (whitespace errors too; only markers count here).
    out = e instanceof GitError ? e.stdout : '';
  }
  const files = new Set<string>();
  for (const line of out.split('\n')) {
    const m = /^(.+?):\d+: leftover conflict marker/.exec(line);
    if (m) files.add(m[1]);
  }
  return [...files];
}

/** Arguments for `--continue`, `--skip` or `--abort` of the operation in progress. */
export function opArgs(kind: OpKind, what: 'continue' | 'skip' | 'abort'): string[] {
  if (what === 'skip' && kind === 'merge') throw new Error('A merge has no skip.');
  return [kind, `--${what}`];
}

/** Environment that keeps `--continue` from opening an editor: git keeps the message it prepared. */
export const NO_EDITOR = { GIT_EDITOR: 'true' };

export const opNames: Record<OpKind, string> = { rebase: 'rebase', merge: 'merge', 'cherry-pick': 'cherry-pick', revert: 'revert', am: 'patch apply (git am)' };
