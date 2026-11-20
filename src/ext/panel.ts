// The graph webview panel: loads data for the selected repository and answers the
// webview's requests (details, diffs, actions).
import * as vscode from 'vscode';
import * as path from 'node:path';
import { readLog, readFileHistory, searchLog, readState, readStashes, insertStashes, readStatusCount, readChanges, readCommitInfo, readWorktrees, mergeBase, Commit, RepoState, CommitOrder, Worktree } from '../core/gitlog';
import * as fs from 'node:fs';
import { layout } from '../core/graph';
import { Repos, RepoInfo } from './repos';
import { runAction, ActionMsg } from './actions';
import { gitUri } from './content';
import { readOperation, OpState } from '../core/progress';
import { webRepo, commitUrl, issueUrl, branchUrl, Forge } from '../core/remote';
import { git } from '../core/gitlog';

const FORGE_NAME: Record<Forge, string> = { github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket' };

export const UNCOMMITTED = '*';

export class GraphPanel implements vscode.Disposable {
  static current: GraphPanel | undefined;
  private panel: vscode.WebviewPanel;
  private repo: string | undefined;
  private max: number;
  /** path: repo-relative, '/'-separated path for file history, or null for the whole repo. */
  private filter: { branch: string | null; remotes: boolean; path: string | null };
  private subs: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private lastSig = '';
  private loading = false;
  private again = false;
  /** Last data posted to the webview (tests read it). */
  lastPong: any;
  lastDetails: any;
  lastHistory: any;
  lastData: { repo: string; commits: Commit[]; state: RepoState; width: number; uncommitted: number; names: string[]; web: unknown; worktrees: Worktree[]; op: OpState | null } | undefined;

  static show(ctx: vscode.ExtensionContext, repos: Repos, root?: string): GraphPanel {
    if (GraphPanel.current) {
      GraphPanel.current.panel.reveal();
      if (root && root !== GraphPanel.current.repo) GraphPanel.current.setRepo(root);
      return GraphPanel.current;
    }
    GraphPanel.current = new GraphPanel(ctx, repos, root);
    return GraphPanel.current;
  }

  private constructor(private ctx: vscode.ExtensionContext, private repos: Repos, root?: string) {
    const cfg = vscode.workspace.getConfiguration('mergeline');
    this.max = cfg.get<number>('initialCommits', 500);
    this.filter = { branch: null, remotes: cfg.get<boolean>('showRemoteBranches', true), path: null };
    this.repo = root ?? ctx.workspaceState.get<string>('mergeline.repo');
    this.panel = vscode.window.createWebviewPanel('mergeline.graph', 'Mergeline', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media')],
    });
    this.panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'tab.svg');
    this.panel.webview.html = this.html();
    vscode.commands.executeCommand('setContext', 'mergeline.panelOpen', true);
    this.subs.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m)),
      this.repos.onDidChange((root) => {
        if (!root) this.postRepos();
        if (!root || root === this.repo) this.scheduleRefresh();
      }),
      this.panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.visible) this.scheduleRefresh(50);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('mergeline')) {
          if (e.affectsConfiguration('mergeline.initialCommits')) this.max = vscode.workspace.getConfiguration('mergeline').get<number>('initialCommits', 500);
          this.postSettings();
          this.refresh(true);
        }
      }),
    );
  }

  private html(): string {
    const w = this.panel.webview;
    const media = (f: string) => w.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', f));
    const nonce = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${w.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${w.cspSource} data:; font-src ${w.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${media('graph.css')}"><title>Mergeline</title></head>
<body><div id="app"></div><script nonce="${nonce}" src="${media('rows.js')}"></script><script nonce="${nonce}" src="${media('graph.js')}"></script></body></html>`;
  }

  private post(m: any) {
    if (m?.type === 'details') this.lastDetails = m;
    if (m?.type === 'history') this.lastHistory = m;
    return this.panel.webview.postMessage(m);
  }

  private settings() {
    const cfg = vscode.workspace.getConfiguration('mergeline');
    return { dateFormat: cfg.get('dateFormat', 'relative'), commitOrder: cfg.get('commitOrder', 'date'), layout: this.ctx.globalState.get('mergeline.layout') ?? null };
  }
  private postSettings() {
    this.post({ type: 'settings', settings: this.settings() });
  }

  private postRepos() {
    const list = this.repos.list();
    if (!this.repo || !list.some((r) => r.root === this.repo)) this.repo = list[0]?.root;
    this.post({ type: 'repos', repos: list.map((r) => ({ root: r.root, name: r.name })), repo: this.repo });
  }

  private info(): RepoInfo | undefined {
    return this.repos.list().find((r) => r.root === this.repo);
  }

  setRepo(root: string) {
    this.repo = root;
    this.ctx.workspaceState.update('mergeline.repo', root);
    this.filter.branch = null;
    this.filter.path = null;
    this.max = vscode.workspace.getConfiguration('mergeline').get<number>('initialCommits', 500);
    this.postRepos();
    this.refresh(true);
  }

  /** Show only the commits that touched `rel` (repo-relative path) in repository `root`. */
  showFileHistory(root: string, rel: string) {
    if (root !== this.repo) {
      this.repo = root;
      this.ctx.workspaceState.update('mergeline.repo', root);
      this.filter.branch = null;
      this.postRepos();
    }
    this.filter.path = rel.split(path.sep).join('/');
    this.max = vscode.workspace.getConfiguration('mergeline').get<number>('initialCommits', 500);
    return this.refresh(true);
  }

  scheduleRefresh(ms = 400) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.panel.visible) this.refresh(false);
    }, ms);
  }

  async refresh(force: boolean): Promise<void> {
    if (this.loading) {
      this.again = true;
      return;
    }
    this.loading = true;
    try {
      await this.load(force);
    } catch (e) {
      this.post({ type: 'error', message: String((e as Error)?.message ?? e) });
    } finally {
      this.loading = false;
      if (this.again) {
        this.again = false;
        this.refresh(true);
      }
    }
  }

  private async load(force: boolean) {
    const root = this.repo;
    if (!root) {
      this.post({ type: 'empty', message: 'No git repository found in this workspace. Open a folder that contains a git repository, or run "git init".' });
      return;
    }
    const cfg = vscode.workspace.getConfiguration('mergeline');
    // File history shows commits only: stashes and the working tree are not path-filtered.
    const fileMode = !!this.filter.path;
    const showStash = cfg.get<boolean>('showStashes', true) && !fileMode;
    const showUnc = cfg.get<boolean>('showUncommitted', true) && !fileMode;
    const order = cfg.get<CommitOrder>('commitOrder', 'date');
    const opts = this.logOptions(order);
    let names: string[] = [];
    let raw = 0;
    const [commits0, state, stashes, unc, wts, op] = await Promise.all([
      fileMode
        ? readFileHistory(root, { ...opts, max: this.max + 1 }, this.filter.path!).then((h) => {
            names = h.names;
            raw = h.raw;
            return h.commits;
          })
        : readLog(root, { ...opts, max: this.max + 1 }).then((c) => ((raw = c.length), c)),
      readState(root),
      showStash ? readStashes(root) : Promise.resolve([]),
      showUnc ? readStatusCount(root) : Promise.resolve(0),
      readWorktrees(root),
      readOperation(root).catch((): OpState | null => null),
    ]);
    // Other working trees of this repository (git worktree), shown as badges on the commit each has checked out.
    const real = (p: string) => {
      try {
        return fs.realpathSync(p);
      } catch {
        return path.resolve(p);
      }
    };
    const here = real(root);
    const worktrees = wts.length > 1 ? wts.map((w) => ({ ...w, current: real(w.path) === here })) : [];
    const web = await this.webInfo(root, state.branch);
    const hasMore = raw > this.max;
    let commits = hasMore ? commits0.slice(0, this.max) : commits0;
    commits = insertStashes(commits, stashes);
    if (unc > 0 && state.head && commits.some((c) => c.sha === state.head)) {
      commits = [{ sha: UNCOMMITTED, parents: [state.head], author: '', email: '', date: Math.floor(Date.now() / 1000), subject: `Uncommitted changes (${unc})`, kind: 'uncommitted' }, ...commits];
    }
    const sig = JSON.stringify([root, state, unc, this.filter, order, this.max, worktrees, op, commits.map((c) => c.sha)]);
    if (!force && sig === this.lastSig) return;
    this.lastSig = sig;
    const lay = layout(commits);
    this.lastData = { repo: root, commits, state, width: lay.width, uncommitted: unc, names, web, worktrees, op };
    this.post({
      type: 'data',
      repo: root,
      commits,
      packed: lay.packed,
      start: lay.start,
      width: lay.width,
      refs: state.refs,
      head: state.head,
      branch: state.branch,
      hasMore,
      filter: this.filter,
      names,
      order,
      web,
      worktrees,
      op,
      branches: state.refs.filter((r) => r.type === 'head' || r.type === 'remote').map((r) => r.name),
    });
  }

  /**
   * Web links for the repository: the current branch's remote, else origin, else the first
   * remote whose URL is on a known forge. Null when there is none (no network is used).
   */
  private async webInfo(root: string, branch: string | null) {
    let out = '';
    try {
      out = await git(root, ['config', '--get-regexp', '^(remote\\..*\\.url|branch\\..*\\.remote)$']);
    } catch {
      return null; // no remotes: git config exits 1
    }
    const urls = new Map<string, string>();
    let upstream: string | undefined;
    for (const line of out.split('\n')) {
      const sp = line.indexOf(' ');
      if (sp < 0) continue;
      const key = line.slice(0, sp), val = line.slice(sp + 1).trim();
      if (key.startsWith('remote.') && key.endsWith('.url')) urls.set(key.slice(7, -4), val);
      else if (branch && key === `branch.${branch}.remote`) upstream = val;
    }
    const order = [upstream, 'origin', ...urls.keys()].filter((r): r is string => !!r && urls.has(r));
    for (const remote of order) {
      const r = webRepo(urls.get(remote)!);
      if (r) return { remote, name: FORGE_NAME[r.forge], commit: commitUrl(r, ''), issue: issueUrl(r, ''), branch: branchUrl(r, '') };
    }
    return null;
  }

  private logOptions(order: CommitOrder) {
    return { max: this.max, branches: this.filter.branch ? [this.filter.branch] : undefined, remotes: this.filter.remotes, order };
  }

  /** Find box "All history": search every commit the graph could show, not just the loaded ones. */
  private async searchHistory(q: string) {
    const root = this.repo;
    if (!root) return;
    const order = vscode.workspace.getConfiguration('mergeline').get<CommitOrder>('commitOrder', 'date');
    const opts = { ...this.logOptions(order), paths: this.filter.path ? (this.lastData?.names.length ? this.lastData.names : [this.filter.path]) : undefined };
    try {
      const res = await searchLog(root, opts, q, this.lastData?.state.refs ?? []);
      this.post({ type: 'history', q, ...res });
    } catch (e) {
      this.post({ type: 'history', q, matches: [], total: 0, error: String((e as Error)?.message ?? e) });
    }
  }

  private async onMessage(m: any) {
    switch (m?.type) {
      case 'ready':
        this.postSettings();
        this.postRepos();
        await this.refresh(true);
        break;
      case 'pong':
        this.lastPong = m;
        break;
      case 'refresh':
        await this.refresh(true);
        break;
      case 'setRepo':
        this.setRepo(m.repo);
        break;
      case 'loadMore':
        this.max += vscode.workspace.getConfiguration('mergeline').get<number>('initialCommits', 500);
        await this.refresh(true);
        break;
      case 'searchHistory':
        await this.searchHistory(String(m.q ?? ''));
        break;
      case 'loadTo': {
        // Load enough pages to include row `index` (a history search match), then reveal it.
        const page = vscode.workspace.getConfiguration('mergeline').get<number>('initialCommits', 500);
        const want = Math.ceil((Number(m.index) + 1 + 50) / page) * page;
        if (want > this.max) {
          this.max = want;
          await this.refresh(true);
        }
        this.post({ type: 'reveal', sha: m.sha });
        break;
      }
      case 'filter':
        this.filter = { branch: m.branch || null, remotes: !!m.remotes, path: m.path === undefined ? this.filter.path : m.path || null };
        await this.refresh(true);
        break;
      case 'order':
        // Saved as a user setting; the configuration listener refreshes the graph.
        if (['date', 'topo', 'author-date'].includes(m.order)) await vscode.workspace.getConfiguration('mergeline').update('commitOrder', m.order, vscode.ConfigurationTarget.Global);
        break;
      case 'details':
        await this.details(m.sha, m.compare, !!m.base);
        break;
      case 'getMessage': {
        // Full message for the webview's "Edit commit message" editor.
        if (!this.repo || typeof m.sha !== 'string' || !/^[0-9a-f]{4,64}$/i.test(m.sha)) return;
        try {
          const message = (await git(this.repo, ['show', '-s', '--format=%B', m.sha])).replace(/\s+$/, '');
          this.post({ type: 'message', sha: m.sha, message });
        } catch (e) {
          vscode.window.showErrorMessage(`Mergeline: could not read the message: ${String((e as Error)?.message ?? e)}`);
        }
        break;
      }
      case 'openFile':
        await this.openFile(m);
        break;
      case 'fileAction':
        await this.fileAction(m);
        break;
      case 'layout':
        // Column widths, hidden columns and the details height, kept across sessions.
        await this.ctx.globalState.update('mergeline.layout', m.layout && typeof m.layout === 'object' ? m.layout : undefined);
        if (m.echo) this.postSettings();
        break;
      case 'copy':
        if (typeof m.text === 'string') await vscode.env.clipboard.writeText(m.text);
        break;
      case 'openUrl':
        if (typeof m.url === 'string' && /^https?:\/\//i.test(m.url)) await vscode.env.openExternal(vscode.Uri.parse(m.url, true));
        break;
      case 'action': {
        const info = this.info();
        if (!info) return;
        const changed = await runAction({ root: info.root, api: info.api }, { ...(m as ActionMsg), current: this.lastData?.state.branch ?? null });
        if (changed) await this.refresh(true);
        break;
      }
    }
  }

  /**
   * Details pane data. With `compare`, the changes between two commits (UNCOMMITTED = the
   * working tree); with `base` too, the changes on `sha` since it split from `compare`
   * (`git diff compare...sha`: what merging `sha` would bring in).
   */
  private async details(sha: string, compare?: string, base = false) {
    const root = this.repo;
    if (!root) return;
    try {
      if (compare && base && sha !== UNCOMMITTED && compare !== UNCOMMITTED) {
        const mb = await mergeBase(root, compare, sha);
        if (!mb) {
          this.post({ type: 'details', sha, compare, base: true, from: null, to: sha, files: [], error: 'These commits share no history.' });
          return;
        }
        const files = await readChanges(root, mb, sha);
        this.post({ type: 'details', sha, compare, base: true, mergeBase: mb, from: mb, to: sha, files });
        return;
      }
      if (compare) {
        // Older first. UNCOMMITTED means the working tree.
        const order = this.lastData?.commits.map((c) => c.sha) ?? [];
        let [from, to] = [sha, compare];
        if (order.indexOf(from) < order.indexOf(to)) [from, to] = [to, from];
        const files = await readChanges(root, from === UNCOMMITTED ? 'HEAD' : from, to === UNCOMMITTED ? null : to);
        this.post({ type: 'details', sha, compare, from, to: to === UNCOMMITTED ? null : to, files });
        return;
      }
      if (sha === UNCOMMITTED) {
        const files = await readChanges(root, 'HEAD', null);
        this.post({ type: 'details', sha, from: 'HEAD', to: null, files });
        return;
      }
      const info = await readCommitInfo(root, sha);
      const files = await readChanges(root, info.parents[0] ?? null, sha);
      this.post({ type: 'details', sha, info, from: info.parents[0] ?? null, to: sha, files });
    } catch (e) {
      this.post({ type: 'details', sha, error: String((e as Error)?.message ?? e), files: [] });
    }
  }

  private async openFile(m: { from: string | null; to: string | null; path: string; oldPath?: string; status: string }) {
    const root = this.repo!;
    const leftRef = m.status === 'A' || m.status === 'U' ? null : m.from;
    const left = gitUri(root, leftRef, m.oldPath ?? m.path);
    const right = m.status === 'D' ? gitUri(root, null, m.path) : m.to ? gitUri(root, m.to, m.path) : vscode.Uri.file(path.join(root, m.path));
    const s = (r: string | null) => (r ? (r.length === 40 ? r.slice(0, 8) : r) : 'working tree');
    const title = `${path.basename(m.path)} (${m.from ? s(m.from) : 'empty'} ↔ ${s(m.to)})`;
    await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true, preserveFocus: false });
  }

  /** Right-click menu on a file in the details pane. `ref` null means the working tree. */
  private async fileAction(m: { act: string; ref: string | null; path: string }) {
    const root = this.repo;
    if (!root || typeof m.path !== 'string') return;
    const abs = path.resolve(root, m.path);
    if (abs !== root && !abs.startsWith(root + path.sep)) return;
    const fileUri = vscode.Uri.file(abs);
    const exists = async () => {
      try {
        await vscode.workspace.fs.stat(fileUri);
        return true;
      } catch {
        vscode.window.showInformationMessage(`Mergeline: ${m.path} does not exist in the working tree.`);
        return false;
      }
    };
    const s = (r: string) => (r.length === 40 ? r.slice(0, 8) : r);
    switch (m.act) {
      case 'openWorking':
        if (await exists()) await vscode.window.showTextDocument(fileUri, { preview: true });
        break;
      case 'openAt':
        if (m.ref) await vscode.window.showTextDocument(gitUri(root, m.ref, m.path), { preview: true });
        break;
      case 'diffWorking':
        if (m.ref && (await exists())) await vscode.commands.executeCommand('vscode.diff', gitUri(root, m.ref, m.path), fileUri, `${path.basename(m.path)} (${s(m.ref)} ↔ working tree)`, { preview: true });
        break;
      case 'history':
        await this.showFileHistory(root, m.path);
        break;
      case 'copyPath':
        await vscode.env.clipboard.writeText(m.path);
        break;
      case 'copyAbs':
        await vscode.env.clipboard.writeText(abs);
        break;
      case 'reveal':
        if (await exists()) await vscode.commands.executeCommand('revealInExplorer', fileUri);
        break;
    }
  }

  /** Test hook: asks the webview to report what it rendered (answer lands in lastPong). */
  async ping(): Promise<boolean> {
    return this.post({ type: 'ping' });
  }

  dispose() {
    GraphPanel.current = undefined;
    vscode.commands.executeCommand('setContext', 'mergeline.panelOpen', false);
    if (this.timer) clearTimeout(this.timer);
    this.subs.forEach((s) => s.dispose());
    this.panel.dispose();
  }

  // Exposed for e2e tests.
  async testMessage(m: any) {
    await this.onMessage(m);
  }
  testPost(m: any) {
    return this.post(m);
  }
  get repoRoot() {
    return this.repo;
  }
}
