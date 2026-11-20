import * as vscode from 'vscode';
import { Repos } from './repos';
import { GraphPanel } from './panel';
import { GitContentProvider, SCHEME } from './content';

export async function activate(ctx: vscode.ExtensionContext) {
  const repos = new Repos();
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
