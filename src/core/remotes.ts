// Remotes of a repository: list them and say what removing or renaming one touches.
// No VS Code dependency; the dialogs are in src/ext/actions.ts.
import { git } from './gitlog';

export interface Remote {
  name: string;
  /** Fetch URL ('' when the remote has none). */
  fetch: string;
  /** Push URL; equal to fetch unless remote.<name>.pushurl is set. */
  push: string;
}

/** Parses `git remote -v`: "origin\thttps://… (fetch)" lines, in git's order. */
export function parseRemotes(text: string): Remote[] {
  const out = new Map<string, Remote>();
  for (const line of text.split('\n')) {
    const m = /^(\S+)\t(.*) \((fetch|push)\)$/.exec(line.replace(/\r$/, ''));
    if (!m) continue;
    const r = out.get(m[1]) ?? { name: m[1], fetch: '', push: '' };
    if (m[3] === 'fetch') r.fetch = m[2];
    else r.push = m[2];
    out.set(m[1], r);
  }
  for (const r of out.values()) if (!r.push) r.push = r.fetch;
  return [...out.values()];
}

export async function readRemotes(cwd: string): Promise<Remote[]> {
  const rs = parseRemotes(await git(cwd, ['remote', '-v']));
  // A remote with no URL yet (only remote.<name>.fetch set) is not listed by -v.
  const names = (await git(cwd, ['remote'])).split('\n').filter(Boolean);
  for (const n of names) if (!rs.some((r) => r.name === n)) rs.push({ name: n, fetch: '', push: '' });
  return rs;
}

/** Why `name` cannot be a new remote's name, or undefined when it can. */
export function remoteNameProblem(name: string, existing: string[]): string | undefined {
  const n = name.trim();
  if (!n) return 'Enter a name';
  if (existing.includes(n)) return `A remote named “${n}” already exists`;
  // git checks the name as part of refs/remotes/<name>/*.
  if (/[\s~^:?*[\\]|\.\.|@\{|^[-.]|[/.]$|\.lock(\/|$)|\/\/|\/\./.test(n)) return 'Not a valid remote name';
  return undefined;
}

/** What depends on a remote: its remote-tracking branches and the local branches whose upstream it is. */
export async function remoteUsage(cwd: string, name: string): Promise<{ tracking: string[]; upstreamOf: string[] }> {
  // Full names: the short name of refs/remotes/<name>/HEAD is just "<name>".
  const tracking = (await git(cwd, ['for-each-ref', '--format=%(refname)', `refs/remotes/${name}/`]))
    .split('\n')
    .filter(Boolean)
    .map((r) => r.slice('refs/remotes/'.length))
    .filter((r) => r !== `${name}/HEAD`);
  let cfg = '';
  try {
    cfg = await git(cwd, ['config', '--get-regexp', '^branch\\..*\\.remote$']);
  } catch {
    cfg = ''; // exit 1: no branch has an upstream
  }
  const upstreamOf: string[] = [];
  for (const line of cfg.split('\n')) {
    const sp = line.lastIndexOf(' ');
    if (sp < 0 || line.slice(sp + 1) !== name) continue;
    upstreamOf.push(line.slice('branch.'.length, sp - '.remote'.length));
  }
  return { tracking, upstreamOf };
}
