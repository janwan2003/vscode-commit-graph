// Git operations triggered from the graph. Each asks for what it needs, confirms
// destructive steps with a modal dialog, runs git and reports errors.
import * as vscode from 'vscode';
import { git, GitError } from '../core/gitlog';
import { GitApiRepo } from './repos';

export interface ActionMsg {
  action: string;
  sha?: string;
  parents?: string[];
  subject?: string;
  ref?: string; // branch/tag name
  refType?: 'head' | 'remote' | 'tag' | 'stash';
  remote?: string;
  stashRef?: string;
  current?: string | null; // current branch
}

export interface ActionCtx {
  root: string;
  api?: GitApiRepo;
}

const short = (s?: string) => (s ? s.slice(0, 8) : '');

async function run(ctx: ActionCtx, args: string[], title: string): Promise<boolean> {
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Mergeline: ${title}` }, () => git(ctx.root, args));
    return true;
  } catch (e) {
    await reportError(e, title);
    return false;
  }
}

async function reportError(e: unknown, title: string) {
  const msg = e instanceof GitError ? e.message : String((e as Error)?.message ?? e);
  const conflict = /CONFLICT|conflict|could not apply|Resolve all conflicts/i.test(msg);
  if (conflict) {
    const pick = await vscode.window.showWarningMessage(`${title}: there are conflicts. Resolve them in Source Control, then continue.`, 'Open Source Control');
    if (pick) vscode.commands.executeCommand('workbench.view.scm');
  } else vscode.window.showErrorMessage(`${title} failed: ${msg.split('\n').slice(0, 6).join(' ')}`);
}

async function confirm(message: string, detail: string, button: string): Promise<boolean> {
  const r = await vscode.window.showWarningMessage(message, { modal: true, detail }, button);
  return r === button;
}

async function remotes(ctx: ActionCtx): Promise<string[]> {
  return (await git(ctx.root, ['remote'])).split('\n').filter(Boolean);
}

async function pickRemote(ctx: ActionCtx, preferred?: string): Promise<string | undefined> {
  const rs = await remotes(ctx);
  if (!rs.length) {
    vscode.window.showErrorMessage('This repository has no remotes.');
    return undefined;
  }
  if (preferred && rs.includes(preferred)) return preferred;
  if (rs.length === 1) return rs[0];
  return vscode.window.showQuickPick(rs.sort((a, b) => (a === 'origin' ? -1 : b === 'origin' ? 1 : a.localeCompare(b))), { placeHolder: 'Remote' });
}

const validRef = (v: string) => (!v.trim() ? 'Enter a name' : /[\s~^:?*[\\]|\.\.|@\{|^[-/.]|[/.]$|\.lock$/.test(v) ? 'Not a valid git ref name' : undefined);

async function mergeArgs(target: string): Promise<string[] | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: 'Merge', description: 'fast-forward when possible', args: [] as string[] },
      { label: 'Merge with a merge commit', description: '--no-ff', args: ['--no-ff'] },
      { label: 'Squash merge', description: '--squash (stages the changes; you commit)', args: ['--squash'] },
    ],
    { placeHolder: `Merge ${target} into the current branch` },
  );
  return pick ? ['merge', '--no-edit', ...pick.args, target] : undefined;
}

async function pushVia(ctx: ActionCtx, remote: string, refspec: string, setUpstream: boolean, title: string): Promise<boolean> {
  if (ctx.api) {
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Mergeline: ${title}` }, () => ctx.api!.push(remote, refspec, setUpstream));
      return true;
    } catch (e) {
      await reportError(e, title);
      return false;
    }
  }
  return run(ctx, ['push', ...(setUpstream ? ['-u'] : []), remote, refspec], title);
}

/** Returns true when the repository may have changed (caller refreshes). */
export async function runAction(ctx: ActionCtx, m: ActionMsg): Promise<boolean> {
  const sha = m.sha ?? '';
  const label = m.subject ? `${short(sha)} "${m.subject.slice(0, 60)}"` : short(sha);
  switch (m.action) {
    // ---- commit ----
    case 'copyHash':
      await vscode.env.clipboard.writeText(sha);
      return false;
    case 'copySubject':
      await vscode.env.clipboard.writeText(m.subject ?? '');
      return false;
    case 'copyRef':
      await vscode.env.clipboard.writeText(m.ref ?? '');
      return false;
    case 'checkoutCommit':
      return run(ctx, ['checkout', '--detach', sha], `Check out ${short(sha)}`);
    case 'createBranch': {
      const name = await vscode.window.showInputBox({ prompt: `New branch at ${label}`, validateInput: validRef });
      if (!name) return false;
      const how = await vscode.window.showQuickPick(['Create and check out', 'Create only'], { placeHolder: `Branch ${name}` });
      if (!how) return false;
      return run(ctx, how === 'Create only' ? ['branch', name, sha] : ['checkout', '-b', name, sha], `Create branch ${name}`);
    }
    case 'createTag': {
      const name = await vscode.window.showInputBox({ prompt: `New tag at ${label}`, validateInput: validRef });
      if (!name) return false;
      const msg = await vscode.window.showInputBox({ prompt: 'Tag message (leave empty for a lightweight tag)' });
      if (msg === undefined) return false;
      return run(ctx, msg ? ['tag', '-a', name, '-m', msg, sha] : ['tag', name, sha], `Create tag ${name}`);
    }
    case 'cherryPick': {
      const args = ['cherry-pick'];
      if ((m.parents?.length ?? 0) > 1) {
        const p = await pickParent(m.parents!);
        if (!p) return false;
        args.push('-m', p);
      }
      return run(ctx, [...args, sha], `Cherry-pick ${short(sha)}`);
    }
    case 'revert': {
      const args = ['revert', '--no-edit'];
      if ((m.parents?.length ?? 0) > 1) {
        const p = await pickParent(m.parents!);
        if (!p) return false;
        args.push('-m', p);
      }
      return run(ctx, [...args, sha], `Revert ${short(sha)}`);
    }
    case 'merge': {
      const target = m.ref ?? sha;
      const args = await mergeArgs(m.ref ?? short(sha));
      if (!args) return false;
      args[args.length - 1] = target;
      return run(ctx, args, `Merge ${m.ref ?? short(sha)}`);
    }
    case 'rebase': {
      const target = m.ref ?? sha;
      if (!(await confirm(`Rebase ${m.current ?? 'HEAD'} onto ${m.ref ?? short(sha)}?`, 'Your commits that are not on the target are replayed on top of it. This rewrites their hashes.', 'Rebase'))) return false;
      return run(ctx, ['rebase', target], `Rebase onto ${m.ref ?? short(sha)}`);
    }
    case 'interactiveRebase': {
      const t = vscode.window.createTerminal({ name: 'Mergeline rebase', cwd: ctx.root });
      t.show();
      t.sendText(`git rebase -i ${sha}`);
      return false;
    }
    case 'reset': {
      const pick = await vscode.window.showQuickPick(
        [
          { label: 'Soft', description: 'keep changes staged', mode: '--soft' },
          { label: 'Mixed', description: 'keep changes in the working tree, unstaged', mode: '--mixed' },
          { label: 'Hard', description: 'discard all changes', mode: '--hard' },
        ],
        { placeHolder: `Reset ${m.current ?? 'HEAD'} to ${label}` },
      );
      if (!pick) return false;
      if (pick.mode === '--hard' && !(await confirm(`Hard reset ${m.current ?? 'HEAD'} to ${short(sha)}?`, 'Uncommitted changes are lost. Commits after this one stay reachable only through the reflog.', 'Reset --hard'))) return false;
      return run(ctx, ['reset', pick.mode, sha], `Reset to ${short(sha)}`);
    }
    // ---- branches ----
    case 'checkoutBranch': {
      const name = m.ref!;
      if (m.refType !== 'remote') return run(ctx, ['checkout', name], `Check out ${name}`);
      const remote = m.remote ?? name.split('/')[0];
      const localDefault = name.slice(remote.length + 1);
      const local = await vscode.window.showInputBox({ prompt: `Local branch tracking ${name}`, value: localDefault, validateInput: validRef });
      if (!local) return false;
      const exists = (await git(ctx.root, ['branch', '--list', local])).trim().length > 0;
      if (exists) return run(ctx, ['checkout', local], `Check out ${local}`);
      return run(ctx, ['checkout', '-b', local, '--track', name], `Check out ${name} as ${local}`);
    }
    case 'renameBranch': {
      const nn = await vscode.window.showInputBox({ prompt: `Rename branch ${m.ref}`, value: m.ref, validateInput: validRef });
      if (!nn || nn === m.ref) return false;
      return run(ctx, ['branch', '-m', m.ref!, nn], `Rename ${m.ref}`);
    }
    case 'deleteBranch': {
      if (!(await confirm(`Delete branch ${m.ref}?`, 'Only the local branch is deleted.', 'Delete'))) return false;
      try {
        await git(ctx.root, ['branch', '-d', m.ref!]);
        return true;
      } catch (e) {
        if (e instanceof GitError && /not fully merged/.test(e.message)) {
          if (await confirm(`${m.ref} is not fully merged.`, 'Force-deleting it drops commits that exist only on this branch (recoverable from the reflog for a while).', 'Force delete')) {
            return run(ctx, ['branch', '-D', m.ref!], `Delete ${m.ref}`);
          }
          return false;
        }
        await reportError(e, `Delete ${m.ref}`);
        return false;
      }
    }
    case 'pushBranch': {
      const remote = await pickRemote(ctx);
      if (!remote) return false;
      return pushVia(ctx, remote, m.ref!, true, `Push ${m.ref} to ${remote}`);
    }
    case 'pull':
      if (ctx.api) {
        try {
          await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Mergeline: Pull' }, () => ctx.api!.pull());
          return true;
        } catch (e) {
          await reportError(e, 'Pull');
          return true;
        }
      }
      return run(ctx, ['pull', '--no-edit'], 'Pull');
    case 'deleteRemoteBranch': {
      const remote = m.remote ?? m.ref!.split('/')[0];
      const branch = m.ref!.slice(remote.length + 1);
      if (!(await confirm(`Delete ${branch} on ${remote}?`, `This deletes the branch on the remote server for everyone (git push ${remote} --delete ${branch}).`, 'Delete on remote'))) return false;
      return run(ctx, ['push', remote, '--delete', branch], `Delete ${m.ref}`);
    }
    // ---- tags ----
    case 'pushTag': {
      const remote = await pickRemote(ctx);
      if (!remote) return false;
      return run(ctx, ['push', remote, `refs/tags/${m.ref}`], `Push tag ${m.ref}`);
    }
    case 'deleteTag': {
      const rs = await remotes(ctx);
      const r = await vscode.window.showWarningMessage(
        `Delete tag ${m.ref}?`,
        { modal: true },
        'Delete locally',
        ...(rs.length ? ['Delete locally and on remote'] : []),
      );
      if (!r) return false;
      const ok = await run(ctx, ['tag', '-d', m.ref!], `Delete tag ${m.ref}`);
      if (ok && r !== 'Delete locally') {
        const remote = await pickRemote(ctx);
        if (remote) await run(ctx, ['push', remote, '--delete', `refs/tags/${m.ref}`], `Delete tag ${m.ref} on ${remote}`);
      }
      return true;
    }
    // ---- stashes ----
    case 'stashApply':
      return run(ctx, ['stash', 'apply', m.stashRef!], `Apply ${m.stashRef}`);
    case 'stashPop':
      return run(ctx, ['stash', 'pop', m.stashRef!], `Pop ${m.stashRef}`);
    case 'stashDrop':
      if (!(await confirm(`Drop ${m.stashRef}?`, `"${m.subject ?? ''}" is deleted.`, 'Drop'))) return false;
      return run(ctx, ['stash', 'drop', m.stashRef!], `Drop ${m.stashRef}`);
    case 'stashBranch': {
      const name = await vscode.window.showInputBox({ prompt: `New branch from ${m.stashRef}`, validateInput: validRef });
      if (!name) return false;
      return run(ctx, ['stash', 'branch', name, m.stashRef!], `Branch from ${m.stashRef}`);
    }
    // ---- working tree ----
    case 'stashSave': {
      const msg = await vscode.window.showInputBox({ prompt: 'Stash message (optional)' });
      if (msg === undefined) return false;
      return run(ctx, ['stash', 'push', '--include-untracked', ...(msg ? ['-m', msg] : [])], 'Stash changes');
    }
    case 'discardAll': {
      if (!(await confirm('Discard ALL uncommitted changes?', 'Runs git reset --hard and git clean -fd. Modified and untracked files are lost and cannot be recovered.', 'Discard everything'))) return false;
      return (await run(ctx, ['reset', '--hard', 'HEAD'], 'Discard changes')) && run(ctx, ['clean', '-fd'], 'Remove untracked files');
    }
    case 'openScm':
      vscode.commands.executeCommand('workbench.view.scm');
      return false;
    case 'fetch':
      if (ctx.api) {
        try {
          await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Mergeline: Fetch' }, () => ctx.api!.fetch({ all: true, prune: true }));
          return true;
        } catch (e) {
          await reportError(e, 'Fetch');
          return false;
        }
      }
      return run(ctx, ['fetch', '--all', '--prune'], 'Fetch');
  }
  return false;
}

async function pickParent(parents: string[]): Promise<string | undefined> {
  const p = await vscode.window.showQuickPick(
    parents.map((s, i) => ({ label: `Parent ${i + 1}`, description: short(s), n: String(i + 1) })),
    { placeHolder: 'This is a merge commit. Which parent is the mainline?' },
  );
  return p?.n;
}
