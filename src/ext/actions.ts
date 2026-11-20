// Git operations triggered from the graph. Each asks for what it needs, confirms
// destructive steps with a modal dialog, runs git and reports errors.
import * as vscode from 'vscode';
import * as path from 'node:path';
import { git, GitError } from '../core/gitlog';
import { planRewrite, runRewrite, rewordMessage, squashMessage, findFixups, RewriteError, RewriteOp, RewritePlan } from '../core/rewrite';
import { readOperation, unmerged, leftoverMarkers, opArgs, opNames, NO_EDITOR, OpKind } from '../core/progress';
import { GitApiRepo } from './repos';
import { readRemotes, remoteNameProblem, remoteUsage, Remote } from '../core/remotes';
import { webRepo } from '../core/remote';
import { archiveFormat } from '../core/misc';
import { readBisect, markArgs, bisectRunLine, BisectMark } from '../core/bisect';

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
  message?: string; // reword/squash: the new subject (skips the input box)
  fullMessage?: string; // reword: the whole new message, from the webview's editor
  dir?: 'older' | 'newer'; // moveCommit
  fold?: boolean; // placeCommit: fold into the target instead of moving next to it
  targetSubject?: string; // placeCommit
  op?: string; // manageRemotes: add | fetch | prune | setUrl | rename | remove | copy | open (skips the menus)
  url?: string; // manageRemotes add/setUrl
  fetch?: boolean; // manageRemotes add: fetch after adding
  upstream?: string; // updateBranch: shown in messages
  mark?: BisectMark; // bisectStart / bisectMark
  command?: string; // bisectRun: the test command (skips the input box)
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
    case 'archive': {
      // The tracked files at this commit (git archive: no .git, nothing untracked, export-ignore honoured).
      const tag = (m.ref ? m.ref.replace(/[^\w.-]+/g, '-') : short(sha)) || short(sha);
      const base = `${path.basename(ctx.root)}-${tag}`;
      const uri = await vscode.window.showSaveDialog({
        title: `Save ${m.ref ?? label} as an archive`,
        defaultUri: vscode.Uri.file(path.join(path.dirname(ctx.root), `${base}.zip`)),
        filters: { 'Zip archive': ['zip'], 'Gzipped tar': ['tar.gz', 'tgz'], 'Tar archive': ['tar'] },
      });
      if (!uri) return false;
      const fmt = archiveFormat(uri.fsPath);
      const name = path.basename(uri.fsPath).replace(/\.(zip|tar\.gz|tgz|tar)$/i, '') || base;
      const file = fmt.ext ? uri.fsPath : `${uri.fsPath}.zip`;
      const ok = await run(ctx, ['archive', `--format=${fmt.format}`, `--prefix=${name}/`, '-o', file, sha], `Save archive ${path.basename(file)}`);
      if (ok) {
        vscode.window.showInformationMessage(`Mergeline: saved ${path.basename(file)}`, 'Reveal in file manager').then((pick) => {
          if (pick) vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(file));
        });
      }
      return false;
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
    case 'moveCommit':
    case 'placeCommit':
    case 'editCommit':
    case 'autosquash':
      return rewrite(ctx, m);
    case 'createFixup':
      return createFixup(ctx, m);
    case 'opContinue':
    case 'opSkip':
    case 'opAbort':
      return goOn(ctx, m.action === 'opContinue' ? 'continue' : m.action === 'opSkip' ? 'skip' : 'abort', !!m.message);
    case 'undoRewrite': {
      // Put the branch back where it was before a rewrite, keeping uncommitted changes.
      const now = (await git(ctx.root, ['rev-parse', 'HEAD'])).trim();
      if (m.target && now !== m.target && !(await confirm('The branch moved since that change.', `Undo would reset it to ${short(sha)} and drop what happened since (still in the reflog).`, 'Undo anyway'))) return false;
      return run(ctx, ['reset', '--keep', sha], 'Undo');
    }
    // ---- bisect ----
    case 'bisectStart': {
      const mark = m.mark === 'good' ? 'good' : 'bad';
      if (await readBisect(ctx.root)) {
        vscode.window.showWarningMessage('A bisect is already running. Mark commits from the bar or the commit menu, or reset it first.');
        return true;
      }
      if (!(await run(ctx, ['bisect', 'start'], 'Start bisect'))) return true;
      return (await run(ctx, markArgs(['bad', 'good'], mark, sha), `Mark ${short(sha)} as ${mark}`)) || true;
    }
    case 'bisectMark': {
      const st = await readBisect(ctx.root);
      if (!st) {
        vscode.window.showWarningMessage('No bisect is running.');
        return true;
      }
      const mark: BisectMark = m.mark === 'good' || m.mark === 'skip' ? m.mark : 'bad';
      return (await run(ctx, markArgs(st.terms, mark, sha || undefined), `Bisect: mark ${sha ? short(sha) : 'HEAD'} as ${mark === 'skip' ? 'skipped' : mark === 'bad' ? st.terms[0] : st.terms[1]}`)) || true;
    }
    case 'bisectReset': {
      const st = await readBisect(ctx.root);
      return (await run(ctx, ['bisect', 'reset'], `Stop bisect${st?.start ? ` and go back to ${st.start}` : ''}`)) || true;
    }
    case 'bisectRun': {
      const st = await readBisect(ctx.root);
      if (!st || !st.bad || !st.good.length) {
        vscode.window.showWarningMessage('Mark one good and one bad commit first, then run a test command.');
        return false;
      }
      const cmd =
        m.command ??
        (await vscode.window.showInputBox({
          prompt: 'Command that tests the checked-out commit: exit 0 = good, 1-127 = bad, 125 = skip (runs git bisect run in a terminal)',
          placeHolder: 'npm test',
        }));
      if (!cmd || !cmd.trim()) return false;
      const t = vscode.window.createTerminal({ name: 'Mergeline bisect', cwd: ctx.root });
      t.show();
      t.sendText(bisectRunLine(cmd, process.platform === 'win32'));
      return false;
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
    case 'updateBranch': {
      // Fast-forward a local branch that is not checked out to the branch it tracks, without
      // checking it out: git fetch <remote> <merge>:refs/heads/<branch>. git refuses a
      // non-fast-forward update (the branch has its own commits) and a branch checked out in a worktree.
      const b = m.ref!;
      const cfg = async (k: string) => (await git(ctx.root, ['config', '--get', k]).catch(() => '')).trim();
      const remote = await cfg(`branch.${b}.remote`);
      const merge = await cfg(`branch.${b}.merge`);
      if (!remote || !merge) {
        vscode.window.showInformationMessage(`Mergeline: ${b} does not track a remote branch.`);
        return false;
      }
      if (b === m.current) return runAction(ctx, { ...m, action: 'pull' });
      try {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Mergeline: Update ${b}` }, () => git(ctx.root, ['fetch', remote, `${merge}:refs/heads/${b}`]));
        return true;
      } catch (e) {
        const msg = e instanceof GitError ? e.message : String(e);
        if (/non-fast-forward|rejected/i.test(msg)) {
          vscode.window.showWarningMessage(`Mergeline: ${b} has commits that ${m.upstream ?? 'its upstream'} does not, so it cannot be fast-forwarded. Check it out and pull (merge or rebase) instead.`);
          return true; // the fetch may still have updated the remote-tracking branch
        }
        await reportError(e, `Update ${b}`);
        return false;
      }
    }
    case 'pullInto': {
      // Fetch one remote branch, then merge it into the current branch.
      if (!m.current) {
        vscode.window.showInformationMessage('Mergeline: check out a branch first; HEAD is detached.');
        return false;
      }
      const remote = m.remote ?? m.ref!.split('/')[0];
      const branch = m.ref!.slice(remote.length + 1);
      const args = await mergeArgs(`${m.ref} (after fetching it)`);
      if (!args) return false;
      try {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Mergeline: Fetch ${m.ref}` }, () => git(ctx.root, ['fetch', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]));
      } catch (e) {
        await reportError(e, `Fetch ${m.ref}`);
        return false;
      }
      args[args.length - 1] = `refs/remotes/${remote}/${branch}`;
      await run(ctx, args, `Pull ${m.ref} into ${m.current}`);
      return true;
    }
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
    case 'manageRemotes':
      return manageRemotes(ctx, m);
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

/**
 * Remotes: list them with their URLs, add one, and for one remote fetch, fetch and prune,
 * change its URL, rename, remove, copy the URL or open it on its forge. `m.remote` preselects
 * a remote; `m.op` (with `m.url`, `m.message` = name, `m.fetch`) skips the menus and inputs.
 */
async function manageRemotes(ctx: ActionCtx, m: ActionMsg): Promise<boolean> {
  const rs = await readRemotes(ctx.root);
  const names = rs.map((r) => r.name);
  let op = m.op;
  let r: Remote | undefined = rs.find((x) => x.name === m.remote);
  if (!op && !r) {
    type Item = vscode.QuickPickItem & { remote?: Remote };
    const items: Item[] = [
      ...rs.map((x) => ({ label: `$(repo) ${x.name}`, description: x.fetch || '(no URL)', detail: x.push !== x.fetch ? `push: ${x.push}` : undefined, remote: x })),
      { label: '$(add) Add remote…', description: 'git remote add' },
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: rs.length ? 'Remotes of this repository: pick one to manage it, or add one' : 'This repository has no remotes yet' });
    if (!pick) return false;
    if (pick.remote) r = pick.remote;
    else op = 'add';
  }
  if (!op && r) {
    const web = webRepo(r.fetch);
    const forge = web ? { github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket' }[web.forge] : '';
    const items: (vscode.QuickPickItem & { op: string })[] = [
      { label: '$(cloud-download) Fetch', description: `git fetch ${r.name}`, op: 'fetch' },
      { label: '$(cloud-download) Fetch and prune', description: 'also deletes remote-tracking branches whose branch is gone on the remote', op: 'prune' },
      { label: '$(edit) Change URL…', description: r.fetch, op: 'setUrl' },
      { label: '$(tag) Rename…', op: 'rename' },
      { label: '$(trash) Remove…', description: 'git remote remove', op: 'remove' },
      { label: '$(copy) Copy URL', op: 'copy' },
      ...(web ? [{ label: `$(link-external) Open on ${forge}`, description: web.base, op: 'open' }] : []),
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: `Remote “${r.name}” (${r.fetch || 'no URL'})` });
    if (!pick) return false;
    op = pick.op;
  }
  if (op !== 'add' && !r) {
    vscode.window.showErrorMessage(`Mergeline: there is no remote named “${m.remote ?? ''}”.`);
    return false;
  }
  switch (op) {
    case 'add': {
      const name = m.message ?? (await vscode.window.showInputBox({ prompt: 'New remote name', value: names.includes('origin') ? (names.includes('upstream') ? '' : 'upstream') : 'origin', validateInput: (v) => remoteNameProblem(v, names) }));
      if (!name) return false;
      const problem = remoteNameProblem(name, names);
      if (problem) {
        vscode.window.showErrorMessage(`Mergeline: ${problem}.`);
        return false;
      }
      const url = m.url ?? (await vscode.window.showInputBox({ prompt: `URL of “${name.trim()}” (https://…, git@host:owner/repo.git or a path)`, validateInput: (v) => (v.trim() ? undefined : 'Enter a URL') }));
      if (!url?.trim()) return false;
      let fetch = m.fetch;
      if (fetch === undefined && m.op === undefined) {
        const how = await vscode.window.showQuickPick(['Add and fetch', 'Add only'], { placeHolder: `Add remote ${name.trim()}` });
        if (!how) return false;
        fetch = how === 'Add and fetch';
      }
      if (!(await run(ctx, ['remote', 'add', name.trim(), url.trim()], `Add remote ${name.trim()}`))) return false;
      if (fetch) await run(ctx, ['fetch', name.trim()], `Fetch ${name.trim()}`);
      return true;
    }
    case 'fetch':
    case 'prune':
      return run(ctx, ['fetch', ...(op === 'prune' ? ['--prune'] : []), r!.name], `${op === 'prune' ? 'Fetch and prune' : 'Fetch'} ${r!.name}`);
    case 'setUrl': {
      const url = m.url ?? (await vscode.window.showInputBox({ prompt: `New URL for “${r!.name}”`, value: r!.fetch, validateInput: (v) => (v.trim() ? undefined : 'Enter a URL') }));
      if (!url?.trim() || url.trim() === r!.fetch) return false;
      const ok = await run(ctx, ['remote', 'set-url', r!.name, url.trim()], `Change URL of ${r!.name}`);
      if (ok && r!.push !== r!.fetch) vscode.window.showInformationMessage(`Mergeline: changed the fetch URL of “${r!.name}”. Its separate push URL is still ${r!.push}.`);
      return ok;
    }
    case 'rename': {
      const others = names.filter((n) => n !== r!.name);
      const name = m.message ?? (await vscode.window.showInputBox({ prompt: `Rename remote “${r!.name}” to`, value: r!.name, validateInput: (v) => (v.trim() === r!.name ? undefined : remoteNameProblem(v, others)) }));
      if (!name?.trim() || name.trim() === r!.name) return false;
      const problem = remoteNameProblem(name, others);
      if (problem) {
        vscode.window.showErrorMessage(`Mergeline: ${problem}.`);
        return false;
      }
      // git also renames the remote-tracking branches and the upstream settings that point at it.
      return run(ctx, ['remote', 'rename', r!.name, name.trim()], `Rename remote ${r!.name}`);
    }
    case 'remove': {
      const u = await remoteUsage(ctx.root, r!.name);
      const parts = [
        u.tracking.length ? `Its ${plural(u.tracking.length, 'remote-tracking branch')} (${u.tracking.slice(0, 3).join(', ')}${u.tracking.length > 3 ? '…' : ''}) ${u.tracking.length === 1 ? 'is' : 'are'} deleted from this repository.` : '',
        u.upstreamOf.length ? `${plural(u.upstreamOf.length, 'local branch')} (${u.upstreamOf.slice(0, 3).join(', ')}${u.upstreamOf.length > 3 ? '…' : ''}) lose${u.upstreamOf.length === 1 ? 's' : ''} ${u.upstreamOf.length === 1 ? 'its' : 'their'} upstream.` : '',
        'Nothing changes on the remote itself, and your local branches and commits stay.',
      ].filter(Boolean);
      if (!(await confirm(`Remove remote “${r!.name}”?`, `${r!.fetch}\n\n${parts.join('\n')}`, 'Remove remote'))) return false;
      return run(ctx, ['remote', 'remove', r!.name], `Remove remote ${r!.name}`);
    }
    case 'copy':
      await vscode.env.clipboard.writeText(r!.fetch);
      return false;
    case 'open': {
      const web = webRepo(r!.fetch);
      if (web && !process.env.MERGELINE_E2E_REPORT) await vscode.env.openExternal(vscode.Uri.parse(web.base, true));
      return false;
    }
  }
  return false;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : /(ch|sh|s|x)$/.test(w) ? 'es' : 's'}`;

/** Exit status 0 → true, 1 → false (git diff --quiet and friends). */
async function quiet(root: string, args: string[]): Promise<boolean> {
  try {
    await git(root, args);
    return true;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
}

/** `git commit --fixup=<sha>` from the staged changes (offers `git add -u` when nothing is staged). */
async function createFixup(ctx: ActionCtx, m: ActionMsg): Promise<boolean> {
  const sha = m.sha ?? '';
  const label = m.subject ? `${short(sha)} "${m.subject.slice(0, 60)}"` : short(sha);
  if (await quiet(ctx.root, ['diff', '--cached', '--quiet'])) {
    if (await quiet(ctx.root, ['diff', '--quiet'])) {
      vscode.window.showWarningMessage('Mergeline: nothing to put in a fixup commit. Change files (and stage them) first; the staged changes become the fixup commit.');
      return false;
    }
    if (!(await confirm(`Nothing is staged. Stage all changes to tracked files and create a fixup commit for ${label}?`, 'Runs git add -u (new, untracked files are left out), then git commit --fixup. To pick the changes yourself, stage them in Source Control and run this again.', 'Stage all and create'))) return false;
    if (!(await run(ctx, ['add', '-u'], 'Stage changes'))) return false;
  }
  if (!(await run(ctx, ['commit', `--fixup=${sha}`], `Create fixup commit for ${short(sha)}`))) return true;
  vscode.window.showInformationMessage(`Created a fixup commit for ${label}. "Squash fixup commits into their targets" (commit menu) folds it in, now or later.`, 'Squash now').then((pick) => {
    if (pick) runAction(ctx, { action: 'autosquash', current: m.current });
  });
  return true;
}

/** Reword, drop, fold into parent or squash a range of commits on the current branch. */
async function rewrite(ctx: ActionCtx, m: ActionMsg): Promise<boolean> {
  let fixups: Awaited<ReturnType<typeof findFixups>> = [];
  if (m.action === 'autosquash') {
    fixups = await findFixups(ctx.root);
    if (!fixups.length) {
      vscode.window.showWarningMessage('Mergeline: no fixup!, squash! or amend! commits with a target were found on the checked-out branch (back to its last merge).');
      return false;
    }
    // The oldest target: the one furthest from HEAD on the first-parent line.
    const line = (await git(ctx.root, ['rev-list', '--first-parent', 'HEAD', `-n${fixups.length + 2000}`])).split('\n');
    m = { ...m, sha: fixups.map((f) => f.target).sort((a, b) => line.indexOf(b) - line.indexOf(a))[0] };
  }
  const sha = m.sha ?? '';
  const label = m.subject ? `${short(sha)} "${m.subject.slice(0, 60)}"` : short(sha);
  const branch = m.current ?? 'HEAD';
  const op: RewriteOp =
    m.action === 'reword' ? { kind: 'reword', sha, subject: '' }
    : m.action === 'dropCommit' ? { kind: 'drop', sha }
    : m.action === 'editCommit' ? { kind: 'edit', sha }
    : m.action === 'fixupCommit' ? { kind: 'fixup', sha }
    : m.action === 'moveCommit' ? { kind: 'move', sha, dir: m.dir === 'newer' ? 'newer' : 'older' }
    : m.action === 'placeCommit' ? { kind: 'place', sha, target: m.target ?? '', fold: !!m.fold }
    : m.action === 'autosquash' ? { kind: 'autosquash', sha }
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
    if (m.fullMessage !== undefined) {
      // From the webview's message editor: the whole message, as typed.
      message = m.fullMessage.replace(/\s+$/, '') + '\n';
      if (!message.trim()) return false;
      const old = await git(ctx.root, ['show', '-s', '--format=%B', sha]);
      if (old.replace(/\s+$/, '') + '\n' === message) return false;
      op.subject = message.split('\n')[0];
    } else {
      const subject = m.message ?? (await vscode.window.showInputBox({ prompt: `New subject line for ${short(sha)} (the rest of the message is kept)`, value: m.subject ?? '', validateInput: (v) => (v.trim() ? undefined : 'Enter a subject') }));
      if (!subject || subject === m.subject) return false;
      op.subject = subject;
      message = await rewordMessage(ctx.root, sha, subject);
    }
    if ((plan.first !== plan.head || plan.pushed.length) && !(await confirm(`Change the message of ${short(sha)}?`, common, 'Edit message'))) return false;
    [title, done] = [`Edit message of ${short(sha)}`, `Edited the message of ${short(sha)}`];
  } else if (op.kind === 'move') {
    const word = op.dir === 'older' ? 'down (before its parent)' : 'up (after the next commit)';
    if (!(await confirm(`Move ${label} ${word}?`, `The two commits swap places. If both change the same lines, git stops with a conflict that you resolve or abort. ${common}`, 'Move commit'))) return false;
    [title, done] = [`Move ${short(sha)}`, `Moved ${short(sha)} ${op.dir === 'older' ? 'down' : 'up'}`];
  } else if (op.kind === 'place') {
    const tl = m.targetSubject ? `${short(m.target)} "${m.targetSubject.slice(0, 60)}"` : short(m.target);
    const what = op.fold
      ? [`Squash ${label} into ${tl}?`, `Its changes join ${short(m.target)}, which keeps its message.`, 'Squash', `Squash ${short(sha)}`, `Squashed ${short(sha)} into ${short(m.target)}`]
      : [`Move ${label} to right after ${tl}?`, `It is replayed directly on top of ${short(m.target)}.`, 'Move commit', `Move ${short(sha)}`, `Moved ${short(sha)}`];
    if (!(await confirm(what[0], `${what[1]} If commits in between change the same lines, git stops with a conflict that you resolve or abort. ${common}`, what[2]))) return false;
    [title, done] = [what[3], what[4]];
  } else if (op.kind === 'edit') {
    if (!(await confirm(`Stop at ${label} to change it?`, `Git replays ${branch} up to this commit and stops there. Change files and stage them, then press Continue in the bar above the graph: the staged changes are added to this commit (its message is kept) and the later commits are replayed on top. Abort puts everything back. ${common}`, 'Stop here'))) return false;
    [title, done] = [`Stop at ${short(sha)}`, ''];
  } else if (op.kind === 'autosquash') {
    const k = fixups.length;
    const list = fixups.slice(0, 4).map((f) => `• ${f.subject.slice(0, 70)} → ${short(f.target)}`).join('\n') + (k > 4 ? `\n• … ${k - 4} more` : '');
    if (!(await confirm(`Squash ${plural(k, 'fixup commit')} into ${k === 1 ? 'its target' : 'their targets'}?`, `${list}\n\nRuns git rebase --autosquash from ${short(sha)}'s parent: fixup! commits fold in silently, amend! ones also replace the message, squash! ones add their message. ${common}`, 'Squash fixups'))) return false;
    [title, done] = [`Squash ${plural(k, 'fixup commit')}`, `Squashed ${plural(k, 'fixup commit')}`];
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
    if (op.kind === 'edit') {
      vscode.window.showInformationMessage(`Stopped at ${label}. Change and stage files, then press Continue in the bar above the graph.`);
      return true;
    }
    vscode.window.showInformationMessage(`${done} (${plural(n, 'commit')} rewritten).`, 'Undo').then((pick) => {
      if (pick) runAction(ctx, { action: 'undoRewrite', sha: r.before, target: r.after });
    });
  } catch (e) {
    const msg = e instanceof GitError ? e.message : String((e as Error)?.message ?? e);
    if (/CONFLICT|could not apply|Resolve all conflicts/i.test(msg)) {
      vscode.window.showWarningMessage(`${title}: a commit conflicts. Resolve the conflicts, stage the files, then press Continue in the bar above the graph (or abort).`, 'Open Source Control', 'Abort rebase').then((pick) => {
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

/**
 * Continue, skip or abort the rebase/merge/cherry-pick/revert/am that is in progress.
 * Continue never opens an editor (git keeps the message it prepared) and refuses while
 * files are unmerged; staged files that still hold conflict markers need a second yes.
 * `force` (tests) skips the confirmations.
 */
async function goOn(ctx: ActionCtx, what: 'continue' | 'skip' | 'abort', force = false): Promise<boolean> {
  const op = await readOperation(ctx.root);
  if (!op) {
    vscode.window.showInformationMessage('Mergeline: nothing is in progress any more.');
    return true;
  }
  const name = opNames[op.kind];
  if (what === 'skip' && op.kind === 'merge') return false;
  if (what === 'continue') {
    const u = await unmerged(ctx.root);
    if (u.length) {
      const pick = await vscode.window.showWarningMessage(
        `${plural(u.length, 'file')} still ${u.length === 1 ? 'has' : 'have'} conflicts: ${u.slice(0, 3).join(', ')}${u.length > 3 ? '…' : ''}. Resolve and stage ${u.length === 1 ? 'it' : 'them'} first.`,
        'Open Source Control',
      );
      if (pick) vscode.commands.executeCommand('workbench.view.scm');
      return false;
    }
    const marked = await leftoverMarkers(ctx.root);
    if (marked.length && !force && !(await confirm(`${plural(marked.length, 'staged file')} still contain${marked.length === 1 ? 's' : ''} conflict markers.`, `${marked.slice(0, 5).join('\n')}\n\nContinuing commits them with the <<<<<<< / >>>>>>> lines in.`, 'Continue anyway'))) return false;
  }
  if (what === 'abort' && !force) {
    // rebase/cherry-pick/revert/am --abort all return to where the operation started (also undoing commits it already made).
    const back = op.kind === 'merge' ? 'The merge is undone and the branch stays where it was' : `${op.branch ?? 'The branch'} goes back to where it was before the ${name} started, including any commits it already made`;
    if (!(await confirm(`Abort the ${name}?`, `${back}. Conflict resolutions you made for it are lost.`, `Abort ${op.kind === 'am' ? 'am' : name}`))) return false;
  }
  if (what === 'skip' && !force && !(await confirm(`Skip ${op.stopped ? short(op.stopped) + (op.stoppedSubject ? ` "${op.stoppedSubject.slice(0, 60)}"` : '') : 'this commit'}?`, `Its changes are left out and the ${name} goes on with the next commit.`, 'Skip commit'))) return false;
  const verb = what[0].toUpperCase() + what.slice(1);
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Mergeline: ${verb} ${name}` }, () => git(ctx.root, opArgs(op.kind as OpKind, what), { env: NO_EDITOR }));
  } catch (e) {
    const msg = e instanceof GitError ? e.message : String((e as Error)?.message ?? e);
    // Stopping again on the next commit is normal: the bar shows the new step.
    if (/CONFLICT|could not apply|conflict/i.test(msg)) vscode.window.showWarningMessage(`Mergeline: the ${name} stopped again on a conflict. Resolve it, stage the files, then Continue.`);
    else vscode.window.showErrorMessage(`${verb} ${name} failed: ${msg.split('\n').slice(0, 6).join(' ')}`);
  }
  return true;
}
