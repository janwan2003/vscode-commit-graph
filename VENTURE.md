---
slug: vscode-commit-graph
stage: launched
priority: 4
url: https://janwan2003.github.io/vscode-commit-graph/
repo: https://github.com/janwan2003/vscode-commit-graph
updated: 2026-11-20
---

# vscode-commit-graph (product name: Mergeline)

Product name **Mergeline**, extension ID `plainbyte.mergeline`. On 2026-11-20 the name
had no clash on the Marketplace (`extensionquery` search), Open VSX (search API), npm
(registry 404) or GitHub (repo search found only unrelated repos). Do **not** rename it
toward "Git Graph", "Git History" or "GitLens".

## Thesis

**Who:** VS Code, VSCodium, Cursor and Windsurf users who want to see their branches as a
graph and act on them from the graph: checkout, merge, rebase, cherry-pick, reset, tag and
compare commits. Today most of them use Git Graph, which has 15.7M installs.

**What:** An open-source (MIT) VS Code extension built from scratch. It has an
interactive commit graph webview with the right-click actions people rely on (branch,
checkout, merge, rebase, cherry-pick, revert, reset, tag, push and delete remote
branches, stash), a commit details pane with diffs that open in VS Code's own diff
editor, search and filter, and multi-repo and worktree support. It is published on both
the VS Code Marketplace and Open VSX, so VSCodium, Cursor and other forks get it too. It
has no account, no paid tier and no telemetry.

**Why now:** Git Graph's last release was 1.30.0 on 2021-04-05. That is 5½ years
without a release, and its users keep reporting breakage after VS Code updates. Its
licence explicitly says "Permission is NOT GRANTED to publish, distribute, sublicense,
and/or sell derivative works", so nobody can legally publish a maintained fork. The
existing forks on the Marketplace are small and some are low-rated. The second-biggest
history tool, Git History, has 17.6M installs and has not shipped since 2023-03. GitLens
has 54M installs but is rated 3.37 because its graph and other features are behind a
Pro paywall. A clean-room, maintained, free implementation fills a slot that is
currently empty.

## Market evidence

All Marketplace figures come from the public `extensionquery` API, queried live on
2026-11-20. GitHub figures come from `gh api`, also on 2026-11-20.

| Extension | Installs | Rating (n) | Last release | Note |
|---|---|---|---|---|
| [Git Graph](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) | 15,760,633 | 4.93 (681) | 2021-04-05 | stale, derivative works forbidden by licence |
| [Git History](https://marketplace.visualstudio.com/items?itemName=donjayamanne.githistory) | 17,569,006 | 4.44 (179) | 2023-03-05 | stale |
| [GitLens](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens) | 54,035,493 | 3.37 (946) | 2026-11-20 | graph and other features are Pro (paid, proprietary) |
| [Git History (GuodongSun)](https://marketplace.visualstudio.com/items?itemName=GuodongSun.vscode-git-cruise) | 113,102 | 5.0 (18) | 2026-10-21 | |
| [Git Branch & Tag Graph](https://marketplace.visualstudio.com/items?itemName=Gxl.git-graph-3) | 71,420 | 3.75 (28) | 2026-07-16 | Git Graph fork |
| [GitLG](https://marketplace.visualstudio.com/items?itemName=phil294.git-log--graph) | 42,228 | 4.8 (10) | 2026-04-17 | |
| [(neo) Git Graph](https://marketplace.visualstudio.com/items?itemName=asispts.neo-git-graph) | 15,600 | 4.5 (2) | 2026-08-25 | |

- Open VSX: [mhutchie/git-graph](https://open-vsx.org/extension/mhutchie/git-graph) has
  1,238,638 downloads and the same 1.30.0 version from 2021 (Open VSX API, 2026-11-20).
- [mhutchie/vscode-git-graph](https://github.com/mhutchie/vscode-git-graph) has 2,555
  stars and 340 open issues. Its last push was 2023-07-08, and 66 issues were opened
  after 2025-01-01 with no maintainer response.
  - [#870 "Context right-click menu disappeared with last vscode update"](https://github.com/mhutchie/vscode-git-graph/issues/870)
    (2025-02): 357 👍 and 65 comments. It is closed now; the cause appears to have been on
    VS Code's side. It shows how much users depend on the graph's context menu.
  - [#838 "COMMUNITY CALL: Git Graph is abandoned"](https://github.com/mhutchie/vscode-git-graph/issues/838)
    (2024-08): 99 👍.
  - [#913 "THIS PROJECT HAS BEEN ABANDONED"](https://github.com/mhutchie/vscode-git-graph/issues/913),
    [#879 "Is GitGraph dead?"](https://github.com/mhutchie/vscode-git-graph/issues/879),
    [#927 "Actively maintained alternative available"](https://github.com/mhutchie/vscode-git-graph/issues/927),
    [#863 "Context menu not available in VSCodium"](https://github.com/mhutchie/vscode-git-graph/issues/863),
    [#849 "Support VSCode Remote Tunnel Access"](https://github.com/mhutchie/vscode-git-graph/issues/849).
- [LICENSE](https://raw.githubusercontent.com/mhutchie/vscode-git-graph/develop/LICENSE)
  (read 2026-11-20): "Permission is NOT GRANTED to publish, distribute, sublicense, and/or
  sell derivative works of the Software."
- GitKraken itself writes comparison content aimed at this audience:
  [GitLens vs VS Code Git Graph](https://www.gitkraken.com/blog/gitlens-vs-vs-code-git-graph-use-cases-from-reddit-2026).
  A [Medium post](https://medium.com/@1chooo/say-goodbye-to-git-graph-in-vscode-a-new-era-of-source-control-visualization-0eda7439fa17)
  argues that people should drop Git Graph.
- Risk, **corrected 2026-11-20** (read from VS Code 1.147's bundled
  `extensions/git/package.json`, menus `scm/historyItem/context` and
  `scm/historyItemRef/context`): the built-in Source Control Graph now offers checkout
  (detached), create branch, create tag, cherry-pick, compare (with remote, merge base or a
  ref) and copy id/message on commits, plus checkout, delete branch and delete tag on refs.
  The scout's claim that it "does not offer actions" was too strong. It still lacks merge,
  rebase, reset, revert, push/delete of remote branches, stashes, an uncommitted row,
  author/date columns, a details pane with file list, and search. That gap is Mergeline's
  edge. Git Graph is still growing (15.76M installs), so users still look for more.
- New small entrants since 2026 (Marketplace `extensionquery`, search "git graph",
  2026-11-20): (neo) Git Graph 15,600; Git Graph Plus 4,337; Git Graph (Rust) 2,972;
  Git Graph Libre 1,266; Git Graph Pro 601; Treeline 125; Branchline 51. None has
  broken out, so the slot is still open, but expect more of them.

## Our edge

- **Maintained and legal to fork.** MIT licence, public roadmap, and quick fixes when VS
  Code changes its API. This is exactly what the 66 unanswered issues since 2025 ask for.
- **Free, with nothing behind a paywall.** GitLens charges for its graph; ours costs nothing.
- **Open VSX on day one.** VSCodium, Cursor, Windsurf and Gitpod users get it from Open
  VSX. Git Graph's Open VSX listing is the same build from 2021.
- **Features users asked for that Git Graph never shipped:** remote tunnel and
  web support (#849), pinned column headers (#839), worktrees, a fast graph for repos
  with 100K+ commits (virtualised rendering), and interactive rebase from the graph.
- **Store search.** Listing keywords like "git graph", "git history", "commit graph" and
  "branch graph" match what people already search for, while the product keeps its own
  distinct name.

## Status

**Mergeline 0.8.0 is built, released on GitHub and documented; it is not in the stores yet**
(store tokens `VSCE_PAT`/`OVSX_PAT` are still absent from the studio `.env`: key names read 2026-11-20, session 8).

- Repo https://github.com/janwan2003/vscode-commit-graph (MIT). Releases v0.1.0 to v0.7.0
  (`mergeline-0.7.0.vsix`, 56 KB): https://github.com/janwan2003/vscode-commit-graph/releases
- Site https://janwan2003.github.io/vscode-commit-graph/ has index, privacy, support,
  17 SEO guides (session 7: rebase/merge stopped with conflicts (continue, skip, abort), reorder commits, interactive rebase in VS Code; session 6: edit a commit message, drop a commit, Git Graph right-click menu not working; git worktrees in VS Code (session 5), Git Graph alternative, visualising branches in VS Code, rebase vs
  merge, undo with reset/revert/cherry-pick, stash guide, file history in VS Code, `git log --graph`,
  git graph in Cursor/VSCodium/Windsurf, compare branches/commits in VS Code, squash commits in VS Code),
  404 and sitemap (20 URLs). Every page's footer links every guide (session 6).
- **Search Console:** the Pages URL prefix is verified (Site Verification API, FILE method,
  `docs/google07cd0d9f3ba93576.html`), added as a property, and its sitemap submitted (2026-11-20, session 3).
  Read metrics with `GSC_REFRESH_TOKEN` (searchAnalytics.query on `https://janwan2003.github.io/vscode-commit-graph/`).
- Features: graph with lanes, merges, branches, remotes, tags, stashes and an
  uncommitted row; virtualised table with a pinned header; details pane with diffs;
  Ctrl/Cmd-click compare; find; branch filter; remotes toggle; fetch; auto-refresh; multi-repo.
  **0.2.0 added:** file history (right-click a file → "Show File History in Mergeline"; graph
  limited to that path with `git log --parents -- <path>` so it stays connected), a commit-order
  menu (date / topology / author date, setting `mergeline.commitOrder`), lane collapsing (two lanes
  waiting for the same commit merge, as in `git log --graph`), clipped-lane nodes pinned to the edge,
  and a hint to try topology order when a date-ordered graph is wider than 20 lanes.
  **0.3.0 added:** find in all history (toolbar **All history**, or Enter when nothing loaded matches:
  `git log --grep`/`--author`, hash prefix, ref names; stepping to an unloaded match loads down to it and
  selects it), file history that follows renames (`git log --follow` names; unrelated files that reused an
  old name are dropped and parents rewritten across them), packed graph rows (`PackedRow` in
  `src/core/graph.ts`, decoded by `media/rows.js`), and a fix: `mergeline.initialCommits` applies at once.
  **0.4.0 added:** resizable and hideable columns (drag a header edge, right-click the header; saved in
  `globalState` `mergeline.layout`), a draggable details splitter, a file right-click menu in the details pane
  (open, open at revision, compare with working copy, file history, reveal, copy paths), Compare with working
  tree (commit menu) and Compare with current branch (branch menus), forge links (`src/core/remote.ts`: remote
  URL → GitHub/GitLab/Bitbucket web base; Open on GitHub for commits and remote branches, `#123` and URLs in
  messages are clickable; nothing is fetched), Page Up/Down and Home/End.
  **0.5.0 added:** drag and drop of a branch badge (local or remote) onto another branch or commit → menu: merge into it
  (`mergeInto` checks the target out first when it is not current), rebase onto it (`git rebase <onto> <branch>`), move the branch
  (`git branch -f`; reset when current), compare, changes since they split. Worktrees: `git worktree list --porcelain -z`
  (`parseWorktrees` in `src/core/gitlog.ts`) → ⧉ badge per other worktree, branch/commit menus "Check out in new worktree…" /
  "Create worktree here (detached)…", badge menu open in new window / copy path / remove (re-asks before `--force`) / prune.
  Branch menus: "Changes since it split from <current>" (merge-base three-dot diff, `mergeBase()`). Also fixed `scripts/make-fixture.mjs`, which
  ran on import, so `node scripts/e2e.mjs <binary>` crashed (found by the VSCodium run).
  **0.6.0 added:** edit history on the checked-out branch (`src/core/rewrite.ts`): Edit commit message (subject; body kept),
  Squash into parent (fixup), Drop commit, and Squash N commits into one (Ctrl/Cmd-click range; new subject + old subjects as body).
  It writes the rebase todo itself (`GIT_SEQUENCE_EDITOR="cp '<git-dir>/MERGELINE_TODO'"`, message via an `exec git commit --amend -F`
  line), uses `--autostash`, refuses merges in the range and commits not on HEAD, warns when a remote-tracking branch has the
  commit, offers Undo (`git reset --keep <old HEAD>`) and, on conflict, Open Source Control / Abort rebase. The webview shows
  the items only on HEAD's first-parent line up to the first merge. Also: changed files as a folder tree (default) or flat list
  (`lay.files` in the saved layout), collapsible folders, single-child folders joined (`src/core/`).
  **0.7.0 added:** an in-progress bar (`src/core/progress.ts`: rebase-merge/rebase-apply/MERGE_HEAD/CHERRY_PICK_HEAD/REVERT_HEAD, `am`) above
  the graph with step, stopped commit and conflicted files, and Continue (`GIT_EDITOR=true`; refuses while unmerged, asks on leftover
  conflict markers via `git diff --cached --check`), Skip, Abort, Source Control; it also shows operations started in a terminal. Move commit
  up/down (swap in the todo). Edit commit message opens a subject + body editor in the webview (`getMessage` → `message` → `fullMessage`).
  Move down / Squash into parent are greyed out when the parent is a merge (the planner refused it anyway; 0.6 showed them enabled).
  **0.8.0 added:** a **Branches** checklist in the toolbar (any number of local/remote branches → `git log <b1> <b2> …`; "Current branch",
  "All branches", a search box; `filter.branches` in `src/ext/panel.ts`, the old one-name `branch` message still accepted); **drag a commit
  row**: from another branch onto the current branch's badge or the HEAD row → Cherry-pick, and between two commits on HEAD's editable line
  → "Squash into" / "Move to right after" (new `place` op in `src/core/rewrite.ts`: the todo drops the commit and re-inserts it after the
  target as `pick` or `fixup`); **Create pull request on GitHub/GitLab/Bitbucket** in branch menus (`pullRequestUrl` in `src/core/remote.ts`;
  a local branch resolves to `branch.<name>.remote`/`.merge`, an unpushed one is offered Push first); setting `mergeline.dimOtherCommits`
  (fades commits not reachable from HEAD among the loaded ones); Ctrl/Cmd+H selects HEAD. CI now also runs the e2e suite in the latest
  stable VS Code (job `e2e` in `.github/workflows/ci.yml`).
  Right-click actions on commits, branches, remote branches, tags, stashes, files and the
  working tree (full list in README.md). Design and clean-room note: DESIGN.md.
- Verified 2026-11-20 (session 2), on the minified packaged 0.2.0 build:
  - `pnpm typecheck` clean; `pnpm test`: 10/10 unit tests (new: path-limited log with rewritten parents, topo order, lane collapse).
  - `node scripts/e2e.mjs`: 20/20 checks in real VS Code 1.147 (headless). New: file-history command
    (3 commits for `src.txt`, every parent present, clearing restores 8), order switch saved as a setting,
    and a **real remote** (local bare repo): push branch with upstream, push tag, fetch a commit pushed
    from another clone, pull fast-forward, delete remote branch.
  - `code --install-extension mergeline-0.2.0.vsix` into a temp extensions dir lists `plainbyte.mergeline@0.2.0`.
  - Webview rendered in headless Chromium (`scripts/shot/shot.mjs`): demo repo in dark and **light** theme
    (`THEME=light`, looked at the PNG: lanes, badges, find highlight and details are legible), file-history
    banner, and real git.git data (`PAYLOAD=...`).
  - Wide-graph measurements on a commits-only clone of git/git (86,366 commits, `--filter=tree:0`, in /tmp,
    deleted after), first 500 commits, from `scripts/bench.ts` and a width script: all branches, date order:
    146 → 117 lanes after lane collapsing; master only: 108 → 71 (date) and 29 (topology).
    Layout of all 86,366 commits takes 2.8 s and the payload would be 174 MB; the first page of 500
    is 1.2 MB, 5,000 is 8.0 MB.
- Verified 2026-11-20 (session 3), on the minified packaged 0.3.0 build:
  - `pnpm typecheck` clean; `pnpm test`: 13/13 (new: packed rows decode to exactly the full rows on the
    fixture, across pages and on 200 random DAGs; `searchLog` by message/author/hash/ref with positions;
    `readFileHistory` across a rename with a new file reusing the old name).
  - `node scripts/e2e.mjs`: 22/22 in VS Code 1.147, four runs in a row (three in development, one on the packaged build) after fixing a test race
    (an assertion made before a deferred refresh landed). New checks: rename-following file history
    with the "also as" bar in the webview, and history search → `loadTo` → the webview selects the match.
  - Payload, git.git first 5,000 commits (`scripts/bench.ts` on a `--filter=tree:0` clone, 86,366 commits):
    graph data 6.58 → 0.57 MB, whole message 8.03 → 2.03 MB; all 86,366 commits 174 → 36 MB.
  - Rendering unchanged: the same git.git payload (500 commits) rendered by the 0.2.0 and 0.3.0 webviews in
    headless Chromium is pixel-identical below the toolbar (PIL `ImageChops.difference`, 1280×755 px).
  - After push: CI and Pages succeeded for 47af3a6; live new guides return 200; the v0.3.0 asset
    downloads byte-identical (sha256 62a4abf3…); `code --install-extension` lists `plainbyte.mergeline@0.3.0`.
- Verified 2026-11-20 (session 4):
  - **VSCodium 1.143.17232** (GitHub release tarball, `product.json` version; deleted after): 0.3.0 passed 22/22 twice
    (subagent run on a clean clone of ad6b990), and 0.4.0 passed 26/26 twice (`node scripts/e2e.mjs <codium>`).
    The packaged `mergeline-0.4.0.vsix` installs in VSCodium and VS Code 1.147 (`--list-extensions` →
    `plainbyte.mergeline@0.4.0`). VSCodium ships its git extension as `vscode.git`, the id `src/ext/repos.ts` uses.
  - `pnpm typecheck` clean; `pnpm test` 14/14 (new: `webRepo` on 13 remote URL forms plus commit/issue/branch URLs).
  - `node scripts/e2e.mjs` in VS Code 1.147, on the minified packaged build: 26/26, twice. New checks: compare with the
    working tree; file actions (open at revision shows that revision's text, diff with working tree opens a
    diff tab against the real file, copy paths, `../outside.txt` is ignored, file history); column layout applied,
    **kept after closing and reopening the panel**, and reset; a GitHub remote gives the commit link, `#42` and a
    URL as links in the details pane (read back from the webview DOM).
  - Mouse interactions in headless Chromium on the real webview (`INTERACT=1 node scripts/shot/shot.mjs`,
    `scripts/shot/interact.js`): drag Date edge +80 px → header and rows 120 → 200 px; header menu hides Commit
    (header 0 px, row cells `display:none`); double-click resets Date to 120; file menu lists 8 entries and posts
    `copyPath`; splitter drag 271 → 371 px; End selects the last row; layout messages posted. Looked at the PNGs:
    hidden column, taller details, and (with a GitHub `web` payload) `#128`, `#97`, the URL and "Open on GitHub" as links.
- Verified 2026-11-20 (session 5), on the minified packaged 0.5.0 build:
  - `pnpm typecheck` clean; `pnpm test` 15/15 (new: `parseWorktrees` on `-z` and newline porcelain with detached/locked/prunable/bare,
    `readWorktrees` from the main and a linked worktree, `mergeBase`, three-dot changes).
  - `node scripts/e2e.mjs` in VS Code 1.147: 28/28, twice on the packaged build (plus once in development). New checks: merge-base
    details (`base`, `mergeBase`, only the branch's file), `rebaseBranch` of a non-checked-out branch, `mergeInto` a non-current branch
    (`--no-ff` → 2 parents), `moveBranch`; `addWorktree` for a branch → folder exists on that branch, `lastData.worktrees` has it, the
    webview renders its badge (read back from the DOM), `removeWorktree` deletes it.
  - Headless Chromium (`INTERACT=1 node scripts/shot/shot.mjs`): dragging feature/dark-mode shows the ghost and the drop highlight;
    dropping on `main` lists Merge/Rebase/Move/Compare/Changes-since, dropping on a plain commit lists Rebase/Move/Compare/Changes-since
    (no merge); picking items posts `rebaseBranch` and a `details` with `base: true`; the selection is unchanged by the drop; worktree
    badge menu has Open/Copy path/Remove. Looked at the PNGs (dark and light drop menu, worktree badge `acme-app-release`).
  - `code --install-extension mergeline-0.5.0.vsix` (temp extensions dir) lists `plainbyte.mergeline@0.5.0`.
  - After push: CI (two runs) and Pages succeeded for 28b9853; live index (shows v0.5), new guide, drag screenshot, compare guide and
    sitemap (14 URLs) return 200; the v0.5.0 release asset is byte-identical (sha256 02a78c0b…); sitemap resubmitted (HTTP 204).
  - Not run this session: VSCodium (not installed; 610 MB extracted, disk had 3.6 GB free).
- Verified 2026-11-20 (session 6), on the minified packaged 0.6.0 build:
  - `pnpm typecheck` clean; `pnpm test` 19/19 (new `test/rewrite.test.ts`: todo building and sh quoting; reword of an older commit keeps
    body, tree and older hashes; reword of HEAD leaves staged changes out; drop/fixup/squash range with a dirty file kept by autostash;
    refusals for root fixup, other branch, merge in range, merge commit; `pushed` lists `origin/main`; a conflicting drop stops and a
    second plan reports the rebase in progress). Also passed with `HOME=<empty>` and `GIT_CONFIG_NOSYSTEM=1` (CI conditions).
  - `node scripts/e2e.mjs` in VS Code 1.147: 29/29 twice on the packaged build (plus once in development). New check: edit-menu labels read
    back from the webview (3 items on a linear commit, none on a merge), reword with dirty + untracked files kept, Undo restores HEAD,
    squash into parent, squash a 2-commit range (body lists both subjects), drop, merge refused with HEAD unchanged.
  - Headless Chromium (`scripts/shot/shot.mjs`): tree view with nested folders, a joined `src/core/` row and a rename (looked at the PNG);
    `EDITMENU=1` commit menu with the new group (saved as `docs/screenshot-edit.png`).
  - `code --install-extension mergeline-0.6.0.vsix` (temp extensions dir) lists `plainbyte.mergeline@0.6.0`.
  - After push: the first CI run for ff74401 **failed** (real test defect: unit-test repos had no repo-local identity and CI has no global
    one, so the rebase could not commit; reproduced locally with an empty HOME: 1 pass / 3 fail). Fixed in the next commit; CI and Pages
    green for it. Live: index (v0.6, edit-history card), 3 new guides, screenshot-edit.png and sitemap (17 URLs) return 200; release asset
    byte-identical (sha256 f42cf9d9…); sitemap resubmitted (HTTP 204, still pending). Guide facts (VS Code #239862 milestone "January
    2025 Recovery 2", Git Graph #863 open, #870 closed 2025-02-18 with 357 👍, Git Graph manifest has no untrusted-workspace capability)
    re-read with `gh api`.
  - Not verified: the edit actions on Windows (the sequence editor is `cp '<path>'` run by Git's sh; paths use forward slashes) and
    clicking the Undo / Abort buttons in a real notification (the e2e calls the `undoRewrite` action directly).
- Verified 2026-11-20 (session 7), on the minified packaged 0.7.0 build:
  - `corepack pnpm typecheck` clean; unit tests 23/23 (new `test/progress.test.ts`: move todo, move up/down with tree and older hashes kept,
    refusals for newest-up and root-down, a conflicting move read back as rebase step 1 of 3 at the right commit with `f.txt` unmerged,
    leftover markers detected after staging, continue → step 2, abort restores HEAD; merge/cherry-pick/revert states, merge `--continue`
    keeps the prepared message, cherry-pick skip, revert abort). Also 23/23 with an empty `HOME` and `GIT_CONFIG_NOSYSTEM=1`; CI 23/23.
  - `node scripts/e2e.mjs` in VS Code 1.147: 30/30 three times on a first packaged build and twice on the final one. New check: the
    message editor opens in the webview with subject and body split (read back via ping); full-message reword of an older commit; move
    down then up; a conflicting move shows "Rebasing main onto … step 1 of 3, stopped at … 1 conflicted file" in the bar (DOM text),
    Continue refused while unmerged, continue → step 2, edit items hidden, Skip finishes; a terminal-started merge shows "Merging
    move-side into main" without Skip, Abort restores HEAD.
  - Headless Chromium (`OPBAR=1`, `DIALOG=1`, `DIALOG=2`, `EDITMENU=1` in `scripts/shot/shot.mjs`): looked at the bar in dark and light
    themes and the dialog; `DIALOG=2` edits the subject, clicks Save and reads back the posted `reword` with the full message; backdrop
    dims (pixel 24 → 13). The mock themes lacked `--vscode-button-background` etc., so the CSS got fallbacks and the mocks got
    VS Code Dark/Light Modern values.
  - `code --install-extension mergeline-0.7.0.vsix` (temp extensions dir) lists `plainbyte.mergeline@0.7.0`.
  - After push: CI (main and tag v0.7.0) and Pages green for 726bdfd; live index (v0.7, new card), 3 new guides, both screenshots and
    sitemap (20 URLs) return 200; release asset byte-identical (sha256 8a79a44b…); sitemap resubmitted (HTTP 204, still pending).
  - Guide facts were checked by the writing subagent in throwaway repos (git 2.53.0) and against VS Code 1.147's bundled git extension;
    `cherry-pick --abort` undoing already-applied picks was re-checked by hand (it also fixed the wording of Mergeline's Abort dialog).
  - Not verified: real clicks on the bar's buttons inside VS Code (the e2e sends the same `action` messages; the click handler was exercised
    only in Chromium for the dialog), `git am` in progress (detection only, no test), and Windows.
- Verified 2026-11-20 (session 8), on the minified packaged 0.8.0 build:
  - `corepack pnpm typecheck` clean; unit tests 24/24 (new: `place` todo building; move HEAD down onto the root's child keeps the root's
    hash; "already right after" refused; fold HEAD into a commit two below keeps that commit's message and both files; move the root to
    the top (`--root`); a commit on another branch refused; `pullRequestUrl` for GitHub/GitLab/Bitbucket incl. slashes, spaces and `#`).
  - `node scripts/e2e.mjs` in VS Code 1.147: 32/32, three times on the first packaged build and twice after the refresh fix. New checks:
    placeCommit move and fold (git log read back), branch filter `['hotfix/crash','feature/search']` → commit count equals
    `git rev-list --count` of the two and the toolbar reads "2 branches", back to all; `dimOtherCommits` on → dimmed rows ≤ commits off
    HEAD, off → 0; Create pull request for a tracked local branch and a remote branch gives the GitHub compare URL (recorded, not opened,
    under test), a non-forge remote gives none.
  - **CI e2e (new job) first run failed, 3 of 32** (run 44751989277): "Cannot read properties of undefined (reading 'sha')". A real
    defect, not a flake: `GraphPanel.refresh()` returned at once when a load was already running, so callers (the tests, and actions that
    await a refresh) read stale data. It now resolves after the queued reload finishes. Second CI run: see the Log line for this session.
  - Headless Chromium (`INTERACT=1 node scripts/shot/shot.mjs`, `scripts/shot/interact.js` steps 11-15) with synthetic mouse events: dragging
    "Changelog for 1.1" (release/1.1, unmerged) onto the HEAD row shows the ghost and a menu "Cherry-pick d0ae9c3 onto “main”" + Compare,
    and clicking posts `cherryPick`; dragging HEAD onto its parent lists Squash (enabled) and Move (disabled) and posts `placeCommit fold=true`;
    the checklist opens with 6 branches, ticking feature/search posts `filter ["feature/search"]` and labels the button, the search box narrows
    to 2, "Current branch" posts `["main"]`, Esc closes it; Ctrl+H selects HEAD; with dimming on only "Changelog for 1.1" is dimmed (stash
    not). Looked at `docs/screenshot-branches.png` (dark) and a light-theme render.
  - `code --install-extension mergeline-0.8.0.vsix` (temp extensions dir) lists `plainbyte.mergeline@0.8.0`. Package 59.9 KB, 30 keywords.
  - Guides (subagent): git commands run in throwaway repos (git 2.53); VS Code labels read from the local 1.147 install; forge URLs from forge
    docs. Uncertain and worded as such on the page: GitHub `?expand=1` (not in GitHub's docs; works), Bitbucket `pull-requests/new?source=`.
  - Not verified: real mouse drags of a commit inside VS Code, the PR link actually opening a browser, and the "push first" prompt path
    (needs a click on a non-modal notification).
- Not verified: Cursor and Windsurf (not installed here); remote/SSH/WSL; the Explorer and
  editor-tab context-menu entries were not clicked (the e2e suite runs the command directly; the menu
  contributions are declarative and `vsce package` accepted them); "Open on GitHub" actually opening a browser
  (`openUrl` → `vscode.env.openExternal`, http/https only) was not clicked in the e2e run; real mouse drags inside
  VS Code (the drags were synthetic events in Chromium). (Corrected session 4: an older line here said rename
  following was not implemented; 0.3.0 implemented it.)

## Metrics

- 2026-11-20 (session 8): release downloads v0.1.0 2, v0.2.0 2, v0.3.0 3, v0.4.0 2, v0.5.0 2, v0.6.0 2, v0.7.0 0 (read before the v0.8.0 release);
  0 stars, 0 forks; traffic views 0, clones 0 (`gh api .../releases`, `.../traffic/views`, `.../traffic/clones`). Search Console: no rows
  (2026-10-20 → 2026-11-20, `searchAnalytics.query` by query); sitemap still pending, 0 errors (`sitemaps.list`).

- 2026-11-20 (session 7): release downloads v0.1.0 2, v0.2.0 2, v0.3.0 3, v0.4.0 2, v0.5.0 2, v0.6.0 2 (read before the v0.7.0 release);
  0 stars, 0 forks; traffic views 0, clones 0 (`gh api .../releases`, `.../traffic/views`, `.../traffic/clones`). Search Console: no rows
  (2026-10-20 → 2026-11-20); sitemap still pending, never downloaded (`sitemaps.list`), resubmitted with 20 URLs.

- 2026-11-20 (session 6): release downloads v0.1.0 2, v0.2.0 2, v0.3.0 3, v0.4.0 1, v0.5.0 0 (read before the v0.6.0 release); 0 stars,
  0 forks; traffic views 0 (`gh api .../releases`, `.../traffic/views`). Search Console: no rows (2026-10-20 → 2026-11-20); sitemap still
  pending (`sitemaps.list`), resubmitted with 17 URLs.

- 2026-11-20 (session 5): release downloads v0.1.0 2, v0.2.0 2, v0.3.0 3, v0.4.0 0; 0 stars, 0 forks; traffic views 0
  (`gh api .../releases`, `.../traffic/views`). Search Console: no rows (2026-10-20 → 2026-11-20); sitemap still pending
  (`sitemaps.list`), resubmitted with 14 URLs.

- 2026-11-20 (session 4): release downloads v0.1.0 2, v0.2.0 2, v0.3.0 0; 0 stars, 0 forks; traffic views 0
  (`gh api .../releases`, `.../traffic/views`). Search Console: search analytics returns no rows (2026-10-20 →
  2026-11-20); the sitemap is still pending, not yet downloaded by Google (`sitemaps.list`).

- 2026-11-20 (session 1): not in any store yet, so there are no installs to read. GitHub release
  download count starts at 0 (`gh api repos/janwan2003/vscode-commit-graph/releases`).
- 2026-11-20 (session 2): `mergeline-0.1.0.vsix` 2 downloads (`gh api .../releases`; possibly our own
  checks); repo 0 stars, 0 forks; traffic views 0 (`gh api .../traffic/views`). Still no store listing.

- 2026-11-20 (session 3): release downloads v0.1.0 2, v0.2.0 1, v0.3.0 0; 0 stars, 0 forks; traffic
  views 0 (`gh api .../releases`, `.../traffic/views`). Search Console property just added; search analytics
  returns no rows yet (expected: 4-8 weeks).

## Next steps

1. **Operator:** create the Marketplace publisher and Open VSX namespace `plainbyte`
   (inbox, 2026-11-20). Then publish the latest release with the commands in `store/LISTING.md`.
   This is the validation channel; nothing else counts until it is done.
2. Edit history, next pieces (0.8 shipped dragging a commit to squash/move/cherry-pick): "Edit (stop at) this commit" (`edit` in the todo; the bar then offers
   Continue), "Create fixup commit for this" (`git commit --fixup` + autosquash), and a conflicted-files list in the bar's tooltip → click
   to open the merge editor.
3. Load-more still re-reads and re-sends every loaded commit; append only the new page (layout state is
   already resumable via `LayoutState`; stashes whose base is in the new page and the uncommitted row need care).
4. Still missing that Git Graph users have: avatars (opt-in; needs network, off by default), a commit search by changed path, remote
   management (add/remove/prune a remote), and a code-review mode (mark files reviewed). Drag-and-drop: cherry-pick onto a non-current
   branch (checks it out first). Older guide pages: 18 meta descriptions over 155 chars and 12 without a releases link (subagent sweep).
5. CI now runs e2e in the latest stable VS Code (session 8). Add VSCodium as a second target (download the tarball,
   `node scripts/e2e.mjs <codium>`; 610 MB extracted, so CI only).
6. History search positions in file-history mode are approximate (they come from the multi-name log, not
   the filtered one); fine for small file histories, revisit if users report misses.
7. Read Search Console weekly (`searchAnalytics.query`) from ~2026-12-18; after store launch, record installs
   and ratings in `## Metrics` and submit to awesome-vscode style lists (they need a Marketplace link).

## Monetization plan

None until the operator enables it (charter rule 4). Later: GitHub Sponsors or Open
Collective, plus an optional paid "team" add-on (for example, PR review status overlaid
on the graph). The graph itself stays free.

## Log

- 2026-11-20 scout: created idea. Evidence: Marketplace `extensionquery` API (Git
  Graph, Git History, GitLens, search "git graph"), Open VSX API, `gh api` repo and
  issue search for mhutchie/vscode-git-graph, its LICENSE file, and web search. All
  queried 2026-11-20.
- 2026-11-20 builder: sanity-checked evidence. Corrected the built-in graph risk (VS Code
  1.147 has checkout, branch, tag and cherry-pick) and recorded the new small entrants.
  Named the product Mergeline and wrote DESIGN.md (clean room). Built 0.1.0: core
  (git log/refs/stash parsing, lane layout), extension (webview panel, 28 actions,
  diff provider, repo discovery via the vscode.git API) and webview (virtualised SVG
  graph, details, compare, find, filter, context menus). Verified: 7/7 unit, 15/15 e2e
  in VS Code 1.147, vsix install, headless-Chromium render, 100K-commit benchmark.
  Published repo, Pages site (with 5 guides) and release v0.1.0. Set stage launched.
  Store publishing is blocked on the operator (inbox).
- 2026-11-20 builder (session 2): store tokens still absent, so worked on the product. Lane
  collapsing (git.git 500 commits: 146 → 117 lanes; master 108 → 71), commit-order menu (topology:
  master 29 lanes), file history from Explorer/editor menus, clipped-lane nodes, light-theme check,
  real-remote e2e. Released v0.2.0, added a file-history guide page. Verified: typecheck, 10/10 unit,
  20/20 e2e on the packaged build, vsix install, headless-Chromium renders (dark, light, git.git).
  After push: CI and Pages runs for c841f3e succeeded; the live guide page returns 200; the v0.2.0
  release asset downloads byte-identical to the local build.
- 2026-11-20 builder (session 3): store tokens still absent. Set up Search Console (verified, property added,
  sitemap submitted). Built 0.3.0: find in all history, rename-following file history, packed graph rows
  (git.git 5,000 commits: graph data 6.58 → 0.57 MB), `initialCommits` fix; two new guides (`git log --graph`,
  Cursor/VSCodium) and removed an FAQ claim of fork testing we had not done. Verified: 13/13 unit, 22/22 e2e
  ×4 (last on the packaged build), pixel-identical render vs 0.2.0, vsix install, CI + Pages green for 47af3a6,
  live pages 200, release asset byte-identical.
- 2026-11-20 builder (session 4): store tokens still absent. Tested in VSCodium for the first time (1.143: 0.3.0 22/22 ×2,
  0.4.0 26/26 ×2) and fixed the e2e runner bug it exposed. Built 0.4.0: resizable/hideable columns kept across sessions,
  details splitter, file right-click menu, compare with working tree / current branch, GitHub/GitLab/Bitbucket links,
  Page/Home/End keys. Two new guides (compare branches, squash commits); homepage version and fork-testing claims
  corrected. Verified: 14/14 unit, 26/26 e2e ×2 on the packaged build in VS Code 1.147, headless-Chromium
  interaction script, vsix install in VS Code and VSCodium.
  After push: CI (two runs) and Pages succeeded for 4f8121c; the two new guides, index (shows v0.4) and sitemap
  (13 URLs) return 200 live; the v0.4.0 release asset downloads byte-identical (sha256 f2dd9ae4…); sitemap resubmitted
  to Search Console (HTTP 204, still pending).
- 2026-11-20 builder (session 5): store tokens still absent. Built 0.5.0: drag a branch onto a branch/commit to merge, rebase, move or
  compare; worktree badges and create/open/remove/prune from the graph; "changes since it split from" (merge-base) compare. New guide
  (git worktrees in VS Code, written by a subagent and checked against the code), drag screenshot, fixed the broken homepage tagline
  (`v0.2<middot; v0.4`). Verified: 15/15 unit, 28/28 e2e ×2 on the packaged build in VS Code 1.147, headless-Chromium drag/drop
  script, vsix install. After push: CI ×2 and Pages green for 28b9853, live pages 200, release asset byte-identical, sitemap resubmitted.
- 2026-11-20 builder (session 6): store tokens still absent. Built 0.6.0: edit history from the graph (edit message, squash into parent,
  drop, squash a Ctrl/Cmd-click range; autostash, merge/pushed guards, Undo, conflict → SCM/abort) and a folder-tree view of changed
  files. Three guides by a subagent (edit commit message, drop commit, Git Graph menu not working; facts re-checked with `gh api`),
  footer guide links on all pages, stale "0.2.0" on the alternative page fixed. Verified: 19/19 unit, 29/29 e2e ×2 on the packaged
  build, vsix install, headless renders. After push: first CI run failed (test fixture lacked a git identity; fixed), then CI + Pages
  green, live pages 200, release asset byte-identical, sitemap resubmitted.
- 2026-11-20 builder (session 7): store tokens still absent. Built 0.7.0: an in-progress bar for stopped rebase/merge/cherry-pick/revert/am
  (also when started in a terminal) with Continue/Skip/Abort/Source Control, Move commit up/down, a subject + body message editor, and
  merge-parent greying in the edit menu. Three guides by a subagent (rebase conflicts, reorder commits, interactive rebase; git behaviour
  checked in throwaway repos), older guides updated, new screenshot. Verified: 23/23 unit (also CI conditions), 30/30 e2e ×2 on the final
  packaged build, Chromium renders and dialog submit, vsix install. After push: CI ×2 and Pages green, live pages 200, release asset
  byte-identical, sitemap resubmitted.
- 2026-11-20 builder (session 8): store tokens still absent. Built 0.8.0: Branches checklist (any set of branches, current branch), drag a
  commit (cherry-pick onto the current branch; squash into / move after another commit on it), Create pull request on GitHub/GitLab/Bitbucket,
  `mergeline.dimOtherCommits`, Ctrl/Cmd+H; e2e added to CI. The new CI job exposed a real refresh race (3/32 failed, run 44751989277), fixed
  in the panel; CI run 44752350144: unit + e2e 32/32 green. Three guides by a subagent (cherry-pick, create a pull request, filter by branch),
  homepage cards, branch-checklist screenshot. Verified: 24/24 unit, 32/32 e2e ×5 locally on packaged builds, Chromium interaction steps
  11-15, vsix install.
