# Changelog

## 0.14.0 (2026-11-20)

- **Pinned branches keep their own straight column.** `main`, `master` and `develop` now each get a fixed column on the left of the graph with a fixed colour, and their history is drawn as one straight line instead of moving from column to column as other branches start and end. Git-flow repositories read at a glance: `main` on the far left, `develop` next to it, features and releases to the right. Pin any other branch, or a pattern like `release/*`, with the new setting `mergeline.pinnedBranches` (earlier entries get the leftmost columns, at most 4), or right-click a branch → **Pin to its own column on the left** / **Unpin**. A local branch and its remote branch (`main`, `origin/main`) share a column. Set the setting to `[]` for the previous layout.
- A pinned line is the branch's first-parent history (each commit's first parent, as `git log --first-parent` follows it). Where a pinned branch started from another pinned branch, its line joins that column there. The "Uncommitted changes" row stays straight above a pinned checked-out branch.

## 0.13.0 (2026-11-20)

- **Bisect from the graph.** Right-click a commit → **Start bisect: this commit is bad** (or **good**), then mark a commit from the other side, and git checks out the commit halfway between. A bar above the graph shows the commit under test and how many are left (“4 commits left, about 3 steps”), with **Good**, **Bad**, **Skip** and **Reset**. The graph selects each new commit to test and puts **bad**, **good** and **skip** badges on the commits you have judged. While a bisect runs, the commit menu offers **Bisect: mark as bad / good**, **Bisect: skip this commit** and **Bisect: stop and go back (reset)**, and the history-editing items are hidden.
- **Run a test command.** In the bar, **Run a test command…** asks for a command (for example `npm test`) and runs `git bisect run` with it in a VS Code terminal named “Mergeline bisect”: exit code 0 means good, 1 to 127 bad, 125 skip. The command goes through `sh -c`, so `&&`, pipes and redirections work. The graph follows each step, and the bar names the first bad commit at the end.
- Bisects started in a terminal show up in the bar too, with custom terms (`git bisect start --term-old=fast --term-new=slow`) used as the button labels. When only skipped commits are left, the bar says how many commits the first bad one could be.

## 0.12.0 (2026-11-20)

- **Ahead/behind on branch badges.** A local branch that tracks a remote branch shows **↑N** for commits you have not pushed and **↓N** for commits you have not pulled yet (as of your last fetch). Hover for the details. A **✕** means its upstream branch was deleted on the remote.
- **Update a branch without checking it out.** Right-click a branch that is not checked out → **Update from origin/… (fast-forward)** brings it up to date with the branch it tracks (`git fetch origin main:main`). If the branch has commits of its own, nothing changes and Mergeline tells you to check it out and pull instead.
- **Pull a remote branch into yours.** Right-click a remote branch → **Fetch and merge into “main” (pull)…** fetches that branch first, so you merge what is on the server now rather than what you fetched last time. It offers the usual merge choices (fast-forward, `--no-ff`, `--squash`).
- **First parent only.** A **First parent** checkbox in the toolbar (setting `mergeline.firstParentOnly`) follows only the first parent of merges, as `git log --first-parent` does. On a mainline full of merged pull requests you see one commit per merge, not every commit of every branch. Find in all history searches the same view.
- **Signed commits.** The details pane shows a commit's signature: good (with the signer and key), good but untrusted, expired, revoked, bad, or "could not be checked" when your machine lacks the key or SSH allowed-signers file. Git does the checking with your own keys; unsigned commits show nothing.

## 0.11.0 (2026-11-20)

- **Find commits by changed path.** Type `path:` and some text in Find (`path:src/auth`, `path:package.json`, `path:*.md`) and press Enter: Mergeline searches the whole history, not just the loaded commits, for commits that changed a file or folder whose path contains the text (case-insensitive), or matches the glob when it has `*`, `?` or `[`. Step through the matches as usual; an unloaded match is loaded when you reach it. It uses git's default history simplification, like `git log -- <path>`.
- **Issue links for any tracker.** New setting `mergeline.issueLinks`: rules like `{ "pattern": "\\bPROJ-\\d+\\b", "url": "https://yourcompany.atlassian.net/browse/$0" }` turn Jira, Linear, YouTrack or other keys in commit and tag messages into links (`$0` is the match, `$1`… its groups). Invalid rules are skipped with a warning. GitHub, GitLab and Bitbucket `#123` links still work without it.
- **Save as archive.** Right-click a commit, branch, remote branch or tag → **Save as archive (zip, tar.gz)…** writes the tracked files at that commit to a `.zip`, `.tar.gz` or `.tar` (`git archive`, with one top folder named after the file; `export-ignore` paths are left out).
- **Tag details.** The details pane lists the tags on a commit: annotated tags with their tagger, date and message, lightweight tags marked as such. Tag badges gain **Show tag details**.
- **Avatars (opt-in).** New setting `mergeline.showAvatars` (off by default) shows author avatars in the graph and the details pane: GitHub noreply addresses use the GitHub avatar, other addresses Gravatar (an MD5 hash of the email). Authors without an avatar get their initials in a coloured circle. While the setting is off, nothing is requested.

## 0.10.0 (2026-11-20)

- **Fixup commits.** Right-click a commit on the checked-out branch → **Create fixup commit for this** turns your staged changes into a `fixup!` commit for it (`git commit --fixup`). If nothing is staged it offers to stage your changes to tracked files first (`git add -u`; new files are left out). When the branch has `fixup!`, `squash!` or `amend!` commits, the commit menu offers **Squash N fixup commits into their targets…**: one `git rebase --autosquash` from the parent of the oldest target, with no editor, the usual autostash, a warning when the commits are already pushed, and Undo.
- **Conflicted files are listed in the bar.** When a rebase, merge, cherry-pick or revert stops on a conflict, the bar above the graph now names the conflicted files (the first three, then **+N more ▾**). Click one to open it in VS Code's 3-way merge editor (the plain file if the merge editor can't open it).
- **Faster "Load more" in big repositories.** Loading the next page used to lay out and re-send every commit already shown; now only the new commits are laid out and sent, as long as nothing else changed. On git.git, scrolling down to 5,000 commits in pages of 500 now sends 2.0 MB to the graph instead of 11.9 MB.
- Fixed: after loading more commits, the newly loaded ones could be dimmed by `mergeline.dimOtherCommits` or miss the edit items even when they were on the checked-out branch.

## 0.9.0 (2026-11-20)

- **Review a commit file by file.** Above a commit's changed files (or a comparison of two commits, or a branch's changes since it split off) there is now a **Review** button; right-click a commit → **Review changes file by file** does the same. Each file gets a check box and the header counts "N of M reviewed". **Next unreviewed** opens the next file's diff in VS Code's diff editor, and opening any file's diff ticks it. Click a check box (or right-click → Mark as not reviewed) to change it. Progress is kept per commit or comparison in the workspace, so you can close VS Code and carry on later; **End review** forgets it. The 200 most recent reviews are kept. Uncommitted changes have no review mode, since they keep changing.
- **Manage remotes.** A **Remotes…** toolbar button (also **Mergeline: Manage Remotes** in the Command Palette, and **Manage remote “origin”…** on remote branch badges) lists the repository's remotes with their URLs. **Add remote…** asks for a name and URL and can fetch it at once. For a remote: **Fetch**, **Fetch and prune**, **Change URL…**, **Rename…** (git moves its remote-tracking branches and upstream settings along), **Remove…** (says first which remote-tracking branches are deleted and which local branches lose their upstream), **Copy URL** and **Open on GitHub/GitLab/Bitbucket**. The toolbar checkbox that hides remote branches is now labelled **Remote branches**.
- **Stop at a commit to change it.** Right-click a commit on the checked-out branch → **Stop at this commit to change it…** replays the branch up to that commit and stops. Change files, stage them and press **Continue** in the bar: the staged changes are added to that commit (its message is kept) and the later commits are replayed on top. Abort puts everything back.

## 0.8.0 (2026-11-20)

- **Show only some branches.** The toolbar's branch filter is now a checklist: tick any number of local or remote branches to see only their history together. **Current branch** shows just the checked-out one, **All branches** clears it, and a search box narrows long lists. It replaces the old single-branch dropdown.
- **Drag a commit.** Drag a commit row from another branch onto the current branch's badge or the HEAD row to **cherry-pick** it. Drag a commit on your branch onto another commit on it to **squash it into that commit** or **move it to right after it**, anywhere on the branch, not just next to its neighbour. These use the same safety as the other history edits (autostash, a warning for pushed commits, Undo, and the Continue/Skip/Abort bar on a conflict). Nothing runs until you pick an item from the menu that opens on drop.
- **Create pull request.** Branch menus gain **Create pull request on GitHub…** (or GitLab, Bitbucket). It opens the forge's new pull request (merge request) page for that branch in your browser. A local branch uses the branch it tracks; one that is not pushed yet is offered a push first. Mergeline still makes no network requests itself and needs no sign-in.
- **Dim other commits.** New setting `mergeline.dimOtherCommits` (off by default) fades commits that are not in the checked-out branch's history, so your branch's line stands out.
- **Ctrl/Cmd+H** jumps to the checked-out commit.

## 0.7.0 (2026-11-20)

- **Rebase, merge, cherry-pick or revert in progress? The graph says so.** When one of them has stopped (usually on a conflict), whether Mergeline started it or you did in a terminal, a bar above the graph shows what is happening: for example "Rebasing main onto feature/x — step 2 of 5, stopped at 1a2b3c4 “subject” · 2 conflicted files". Its buttons **Continue**, **Skip** (not for merges), **Abort** and **Source Control** do the obvious thing. Continue never opens an editor (git keeps the message it prepared), refuses while files are still unmerged, and asks again if a staged file still contains conflict markers. Abort and Skip ask first. `git am` is recognised too.
- **Edit the whole commit message.** **Edit commit message…** now opens an editor in the graph with the subject and the body, so you can rewrite both (Ctrl/Cmd+Enter saves, Esc cancels). It warns when the subject is longer than 72 characters.
- **Move a commit up or down.** Right-click a commit on the checked-out branch: **Move commit up (newer)** or **Move commit down (older)** swaps it with its neighbour, with the same safety as the other edits (autostash, pushed-commit warning, Undo). If the two commits change the same lines, the rebase stops and the new bar takes you through it.
- While something is in progress, the edit-history items are hidden (finish or abort it first).

## 0.6.0 (2026-11-20)

- **Edit history from the graph.** Right-click a commit on the checked-out branch: **Edit commit message…** (change the subject line; the rest of the message is kept), **Squash into parent** (the two become one commit with the parent's message) or **Drop commit…** (later commits are replayed without it). Ctrl/Cmd-click a second commit on the branch, then right-click either one, or use the link in the details pane, to **Squash N commits into one** with a new subject; the old subjects are listed in its body. Mergeline writes the rebase plan itself, so no editor or terminal opens, and `--autostash` keeps your uncommitted changes. It refuses when a merge commit is in the way, warns before rewriting commits that are already on a remote branch, and every change offers **Undo** (`git reset --keep` to where the branch was). If a later commit conflicts, the notification offers Open Source Control or Abort rebase.
- **Changed files as a tree.** The details pane can show changed files in folders (the default) or as a flat list of paths; the choice is kept. Click a folder to collapse it. A folder that only holds one folder is shown as one row (`src/core/`).

## 0.5.0 (2026-11-20)

- **Drag and drop branches.** Drag a branch badge (local or remote) onto another branch or onto any commit, and choose what to do: merge it into that branch (Mergeline checks the target out first if it is not current), rebase it onto that branch or commit (`git rebase <onto> <branch>`), move the branch there (`git branch -f`, or a reset when it is the current branch), compare the two, or see the changes since they split. The target row is highlighted while you drag, and nothing runs until you pick an item; rebases and moves ask first.
- **Worktrees.** Other working trees of the repository (`git worktree`) show as a ⧉ badge on the commit each one has checked out. Right-click a branch → **Check out in new worktree…** (a remote branch becomes a local tracking branch), or a commit → **Create worktree here (detached)…**. Right-click a worktree badge to open it in a new window, copy its path or remove it (asks first, and asks again before discarding uncommitted changes there). A branch that is checked out in another worktree offers **Open its worktree in new window** instead of Check out. Badges of worktrees whose folder is gone offer **Prune missing worktrees**.
- **Changes since a branch split off.** Branch menus gain **Changes since it split from “main”** (or whatever is current): the files changed on that branch since its merge base with the current branch (`git diff main...branch`), which is what merging it would bring in. The details pane names the merge base.

## 0.4.0 (2026-11-20)

- **Resizable columns.** Drag the edge of a column header to resize the Graph, Date, Author or Commit column; double-click the edge to reset it. Right-click the header to hide or show columns. The layout is kept across sessions.
- **Resizable details pane.** Drag the bar above it; double-click to reset.
- **File actions in the details pane.** Right-click a changed file: open changes, open the file, open it as it was at that commit, compare that version with your working copy, show its history, reveal it in the Explorer, copy its relative or absolute path.
- **Compare with working tree** on a commit's right-click menu, and **Compare with current branch** on a branch's.
- **Links.** URLs in commit messages are clickable. When the remote is on GitHub, GitLab or Bitbucket, `#123` opens the issue, and commits and remote branches get **Open on GitHub** (or GitLab, Bitbucket). Links open only when you click them; Mergeline still makes no network requests itself.
- **Keyboard:** Page Up/Down and Home/End move the selection.
- Tested in VSCodium 1.143 as well as VS Code 1.147: the end-to-end suite passes in both.

## 0.3.0 (2026-11-20)

- **Find in all history.** The find box searches only the loaded commits; when the repository has more, an **All history** button (or Enter when nothing loaded matches) searches every commit the graph can show: message, author name or email, hash prefix and ref names, case-insensitive. Stepping to a match that is not loaded yet loads the graph down to it and selects it.
- **File history follows renames.** If the file was renamed or moved, its history continues under the old names (shown as "also as …" above the graph). A different file that later reused an old name is left out, and the graph stays connected across the commits that are dropped.
- **Much smaller graph data.** Rows are sent in a compact form and the webview rebuilds the straight lines itself. On git.git's first 5,000 commits the graph part of each refresh drops from 6.58 MB to 0.57 MB, and the whole message from 8.0 MB to 2.0 MB.
- Fixed: changing `mergeline.initialCommits` now applies straight away instead of after switching repositories.

## 0.2.0 (2026-11-20)

- **File history.** Right-click a file in the Explorer, an editor tab or the editor, and choose **Show File History in Mergeline**. The graph then shows only the commits that touched that file, still connected as a graph, and the details pane highlights the file. **Show all commits** goes back.
- **Commit order.** A new **Order** menu in the toolbar (setting `mergeline.commitOrder`) switches between date, topology and author-date order. Topology keeps each branch's commits together; on git.git's master branch it cuts the graph from 71 to 29 lanes in the first 500 commits.
- **Narrower graphs on busy histories.** When two lanes wait for the same commit, they now merge into one, as `git log --graph` does. On git.git's first 500 commits (all branches) this cuts the width from 146 to 117 lanes, and on master alone from 108 to 71.
- Commits in lanes beyond the 30 that are drawn now show as a hollow node at the right edge instead of disappearing. The graph column is never narrower than its header.
- Tests: push, pull, fetch and delete-remote-branch now run against a real (local bare) remote in the end-to-end suite, which has 20 checks.

## 0.1.0 (2026-11-20)

First release.

- Commit graph with coloured lanes, merges, branches, remote branches, tags, stashes and an uncommitted-changes row.
- Columns for graph, description, date, author and hash, with a pinned header. Rows are virtualised, and more commits load as you scroll.
- Details pane with message, author, committer, parents and changed files (+/− counts, renames). A file opens in VS Code's diff editor.
- Ctrl/Cmd-click two commits to compare them.
- Find by subject, author, email, hash or ref. Filter by branch. Toggle remote branches.
- Context menus. Commits: create branch, add tag, check out, cherry-pick, revert, merge, rebase, interactive rebase (terminal), reset soft/mixed/hard, copy. Branches: check out (remote → local tracking), merge, rebase, push, pull, rename, delete, delete on remote. Tags: push, merge, delete (locally and on remote). Stashes: apply, pop, drop, branch. Working tree: stash, discard.
- Fetch from the toolbar. Refreshes automatically when the repository changes. Supports multiple repos.
