// `mergeline:` documents hold a file's content at a given commit, for the diff editor.
import * as vscode from 'vscode';
import { git } from '../core/gitlog';

export const SCHEME = 'mergeline';

export function gitUri(repo: string, ref: string | null, path: string): vscode.Uri {
  // ref null = empty document (file did not exist on that side).
  const q = JSON.stringify({ repo, ref });
  return vscode.Uri.from({ scheme: SCHEME, path: '/' + path, query: q });
}

export class GitContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    let q: { repo: string; ref: string | null };
    try {
      q = JSON.parse(uri.query);
    } catch {
      return '';
    }
    if (!q.ref) return '';
    const path = uri.path.replace(/^\//, '');
    try {
      return await git(q.repo, ['show', `${q.ref}:${path}`]);
    } catch {
      return '';
    }
  }
}
