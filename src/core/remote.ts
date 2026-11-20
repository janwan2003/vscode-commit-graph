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

export interface IssueLinkRule {
  pattern: string;
  url: string;
}

/**
 * The valid entries of the `mergeline.issueLinks` setting: a regular expression that
 * compiles and an http(s) URL template ($0 = whole match, $1… = groups). Others are dropped,
 * with a reason for each, so a typo in settings.json does not break the details pane.
 */
export function issueLinkRules(raw: unknown): { rules: IssueLinkRule[]; problems: string[] } {
  const rules: IssueLinkRule[] = [];
  const problems: string[] = [];
  if (!Array.isArray(raw)) return { rules, problems: raw == null ? [] : ['mergeline.issueLinks must be an array'] };
  raw.forEach((r, i) => {
    const p = r && typeof r === 'object' ? (r as any).pattern : undefined;
    const u = r && typeof r === 'object' ? (r as any).url : undefined;
    if (typeof p !== 'string' || !p || typeof u !== 'string') return problems.push(`entry ${i + 1}: needs "pattern" and "url" strings`);
    if (!/^https?:\/\//i.test(u)) return problems.push(`entry ${i + 1}: url must start with http:// or https://`);
    try {
      if (new RegExp(p, 'g').test('')) return problems.push(`entry ${i + 1}: pattern matches empty text`);
    } catch (e) {
      return problems.push(`entry ${i + 1}: ${String((e as Error).message)}`);
    }
    rules.push({ pattern: p, url: u });
  });
  return { rules, problems };
}

/** The link for one match of a rule: $0 and $1…$9 replaced (each part URI-encoded). */
export function issueLinkUrl(template: string, m: string[]): string {
  return template.replace(/\$(\d)/g, (_, d) => encodeURIComponent(m[Number(d)] ?? ''));
}
