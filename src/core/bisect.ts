// A `git bisect` session, read from the files and refs git keeps for it, and the commands
// that drive it. No VS Code dependency.
import { readFileSync, existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { git } from './gitlog';

export interface BisectState {
  /** The words git uses for the two ends: ['bad', 'good'] by default, ['new', 'old'] or custom terms. */
  terms: [string, string];
  /** Branch (or commit) the bisect started from; `git bisect reset` goes back there. */
  start: string | null;
  /** The commit marked bad (the newest one known bad). */
  bad: string | null;
  good: string[];
  skip: string[];
  /** HEAD: the commit checked out for testing. */
  testing: string | null;
  testingSubject: string | null;
  /** Commits that could still be the first bad one, not counting the bad end or skipped ones. */
  left: number | null;
  /** Rough number of tests to go (log2), when both ends are known. */
  steps: number | null;
  /** Set once the search has finished. */
  firstBad: string | null;
  firstBadSubject: string | null;
  /** Finished with only skipped commits left: any of these (and the bad end) can be the first bad commit. */
  onlySkipped: number | null;
}

const read = (p: string) => {
  try {
    return readFileSync(p, 'utf8').trim();
  } catch {
    return '';
  }
};

/** The bisect in progress in the repository at `cwd`, or null when none is. */
export async function readBisect(cwd: string): Promise<BisectState | null> {
  const paths = (await git(cwd, ['rev-parse', '--git-path', 'BISECT_START', '--git-path', 'BISECT_TERMS'])).split('\n').filter(Boolean);
  if (paths.length !== 2) return null;
  const [startFile, termsFile] = paths.map((p) => resolvePath(cwd, p));
  if (!existsSync(startFile)) return null;
  const t = read(termsFile).split('\n').map((s) => s.trim()).filter(Boolean);
  const terms: [string, string] = t.length === 2 ? [t[0], t[1]] : ['bad', 'good'];
  const startRaw = read(startFile);
  const refsOut = await git(cwd, ['for-each-ref', '--format=%(objectname) %(refname)', 'refs/bisect/']);
  let bad: string | null = null;
  const good: string[] = [];
  const skip: string[] = [];
  for (const line of refsOut.split('\n')) {
    const m = /^([0-9a-f]+) refs\/bisect\/(.+)$/.exec(line.trim());
    if (!m) continue;
    if (m[2] === terms[0]) bad = m[1];
    else if (m[2].startsWith(terms[1] + '-')) good.push(m[1]);
    else if (m[2].startsWith('skip-')) skip.push(m[1]);
  }
  const testing = await git(cwd, ['rev-parse', '--verify', '-q', 'HEAD']).then((s) => s.trim() || null, () => null);
  let left: number | null = null;
  let steps: number | null = null;
  let firstBad: string | null = null;
  let onlySkipped: number | null = null;
  if (bad && good.length) {
    // Candidates: reachable from bad, not from any good commit (bad itself included).
    const cand = (await git(cwd, ['rev-list', bad, '--not', ...good])).split('\n').filter(Boolean);
    const skipped = new Set(skip);
    const untested = cand.filter((s) => s !== bad && !skipped.has(s)).length;
    if (cand.length <= 1) firstBad = bad;
    else if (untested === 0) onlySkipped = cand.length;
    else {
      left = untested;
      steps = Math.max(1, Math.ceil(Math.log2(untested + 1)));
    }
  }
  const subject = (sha: string | null) => (sha ? git(cwd, ['show', '-s', '--format=%s', sha]).then((s) => s.trim(), () => null) : Promise.resolve(null));
  const [testingSubject, firstBadSubject] = await Promise.all([subject(testing), subject(firstBad)]);
  return { terms, start: startRaw || null, bad, good, skip, testing, testingSubject, left, steps, firstBad, firstBadSubject, onlySkipped };
}

export type BisectMark = 'bad' | 'good' | 'skip';

/** `git bisect` arguments that mark `sha` (HEAD when omitted), in the session's own terms. */
export function markArgs(terms: [string, string], mark: BisectMark, sha?: string): string[] {
  const word = mark === 'bad' ? terms[0] : mark === 'good' ? terms[1] : 'skip';
  return ['bisect', word, ...(sha ? [sha] : [])];
}

/** Shell-quote one argument for a POSIX shell (the terminal running `git bisect run`). */
export function shQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The terminal line that runs `cmd` for every bisect step. git quotes the arguments of
 * `git bisect run` before handing them to its shell, so a command with `&&`, pipes or
 * redirections has to go through `sh -c` itself. Windows (PowerShell, cmd) gets double quotes;
 * Git for Windows runs the step with its own sh.
 */
export function bisectRunLine(cmd: string, windows = false): string {
  return `git bisect run sh -c ${windows ? `"${cmd.replace(/"/g, '\\"')}"` : shQuote(cmd)}`;
}
