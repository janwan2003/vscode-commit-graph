# Changelog

## 0.1.0 (2026-11-20)

First release.

- Commit graph with coloured lanes, merges, branches, remote branches, tags, stashes and an uncommitted-changes row.
- Columns for graph, description, date, author and hash, with a pinned header. Rows are virtualised, and more commits load as you scroll.
- Details pane with message, author, committer, parents and changed files (+/− counts, renames). A file opens in VS Code's diff editor.
- Ctrl/Cmd-click two commits to compare them.
- Find by subject, author, email, hash or ref. Filter by branch. Toggle remote branches.
- Context menus. Commits: create branch, add tag, check out, cherry-pick, revert, merge, rebase, interactive rebase (terminal), reset soft/mixed/hard, copy. Branches: check out (remote → local tracking), merge, rebase, push, pull, rename, delete, delete on remote. Tags: push, merge, delete (locally and on remote). Stashes: apply, pop, drop, branch. Working tree: stash, discard.
- Fetch from the toolbar. Refreshes automatically when the repository changes. Supports multiple repos.
