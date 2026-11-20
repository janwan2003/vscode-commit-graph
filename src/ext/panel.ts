// The graph webview panel: loads data for the selected repository and answers the
// webview's requests (details, diffs, actions).
import * as vscode from 'vscode';
import * as path from 'node:path';
import { readLog, readFileHistory, searchLog, readState, readStashes, insertStashes, readStatusCount, readChanges, readCommitInfo, readWorktrees, readTags, readSignature, mergeBase, readNotedCommits, readNote, writeNote, readAuthors, readCompactLog, readContaining, Commit, RepoState, CommitOrder, Worktree } from '../core/gitlog';
import * as fs from 'node:fs';
import { layout, LayoutState, newLayoutState, pinBranches, extendPins } from '../core/graph';
import { pinnedTips } from '../core/pins';
import { colorRules, cssColor, nameColor, refColors, tipColors, PALETTE_NAMES as PALETTE } from '../core/colors';
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

/**
 * Where a graph lives: an editor tab (WebviewPanel) or the Source Control sidebar view
 * (WebviewView, Git Graph issue #781). The controller only needs these few things.
 */
export interface GraphHost {
  kind: 'editor' | 'view';
  webview: vscode.Webview;
  readonly visible: boolean;
  reveal(): void;
  onDidDispose: vscode.Event<void>;
  onDidChangeVisible: vscode.Event<unknown>;
  dispose(): void;
}

function editorHost(ctx: vscode.ExtensionContext): GraphHost {
  const p = vscode.window.createWebviewPanel('mergeline.graph', 'Mergeline', vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media')],
  });
  p.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'tab.svg');
  return {
    kind: 'editor',
    webview: p.webview,
    get visible() {
      return p.visible;
    },
    reveal: () => p.reveal(),
    onDidDispose: p.onDidDispose,
    onDidChangeVisible: p.onDidChangeViewState,
    dispose: () => p.dispose(),
  };
}

export function viewHost(ctx: vscode.ExtensionContext, v: vscode.WebviewView): GraphHost {
  v.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media')] };
  return {
    kind: 'view',
    webview: v.webview,
    get visible() {
      return v.visible;
    },
    reveal: () => v.show(true),
    onDidDispose: v.onDidDispose,
    onDidChangeVisible: v.onDidChangeVisibility,
    dispose: () => {},
  };
}

/** The sidebar view's id (package.json contributes.views.scm). */
export const VIEW_ID = 'mergeline.sidebar';

export class GraphPanel implements vscode.Disposable {
  /** The graph in an editor tab. */
  static current: GraphPanel | undefined;
  /** The graph in the Source Control sidebar view, once that view has been opened. */
  static view: GraphPanel | undefined;
  /** The graph the user used last (editor tab or sidebar), for commands that act on "the shown repository". */
  static last: GraphPanel | undefined;
  static all(): GraphPanel[] {
    return [GraphPanel.current, GraphPanel.view].filter((p): p is GraphPanel => !!p);
  }
  private panel: GraphHost;
  private repo: string | undefined;
  private max: number;
  /**
   * branches: show only these (empty = all). authors: only commits by these "Name <email>" (empty = all;
   * not applied in file history). path: repo-relative, '/'-separated path for file history, or null for the whole repo.
   */
  /** Bumped per commit details request; a pending 'contains' lookup runs only if it is still the latest. */
  private containsSeq = 0;
  private filter: { branches: string[]; remotes: boolean; path: string | null; authors: string[] };
  private subs: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private lastSig = '';
  /** Everything but the commit list and page size, so load more can tell whether only commits were added. */
  private lastBase = '';
  /** Layout state after the last row sent, so load more lays out and sends only the new rows. */
  private layState: LayoutState | undefined;
  /** Rows sent by the last load (counted for the e2e: 'data' sends all, 'append' only new ones). */
  lastSent = { kind: '', rows: 0 };
  /** Compact graph: commits whose folded run the user opened (a run with any of them is shown whole). Reset when compact is turned off or the repo changes. */
  private expand = new Set<string>();
  /** Compact graph counts from the last load: commits walked and hidden. */
  private folded: { total: number; hidden: number } | null = null;
  private loading = false;
  private again = false;
  /** Last data posted to the webview (tests read it). */
  lastPong: any;
  lastDetails: any;
  lastHistory: any;
  /** Last URL handed to the browser (tests read it; under test nothing is opened). */
  lastUrl: string | undefined;
  lastData: { repo: string; commits: Commit[]; state: RepoState; width: number; uncommitted: number; names: string[]; web: unknown; worktrees: Worktree[]; op: OpState | null; bisect: BisectState | null; notes: string[] } | undefined;

  static show(ctx: vscode.ExtensionContext, repos: Repos, root?: string): GraphPanel {
    if (GraphPanel.current) {
      GraphPanel.current.panel.reveal();
      if (root && root !== GraphPanel.current.repo) GraphPanel.current.setRepo(root);
      return GraphPanel.current;
    }
    GraphPanel.current = new GraphPanel(ctx, repos, editorHost(ctx), root);
    GraphPanel.last = GraphPanel.current;
    return GraphPanel.current;
  }

  /** Called when VS Code resolves the sidebar view (first time it is shown, or after it was moved). */
  static attachView(ctx: vscode.ExtensionContext, repos: Repos, v: vscode.WebviewView): GraphPanel {
    GraphPanel.view?.dispose();
    GraphPanel.view = new GraphPanel(ctx, repos, viewHost(ctx, v));
    GraphPanel.last ??= GraphPanel.view;
    return GraphPanel.view;
  }

  /** Layout (column widths, hidden columns, details height) is kept per host kind: the sidebar is narrow. */
  private get layoutKey() {
    return this.panel.kind === 'view' ? 'mergeline.layout.view' : 'mergeline.layout';
  }

  private constructor(private ctx: vscode.ExtensionContext, private repos: Repos, host: GraphHost, root?: string) {
    const cfg = vscode.workspace.getConfiguration('mergeline');
    this.max = cfg.get<number>('initialCommits', 500);
    this.filter = { branches: [], remotes: cfg.get<boolean>('showRemoteBranches', true), path: null, authors: [] };
    this.repo = root ?? ctx.workspaceState.get<string>('mergeline.repo');
    this.panel = host;
    this.panel.webview.html = this.html();
    vscode.commands.executeCommand('setContext', 'mergeline.panelOpen', true);
    this.subs.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m)),
      this.repos.onDidChange((root) => {
        if (!root) this.postRepos();
        if (!root || root === this.repo) this.scheduleRefresh();
      }),
      this.panel.onDidChangeVisible(() => {
        if (this.panel.visible) this.scheduleRefresh(50);
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
   * Adds a branch name or glob to mergeline.pinnedBranches / hiddenBranches, or removes it, at the most
   * specific level that already sets it (folder, workspace), else in user settings, so a repository's
   * .vscode/settings.json is only written when the user put the setting there.
   */
  private async setListSetting(key: 'pinnedBranches' | 'hiddenBranches', name: string, on: boolean) {
    const cfg = vscode.workspace.getConfiguration('mergeline');
    const i = cfg.inspect<unknown>(key);
    const target = i?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder : i?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    const cur = cfg.get<unknown>(key, []);
    const list = (Array.isArray(cur) ? cur : []).filter((x): x is string => typeof x === 'string');
    const next = on ? (list.includes(name) ? list : [...list, name]) : list.filter((x) => x !== name);
    if (next.length === list.length && next.every((x, k) => x === list[k])) return;
    await cfg.update(key, next, target);
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
      rowColors: cfg.get('rowColors', 'none'),
      showAvatars: this.avatarsOn(),
      issueLinks: links.rules,
      layout: this.ctx.globalState.get(this.layoutKey) ?? (this.panel.kind === 'view' ? { w: {}, hidden: ['date', 'author', 'hash'], details: null } : null),
      host: this.panel.kind,
    };
  }
  private linkProblems = '';
  private colorProblems = '';
  private warnColors(problems: string[]) {
    const sig = problems.join('; ');
    if (sig && sig !== this.colorProblems) vscode.window.showWarningMessage(`Mergeline: some mergeline.branchColors entries were skipped: ${sig}`);
    this.colorProblems = sig;
  }

  /**
   * Sets or removes one branch name or glob in mergeline.branchColors (`color` null = remove), at the most
   * specific level that already sets the setting, else in user settings. Asks for the colour when `color` is undefined.
   */
  private async setBranchColor(pattern: string, color?: string | null) {
    const cfg = vscode.workspace.getConfiguration('mergeline');
    const cur = cfg.get<unknown>('branchColors', {});
    const map: Record<string, unknown> = cur && typeof cur === 'object' && !Array.isArray(cur) ? { ...(cur as Record<string, unknown>) } : {};
    if (color === undefined) {
      const SWATCH: Record<string, string> = { blue: '🟦', red: '🟥', green: '🟩', yellow: '🟨', purple: '🟪', orange: '🟧' };
      type Item = vscode.QuickPickItem & { value: string | null };
      const items: Item[] = PALETTE.map((n) => ({ label: `${SWATCH[n] ?? '⬜'} ${n}`, description: map[pattern] === n ? 'current' : undefined, value: n }));
      items.push({ label: '$(edit) Custom colour…', description: '#hex, rgb() or hsl()', value: '' });
      if (pattern in map) items.push({ label: '$(discard) Automatic (remove the colour)', value: null });
      const pick = await vscode.window.showQuickPick(items, { title: `Colour for ${pattern}`, placeHolder: 'Palette colours follow the light or dark theme' });
      if (!pick) return;
      color = pick.value;
      if (color === '') {
        const typed = await vscode.window.showInputBox({
          title: `Colour for ${pattern}`,
          prompt: 'A #hex colour, rgb(…) or hsl(…), or a palette name',
          value: typeof map[pattern] === 'string' ? (map[pattern] as string) : '#',
          validateInput: (v) => (cssColor(v) ? null : 'Not a colour Mergeline accepts, e.g. #e5534b or rgb(229, 83, 75)'),
        });
        if (!typed) return;
        color = typed.trim();
      }
    }
    if (color === null) delete map[pattern];
    else if (cssColor(color)) map[pattern] = color;
    else return;
    const i = cfg.inspect<unknown>('branchColors');
    const target = i?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder : i?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await cfg.update('branchColors', Object.keys(map).length ? map : undefined, target);
  }
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
    this.expand.clear();
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
    // Compact graph: not with file history or the author filter, which already leave commits out.
    const compact = cfg.get<boolean>('compactGraph', false) && !fileMode && !opts.authors;
    let names: string[] = [];
    let raw = 0;
    const stateP = readState(root);
    const stashP: Promise<Commit[]> = showStash ? readStashes(root) : Promise.resolve([]);
    this.folded = null;
    const [commits0, state, stashes, unc, wts, op, bisect, noted] = await Promise.all([
      fileMode
        ? readFileHistory(root, { ...opts, max: this.max + 1 }, this.filter.path!).then((h) => {
            names = h.names;
            raw = h.raw;
            return h.commits;
          })
        : compact
          ? Promise.all([stateP, stashP]).then(async ([st, ss]) => {
              // Kept: every ref, HEAD and each stash's base commit, so their rows and lines still have a commit to sit on.
              const keep = [...st.refs.map((r) => r.sha), ...(st.head ? [st.head] : []), ...ss.map((x) => x.parents[0]).filter(Boolean)];
              const r = await readCompactLog(root, { ...opts, max: this.max + 1 }, keep, this.expand);
              this.folded = { total: r.total, hidden: r.hidden };
              raw = r.commits.length;
              return r.commits;
            })
          : readLog(root, { ...opts, max: this.max + 1 }).then((c) => ((raw = c.length), c)),
      stateP,
      stashP,
      showUnc ? readStatusCount(root) : Promise.resolve(0),
      readWorktrees(root),
      readOperation(root).catch((): OpState | null => null),
      readBisect(root).catch((): BisectState | null => null),
      readNotedCommits(root),
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
    const colorSetting = cfg.get<unknown>('branchColors', {});
    const notes = commits.filter((c) => noted.has(c.sha)).map((c) => c.sha);
    const base = JSON.stringify([root, state, unc, this.filter, order, opts.firstParent, compact, [...this.expand], opts.exclude, worktrees, op, bisect, names, web, pinSetting, colorSetting, noted.size]);
    const sig = JSON.stringify([base, this.max, commits.map((c) => c.sha), notes]);
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
      this.lastData = { ...prev, commits, width: lay.width, notes };
      this.lastSent = { kind: 'append', rows: tail.length };
      this.post({ type: 'append', commits: tail, packed: lay.packed, width: lay.width, hasMore, avatars: this.avatars(tail), notes: tail.filter((c) => noted.has(c.sha)).map((c) => c.sha) });
      return;
    }
    this.lastBase = base;
    // Set inside the log promise above; the cast stops TypeScript narrowing it to the null assigned before.
    const folded = this.folded as { total: number; hidden: number } | null;
    const st = newLayoutState();
    const uncRow = commits[0]?.sha === UNCOMMITTED ? { sha: UNCOMMITTED, parent: commits[0].parents[0] } : undefined;
    const pins = pinnedTips(pinSetting, state.refs, commits.map((c) => c.sha), uncRow);
    const kept = pinBranches(st, commits, pins.tips);
    const rules = colorRules(colorSetting);
    this.warnColors(rules.problems);
    st.tipColor = tipColors(rules, state.refs, uncRow ? { sha: UNCOMMITTED, branch: state.branch } : undefined);
    st.pinColor = kept.map((t, k) => nameColor(rules, pins.names[pins.tips.indexOf(t)]) ?? k);
    const lay = layout(commits, st);
    this.layState = st;
    this.lastSent = { kind: 'data', rows: commits.length };
    this.lastData = { repo: root, commits, state, width: lay.width, uncommitted: unc, names, web, worktrees, op, bisect, notes };
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
      hidden: opts.exclude,
      notes,
      names,
      order,
      firstParent: opts.firstParent,
      compact: folded ? { ...folded, expanded: this.expand.size > 0 } : null,
      compactOn: cfg.get<boolean>('compactGraph', false),
      pinned: pins.names.filter((_, i) => kept.includes(pins.tips[i])),
      pinPatterns: Array.isArray(pinSetting) ? pinSetting.filter((x) => typeof x === 'string') : [],
      colors: rules.colors,
      refColors: refColors(rules, state.refs),
      colorPatterns: rules.rules.map((r) => r.pattern),
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
    const cfg = vscode.workspace.getConfiguration('mergeline');
    const firstParent = cfg.get<boolean>('firstParentOnly', false);
    const hidden = cfg.get<unknown>('hiddenBranches', []);
    const exclude = (Array.isArray(hidden) ? hidden : []).filter((x): x is string => typeof x === 'string' && !!x.trim() && !x.startsWith('-'));
    return {
      max: this.max,
      branches: this.filter.branches.length ? this.filter.branches : undefined,
      remotes: this.filter.remotes,
      order,
      firstParent,
      exclude,
      authors: this.filter.authors.length && !this.filter.path ? this.filter.authors : undefined,
    };
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
    if (m?.type !== 'pong' && m?.type !== 'ready') GraphPanel.last = this;
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
        // Compact graph: the match may sit inside a folded run; open that run. (Its index in the full
        // log is at least its compact row index, so `want` still covers it.)
        if (typeof m.sha === 'string' && /^[0-9a-f]{40,64}$/.test(m.sha) && vscode.workspace.getConfiguration('mergeline').get<boolean>('compactGraph', false) && !this.lastData?.commits.some((c) => c.sha === m.sha)) {
          this.expand.add(m.sha);
          if (want <= this.max) await this.refresh(true);
        }
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
        // `authors` left out keeps the current author filter.
        const authors = Array.isArray(m.authors) ? [...new Set((m.authors as unknown[]).filter((a): a is string => typeof a === 'string' && /^.* <.*>$/.test(a)))] : this.filter.authors;
        this.filter = { branches, remotes: !!m.remotes, path: m.path === undefined ? this.filter.path : m.path || null, authors };
        await this.refresh(true);
        break;
      }
      case 'authors': {
        // The author checklist: everyone in the branches shown (ignoring the author filter itself).
        if (!this.repo) return;
        const order = vscode.workspace.getConfiguration('mergeline').get<CommitOrder>('commitOrder', 'date');
        try {
          const list = await readAuthors(this.repo, { ...this.logOptions(order), authors: undefined });
          this.post({ type: 'authors', list: list.slice(0, 1000), total: list.length });
        } catch (e) {
          this.post({ type: 'authors', list: [], total: 0, error: String((e as Error)?.message ?? e) });
        }
        break;
      }
      case 'getNote': {
        if (!this.repo || typeof m.sha !== 'string' || !/^[0-9a-f]{40,64}$/i.test(m.sha)) return;
        this.post({ type: 'note', sha: m.sha, note: await readNote(this.repo, m.sha) });
        break;
      }
      case 'setNote': {
        if (!this.repo || typeof m.sha !== 'string' || !/^[0-9a-f]{40,64}$/i.test(m.sha) || typeof m.note !== 'string') return;
        try {
          const r = await writeNote(this.repo, m.sha, m.note);
          if (r === 'removed') vscode.window.setStatusBarMessage(`Mergeline: removed the note on ${m.sha.slice(0, 8)}`, 4000);
        } catch (e) {
          vscode.window.showErrorMessage(`Mergeline: could not save the note: ${String((e as Error)?.message ?? e)}`);
        }
        await this.refresh(true);
        if (this.lastDetails?.sha === m.sha && !this.lastDetails.compare) await this.details(m.sha);
        break;
      }
      case 'hide':
        // A glob for mergeline.hiddenBranches; the configuration listener refreshes the graph.
        if (typeof m.pattern === 'string' && m.pattern.trim() && !m.pattern.startsWith('-')) await this.setListSetting('hiddenBranches', m.pattern.trim(), !!m.on);
        break;
      case 'order':
        // Saved as a user setting; the configuration listener refreshes the graph.
        if (['date', 'topo', 'author-date'].includes(m.order)) await vscode.workspace.getConfiguration('mergeline').update('commitOrder', m.order, vscode.ConfigurationTarget.Global);
        break;
      case 'compact':
        // Saved as a user setting, like First parent; the configuration listener refreshes the graph.
        this.expand.clear();
        await vscode.workspace.getConfiguration('mergeline').update('compactGraph', !!m.on, vscode.ConfigurationTarget.Global);
        break;
      case 'expand':
        // Open a folded run (placeholder id "~<sha>" or any sha in it) and select its newest commit.
        if (typeof m.sha === 'string' && /^~?[0-9a-f]{4,64}$/i.test(m.sha)) {
          const sha = m.sha.replace(/^~/, '');
          this.expand.add(sha);
          await this.refresh(true);
          this.post({ type: 'reveal', sha });
        }
        break;
      case 'collapse':
        // Fold every opened run again.
        if (this.expand.size) {
          this.expand.clear();
          await this.refresh(true);
        }
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
        await this.ctx.globalState.update(this.layoutKey, m.layout && typeof m.layout === 'object' ? m.layout : undefined);
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
      case 'branchColor':
        // A branch name or glob for mergeline.branchColors; the configuration listener refreshes the graph.
        if (typeof m.pattern === 'string' && m.pattern.trim()) await this.setBranchColor(m.pattern.trim(), m.color === null ? null : typeof m.color === 'string' ? m.color : undefined);
        break;
      case 'rowColors':
        if (['none', 'stripe', 'tint'].includes(m.value)) await vscode.workspace.getConfiguration('mergeline').update('rowColors', m.value, vscode.ConfigurationTarget.Global);
        break;
      case 'pin':
        if (typeof m.name === 'string' && m.name) await this.setListSetting('pinnedBranches', m.name, !!m.on);
        break;
      case 'action': {
        const info = this.info();
        if (!info) return;
        const changed = await runAction({ root: info.root, api: info.api }, { ...(m as ActionMsg), current: this.lastData?.state.branch ?? null });
        if (changed) {
          // The other graph (editor tab or sidebar) catches up when it is visible.
          for (const p of GraphPanel.all()) if (p !== this) p.scheduleRefresh(50);
          await this.refresh(true);
        }
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
      const [info, tags, signature, note] = await Promise.all([readCommitInfo(root, sha), readTags(root, sha).catch(() => []), readSignature(root, sha), readNote(root, sha)]);
      const files = await readChanges(root, info.parents[0] ?? null, sha);
      const avatars = this.avatars([{ email: info.email }]);
      this.post({ type: 'details', sha, info, tags, signature, note, from: info.parents[0] ?? null, to: sha, files, avatar: avatars?.[info.email] });
      // Which branches and tags have it: after the details, so a slow `--contains` never holds them up,
      // and only for the commit the user stops on (arrowing through rows starts no git per row).
      const seq = ++this.containsSeq;
      setTimeout(() => {
        if (seq !== this.containsSeq) return;
        readContaining(root, sha).then(
          (c) => this.post({ type: 'contains', sha, ...c }),
          (e) => this.post({ type: 'contains', sha, error: String(e?.message ?? e) }),
        );
      }, 150);
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

  private disposed = false;
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (GraphPanel.current === this) GraphPanel.current = undefined;
    if (GraphPanel.view === this) GraphPanel.view = undefined;
    if (GraphPanel.last === this) GraphPanel.last = GraphPanel.current ?? GraphPanel.view;
    vscode.commands.executeCommand('setContext', 'mergeline.panelOpen', GraphPanel.all().length > 0);
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
  get hostKind() {
    return this.panel.kind;
  }
  get repoRoot() {
    return this.repo;
  }
}
