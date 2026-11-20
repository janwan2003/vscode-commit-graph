// Patches: which git command makes one (`git format-patch` for commits, `git diff` for
// everything else) and what a piece of text is before it is applied (`git am` for a
// mailbox of commits, `git apply` for a plain diff). No VS Code dependency.

/** What to turn into a patch. */
export type PatchSource =
  /** One commit. A merge has no single diff for format-patch, so it becomes a diff against its first parent. */
  | { kind: 'commit'; sha: string; merge: boolean }
  /** Every non-merge commit from `oldest` to `newest`, both included (`oldest` must be an ancestor of `newest`). `root`: `oldest` has no parent. */
  | { kind: 'series'; oldest: string; newest: string; root: boolean }
  /** The commits on `branch` that are not on `base` (`git format-patch base..branch`). */
  | { kind: 'branch'; branch: string; base: string }
  /** Staged and unstaged changes to tracked files, against HEAD. */
  | { kind: 'working' }
  | { kind: 'stash'; ref: string }
  /** The plain diff between two commits; `to` null = the working tree. */
  | { kind: 'diff'; from: string; to: string | null };

/** The git arguments that print the patch on stdout. */
export function patchArgs(src: PatchSource): string[] {
  switch (src.kind) {
    case 'commit':
      return src.merge ? ['diff', '--binary', `${src.sha}^1`, src.sha] : ['format-patch', '-1', '--stdout', src.sha];
    case 'series':
      return src.root ? ['format-patch', '--stdout', '--root', src.newest] : ['format-patch', '--stdout', `${src.oldest}^..${src.newest}`];
    case 'branch':
      return ['format-patch', '--stdout', `${src.base}..${src.branch}`];
    case 'working':
      return ['diff', '--binary', 'HEAD'];
    case 'stash':
      // With the untracked files of a `git stash -u` (git 2.32+).
      return ['stash', 'show', '-p', '--binary', '--include-untracked', src.ref];
    case 'diff':
      return src.to ? ['diff', '--binary', src.from, src.to] : ['diff', '--binary', src.from];
  }
}

/** True when the patch is a mailbox of commits (author, date and message travel with it). */
export const isMailboxSource = (src: PatchSource) => (src.kind === 'commit' && !src.merge) || src.kind === 'series' || src.kind === 'branch';

/**
 * File name the way `git format-patch` names its files: `0001-Fix-the-parser.patch`.
 * Runs of characters other than letters, digits, `.` and `_` become one `-`; the subject part is cut to 64 characters.
 */
export function patchFileName(subject: string, n = 1): string {
  let s = subject.replace(/[^A-Za-z0-9._]+/g, '-').replace(/\.{2,}/g, '.');
  s = s.slice(0, 64).replace(/^[-.]+|[-.]+$/g, '');
  return `${String(n).padStart(4, '0')}-${s || 'patch'}.patch`;
}

/** A name that is safe as a file name: `feature/login` → `feature-login`. */
export const safeName = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'patch';

export interface PatchInfo {
  /** `mbox`: one or more commits from `git format-patch` (or a mail client); `diff`: a plain diff; `none`: neither. */
  kind: 'mbox' | 'diff' | 'none';
  /** Commits in a mailbox (0 for a plain diff). */
  commits: number;
  /** Their subjects, without the `[PATCH n/m]` prefix. */
  subjects: string[];
}

const MBOX_FROM = /^From [0-9a-f]{40} /;
const DIFF_START = /^(diff --git |--- \S|Index: |GIT binary patch)/m;

/** What kind of patch `text` is. */
export function inspectPatch(text: string): PatchInfo {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const subjects: string[] = [];
  let inHeader = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (MBOX_FROM.test(l)) {
      inHeader = true;
      subjects.push('');
      continue;
    }
    if (!inHeader) continue;
    if (l === '') {
      inHeader = false;
      continue;
    }
    const m = /^Subject:\s*(.*)$/i.exec(l);
    if (m) {
      // A long subject is folded onto continuation lines that start with whitespace.
      let s = m[1];
      while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) s += ' ' + lines[++i].trim();
      subjects[subjects.length - 1] = s.replace(/^\[[^\]]*PATCH[^\]]*\]\s*/i, '').trim();
    }
  }
  const hasDiff = DIFF_START.test(text) && /^(@@ |GIT binary patch|Binary files )/m.test(text);
  if (subjects.length) return { kind: 'mbox', commits: subjects.length, subjects };
  if (hasDiff) return { kind: 'diff', commits: 0, subjects: [] };
  // A rename-only or mode-only change has no hunks, but `git diff --git` headers with rename/mode lines.
  if (/^diff --git /m.test(text) && /^(rename from |old mode |new file mode |deleted file mode )/m.test(text)) return { kind: 'diff', commits: 0, subjects: [] };
  return { kind: 'none', commits: 0, subjects: [] };
}

/**
 * Text as git expects it: a patch pasted from a browser or chat often lost its final
 * newline, and git then reports "corrupt patch at line N". CRLF line ends are kept
 * when every line has one (a patch of CRLF files), otherwise they become LF.
 */
export function normalizePatch(text: string): string {
  const lines = text.split('\n');
  const body = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
  const allCrlf = body.length > 0 && body.every((l) => l.endsWith('\r'));
  let out = allCrlf ? text : text.replace(/\r\n/g, '\n');
  if (!out.endsWith('\n')) out += '\n';
  return out;
}

export type ApplyMode = 'am' | 'apply' | 'reverse';

/**
 * Commands to try in order for `file`. `git apply --3way` stages the result and can leave
 * conflict markers, but refuses (atomically) when a touched file has unstaged changes
 * ("does not match index"); then a plain `git apply` to the working tree is tried.
 */
export function applyCommands(mode: ApplyMode, file: string): string[][] {
  if (mode === 'am') return [['am', '--3way', file]];
  const r = mode === 'reverse' ? ['-R'] : [];
  return [
    ['apply', ...r, '--3way', file],
    ['apply', ...r, file],
  ];
}

/** True when a failed `git apply --3way` should be retried without it (see `applyCommands`). */
export const retryWithoutIndex = (stderr: string) => /does not match index|does not exist in index|patch does not apply/i.test(stderr) && !/with conflicts/i.test(stderr);

/** Paths `git apply --3way` left with conflicts ("Applied patch to 'f' with conflicts."). */
export function conflictedFromApply(stderr: string): string[] {
  const out = new Set<string>();
  for (const m of stderr.matchAll(/^Applied patch to '(.+)' with conflicts\.$/gm)) out.add(m[1]);
  return [...out];
}

/**
 * "2 files changed, +3 −1" from `git apply --numstat` output, or ''. Counted per distinct
 * path: `git apply --stat` lists a file once per patch that touches it, so a series
 * that edits one file twice would read "2 files changed".
 */
export function numstatSummary(numstat: string): string {
  const paths = new Set<string>();
  let add = 0, del = 0;
  for (const l of numstat.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l);
    if (!m) continue;
    paths.add(m[3]);
    if (m[1] !== '-') add += Number(m[1]);
    if (m[2] !== '-') del += Number(m[2]);
  }
  if (!paths.size) return '';
  return `${paths.size} file${paths.size === 1 ? '' : 's'} changed, +${add} −${del}`;
}
