// The graph webview panel: loads data for the selected repository and answers the
// webview's requests (details, diffs, actions).
import * as vscode from 'vscode';
import * as path from 'node:path';
import { readLog, readFileHistory, searchLog, readState, readStashes, insertStashes, readStatusCount, readChanges, readCommitInfo, readWorktrees, readTags, readSignature, mergeBase, Commit, RepoState, CommitOrder, Worktree } from '../core/gitlog';
import * as fs from 'node:fs';
import { layout, LayoutState, newLayoutState, pinBranches, extendPins } from '../core/graph';
import { pinnedTips } from '../core/pins';
import { Repos, RepoInfo } from './repos';
import { runAction, ActionMsg } from './actions';
import { gitUri } from './content';
import { readOperation, OpState } from '../core/progress';
import { readBisect, BisectState } from '../core/bisect';
import { webRepo, commitUrl, issueUrl, branchUrl, pullRequestUrl, Forge, issueLinkRules } from '../core/remote';
import { avatarMap } from '../core/misc';
import { git } from '../core/gitlog';

const FORGE_NAME: Record<Forge, string> = { github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket' };

export const UNCOMMITTED = '*';

export class GraphPanel implements vscode.Disposable {
  static current: GraphPanel | undefined;
  private panel: vscode.WebviewPanel;
  private repo: string | undefined;
  private max: number;
  /** branches: show only these (empty = all). path: repo-relative, '/'-separated path for file history, or null for the whole repo. */
  private filter: { branches: string[]; remotes: boolean; path: string | null };
  private subs: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private lastSig = '';
  /** Everything but the commit list and page size, so load more can tell whether only commits were added. */
  private lastBase = '';
  /** Layout state after the last row sent, so load more lays out and sends only the new rows. */
  private layState: LayoutState | undefined;
  /** Rows sent by the last load (counted for the e2e: 'data' sends all, 'append' only new ones). */
  lastSent = { kind: '', rows: 0 };
  private loading = false;
  private again = false;
  /** Last data posted to the webview (tests read it). */
  lastPong: any;
  lastDetails: any;
  lastHistory: any;
  /** Last URL handed to the browser (tests read it; under test nothing is opened). */
  lastUrl: string | undefined;
  lastData: { repo: string; commits: Commit[]; state: RepoState; width: number; uncommitted: number; names: string[]; web: unknown; worktrees: Worktree[]; op: OpState | null; bisect: BisectState | null } | undefined;

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
    this.filter = { branches: [], remotes: cfg.get<boolean>('showRemoteBranches', true), path: null };
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${w.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${w.cspSource} data: https://avatars.githubusercontent.com https://www.gravatar.com; font-src ${w.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${media('graph.css')}"><title>Mergeline</title></head>
<body><div id="app"></div><script nonce="${nonce}" src="${media('rows.js')}"></script><script nonce="${nonce}" src="${media('graph.js')}"></script></body></html>`;
  }

  /**
   * Code review: which files of a diff were marked reviewed, per diff ("<from>..<to>", from
   * 'empty' for a root commit), kept in workspaceState. Only diffs between two commits; the
   * working tree changes as you edit, so it has none. Absent key = no review started.
   */
  private static REVIEWS = 'mergeline.reviews';
  private static MAX_REVIEWS = 200;
  static reviewKey(from: string | null, to: string | null): string | null {
    return to && to !== UNCOMMITTED && from !== UNCOMMITTED ? `${from ?? 'empty'}..${to}` : null;
  }
  reviews(): Record<string, { files: string[]; t: number }> {
    return this.ctx.workspaceState.get(GraphPanel.REVIEWS) ?? {};
  }
  private async saveReview(key: string, files: string[] | null) {
    const all = { ...this.reviews() };
    if (files === null) delete all[key];
    else all[key] = { files: [...new Set(files.filter((f) => typeof f === 'string'))], t: Date.now() };
    // Keep the most recently touched reviews only.
    const keys = Object.keys(all).sort((a, b) => all[b].t - all[a].t);
    for (const k of keys.slice(GraphPanel.MAX_REVIEWS)) delete all[k];
    await this.ctx.workspaceState.update(GraphPanel.REVIEWS, all);
  }

  private post(m: any) {
    if (m?.type === 'details') {
      const key = GraphPanel.reviewKey(m.from ?? null, m.to ?? null);
      if (key && !m.error) {
        m.reviewKey = key;
        m.reviewed = this.reviews()[key]?.files ?? null;
      }
      this.lastDetails = m;
    }
    if (m?.type === 'history') this.lastHistory = m;
    return this.panel.webview.postMessage(m);
  }

  /**
   * Adds a branch name to mergeline.pinnedBranches, or removes it, at the most specific level that
   * already sets it (folder, workspace), else in user settings, so a repository's .vscode/settings.json
   * is only written when the user put the setting there.
   */
  private async setPinned(name: string, on: boolean) {
    const cfg = vscode.workspace.getConfiguration('mergeline');
    const i = cfg.inspect<unknown>('pinnedBranches');
    const target = i?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder : i?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    const cur = cfg.get<unknown>('pinnedBranches', []);
    const list = (Array.isArray(cur) ? cur : []).filter((x): x is string => typeof x === 'string');
    const next = on ? (list.includes(name) ? list : [...list, name]) : list.filter((x) => x !== name);
    if (next.length === list.length && next.every((x, k) => x === list[k])) return;
    await cfg.update('pinnedBranches', next, target);
  }

  private settings() {
    const cfg = vscode.workspace.getConfiguration('mergeline');
    const links = issueLinkRules(cfg.get('issueLinks', []));
    const sig = links.problems.join('\n');
    if (sig && sig !== this.linkProblems) vscode.window.showWarningMessage(`Mergeline: some mergeline.issueLinks entries were skipped: ${links.problems.join('; ')}`);
    this.linkProblems = sig;
    return {
      dateFormat: cfg.get('dateFormat', 'relative'),
      commitOrder: cfg.get('commitOrder', 'date'),
      dimOtherCommits: cfg.get('dimOtherCommits', false),
      showAvatars: this.avatarsOn(),
      issueLinks: links.rules,
      layout: this.ctx.globalState.get('mergeline.layout') ?? null,
    };
  }
  private linkProblems = '';
  private avatarsOn() {
    return vscode.workspace.getConfiguration('mergeline').get<boolean>('showAvatars', false);
  }
  /** Avatar URLs for the authors of `commits`, only when the user turned avatars on. */
  private avatars(commits: { email: string }[]) {
    return this.avatarsOn() ? avatarMap(commits.map((c) => c.email)) : undefined;
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
    this.filter.branches = [];
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
      this.filter.branches = [];
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

  /** Resolves when no load is running and none is queued (so callers see fresh lastData). */
  private waiters: (() => void)[] = [];

  async refresh(force: boolean): Promise<void> {
    if (this.loading) {
      // A load is running; queue one more and resolve once that one has finished.
      this.again = true;
      return new Promise<void>((r) => this.waiters.push(r));
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
      } else {
        const w = this.waiters;
        this.waiters = [];
        w.forEach((f) => f());
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
    const [commits0, state, stashes, unc, wts, op, bisect] = await Promise.all([
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
      readBisect(root).catch((): BisectState | null => null),
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
    const pinSetting = cfg.get<unknown>('pinnedBranches', []);
    const base = JSON.stringify([root, state, unc, this.filter, order, opts.firstParent, worktrees, op, bisect, names, web, pinSetting]);
    const sig = JSON.stringify([base, this.max, commits.map((c) => c.sha)]);
    if (!force && sig === this.lastSig) return;
    this.lastSig = sig;
    // Load more (or any reload where only more commits arrived): when nothing else changed and the
    // commits already shown are an unchanged prefix of the new list, lay out and send only the new rows.
    const prev = this.lastData;
    if (this.layState && prev && base === this.lastBase && prev.commits.length < commits.length && prev.commits.every((c, i) => c.sha === commits[i].sha)) {
      const tail = commits.slice(prev.commits.length);
      const st = this.layState;
      extendPins(st, commits);
      const lay = layout(tail, st);
      this.lastData = { ...prev, commits, width: lay.width };
      this.lastSent = { kind: 'append', rows: tail.length };
      this.post({ type: 'append', commits: tail, packed: lay.packed, width: lay.width, hasMore, avatars: this.avatars(tail) });
      return;
    }
    this.lastBase = base;
    const st = newLayoutState();
    const uncRow = commits[0]?.sha === UNCOMMITTED ? { sha: UNCOMMITTED, parent: commits[0].parents[0] } : undefined;
    const pins = pinnedTips(pinSetting, state.refs, commits.map((c) => c.sha), uncRow);
    const kept = pinBranches(st, commits, pins.tips);
    const lay = layout(commits, st);
    this.layState = st;
    this.lastSent = { kind: 'data', rows: commits.length };
    this.lastData = { repo: root, commits, state, width: lay.width, uncommitted: unc, names, web, worktrees, op, bisect };
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
      firstParent: opts.firstParent,
      pinned: pins.names.filter((_, i) => kept.includes(pins.tips[i])),
      pinPatterns: Array.isArray(pinSetting) ? pinSetting.filter((x) => typeof x === 'string') : [],
      web,
      worktrees,
      op,
      bisect,
      branches: state.refs.filter((r) => r.type === 'head' || r.type === 'remote').map((r) => r.name),
      avatars: this.avatars(commits),
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
    const firstParent = vscode.workspace.getConfiguration('mergeline').get<boolean>('firstParentOnly', false);
    return { max: this.max, branches: this.filter.branches.length ? this.filter.branches : undefined, remotes: this.filter.remotes, order, firstParent };
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
      case 'filter': {
        // `branches` (a list) from the toolbar checklist; `branch` (one name, '' = all) is still accepted.
        const list: unknown[] = Array.isArray(m.branches) ? m.branches : m.branch ? [m.branch] : [];
        const branches = [...new Set(list.filter((b): b is string => typeof b === 'string' && !!b && !b.startsWith('-')))];
        this.filter = { branches, remotes: !!m.remotes, path: m.path === undefined ? this.filter.path : m.path || null };
        await this.refresh(true);
        break;
      }
      case 'order':
        // Saved as a user setting; the configuration listener refreshes the graph.
        if (['date', 'topo', 'author-date'].includes(m.order)) await vscode.workspace.getConfiguration('mergeline').update('commitOrder', m.order, vscode.ConfigurationTarget.Global);
        break;
      case 'firstParent':
        // Saved as a user setting, like the order; the configuration listener refreshes the graph.
        await vscode.workspace.getConfiguration('mergeline').update('firstParentOnly', !!m.on, vscode.ConfigurationTarget.Global);
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
      case 'review':
        // The webview sends the whole reviewed list for a diff (null = end the review).
        if (typeof m.key === 'string' && /^[0-9a-z]+\.\.[0-9a-f]{4,64}$/.test(m.key)) await this.saveReview(m.key, Array.isArray(m.files) ? m.files : null);
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
        if (typeof m.url === 'string') await this.openUrl(m.url);
        break;
      case 'openPullRequest':
        await this.openPullRequest(String(m.ref ?? ''), m.refType === 'remote' ? 'remote' : 'head', typeof m.remote === 'string' ? m.remote : undefined);
        break;
      case 'pin':
        if (typeof m.name === 'string' && m.name) await this.setPinned(m.name, !!m.on);
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
      const [info, tags, signature] = await Promise.all([readCommitInfo(root, sha), readTags(root, sha).catch(() => []), readSignature(root, sha)]);
      const files = await readChanges(root, info.parents[0] ?? null, sha);
      const avatars = this.avatars([{ email: info.email }]);
      this.post({ type: 'details', sha, info, tags, signature, from: info.parents[0] ?? null, to: sha, files, avatar: avatars?.[info.email] });
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
      case 'resolve': {
        // A conflicted file from the in-progress bar: VS Code's 3-way merge editor (git extension's
        // "Resolve in Merge Editor"); the plain file when that is unavailable or opened nothing.
        if (!(await exists())) break;
        try {
          await vscode.commands.executeCommand('git.openMergeEditor', fileUri);
        } catch {
          // command missing (git extension disabled) or failed
        }
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
        const merge = (vscode as any).TabInputTextMerge;
        const input = tab?.input as { result?: vscode.Uri } | undefined;
        if (!(merge && input instanceof merge && input?.result?.fsPath === fileUri.fsPath)) await vscode.window.showTextDocument(fileUri, { preview: false });
        break;
      }
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

  private async openUrl(url: string) {
    if (!/^https?:\/\//i.test(url)) return;
    this.lastUrl = url;
    if (process.env.MERGELINE_E2E_REPORT) return; // under test: record, do not open a browser
    await vscode.env.openExternal(vscode.Uri.parse(url, true));
  }

  /**
   * Open the forge's new pull request page for a branch. A local branch is resolved to the branch
   * it tracks on its remote; one with no upstream is offered a push first. No network is used.
   */
  private async openPullRequest(ref: string, type: 'head' | 'remote', remote0?: string) {
    const root = this.repo;
    if (!root || !ref) return;
    const cfg = async (key: string) => {
      try {
        return (await git(root, ['config', '--get', key])).trim();
      } catch {
        return '';
      }
    };
    let remote: string, branch: string;
    if (type === 'remote') {
      remote = remote0 ?? ref.split('/')[0];
      branch = ref.slice(remote.length + 1);
    } else {
      remote = await cfg(`branch.${ref}.remote`);
      branch = (await cfg(`branch.${ref}.merge`)).replace(/^refs\/heads\//, '');
      if (!remote || remote === '.' || !branch) {
        const pick = await vscode.window.showInformationMessage(`“${ref}” is not on a remote yet. Push it first, then open the pull request page.`, 'Push and continue');
        if (pick !== 'Push and continue') return;
        const info = this.info();
        if (!info || !(await runAction({ root, api: info.api }, { action: 'pushBranch', ref, refType: 'head' }))) return;
        await this.refresh(true);
        remote = await cfg(`branch.${ref}.remote`);
        branch = (await cfg(`branch.${ref}.merge`)).replace(/^refs\/heads\//, '');
        if (!remote || !branch) return;
      }
    }
    const repo = webRepo(await cfg(`remote.${remote}.url`));
    if (!repo) {
      vscode.window.showInformationMessage(`Mergeline: remote “${remote}” is not on GitHub, GitLab or Bitbucket, so there is no pull request page to open.`);
      return;
    }
    await this.openUrl(pullRequestUrl(repo, branch));
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
