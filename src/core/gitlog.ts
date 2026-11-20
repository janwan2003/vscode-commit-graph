// Run git and parse its output. No VS Code dependency.
import { execFile } from 'node:child_process';

export interface Commit {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  date: number; // author time, unix seconds
  subject: string;
  kind?: 'commit' | 'stash' | 'uncommitted';
  stashRef?: string; // stash@{0}
}

export type RefType = 'head' | 'remote' | 'tag' | 'stash';
export interface Ref {
  name: string; // short name: main, origin/main, v1.0
  full: string; // refs/heads/main
  type: RefType;
  sha: string; // target commit (tags peeled)
  remote?: string;
  /** Local branches only: the branch it tracks (origin/main), and how far apart they are. */
  upstream?: string;
  ahead?: number;
  behind?: number;
  /** The upstream branch was deleted on the remote (`git branch -vv` shows "gone"). */
  gone?: boolean;
}

export interface RepoState {
  head: string | null; // sha
  branch: string | null; // current branch short name, null if detached
  refs: Ref[];
}

export interface FileChange {
  status: string; // A M D R C T U
  path: string;
  oldPath?: string;
  additions: number | null; // null for binary
  deletions: number | null;
}

export class GitError extends Error {
  constructor(message: string, public stderr: string, public args: string[], public stdout = '') {
    super(message);
  }
}

export function git(cwd: string, args: string[], opts: { maxBuffer?: number; input?: string; env?: Record<string, string>; timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      { cwd, maxBuffer: opts.maxBuffer ?? 256 * 1024 * 1024, timeout: opts.timeout ?? 0, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...opts.env } },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || err.message).trim();
          reject(new GitError(msg, stderr, args, stdout));
        } else resolve(stdout);
      },
    );
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
}

const US = '\x1f';
const RS = '\x1e';
const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%s'].join('%x1f') + '%x1e';

export function parseLog(out: string): Commit[] {
  const commits: Commit[] = [];
  for (let rec of out.split(RS)) {
    rec = rec.replace(/^\n+/, '');
    if (!rec) continue;
    const f = rec.split(US);
    if (f.length < 6) continue;
    commits.push({
      sha: f[0],
      parents: f[1] ? f[1].split(' ') : [],
      author: f[2],
      email: f[3],
      date: Number(f[4]) || 0,
      subject: f.slice(5).join(US),
      kind: 'commit',
    });
  }
  return commits;
}

export interface LogOptions {
  max: number;
  branches?: string[]; // empty/undefined = all
  remotes?: boolean;
  extraRevs?: string[];
  /** Commit order: date (default), topo (keeps each branch's commits together) or author-date. */
  order?: CommitOrder;
  /** Only commits that touch these paths (file history). Parents are rewritten to the nearest touching ancestor. */
  paths?: string[];
  /** Follow only the first parent of merges (`--first-parent`): each branch's mainline, merges as one commit. */
  firstParent?: boolean;
}

export type CommitOrder = 'date' | 'topo' | 'author-date';

/** git log arguments for the revisions, order and paths in `o` (no format or count). */
function logArgs(o: LogOptions, extra: string[]): string[] {
  const order = o.order === 'topo' ? '--topo-order' : o.order === 'author-date' ? '--author-date-order' : '--date-order';
  const args = ['-c', 'log.showSignature=false', 'log', order, '--no-color', ...extra];
  // With a pathspec, --parents turns on parent rewriting so %P names the nearest
  // ancestor that touched the path and the graph stays connected.
  if (o.paths && o.paths.length) args.push('--parents');
  if (o.firstParent) args.push('--first-parent');
  if (o.branches && o.branches.length) args.push(...o.branches);
  else {
    args.push('--branches', '--tags');
    if (o.remotes !== false) args.push('--remotes');
    args.push('HEAD');
  }
  if (o.extraRevs) args.push(...o.extraRevs);
  args.push('--');
  if (o.paths) args.push(...o.paths.map((p) => ':(literal)' + p));
  return args;
}

const EMPTY_REPO = /unknown revision|bad revision|bad default revision|does not have any commits/;

/** Keep only first parents (first-parent view: a merge's other parents are not walked, so not drawn). */
export function firstParents(commits: Commit[]): Commit[] {
  return commits.map((c) => (c.parents.length > 1 ? { ...c, parents: c.parents.slice(0, 1) } : c));
}

export async function readLog(cwd: string, o: LogOptions): Promise<Commit[]> {
  try {
    const commits = parseLog(await git(cwd, logArgs(o, [`--max-count=${o.max}`, `--format=${LOG_FORMAT}`])));
    return o.firstParent ? firstParents(commits) : commits;
  } catch (e) {
    // Empty repository: HEAD does not resolve.
    if (e instanceof GitError && EMPTY_REPO.test(e.message)) return [];
    throw e;
  }
}

export interface FileHistory {
  commits: Commit[];
  /** Every name the file had (newest first); one entry when it was never renamed. */
  names: string[];
  /** Commits read before filtering; more than the caller's page size means there are more. */
  raw: number;
}

/**
 * History of one file across renames. `git log --follow` finds the file's earlier
 * names and the commits that touched it; the graph comes from a log limited to all
 * those names (so parents are rewritten and lanes stay connected), keeping only the
 * commits `--follow` found. That drops unrelated files that later reused an old
 * name. Parents that point at a dropped commit are replaced by its own parents.
 */
export async function readFileHistory(cwd: string, o: LogOptions, file: string): Promise<FileHistory> {
  const follow = { ...o, paths: [file] };
  let namesOut = '';
  let shasOut = '';
  try {
    [namesOut, shasOut] = await Promise.all([
      git(cwd, logArgs(follow, ['--follow', '-M', '--format=', '--name-only', '-z'])),
      git(cwd, logArgs(follow, ['--follow', '-M', '--format=%H'])),
    ]);
  } catch (e) {
    if (!(e instanceof GitError && EMPTY_REPO.test(e.message))) throw e;
  }
  const names = [file];
  for (const n of namesOut.split('\0')) {
    const t = n.replace(/^\n+/, '');
    if (t && !names.includes(t)) names.push(t);
  }
  if (names.length === 1) {
    const commits = await readLog(cwd, follow);
    return { commits, names, raw: commits.length };
  }
  const keep = new Set(shasOut.split('\n').filter(Boolean));
  const all = await readLog(cwd, { ...o, paths: names });
  const bySha = new Map(all.map((c) => [c.sha, c]));
  const resolve = (sha: string, seen: Set<string>, out: string[]) => {
    if (seen.has(sha)) return;
    seen.add(sha);
    const c = bySha.get(sha);
    if (keep.has(sha) || !c) {
      if (!out.includes(sha)) out.push(sha); // kept, or not loaded yet (beyond this page)
      return;
    }
    for (const p of c.parents) resolve(p, seen, out);
  };
  const commits: Commit[] = [];
  for (const c of all) {
    if (!keep.has(c.sha)) continue;
    const parents: string[] = [];
    const seen = new Set<string>();
    for (const p of c.parents) resolve(p, seen, parents);
    commits.push({ ...c, parents });
  }
  return { commits, names, raw: all.length };
}

export interface HistoryMatch {
  sha: string;
  /** Position in the full log for the same options (0 = first row), so the caller knows how much to load. */
  index: number;
}

/**
 * Find commits anywhere in the history shown by `o`, not just the loaded page: message
 * (`--grep`), author name or email (`--author`), hash prefix, and ref names in `refs`.
 * Case-insensitive, fixed string. Returns at most `limit` matches in graph order.
 */
export async function searchLog(cwd: string, o: LogOptions, query: string, refs: Ref[] = [], limit = 2000): Promise<{ matches: HistoryMatch[]; total: number }> {
  const q = query.trim();
  if (!q) return { matches: [], total: 0 };
  const run = (extra: string[]) => git(cwd, logArgs(o, ['--format=%H', ...extra])).catch((e) => {
    if (e instanceof GitError && EMPTY_REPO.test(e.message)) return '';
    throw e;
  });
  const hit = new Set<string>();
  const pq = pathQuery(q);
  let all: string;
  let hex = false;
  const lq = q.toLowerCase();
  if (pq !== null) {
    // "path:<text>": commits that changed a matching file or folder. The path search ignores the
    // file-history filter; intersecting with `all` (which keeps it) gives both.
    if (!pq) return { matches: [], total: 0 };
    const specs = pathSpecs(pq);
    const touched = git(cwd, [...logArgs({ ...o, paths: undefined }, ['--format=%H']), ...specs]).catch((e) => {
      if (e instanceof GitError && EMPTY_REPO.test(e.message)) return '';
      throw e;
    });
    const [a, t] = await Promise.all([run([]), touched]);
    all = a;
    for (const h of t.split('\n')) if (h) hit.add(h);
  } else {
    const [a, msg, author] = await Promise.all([run([]), run(['-i', '-F', `--grep=${q}`]), run(['-i', '-F', `--author=${q}`])]);
    all = a;
    for (const out of [msg, author]) for (const h of out.split('\n')) if (h) hit.add(h);
    for (const r of refs) if (r.name.toLowerCase().includes(lq)) hit.add(r.sha);
    hex = /^[0-9a-f]{4,40}$/.test(lq);
  }
  const matches: HistoryMatch[] = [];
  let total = 0;
  let index = 0;
  for (const h of all.split('\n')) {
    if (!h) continue;
    if (hit.has(h) || (hex && h.startsWith(lq))) {
      total++;
      if (matches.length < limit) matches.push({ sha: h, index });
    }
    index++;
  }
  return { matches, total };
}

/** The text after a leading "path:" in a find query (trimmed, "./" and "/" stripped), or null when the query is not a path search. */
export function pathQuery(q: string): string | null {
  const m = /^path:\s*(.*)$/i.exec(q.trim());
  if (!m) return null;
  return m[1].trim().replace(/^(\.\/|\/)+/, '');
}

/**
 * Pathspecs (from the repository root, case-insensitive) for a path search. With a glob
 * character (* ? [) the text is a glob, matched at the top and in any folder. Otherwise it
 * matches the exact path or folder, and any file or folder whose path contains the text.
 */
export function pathSpecs(p: string): string[] {
  if (/[*?[]/.test(p)) return [`:(top,icase,glob)${p}`, `:(top,icase,glob)**/${p}`, `:(top,icase,glob)**/${p}/**`];
  return [`:(top,icase,literal)${p}`, `:(top,icase,glob)**/*${p}*`, `:(top,icase,glob)**/*${p}*/**`];
}

export interface TagInfo {
  name: string;
  /** False for a lightweight tag (no tagger or message). */
  annotated: boolean;
  tagger?: string;
  email?: string;
  date?: number;
  message?: string;
}

/** Tags that point at `sha` (annotated tags peeled), with the tagger and message of annotated ones. */
export async function readTags(cwd: string, sha: string): Promise<TagInfo[]> {
  const out = await git(cwd, ['for-each-ref', `--points-at=${sha}`, '--sort=-creatordate', `--format=%(refname:short)${US}%(objecttype)${US}%(taggername)${US}%(taggeremail)${US}%(taggerdate:unix)${US}%(contents:subject)${US}%(contents:body)${RS}`, 'refs/tags']);
  return parseTags(out);
}

export function parseTags(out: string): TagInfo[] {
  const tags: TagInfo[] = [];
  for (const rec of out.split(RS)) {
    const r = rec.replace(/^\n/, '');
    if (!r) continue;
    const [name, type, tagger, email, date, subject, ...body] = r.split(US);
    // contents:subject/body leave out a signed tag's signature block.
    const b = body.join(US).replace(/\s+$/, '');
    if (type === 'tag') tags.push({ name, annotated: true, tagger, email: email.replace(/^<|>$/g, ''), date: Number(date) || undefined, message: (subject ?? '') + (b ? '\n\n' + b : '') });
    else tags.push({ name, annotated: false });
  }
  return tags;
}

export function parseRefs(out: string): Ref[] {
  const refs: Ref[] = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [obj, full, peeled, upstream, track] = line.split(US);
    const sha = peeled || obj;
    if (full.startsWith('refs/heads/')) {
      const r: Ref = { name: full.slice(11), full, type: 'head', sha };
      if (upstream) {
        r.upstream = upstream;
        // %(upstream:track,nobracket): "", "ahead 2", "behind 1", "ahead 2, behind 1" or "gone".
        const t = track ?? '';
        if (t === 'gone') r.gone = true;
        else {
          r.ahead = Number(/ahead (\d+)/.exec(t)?.[1] ?? 0);
          r.behind = Number(/behind (\d+)/.exec(t)?.[1] ?? 0);
        }
      }
      refs.push(r);
    }
    else if (full.startsWith('refs/remotes/')) {
      const name = full.slice(13);
      if (name.endsWith('/HEAD')) continue;
      refs.push({ name, full, type: 'remote', sha, remote: name.split('/')[0] });
    } else if (full.startsWith('refs/tags/')) refs.push({ name: full.slice(10), full, type: 'tag', sha });
  }
  return refs;
}

export async function readState(cwd: string): Promise<RepoState> {
  const refsOut = await git(cwd, ['for-each-ref', `--format=%(objectname)${US}%(refname)${US}%(*objectname)${US}%(upstream:short)${US}%(upstream:track,nobracket)`, 'refs/heads', 'refs/remotes', 'refs/tags']);
  let head: string | null = null;
  let branch: string | null = null;
  try {
    head = (await git(cwd, ['rev-parse', '--verify', '-q', 'HEAD'])).trim() || null;
  } catch {
    head = null;
  }
  try {
    const sym = (await git(cwd, ['symbolic-ref', '-q', 'HEAD'])).trim();
    branch = sym.startsWith('refs/heads/') ? sym.slice(11) : null;
  } catch {
    branch = null;
  }
  return { head, branch, refs: parseRefs(refsOut) };
}

/** Stashes as graph rows: each hangs off its base commit (first parent only). */
export async function readStashes(cwd: string): Promise<Commit[]> {
  let out: string;
  try {
    out = await git(cwd, ['stash', 'list', `--format=%H${US}%P${US}%an${US}%ae${US}%at${US}%gd${US}%s${RS}`]);
  } catch {
    return [];
  }
  const res: Commit[] = [];
  for (let rec of out.split(RS)) {
    rec = rec.replace(/^\n+/, '');
    if (!rec) continue;
    const f = rec.split(US);
    if (f.length < 7) continue;
    res.push({ sha: f[0], parents: f[1] ? [f[1].split(' ')[0]] : [], author: f[2], email: f[3], date: Number(f[4]) || 0, stashRef: f[5], subject: f.slice(6).join(US), kind: 'stash' });
  }
  return res;
}

/** Insert stash rows directly above their base commit (when it is loaded). */
export function insertStashes(commits: Commit[], stashes: Commit[]): Commit[] {
  if (!stashes.length) return commits;
  const byParent = new Map<string, Commit[]>();
  for (const s of stashes) {
    const p = s.parents[0];
    if (!p) continue;
    (byParent.get(p) ?? byParent.set(p, []).get(p)!).push(s);
  }
  const out: Commit[] = [];
  for (const c of commits) {
    const s = byParent.get(c.sha);
    if (s) out.push(...s);
    out.push(c);
  }
  return out;
}

export async function readStatusCount(cwd: string): Promise<number> {
  try {
    const out = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    return countStatus(out);
  } catch {
    return 0;
  }
}

/** Count entries in `git status --porcelain=v1 -z` output (renames carry an extra path). */
export function countStatus(out: string): number {
  const parts = out.split('\0');
  let n = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length < 4) continue;
    n++;
    if (p[0] === 'R' || p[0] === 'C') i++;
  }
  return n;
}

/** Parse `--numstat -z` combined with `--name-status -z` output. */
export function parseNameStatus(out: string): { status: string; path: string; oldPath?: string }[] {
  const parts = out.split('\0');
  const res: { status: string; path: string; oldPath?: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const st = parts[i];
    if (!st) continue;
    const code = st[0];
    if (code === 'R' || code === 'C') {
      res.push({ status: code, oldPath: parts[i + 1], path: parts[i + 2] });
      i += 2;
    } else {
      res.push({ status: code, path: parts[i + 1] });
      i += 1;
    }
  }
  return res;
}

export function parseNumstat(out: string): Map<string, [number | null, number | null]> {
  const m = new Map<string, [number | null, number | null]>();
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const t = p.split('\t');
    if (t.length < 3) continue;
    const a = t[0] === '-' ? null : Number(t[0]);
    const d = t[1] === '-' ? null : Number(t[1]);
    if (t[2] === '') {
      // rename: next two fields are old and new path
      m.set(parts[i + 2], [a, d]);
      i += 2;
    } else m.set(t[2], [a, d]);
  }
  return m;
}

/**
 * Files changed between `from` and `to`. `to` may be null for the working tree.
 * `from` may be null for a root commit (compared with the empty tree).
 */
export async function readChanges(cwd: string, from: string | null, to: string | null): Promise<FileChange[]> {
  const EMPTY = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const base = ['-c', 'core.quotepath=false', 'diff', '--no-color', '-M', '-z'];
  const range = to ? [from ?? EMPTY, to] : [from ?? EMPTY];
  const [ns, num] = await Promise.all([git(cwd, [...base, '--name-status', ...range, '--']), git(cwd, [...base, '--numstat', ...range, '--'])]);
  const stats = parseNumstat(num);
  const files: FileChange[] = parseNameStatus(ns).map((f) => {
    const s = stats.get(f.path);
    return { ...f, additions: s ? s[0] : null, deletions: s ? s[1] : null };
  });
  if (!to) {
    // Untracked files are not in `git diff`.
    const un = await git(cwd, ['-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard', '-z']);
    for (const p of un.split('\0')) if (p) files.push({ status: 'U', path: p, additions: null, deletions: null });
  }
  return files;
}

export interface CommitInfo {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  authorDate: number;
  committer: string;
  committerEmail: string;
  commitDate: number;
  message: string;
}

export async function readCommitInfo(cwd: string, sha: string): Promise<CommitInfo> {
  const out = await git(cwd, ['show', '-s', '--no-color', `--format=%H${US}%P${US}%an${US}%ae${US}%at${US}%cn${US}%ce${US}%ct${US}%B`, sha, '--']);
  const f = out.split(US);
  return {
    sha: f[0],
    parents: f[1] ? f[1].split(' ') : [],
    author: f[2],
    email: f[3],
    authorDate: Number(f[4]),
    committer: f[5],
    committerEmail: f[6],
    commitDate: Number(f[7]),
    message: f.slice(8).join(US).replace(/\s+$/, ''),
  };
}

export type SignatureStatus = 'good' | 'bad' | 'untrusted' | 'expired' | 'expiredKey' | 'revoked' | 'unchecked';

export interface Signature {
  status: SignatureStatus;
  signer: string; // %GS: the signer's name/identity, may be empty
  key: string; // %GK: key ID or SSH key fingerprint, may be empty
}

const SIG_CODES: Record<string, SignatureStatus> = { G: 'good', B: 'bad', U: 'untrusted', X: 'expired', Y: 'expiredKey', R: 'revoked', E: 'unchecked' };

/** Parse `%G?%x1f%GS%x1f%GK`. Null when the commit is not signed (N) or the output is unexpected. */
export function parseSignature(out: string): Signature | null {
  const [code, signer = '', key = ''] = out.replace(/\s+$/, '').split(US);
  const status = SIG_CODES[(code ?? '').trim()];
  return status ? { status, signer: signer.trim(), key: key.trim() } : null;
}

/**
 * GPG, SSH or X.509 signature of a commit, verified by git with the user's own keyring and
 * gpg.ssh.allowedSignersFile. Unsigned commits return null without running gpg. A missing gpg,
 * or a verify that fails to run, gives 'unchecked' or null; it never throws.
 */
export async function readSignature(cwd: string, sha: string): Promise<Signature | null> {
  try {
    const sig = parseSignature(await git(cwd, ['-c', 'log.showSignature=false', 'show', '-s', '--no-color', `--format=%G?${US}%GS${US}%GK`, sha, '--'], { timeout: 10000 }));
    if (sig) return sig;
    // git answers N for an SSH-signed commit when gpg.ssh.allowedSignersFile is not set up:
    // the commit is signed, git just cannot say by whom. Look for the signature header itself.
    const raw = await git(cwd, ['cat-file', 'commit', sha]);
    const headers = raw.slice(0, raw.indexOf('\n\n') >>> 0);
    return /^gpgsig(-sha256)? /m.test(headers) ? { status: 'unchecked', signer: '', key: '' } : null;
  } catch {
    return null;
  }
}

export interface Worktree {
  path: string;
  head: string | null; // checked-out commit, null for a bare entry or an unborn branch
  branch: string | null; // short branch name, null when detached
  main: boolean; // the first entry: the main working tree (or the bare repository)
  bare?: boolean;
  locked?: boolean;
  prunable?: boolean; // its directory is gone; `git worktree prune` removes it
}

/** Parse `git worktree list --porcelain -z`: attribute lines are NUL-terminated, entries end in an extra NUL. */
export function parseWorktrees(out: string): Worktree[] {
  const list: Worktree[] = [];
  let cur: Worktree | null = null;
  for (const line of out.split(/\0|\n/)) {
    if (!line) {
      cur = null;
      continue;
    }
    const sp = line.indexOf(' ');
    const key = sp < 0 ? line : line.slice(0, sp);
    const val = sp < 0 ? '' : line.slice(sp + 1);
    if (key === 'worktree') {
      cur = { path: val, head: null, branch: null, main: list.length === 0 };
      list.push(cur);
    } else if (!cur) continue;
    else if (key === 'HEAD') cur.head = /^0+$/.test(val) ? null : val;
    else if (key === 'branch') cur.branch = val.startsWith('refs/heads/') ? val.slice(11) : val;
    else if (key === 'bare') cur.bare = true;
    else if (key === 'locked') cur.locked = true;
    else if (key === 'prunable') cur.prunable = true;
  }
  return list;
}

export async function readWorktrees(cwd: string): Promise<Worktree[]> {
  try {
    return parseWorktrees(await git(cwd, ['worktree', 'list', '--porcelain', '-z']));
  } catch {
    try {
      // git < 2.36 has no -z.
      return parseWorktrees(await git(cwd, ['worktree', 'list', '--porcelain']));
    } catch {
      return [];
    }
  }
}

/** The best common ancestor of two commits, or null when they share no history. */
export async function mergeBase(cwd: string, a: string, b: string): Promise<string | null> {
  try {
    return (await git(cwd, ['merge-base', a, b])).trim() || null;
  } catch {
    return null;
  }
}
