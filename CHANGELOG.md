# Changelog

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
