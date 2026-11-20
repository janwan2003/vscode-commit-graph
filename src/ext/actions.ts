// Git operations triggered from the graph. Each asks for what it needs, confirms
// destructive steps with a modal dialog, runs git and reports errors.
import * as vscode from 'vscode';
import * as path from 'node:path';
import { git, GitError } from '../core/gitlog';
import { planRewrite, runRewrite, rewordMessage, squashMessage, RewriteError, RewriteOp, RewritePlan } from '../core/rewrite';
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
  target?: string; // drag and drop: the branch (or commit) dropped on
  path?: string; // worktree path
  message?: string; // tests: skip the input box
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
    // ---- edit history on the current branch ----
    case 'reword':
    case 'dropCommit':
    case 'fixupCommit':
    case 'squashRange':
      return rewrite(ctx, m);
    case 'undoRewrite': {
      // Put the branch back where it was before a rewrite, keeping uncommitted changes.
      const now = (await git(ctx.root, ['rev-parse', 'HEAD'])).trim();
      if (m.target && now !== m.target && !(await confirm('The branch moved since that change.', `Undo would reset it to ${short(sha)} and drop what happened since (still in the reflog).`, 'Undo anyway'))) return false;
      return run(ctx, ['reset', '--keep', sha], 'Undo');
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
    // ---- drag and drop ----
    case 'rebaseBranch': {
      // Rebase branch `ref` onto `target` (a branch name or a commit).
      const onto = m.target!;
      const ontoL = onto.length === 40 ? short(onto) : onto;
      const isCur = m.ref === m.current;
      if (!(await confirm(`Rebase ${m.ref} onto ${ontoL}?`, `${isCur ? `Replays the commits of ${m.ref}` : `Checks out ${m.ref}, then replays its commits`} that are not on ${ontoL} on top of it. This rewrites their hashes.`, 'Rebase'))) return false;
      return run(ctx, isCur ? ['rebase', onto] : ['rebase', onto, m.ref!], `Rebase ${m.ref} onto ${ontoL}`);
    }
    case 'mergeInto': {
      // Merge `ref` into the local branch `target`, checking `target` out first when it is not current.
      const into = m.target!;
      const args = await mergeArgs(m.ref!);
      if (!args) return false;
      if (into !== m.current && !(await run(ctx, ['checkout', into], `Check out ${into}`))) return true;
      args[args.length - 1] = m.ref!;
      await run(ctx, args, `Merge ${m.ref} into ${into}`);
      return true; // the checkout alone changed the graph
    }
    case 'moveBranch': {
      if (!(await confirm(`Move branch ${m.ref} to ${label}?`, `Runs git branch -f ${m.ref} ${short(sha)}. Commits that were only on ${m.ref} stay reachable from the reflog for a while.`, 'Move branch'))) return false;
      return run(ctx, ['branch', '-f', m.ref!, sha], `Move ${m.ref}`);
    }
    // ---- worktrees ----
    case 'addWorktree': {
      // A new working tree for a local branch, a remote branch (as a new local tracking branch) or a commit (detached).
      const isRemote = m.refType === 'remote';
      const remote = isRemote ? m.remote ?? m.ref!.split('/')[0] : '';
      const localName = isRemote ? m.ref!.slice(remote.length + 1) : m.ref;
      const base = path.basename(ctx.root);
      const suffix = (localName ?? short(sha)).replace(/[^\w.-]+/g, '-');
      const where = await vscode.window.showInputBox({ prompt: `Folder for the new worktree (${localName ?? short(sha)})`, value: path.join(path.dirname(ctx.root), `${base}-${suffix}`) });
      if (!where) return false;
      const dest = path.resolve(ctx.root, where);
      let args: string[];
      if (!m.ref) args = ['worktree', 'add', '--detach', dest, sha];
      else if (!isRemote) args = ['worktree', 'add', dest, m.ref];
      else {
        const exists = (await git(ctx.root, ['branch', '--list', localName!])).trim().length > 0;
        args = exists ? ['worktree', 'add', dest, localName!] : ['worktree', 'add', '--track', '-b', localName!, dest, m.ref];
      }
      if (!(await run(ctx, args, `Add worktree ${path.basename(dest)}`))) return false;
      vscode.window.showInformationMessage(`Worktree created at ${dest}.`, 'Open in New Window').then((pick) => {
        if (pick) vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dest), { forceNewWindow: true });
      });
      return true;
    }
    case 'openWorktree':
      if (m.path) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(m.path), { forceNewWindow: true });
      return false;
    case 'removeWorktree': {
      const p = m.path!;
      if (!(await confirm(`Remove the worktree at ${p}?`, 'Deletes that folder. Its branch and commits are kept.', 'Remove worktree'))) return false;
      try {
        await git(ctx.root, ['worktree', 'remove', p]);
        return true;
      } catch (e) {
        if (e instanceof GitError && /modified or untracked|is dirty|use --force/i.test(e.message)) {
          if (await confirm(`The worktree at ${p} has uncommitted changes.`, 'Removing it anyway deletes those changes. They cannot be recovered.', 'Remove anyway')) {
            return run(ctx, ['worktree', 'remove', '--force', p], 'Remove worktree');
          }
          return false;
        }
        await reportError(e, 'Remove worktree');
        return false;
      }
    }
    case 'pruneWorktrees':
      return run(ctx, ['worktree', 'prune'], 'Prune worktrees');
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

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Reword, drop, fold into parent or squash a range of commits on the current branch. */
async function rewrite(ctx: ActionCtx, m: ActionMsg): Promise<boolean> {
  const sha = m.sha ?? '';
  const label = m.subject ? `${short(sha)} "${m.subject.slice(0, 60)}"` : short(sha);
  const branch = m.current ?? 'HEAD';
  const op: RewriteOp =
    m.action === 'reword' ? { kind: 'reword', sha, subject: '' }
    : m.action === 'dropCommit' ? { kind: 'drop', sha }
    : m.action === 'fixupCommit' ? { kind: 'fixup', sha }
    : { kind: 'squash', from: sha, to: m.target ?? '', message: '' };
  let plan: RewritePlan;
  try {
    plan = await planRewrite(ctx.root, op);
  } catch (e) {
    if (e instanceof RewriteError) vscode.window.showWarningMessage(`Mergeline: ${e.message}`);
    else await reportError(e, 'Edit history');
    return false;
  }
  const n = plan.rewritten;
  const pushedNote = plan.pushed.length
    ? `\n\nAlready on ${plan.pushed.slice(0, 3).join(', ')}${plan.pushed.length > 3 ? '…' : ''}. After this you will need to force-push (git push --force-with-lease), which rewrites history for anyone else using that branch.`
    : '';
  const common = `This rewrites ${plural(n, 'commit')} on ${branch} (they get new hashes). Uncommitted changes are stashed and restored. You can undo it afterwards.${pushedNote}`;
  let message: string | undefined;
  let title: string, done: string;
  if (op.kind === 'reword') {
    const subject = m.message ?? (await vscode.window.showInputBox({ prompt: `New subject line for ${short(sha)} (the rest of the message is kept)`, value: m.subject ?? '', validateInput: (v) => (v.trim() ? undefined : 'Enter a subject') }));
    if (!subject || subject === m.subject) return false;
    op.subject = subject;
    if ((plan.first !== plan.head || plan.pushed.length) && !(await confirm(`Change the message of ${short(sha)}?`, common, 'Edit message'))) return false;
    message = await rewordMessage(ctx.root, sha, subject);
    [title, done] = [`Edit message of ${short(sha)}`, `Edited the message of ${short(sha)}`];
  } else if (op.kind === 'drop') {
    if (!(await confirm(`Drop ${label}?`, `Its changes are removed from ${branch}, and later commits are replayed without it. ${common}`, 'Drop commit'))) return false;
    [title, done] = [`Drop ${short(sha)}`, `Dropped ${short(sha)}`];
  } else if (op.kind === 'fixup') {
    if (!(await confirm(`Squash ${label} into its parent?`, `The two commits become one with the parent's message. ${common}`, 'Squash'))) return false;
    [title, done] = [`Squash ${short(sha)}`, `Squashed ${short(sha)} into its parent`];
  } else {
    const range = plan.commits.slice(plan.commits.indexOf(plan.first), plan.commits.indexOf(plan.last) + 1);
    const first = (await git(ctx.root, ['show', '-s', '--format=%s', range[0]])).trim();
    const subject = m.message ?? (await vscode.window.showInputBox({ prompt: `Subject for the squashed commit (${plural(range.length, 'commit')}; the old subjects are listed in its body)`, value: first, validateInput: (v) => (v.trim() ? undefined : 'Enter a subject') }));
    if (!subject) return false;
    if (!(await confirm(`Squash ${plural(range.length, 'commit')} into one?`, `${short(range[0])}…${short(range[range.length - 1])} become a single commit "${subject.slice(0, 60)}". ${common}`, 'Squash'))) return false;
    message = await squashMessage(ctx.root, subject, range);
    op.message = message;
    [title, done] = [`Squash ${range.length} commits`, `Squashed ${range.length} commits`];
  }
  try {
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Mergeline: ${title}` }, () => runRewrite(ctx.root, op, plan, message));
    vscode.window.showInformationMessage(`${done} (${plural(n, 'commit')} rewritten).`, 'Undo').then((pick) => {
      if (pick) runAction(ctx, { action: 'undoRewrite', sha: r.before, target: r.after });
    });
  } catch (e) {
    const msg = e instanceof GitError ? e.message : String((e as Error)?.message ?? e);
    if (/CONFLICT|could not apply|Resolve all conflicts/i.test(msg)) {
      vscode.window.showWarningMessage(`${title}: a later commit conflicts. Resolve the conflicts in Source Control and continue the rebase, or abort it.`, 'Open Source Control', 'Abort rebase').then((pick) => {
        if (pick === 'Open Source Control') vscode.commands.executeCommand('workbench.view.scm');
        else if (pick === 'Abort rebase') run(ctx, ['rebase', '--abort'], 'Abort rebase');
      });
    } else await reportError(e, title);
  }
  return true;
}

async function pickParent(parents: string[]): Promise<string | undefined> {
  const p = await vscode.window.showQuickPick(
    parents.map((s, i) => ({ label: `Parent ${i + 1}`, description: short(s), n: String(i + 1) })),
    { placeHolder: 'This is a merge commit. Which parent is the mainline?' },
  );
  return p?.n;
}
