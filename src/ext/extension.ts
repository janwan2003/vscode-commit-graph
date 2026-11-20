import * as vscode from 'vscode';
import * as path from 'node:path';
import { Repos } from './repos';
import { GraphPanel } from './panel';
import { GitContentProvider, SCHEME } from './content';
import { runAction } from './actions';

export async function activate(ctx: vscode.ExtensionContext) {
  const repos = new Repos();
  async function repoAction(action: string) {
    await ready;
    const list = repos.list();
    let repo = list.find((r) => r.root === GraphPanel.current?.repoRoot) ?? (list.length === 1 ? list[0] : undefined);
    if (!repo && list.length) {
      const pick = await vscode.window.showQuickPick(list.map((r) => ({ label: r.name, description: r.root, r })), { placeHolder: 'Repository' });
      repo = pick?.r;
    }
    if (!repo) {
      if (!list.length) vscode.window.showInformationMessage('Mergeline: no git repository found in this workspace.');
      return;
    }
    if (await runAction({ root: repo.root, api: repo.api }, { action })) await GraphPanel.current?.refresh(true);
  }
  ctx.subscriptions.push(repos, vscode.workspace.registerTextDocumentContentProvider(SCHEME, new GitContentProvider()));
  const ready = repos.init();

  ctx.subscriptions.push(
    vscode.commands.registerCommand('mergeline.show', async (arg?: { rootUri?: vscode.Uri }) => {
      await ready;
      // From the SCM title bar VS Code passes the source control; use its root.
      const root = arg?.rootUri?.fsPath;
      return GraphPanel.show(ctx, repos, root);
    }),
    vscode.commands.registerCommand('mergeline.refresh', () => GraphPanel.current?.refresh(true)),
    // Remotes / patches of the repository shown in the graph (or the only / a picked repository).
    vscode.commands.registerCommand('mergeline.manageRemotes', () => repoAction('manageRemotes')),
    vscode.commands.registerCommand('mergeline.applyPatch', () => repoAction('applyPatch')),
    // From the Explorer or an editor tab VS Code passes the file's URI; from the
    // Command Palette we use the active editor.
    vscode.commands.registerCommand('mergeline.fileHistory', async (uri?: vscode.Uri) => {
      await ready;
      const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
      if (!target || target.scheme !== 'file') {
        vscode.window.showInformationMessage('Mergeline: open or select a file to see its history.');
        return;
      }
      const file = target.fsPath;
      const repo = repos
        .list()
        .filter((r) => file === r.root || file.startsWith(r.root + path.sep))
        .sort((a, b) => b.root.length - a.root.length)[0];
      if (!repo) {
        vscode.window.showInformationMessage(`Mergeline: ${path.basename(file)} is not inside a git repository in this workspace.`);
        return;
      }
      const panel = GraphPanel.show(ctx, repos, repo.root);
      await panel.showFileHistory(repo.root, path.relative(repo.root, file));
      return panel;
    }),
  );

  const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  sb.text = '$(git-merge) Graph';
  sb.tooltip = 'Mergeline: Show Commit Graph';
  sb.command = 'mergeline.show';
  const updateSb = () => (vscode.workspace.getConfiguration('mergeline').get('statusBarButton', true) && repos.list().length ? sb.show() : sb.hide());
  ready.then(updateSb);
  ctx.subscriptions.push(sb, repos.onDidChange(updateSb), vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('mergeline.statusBarButton') && updateSb()));

  // Returned API is used by the end-to-end tests.
  return { ready, repos, panel: () => GraphPanel.current };
}

export function deactivate() {
  GraphPanel.current?.dispose();
}
