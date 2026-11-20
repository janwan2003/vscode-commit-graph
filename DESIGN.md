# Mergeline: clean-room design

Mergeline is written from scratch. The feature list below comes from what users say
they rely on (public READMEs, store listings, issue *titles* and reviews of existing
git graph extensions) and from git's own documented behaviour. No other extension's
source code was read or copied.

## Features users rely on (and what VS Code's built-in graph lacks)

VS Code 1.147's built-in Source Control Graph has these history-item actions: checkout
(detached), create branch, create tag, cherry-pick, compare, copy id/message. Its ref
actions are checkout, delete branch and delete tag. (Read from the bundled
`extensions/git/package.json`, `scm/historyItem/context`, on 2026-11-20.)

Mergeline must have everything below. Items marked **+** are missing from the built-in graph:

| Area | Feature |
|---|---|
| Graph | coloured lanes, merges, refs as badges (local, remote, tags, HEAD), **+ stashes as nodes**, **+ uncommitted-changes row** |
| Table | **+ columns: graph, description, date, author, hash; pinned header** |
| Scale | virtualised rows, load more on scroll, 100K-commit repos |
| Details | **+ details pane** with full message, author, committer, parents, changed files with +/− counts; a file opens VS Code's diff editor |
| Compare | **+ Ctrl/Cmd-click two commits** to see the files changed between them |
| Find | **+ search** subject, author, hash and ref; next/previous match |
| Filter | **+ branch filter**, toggle remotes, **+ file history** (graph limited to one path, parents rewritten by `git log --parents -- <path>`), **+ commit order** (date, topology, author date) |
| Commit menu | checkout, create branch, tag (lightweight or annotated), cherry-pick, **+ revert, + merge into current, + rebase current onto, + reset soft/mixed/hard, + interactive rebase (terminal)**, copy hash/subject |
| Branch menu | checkout (remote → local tracking branch), **+ merge, + rebase onto, + rename, + push**, delete (force if unmerged), **+ delete remote branch**, copy name |
| Tag menu | **+ push**, delete (locally and on remote), copy name |
| Stash menu | **+ apply, pop, drop, branch from stash** |
| Repos | multi-repo picker (workspace folders and nested repos via VS Code's git extension), worktrees |
| Toolbar | repo, branch filter, remotes toggle, find, fetch, refresh |
| Trust | no telemetry, no account, MIT, runs in VS Code, VSCodium, Cursor, Windsurf, remote/WSL/SSH |

## Architecture

- `src/core/` has no VS Code dependency, so it can be unit-tested against real repos built in a temp dir.
  - `gitlog.ts`: runs `git log` with a delimiter-separated `--format` and parses commits, refs (`for-each-ref`), stashes and status.
  - `graph.ts`: lane layout. It walks commits top to bottom (children before parents) and keeps an array of lanes, each waiting for one sha.
    A commit takes the leftmost lane waiting for it, and other lanes waiting for it converge into it. The first parent inherits the lane;
    each other parent joins an existing lane waiting for it, or takes a free one.
    A sha is never awaited by two lanes: if a parent is already awaited, the node's line joins that lane (or, when that lane is to the
    right, it folds into the node's lane). This is what keeps topic-branch histories such as git.git narrow. Each row records top-half and bottom-half segments
    (from column → to column, colour), which is everything the renderer needs.
- `src/ext/`: the extension host side.
  - `extension.ts`: commands, status bar, SCM title button, repo discovery via the `vscode.git` API, falling back to `git rev-parse`.
  - `panel.ts`: the webview panel and its message protocol.
  - `actions.ts`: every git operation with confirmation. Destructive ones are modal. Push and fetch go through the `vscode.git` API when it is available, so its credential prompts work.
  - `content.ts`: the `mergeline:` URI scheme (`git show <ref>:<path>`) for diff editors.
- `media/graph.js`, `media/graph.css`: the webview. Plain JS with no framework. It renders only visible rows (fixed 24 px rows), the graph as per-row inline SVG, and an HTML context menu (works in VSCodium and forks, and does not depend on VS Code's webview menu API).
