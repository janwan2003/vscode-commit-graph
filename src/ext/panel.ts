// The graph webview panel: loads data for the selected repository and answers the
// webview's requests (details, diffs, actions).
import * as vscode from 'vscode';
import * as path from 'node:path';
import { readLog, readState, readStashes, insertStashes, readStatusCount, readChanges, readCommitInfo, Commit, RepoState } from '../core/gitlog';
import { layout } from '../core/graph';
import { Repos, RepoInfo } from './repos';
import { runAction, ActionMsg } from './actions';
import { gitUri } from './content';

export const UNCOMMITTED = '*';

export class GraphPanel implements vscode.Disposable {
  static current: GraphPanel | undefined;
  private panel: vscode.WebviewPanel;
  private repo: string | undefined;
  private max: number;
  private filter: { branch: string | null; remotes: boolean };
  private subs: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private lastSig = '';
  private loading = false;
  private again = false;
  /** Last data posted to the webview (tests read it). */
  lastPong: any;
  lastDetails: any;
  lastData: { repo: string; commits: Commit[]; state: RepoState; width: number; uncommitted: number } | undefined;

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
    this.filter = { branch: null, remotes: cfg.get<boolean>('showRemoteBranches', true) };
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
<body><div id="app"></div><script nonce="${nonce}" src="${media('graph.js')}"></script></body></html>`;
  }

  private post(m: any) {
    if (m?.type === 'details') this.lastDetails = m;
    return this.panel.webview.postMessage(m);
  }

  private settings() {
    const cfg = vscode.workspace.getConfiguration('mergeline');
    return { dateFormat: cfg.get('dateFormat', 'relative') };
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
    this.max = vscode.workspace.getConfiguration('mergeline').get<number>('initialCommits', 500);
    this.postRepos();
    this.refresh(true);
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
    const showStash = cfg.get<boolean>('showStashes', true);
    const showUnc = cfg.get<boolean>('showUncommitted', true);
    const [commits0, state, stashes, unc] = await Promise.all([
      readLog(root, { max: this.max + 1, branches: this.filter.branch ? [this.filter.branch] : undefined, remotes: this.filter.remotes }),
      readState(root),
      showStash ? readStashes(root) : Promise.resolve([]),
      showUnc ? readStatusCount(root) : Promise.resolve(0),
    ]);
    const hasMore = commits0.length > this.max;
    let commits = hasMore ? commits0.slice(0, this.max) : commits0;
    commits = insertStashes(commits, stashes);
    if (unc > 0 && state.head && commits.some((c) => c.sha === state.head)) {
      commits = [{ sha: UNCOMMITTED, parents: [state.head], author: '', email: '', date: Math.floor(Date.now() / 1000), subject: `Uncommitted changes (${unc})`, kind: 'uncommitted' }, ...commits];
    }
    const sig = JSON.stringify([root, state, unc, this.filter, this.max, commits.map((c) => c.sha)]);
    if (!force && sig === this.lastSig) return;
    this.lastSig = sig;
    const lay = layout(commits);
    this.lastData = { repo: root, commits, state, width: lay.width, uncommitted: unc };
    this.post({
      type: 'data',
      repo: root,
      commits,
      rows: lay.rows,
      width: lay.width,
      refs: state.refs,
      head: state.head,
      branch: state.branch,
      hasMore,
      filter: this.filter,
      branches: state.refs.filter((r) => r.type === 'head' || r.type === 'remote').map((r) => r.name),
    });
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
      case 'filter':
        this.filter = { branch: m.branch || null, remotes: !!m.remotes };
        await this.refresh(true);
        break;
      case 'details':
        await this.details(m.sha, m.compare);
        break;
      case 'openFile':
        await this.openFile(m);
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

  private async details(sha: string, compare?: string) {
    const root = this.repo;
    if (!root) return;
    try {
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
  get repoRoot() {
    return this.repo;
  }
}
