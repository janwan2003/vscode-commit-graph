// Edit history on the current branch without an editor: reword, drop, and squash.
// Runs `git rebase -i` with a todo list we write ourselves (GIT_SEQUENCE_EDITOR copies
// it over git's), so no terminal or editor opens. No VS Code dependency.
import { writeFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { git } from './gitlog';

export type RewriteOp =
  | { kind: 'reword'; sha: string; subject: string }
  | { kind: 'drop'; sha: string }
  /** Stop the rebase right after `sha` is replayed, so its files can be changed; Continue amends it. */
  | { kind: 'edit'; sha: string }
  /** Swap `sha` with its parent (`older`) or with the commit after it on the branch (`newer`). */
  | { kind: 'move'; sha: string; dir: 'older' | 'newer' }
  /** Fold `sha` into its parent; the parent's message is kept. */
  | { kind: 'fixup'; sha: string }
  /**
   * Put `sha` directly after (on top of) `target`, anywhere on the branch: with `fold`, fold it
   * into `target` (target's message is kept), else just move it there. Drag a commit onto another.
   */
  | { kind: 'place'; sha: string; target: string; fold: boolean }
  /** Squash the commits from `from` (oldest) to `to` (newest), inclusive, into one with `message`. */
  | { kind: 'squash'; from: string; to: string; message: string };

export interface RewritePlan {
  /** Rebase base, or null for --root. */
  base: string | null;
  /** Commits base..HEAD, oldest first. */
  commits: string[];
  /** Commits whose hash changes (the first one rewritten and every later one). */
  rewritten: number;
  /** Remote-tracking branches that already contain the first rewritten commit. */
  pushed: string[];
  head: string;
  /** Full hashes of the commit (or the oldest and newest of a squash range). */
  first: string;
  last: string;
}

export class RewriteError extends Error {}

/** Quote for POSIX sh (git runs editors and exec lines through sh, also on Windows). */
export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

async function revs(cwd: string, args: string[]): Promise<string[]> {
  return (await git(cwd, ['rev-list', ...args])).split('\n').filter(Boolean);
}

async function resolve(cwd: string, rev: string): Promise<string> {
  return (await git(cwd, ['rev-parse', '--verify', '--quiet', rev + '^{commit}'])).trim();
}

/**
 * Check that the operation can run as a linear rebase of the current branch, and work out
 * the base and what it touches. Throws RewriteError with a user-facing reason when not.
 */
export async function planRewrite(cwd: string, op: RewriteOp): Promise<RewritePlan> {
  const head = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
  const first = await resolve(cwd, op.kind === 'squash' ? op.from : op.sha); // oldest commit that changes
  const last = op.kind === 'squash' ? await resolve(cwd, op.to) : first;
  // fixup folds into the parent, so the parent is the oldest rewritten commit.
  const parents = (await git(cwd, ['rev-list', '--parents', '-n', '1', first])).trim().split(' ').slice(1);
  if (parents.length > 1) throw new RewriteError('This is a merge commit. Use an interactive rebase in a terminal for merges.');
  let oldest = first;
  let target: string | undefined;
  if (op.kind === 'place') {
    target = await resolve(cwd, op.target);
    if (target === first) throw new RewriteError('Drop it on a different commit.');
    // The older of the two is the first commit whose position or content changes.
    if (!(await isAncestor(cwd, first, target))) {
      if (!(await isAncestor(cwd, target, first))) throw new RewriteError('Those two commits are not on one line of history. Both must be on the checked-out branch.');
      oldest = target;
      if (!op.fold && parents[0] === target) throw new RewriteError('It is already right after that commit.');
    }
    const tp = (await git(cwd, ['rev-list', '--parents', '-n', '1', target])).trim().split(' ').slice(1);
    if (tp.length > 1) throw new RewriteError('That is a merge commit. Use an interactive rebase in a terminal for merges.');
  }
  if (op.kind === 'fixup' || (op.kind === 'move' && op.dir === 'older')) {
    if (!parents.length) throw new RewriteError(op.kind === 'fixup' ? 'This is the first commit; it has no parent to squash into.' : 'This is the first commit; there is nothing older to move it below.');
    oldest = parents[0];
  }
  const op2 = (await git(cwd, ['rev-list', '--parents', '-n', '1', oldest])).trim().split(' ').slice(1);
  if (op2.length > 1) throw new RewriteError('Its parent is a merge commit. Use an interactive rebase in a terminal for merges.');
  const base = op2[0] ?? null;
  const range = base ? [`${base}..HEAD`] : ['HEAD'];
  const commits = (await revs(cwd, ['--reverse', ...range]));
  if (!commits.includes(first) || !commits.includes(last) || (target && !commits.includes(target))) throw new RewriteError('That commit is not on the checked-out branch. Check its branch out first.');
  if ((await revs(cwd, ['--merges', ...range])).length) throw new RewriteError('There is a merge commit between it and HEAD, and rewriting would flatten it. Use an interactive rebase in a terminal (git rebase -i --rebase-merges).');
  if (op.kind === 'squash' && commits.indexOf(first) >= commits.indexOf(last)) throw new RewriteError('Pick the older commit first, then the newer one.');
  if (op.kind === 'edit' && first === head) throw new RewriteError('This is the newest commit, so no rebase is needed: change the files, stage them and amend it (Commit (Amend) in Source Control).');
  if (op.kind === 'move' && op.dir === 'newer' && first === head) throw new RewriteError('This is already the newest commit on the branch.');
  if (await rebaseInProgress(cwd)) throw new RewriteError('A rebase is already in progress. Finish or abort it first.');
  const pushed = (await git(cwd, ['branch', '-r', '--contains', oldest, '--format=%(refname:short)'])).split('\n').map((s) => s.trim()).filter((s) => s && !s.endsWith('/HEAD'));
  // A moved commit placed lower down leaves the commits below its new place untouched.
  let from = commits.indexOf(oldest);
  if (op.kind === 'place' && !op.fold && oldest === target) from += 1;
  return { base, commits, rewritten: commits.length - from, pushed, head, first, last: target ?? last };
}

async function isAncestor(cwd: string, a: string, b: string): Promise<boolean> {
  try {
    await git(cwd, ['merge-base', '--is-ancestor', a, b]);
    return true;
  } catch {
    return false;
  }
}

export async function rebaseInProgress(cwd: string): Promise<boolean> {
  for (const p of ['rebase-merge', 'rebase-apply']) {
    const dir = (await git(cwd, ['rev-parse', '--git-path', p])).trim();
    try {
      statSync(resolvePath(cwd, dir));
      return true;
    } catch {
      // not there
    }
  }
  return false;
}

/** The todo list for `op` over `commits` (oldest first). Messages are written to `msgFile`. */
export function buildTodo(op: RewriteOp, commits: string[], msgFile: string): string[] {
  const amend = `exec git commit --amend --only --allow-empty --no-verify --cleanup=verbatim -F ${shQuote(msgFile)}`;
  const out: string[] = [];
  const iFrom = op.kind === 'squash' ? commits.indexOf(op.from) : -1;
  const iTo = op.kind === 'squash' ? commits.indexOf(op.to) : -1;
  if (op.kind === 'place') {
    const order = commits.filter((c) => c !== op.sha).map((c) => `pick ${c}`);
    const t = commits.filter((c) => c !== op.sha).indexOf(op.target);
    order.splice(t + 1, 0, `${op.fold ? 'fixup' : 'pick'} ${op.sha}`);
    return order;
  }
  if (op.kind === 'move') {
    const i = commits.indexOf(op.sha);
    const j = op.dir === 'older' ? i - 1 : i + 1;
    const order = [...commits];
    if (i >= 0 && j >= 0 && j < order.length) [order[i], order[j]] = [order[j], order[i]];
    return order.map((c) => `pick ${c}`);
  }
  commits.forEach((c, i) => {
    if (op.kind === 'drop' && c === op.sha) out.push(`drop ${c}`);
    else if (op.kind === 'edit' && c === op.sha) out.push(`edit ${c}`);
    else if (op.kind === 'fixup' && c === op.sha) out.push(`fixup ${c}`);
    else if (op.kind === 'squash' && i > iFrom && i <= iTo) out.push(`fixup ${c}`);
    else out.push(`pick ${c}`);
    if ((op.kind === 'reword' && c === op.sha) || (op.kind === 'squash' && i === iTo)) out.push(amend);
  });
  return out;
}

/** Full message of `sha` with the subject line replaced. */
export async function rewordMessage(cwd: string, sha: string, subject: string): Promise<string> {
  const msg = await git(cwd, ['show', '-s', '--format=%B', sha]);
  const nl = msg.indexOf('\n');
  const rest = nl < 0 ? '' : msg.slice(nl).replace(/\s+$/, '');
  return subject.trim() + rest + '\n';
}

/** Default message for squashing `commits` (oldest first): new subject, then the old subjects. */
export async function squashMessage(cwd: string, subject: string, commits: string[]): Promise<string> {
  const subs = await Promise.all(commits.map(async (c) => (await git(cwd, ['show', '-s', '--format=%s', c])).trim()));
  return `${subject.trim()}\n\n${subs.map((s) => `* ${s}`).join('\n')}\n`;
}

export interface RewriteResult {
  before: string;
  after: string;
}

/**
 * Run `op`. Uncommitted changes are stashed and restored (--autostash). On a conflict git
 * stops mid-rebase and this throws the GitError (the caller offers to open Source Control
 * or abort). The message, when needed, must be passed in `message`.
 */
export async function runRewrite(cwd: string, op0: RewriteOp, plan: RewritePlan, message?: string): Promise<RewriteResult> {
  // Use the full hashes planRewrite resolved (the op may name abbreviated hashes or refs).
  const op: RewriteOp =
    op0.kind === 'squash' ? { ...op0, from: plan.first, to: plan.last }
    : op0.kind === 'place' ? { ...op0, sha: plan.first, target: plan.last }
    : { ...op0, sha: plan.first };
  // Files live in the git dir, not in tmp: if the rebase stops on a conflict, its remaining
  // exec line still reads the message file after the user resolves and continues.
  const gitDir = (await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim();
  const fwd = (p: string) => p.replace(/\\/g, '/');
  const msgFile = fwd(join(gitDir, 'MERGELINE_MSG'));
  const todo = fwd(join(gitDir, 'MERGELINE_TODO'));
  if (message !== undefined) writeFileSync(msgFile, message);
  let done = false;
  try {
    // Reword of HEAD itself needs no rebase.
    if (op.kind === 'reword' && op.sha === plan.head) {
      await git(cwd, ['commit', '--amend', '--only', '--allow-empty', '--no-verify', '--cleanup=verbatim', '-F', msgFile]);
    } else {
      writeFileSync(todo, buildTodo(op, plan.commits, msgFile).join('\n') + '\n');
      await git(cwd, ['rebase', '-i', '--autostash', '--no-autosquash', ...(plan.base ? [plan.base] : ['--root'])], {
        env: { GIT_SEQUENCE_EDITOR: `cp ${shQuote(todo)}`, GIT_EDITOR: 'true' },
      });
    }
    done = true;
    return { before: plan.head, after: (await git(cwd, ['rev-parse', 'HEAD'])).trim() };
  } finally {
    rmSync(todo, { force: true });
    if (done) rmSync(msgFile, { force: true });
  }
}
