// Interactive rebase in VS Code tabs (Git Graph issue #757): git's rebase todo and any commit
// message it asks for (reword, squash) open as editor tabs; "Start rebase" / "Done" in the
// tab's title bar (or closing the tab) hands the file back to git, "Cancel" aborts.
import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { git } from '../core/gitlog';
import { WaitDir, editKind, todoSummary, TodoKind } from '../core/waiteditor';

interface Pending {
  id: string;
  kind: TodoKind;
  uri: vscode.Uri;
}

interface Session {
  root: string;
  wd: WaitDir;
  pending: Pending[];
  /** The user cancelled the todo (git then aborts the whole rebase). */
  cancelledTodo: boolean;
  /** The user asked to abort while a message was open: abort the rebase once git exits. */
  abortAfter: boolean;
}

let session: Session | null = null;
const changed = new vscode.EventEmitter<void>();
/** Fires when a tab starts or stops waiting (the graph's bar shows it). */
export const onDidChangeWaiting = changed.event;

/** What the rebase in `root` is waiting for the user to edit, if anything. */
export function waitingFor(root: string): { kind: TodoKind; file: string } | null {
  if (!session || path.resolve(session.root) !== path.resolve(root) || !session.pending.length) return null;
  const p = session.pending[session.pending.length - 1];
  return { kind: p.kind, file: p.uri.fsPath };
}

export const busy = (): boolean => !!session;

const setContext = () => {
  vscode.commands.executeCommand('setContext', 'mergeline.waitingEditor', !!session?.pending.length);
};

function settle(p: Pending, ok: boolean) {
  if (!session) return;
  const i = session.pending.indexOf(p);
  if (i < 0) return;
  session.pending.splice(i, 1);
  if (!ok && p.kind === 'todo') session.cancelledTodo = true;
  if (!ok && p.kind === 'message') session.abortAfter = true;
  session.wd.answer(p.id, ok);
  setContext();
  changed.fire();
}

const same = (a: vscode.Uri, b: vscode.Uri) => path.resolve(a.fsPath) === path.resolve(b.fsPath);

function find(uri?: vscode.Uri): Pending | undefined {
  if (!session) return;
  const u = uri ?? vscode.window.activeTextEditor?.document.uri;
  return (u && session.pending.find((p) => same(p.uri, u))) ?? session.pending[session.pending.length - 1];
}

async function closeTabs(uri: vscode.Uri) {
  const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputText && same(t.input.uri, uri));
  if (tabs.length) await vscode.window.tabGroups.close(tabs, true);
}

/** Save the file and hand it back to git ("Start rebase" on a todo, "Done" on a message). */
export async function finish(uri?: vscode.Uri, ok = true): Promise<boolean> {
  const p = find(uri);
  if (!p) return false;
  const doc = vscode.workspace.textDocuments.find((d) => same(d.uri, p.uri));
  if (ok && doc?.isDirty) await doc.save();
  settle(p, ok);
  // Closing after settling, so the tab-close listener does not answer twice.
  await closeTabs(p.uri);
  return true;
}

/** Bring the waiting file's tab to the front. */
export async function reveal(): Promise<void> {
  const p = session?.pending[session.pending.length - 1];
  if (p) await vscode.window.showTextDocument(p.uri, { preview: false });
}

async function open(p: Pending) {
  const doc = await vscode.workspace.openTextDocument(p.uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  // git reuses COMMIT_EDITMSG for every message: a still-loaded copy may hold the previous one.
  const disk = await fs.readFile(p.uri.fsPath, 'utf8').catch(() => null);
  if (disk !== null && !doc.isDirty && doc.getText() !== disk) await vscode.commands.executeCommand('workbench.action.files.revert');
  if (p.kind === 'todo') {
    const s = todoSummary(doc.getText());
    const n = Object.values(s).reduce((a, b) => a + b, 0);
    vscode.window
      .showInformationMessage(
        `Mergeline: edit the rebase todo (${n} line${n === 1 ? '' : 's'}): change pick to reword, edit, squash, fixup or drop, or reorder lines. Then Start rebase.`,
        'Start rebase',
        'Cancel',
      )
      .then((pick) => {
        if (pick && session?.pending.includes(p)) finish(p.uri, pick === 'Start rebase');
      });
  } else {
    vscode.window.showInformationMessage('Mergeline: edit the commit message, then Done (lines starting with # are left out).', 'Done', 'Abort rebase').then((pick) => {
      if (pick && session?.pending.includes(p)) finish(p.uri, pick === 'Done');
    });
  }
}

/**
 * Runs `git <args>` (a rebase) with the todo and message editors pointed at VS Code tabs.
 * Resolves when git exits; rejects with git's error. `cancelled`: the user cancelled the todo,
 * so git aborted and nothing changed. `aborted`: the user aborted at a message, and the rebase
 * was aborted after git stopped.
 */
export async function runWithEditors(root: string, args: string[]): Promise<{ cancelled: boolean; aborted: boolean }> {
  if (session) throw new Error('Another rebase is already waiting for an editor tab.');
  const wd = new WaitDir();
  const s: Session = { root, wd, pending: [], cancelledTodo: false, abortAfter: false };
  session = s;
  const tick = setInterval(() => {
    for (const r of wd.poll()) {
      const uri = vscode.Uri.file(path.resolve(root, r.file));
      const p: Pending = { id: r.id, kind: editKind(r.file), uri };
      s.pending.push(p);
      setContext();
      changed.fire();
      open(p).catch(() => settle(p, false));
    }
  }, 150);
  // Closing the tab hands the file back as saved, as with `code --wait`.
  const closeSub = vscode.window.tabGroups.onDidChangeTabs((e) => {
    for (const t of e.closed) {
      if (!(t.input instanceof vscode.TabInputText)) continue;
      const uri = t.input.uri;
      const p = s.pending.find((x) => same(x.uri, uri));
      const stillOpen = vscode.window.tabGroups.all.some((g) => g.tabs.some((o) => o.input instanceof vscode.TabInputText && same(o.input.uri, uri)));
      if (p && !stillOpen) settle(p, true);
    }
  });
  try {
    try {
      await git(root, args, { env: wd.env() });
    } catch (e) {
      if (s.cancelledTodo) return { cancelled: true, aborted: false };
      if (s.abortAfter) {
        await git(root, ['rebase', '--abort']).catch(() => undefined);
        return { cancelled: false, aborted: true };
      }
      throw e;
    }
    return { cancelled: false, aborted: false };
  } finally {
    clearInterval(tick);
    closeSub.dispose();
    for (const p of [...s.pending]) await closeTabs(p.uri).catch(() => undefined);
    session = null;
    wd.dispose();
    setContext();
    changed.fire();
  }
}

export function registerRebaseEditor(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('mergeline.editorDone', (uri?: vscode.Uri) => finish(uri instanceof vscode.Uri ? uri : undefined, true)),
    vscode.commands.registerCommand('mergeline.editorCancel', (uri?: vscode.Uri) => finish(uri instanceof vscode.Uri ? uri : undefined, false)),
    { dispose: () => session?.wd.dispose() },
  );
}
