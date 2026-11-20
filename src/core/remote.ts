// Web links for a repository hosted on a known forge. No network: only the remote URL is parsed.

export type Forge = 'github' | 'gitlab' | 'bitbucket';

export interface WebRepo {
  forge: Forge;
  /** https://host/owner/name, no trailing slash, no .git */
  base: string;
}

/**
 * Turns a remote URL (https, ssh://, scp-like git@host:owner/repo, with or without .git)
 * into the repository's web address. Returns null for local paths and unknown hosts.
 * Hosts are recognised by name: github.com, gitlab.com, bitbucket.org, plus any host
 * whose name contains "github" or "gitlab" (GitHub Enterprise, self-hosted GitLab).
 */
export function webRepo(url: string): WebRepo | null {
  const u = url.trim();
  let host: string;
  let path: string;
  let m: RegExpExecArray | null;
  if ((m = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(u))) [host, path] = [m[1], m[2]];
  else if ((m = /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/.exec(u)) && !/^[a-z]:$/i.test(m[1] + ':')) [host, path] = [m[1], m[2]];
  else return null;
  host = host.toLowerCase();
  path = path.replace(/\.git\/?$/, '').replace(/\/+$/, '');
  if (!path.includes('/') || path.includes('..')) return null;
  let forge: Forge | null = null;
  if (host === 'bitbucket.org') forge = 'bitbucket';
  else if (host.includes('github')) forge = 'github';
  else if (host.includes('gitlab')) forge = 'gitlab';
  if (!forge) return null;
  // ssh.github.com and altssh.gitlab.com serve the same repos as the bare hosts.
  host = host.replace(/^(?:ssh|altssh)\./, '');
  return { forge, base: `https://${host}/${path}` };
}

export function commitUrl(r: WebRepo, sha: string): string {
  if (r.forge === 'gitlab') return `${r.base}/-/commit/${sha}`;
  if (r.forge === 'bitbucket') return `${r.base}/commits/${sha}`;
  return `${r.base}/commit/${sha}`;
}

export function issueUrl(r: WebRepo, n: string): string {
  if (r.forge === 'gitlab') return `${r.base}/-/issues/${n}`;
  if (r.forge === 'bitbucket') return `${r.base}/issues/${n}`;
  return `${r.base}/issues/${n}`; // GitHub redirects to the pull request when n is one
}

export function branchUrl(r: WebRepo, branch: string): string {
  const b = branch.split('/').map(encodeURIComponent).join('/');
  if (r.forge === 'gitlab') return `${r.base}/-/tree/${b}`;
  if (r.forge === 'bitbucket') return `${r.base}/branch/${b}`;
  return `${r.base}/tree/${b}`;
}

/** The forge's "open a pull request" page for `branch` (GitLab: merge request). The forge picks the base branch. */
export function pullRequestUrl(r: WebRepo, branch: string): string {
  if (r.forge === 'gitlab') return `${r.base}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(branch)}`;
  if (r.forge === 'bitbucket') return `${r.base}/pull-requests/new?source=${encodeURIComponent(branch)}`;
  return `${r.base}/compare/${branch.split('/').map(encodeURIComponent).join('/')}?expand=1`;
}
