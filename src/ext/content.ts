// `mergeline:` files hold a file's content at a given commit, for the diff editor.
// A read-only file system (not a text content provider), so VS Code can open what it
// needs bytes for: the notebook diff for .ipynb (Git Graph issue #598) and the image
// preview for pictures, as it does for its own git: files.
import * as vscode from 'vscode';
import { gitBytes } from '../core/gitlog';

export const SCHEME = 'mergeline';

export function gitUri(repo: string, ref: string | null, path: string): vscode.Uri {
  // ref null = empty file (the file did not exist on that side).
  const q = JSON.stringify({ repo, ref });
  return vscode.Uri.from({ scheme: SCHEME, path: '/' + path, query: q });
}

export function parseGitUri(uri: vscode.Uri): { repo: string; ref: string | null; path: string } | null {
  try {
    const q = JSON.parse(uri.query);
    if (typeof q?.repo !== 'string' || (q.ref !== null && typeof q.ref !== 'string')) return null;
    return { repo: q.repo, ref: q.ref, path: uri.path.replace(/^\//, '') };
  } catch {
    return null;
  }
}

const EMPTY = new Uint8Array(0);

export class GitFileSystem implements vscode.FileSystemProvider {
  private changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changes.event;
  /** stat and readFile come in pairs; keep the last few reads of fixed commits (a 40/64-hex ref never changes). */
  private cache = new Map<string, Promise<Uint8Array>>();

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const data = await this.readFile(uri);
    return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: data.byteLength, permissions: vscode.FilePermission.Readonly };
  }

  readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const q = parseGitUri(uri);
    if (!q || !q.ref) return Promise.resolve(EMPTY);
    const fixed = /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(q.ref);
    const key = uri.toString();
    const hit = fixed ? this.cache.get(key) : undefined;
    if (hit) return hit;
    // A file missing at that revision reads as empty, as the text provider did before.
    const p = gitBytes(q.repo, ['show', `${q.ref}:${q.path}`]).then(
      (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength),
      () => EMPTY,
    );
    if (fixed) {
      this.cache.set(key, p);
      while (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value!);
    }
    return p;
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }
  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('Mergeline revisions are read-only');
  }
  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions('Mergeline revisions are read-only');
  }
  delete(): void {
    throw vscode.FileSystemError.NoPermissions('Mergeline revisions are read-only');
  }
  rename(): void {
    throw vscode.FileSystemError.NoPermissions('Mergeline revisions are read-only');
  }
}
