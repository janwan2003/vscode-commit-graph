// Repository discovery. Prefers VS Code's built-in git extension (it already knows
// nested repos, worktrees and submodules); falls back to `git rev-parse`.
import * as vscode from 'vscode';
import { git } from '../core/gitlog';
import * as path from 'node:path';

// Minimal slice of the vscode.git API (v1) that we use.
export interface GitApiRepo {
  rootUri: vscode.Uri;
  state: { onDidChange: vscode.Event<void> };
  push(remote?: string, name?: string, setUpstream?: boolean): Promise<void>;
  pull(): Promise<void>;
  fetch(opts?: { all?: boolean; prune?: boolean }): Promise<void>;
}
interface GitApi {
  repositories: GitApiRepo[];
  onDidOpenRepository: vscode.Event<GitApiRepo>;
  onDidCloseRepository: vscode.Event<GitApiRepo>;
}

export interface RepoInfo {
  root: string;
  name: string;
  api?: GitApiRepo;
}

export class Repos implements vscode.Disposable {
  private api: GitApi | undefined;
  private fallback: RepoInfo[] = [];
  private subs: vscode.Disposable[] = [];
  private readonly changed = new vscode.EventEmitter<string | undefined>(); // root or undefined = list changed
  readonly onDidChange = this.changed.event;

  async init(): Promise<void> {
    try {
      const ext = vscode.extensions.getExtension<{ getAPI(v: 1): GitApi }>('vscode.git');
      if (ext) {
        const exp = ext.isActive ? ext.exports : await ext.activate();
        this.api = exp?.getAPI(1);
      }
    } catch {
      this.api = undefined;
    }
    if (this.api) {
      const watch = (r: GitApiRepo) => this.subs.push(r.state.onDidChange(() => this.changed.fire(r.rootUri.fsPath)));
      this.api.repositories.forEach(watch);
      this.subs.push(
        this.api.onDidOpenRepository((r) => {
          watch(r);
          this.changed.fire(undefined);
        }),
        this.api.onDidCloseRepository(() => this.changed.fire(undefined)),
      );
    }
    await this.scanFallback();
    this.subs.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this.scanFallback().then(() => this.changed.fire(undefined))));
  }

  private async scanFallback() {
    const found = new Map<string, RepoInfo>();
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      try {
        const top = (await git(f.uri.fsPath, ['rev-parse', '--show-toplevel'])).trim();
        if (top) found.set(path.resolve(top), { root: path.resolve(top), name: path.basename(top) });
      } catch {
        /* not a repo */
      }
    }
    this.fallback = [...found.values()];
  }

  list(): RepoInfo[] {
    const m = new Map<string, RepoInfo>();
    for (const r of this.fallback) m.set(r.root, r);
    for (const r of this.api?.repositories ?? []) {
      const root = path.resolve(r.rootUri.fsPath);
      m.set(root, { root, name: path.basename(root), api: r });
    }
    return [...m.values()].sort((a, b) => a.root.localeCompare(b.root));
  }

  dispose() {
    this.subs.forEach((s) => s.dispose());
    this.changed.dispose();
  }
}
