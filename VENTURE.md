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

**Mergeline 0.19.0 is built, released on GitHub and documented; it is not in the stores yet**
(store tokens `VSCE_PAT`/`OVSX_PAT` are still absent from the studio `.env`: key names read 2026-11-20, session 17).

- Repo https://github.com/janwan2003/vscode-commit-graph (MIT). Releases v0.1.0 to v0.19.0
  (`mergeline-0.19.0.vsix`, 99 KB): https://github.com/janwan2003/vscode-commit-graph/releases
- Site https://janwan2003.github.io/vscode-commit-graph/ has index, privacy, support,
  38 SEO guides (session 18: collapse commits / compact graph (`compact-git-graph-vscode.html`); session 17: git graph branch colors; session 16: create and apply git patches; session 15: filter git log by author (+ hidden branches), git notes in VS Code; session 14: git flow graph with pinned main/develop columns; session 13: git bisect in VS Code; session 12: ahead/behind origin, update a branch without checkout, `git log --first-parent`, verify signed commits; session 11: find the commit that changed a file or folder, link Jira issues in commits, git archive as zip; session 10: fixup commits and autosquash, resolve merge conflicts; session 9: review a commit file by file, manage git remotes; session 8: cherry-pick, create a pull request, filter by branch; session 7: rebase/merge stopped with conflicts (continue, skip, abort), reorder commits, interactive rebase in VS Code; session 6: edit a commit message, drop a commit, Git Graph right-click menu not working; git worktrees in VS Code (session 5), Git Graph alternative, visualising branches in VS Code, rebase vs
  merge, undo with reset/revert/cherry-pick, stash guide, file history in VS Code, `git log --graph`,
  git graph in Cursor/VSCodium/Windsurf, compare branches/commits in VS Code, squash commits in VS Code),
  404 and sitemap (41 URLs; corrected session 12: the earlier "30 guides" was a miscount, there were 27). Session 11: privacy page and index FAQ say avatars (opt-in) are the one network exception. Session 9: every meta description ≤155 chars, every guide links the releases page. Every page's footer links every guide (session 6).
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
  **0.9.0 added:** **review mode** in the details pane (Review button or commit menu "Review changes file by file": a check box per file,
  "N of M reviewed", Next unreviewed opens the next diff in tree order, opening a diff ticks it, End review; kept per diff `<from>..<to>`
  in workspaceState `mergeline.reviews`, newest 200; none for the working tree); **remote management** (`src/core/remotes.ts`;
  `manageRemotes` action in `src/ext/actions.ts`; toolbar **Remotes…**, command `mergeline.manageRemotes`, remote badge menu "Manage remote";
  quick picks: add (+fetch), fetch, fetch and prune, change URL, rename, remove with a dialog naming the tracking branches and upstreams
  that go, copy URL, open on forge; the old "Remotes" checkbox is now "Remote branches"); **Stop at this commit to change it** (`edit`
  op in `src/core/rewrite.ts`; the rebase stops there and the existing bar's Continue amends with the staged changes). A webview test hook
  `click` (selector, ctrl) lets the e2e click real DOM elements.
  **0.10.0 added:** **fixup commits** (commit menu "Create fixup commit for this": `git commit --fixup=<sha>` from the staged changes, offers
  `git add -u` when nothing is staged; "Squash N fixup commits into their targets…" when the editable line has fixup!/squash!/amend! commits:
  `findFixups` in `src/core/rewrite.ts` matches targets as `--autosquash` does, then op `autosquash` runs `git rebase -i --autosquash --autostash`
  from the oldest target's parent with `GIT_SEQUENCE_EDITOR=true`, with the usual pushed warning and Undo); **conflicted files named in the
  in-progress bar** (first 3, then "+N more ▾" menu; click → `git.openMergeEditor`, falls back to the plain file; `fileAction` act `resolve`
  in `src/ext/panel.ts`); **append-only Load more** (`GraphPanel.load` keeps the `LayoutState`; when only the page size changed and the shown
  commits are a prefix of the new list it posts `{type:'append'}` with just the new rows; webview `appendData`). Fixed with it: the webview's
  `headReach`/`editableSet` caches are keyed on `data` and went stale on append.
  **0.11.0 added:** **find by changed path** (Find `path:<text>` + Enter → `searchLog` runs `git log -- <pathspecs>` from `pathSpecs` in
  `src/core/gitlog.ts`: `:(top,icase,literal)p`, `**/*p*`, `**/*p*/**`, or the glob at top and in folders; default simplification, not
  `--full-history`, so merges that only bring a side branch in do not match); **issue links** (setting `mergeline.issueLinks`, validated by
  `issueLinkRules` in `src/core/remote.ts`, applied by `linkify` in `media/graph.js` to commit and tag messages, overlaps resolved by start);
  **Save as archive** on commit/branch/remote/tag menus (action `archive` in `src/ext/actions.ts`: save dialog, `git archive --format --prefix`);
  **tag details** (`readTags`: `for-each-ref --points-at`, annotated with tagger/date/subject+body, shown as `.d-tag` blocks; tag menu
  "Show tag details"); **opt-in avatars** (`mergeline.showAvatars`, `src/core/misc.ts` `avatarUrl`: GitHub noreply → avatars.githubusercontent.com,
  else Gravatar md5 `d=404`; initials circle underneath; CSP `img-src` allows only those two hosts).
  **0.12.0 added:** **ahead/behind on branch badges** (`readState` reads `%(upstream:short)` and `%(upstream:track,nobracket)` → `Ref.upstream/ahead/behind/gone`;
  webview `trackHtml`: ↑N ↓N, ✕ for a gone upstream); **Update from <upstream> (fast-forward)** on non-current tracked branches (action `updateBranch`:
  `git fetch <remote> <merge>:refs/heads/<b>`, non-fast-forward → a warning, not an error); **Fetch and merge into <current> (pull)…** on remote branches
  (action `pullInto`: `fetch +refs/heads/b:refs/remotes/r/b`, then the usual merge pick on `refs/remotes/r/b`); **First parent** toolbar checkbox /
  setting `mergeline.firstParentOnly` (`LogOptions.firstParent` → `--first-parent`, parents cut to the first by `firstParents`; also used by history
  search); **signature status** in details (`readSignature` in `src/core/gitlog.ts`: `%G?%GS%GK` with a 10 s timeout; git answers N for an SSH-signed commit
  when `gpg.ssh.allowedSignersFile` is unset, so a `gpgsig` header in `git cat-file commit` then gives 'unchecked'). `git()` gained a `timeout` option.
  **0.13.0 added:** **git bisect from the graph** (`src/core/bisect.ts`: `readBisect` reads `BISECT_START`/`BISECT_TERMS` and `refs/bisect/*`, counts candidates with
  `git rev-list <bad> --not <good>…` minus bad and skipped → `left`, `steps` = ceil(log2(left+1)), `firstBad` when one candidate is left, `onlySkipped` when all
  remaining are skipped; custom terms respected). Actions `bisectStart`/`bisectMark`/`bisectReset`/`bisectRun` in `src/ext/actions.ts`; webview `#bisectbar`
  (waiting / testing with Good, Bad, Skip, Run a test command…, Reset / first bad commit with Show), `bad`/`good`/`skip` badges, auto-select of the commit
  under test, commit-menu items, edit-history items hidden while bisecting. **Run a test command** sends `git bisect run sh -c '<cmd>'` to a terminal
  (`bisectRunLine`): git quotes the arguments of `bisect run`, so a plain quoted string with `&&` fails with "not found" (found by the unit test).
  **0.14.0 added:** **pinned branches** (Git Graph issue #207, 53 👍, its most-upvoted open feature request not yet covered, read 2026-11-20 via
  `gh api search/issues ... sort=reactions`): setting `mergeline.pinnedBranches` (default `["main","master","develop"]`, names or `*` globs, max 4 =
  `MAX_PINNED`) gives each pinned branch's first-parent line its own fixed lane k on the left with colour k (`pinBranches`/`pinChains`/`extendPins` in
  `src/core/graph.ts`: `LayoutState.tips/home/expect`; a parent goes into its pinned lane only when that line expects it next, a pinned lane never
  carries another line, other lines cycle colours P..9). Tips resolved by `pinnedTips` in `src/core/pins.ts` (local + `<remote>/name` share a lane,
  newest loaded ref starts it; the uncommitted row starts HEAD's line). Branch menus: Pin to its own column / Unpin (message `pin` → `setPinned` in
  `src/ext/panel.ts`, writes the most specific level that already sets it, else user settings). Unit test `test/pins.test.ts` checks, over 300
  random histories × 3 pin sets, laid out whole and with Load more, that every node's drawn lines reach exactly its loaded parents.
  **0.15.0 added** (Git Graph issues #171 filter by author, 19 👍; #475 git notes, 19 👍; #360 exclude branches by glob, 14 👍; the next three
  by 👍 after #207): **author filter** (toolbar **Authors** checklist from `readAuthors` = `git log --format='%an <%ae>'` counted, filter box,
  "All authors"; commit menu "Show only commits by <name>" / "Show commits by all authors"; off in file history). git does **not** rewrite
  parents for `--author` (checked with git 2.53.0: neither `--parents` nor `--graph` does), so `readAuthorLog` in `src/core/gitlog.ts` reads
  all of the authors' commits (`--author=^Name <email>$`, a BRE built by `breExact`: `-F` substring matching let "JoAnn <a@x>" match
  "Ann <a@x>" and shifted history-search row indexes, found by the unit test) plus `git rev-list --parents` of the same revisions at once,
  and `nearestShown` replaces each parent with the nearest shown ancestors (first parent's side first). `searchLog` runs its message/author
  queries without the filter (else git ORs the two `--author`s). The filter passes `--no-use-mailmap`: git 2.53 applies `.mailmap` to `--author` by
  default, while the graph and the checklist show raw `%an <%ae>` (found by the guide subagent; unit test with a `.mailmap` fails without the flag). **Git notes** (`readNotedCommits` = `git notes list`, `readNote`,
  `writeNote` = `notes add -f -F -` / `notes remove`): a "note" mark on rows, a Note block with Edit in details, commit menu Add/Edit/Remove
  note, the webview message dialog in a note mode (`dialogMode`). **Hidden branches**: setting `mergeline.hiddenBranches` → `revArgs` puts
  `--exclude=<g>` before `--branches` and `--exclude=*/<g> --exclude=<g>` before `--remotes`; branch menus "Hide this branch" / "Hide all
  <prefix>/… branches" (message `hide` → `setListSetting`, shared with pins); the Branches checklist lists hidden globs with ✕ to unhide.
  **0.16.0 added** (Git Graph issue #538 create/apply patches, 17 👍, next by 👍 not covered): **patches** (`src/core/patch.ts`, no VS Code dep).
  Save/copy: `patchArgs` → commit `format-patch -1 --stdout` (a merge: `git diff --binary <sha>^1 <sha>`), Ctrl/Cmd-click series `format-patch
  <oldest>^..<newest>` (`--root` from the root; offered only when the older end is reachable from the newer among loaded commits, `reaches()` in
  `media/graph.js`, and re-checked with `merge-base --is-ancestor`), branch `format-patch <current>..<branch>`, working tree `diff --binary HEAD`
  (tracked files only), stash `stash show -p --binary`, comparison pane `diff --binary a b`. Apply (`applyPatch` in `src/ext/actions.ts`; toolbar
  **Patch** button, uncommitted-row menu, command `mergeline.applyPatch`): from files (sorted by name) or the clipboard; `inspectPatch` tells a
  format-patch mailbox (counts commits, unfolds subjects, strips `[PATCH n/m]`) from a plain diff from other text; `normalizePatch` adds a lost
  final newline; summary from `git apply --numstat` per distinct path (`--stat` counts a file once per patch: found by the e2e); picks: `git am
  --3way` (mailbox only), `git apply --3way` with fallback to plain `git apply` on "does not match index", `git apply -R`. am needs a clean index
  (git 2.53: "Dirty index"), then offers changes-only; a stopped am shows in the existing in-progress bar. Also fixed: "Squash N commits" counted
  a stash row between the two selected commits.
  **0.17.0 added** (Git Graph #254 "branch colours on all commits", 22 👍, open since 2020-02; and #809 custom colour per branch): **branch colours**
  (`src/core/colors.ts`, no VS Code dep): setting `mergeline.branchColors` (object, branch name or `*` glob → palette name or #hex/rgb()/hsl();
  `cssColor` refuses anything else, so no CSS gets into the webview's SVG attributes). Custom colours are indexes 10..35 (`CUSTOM_BASE`, max 26
  distinct); packed lane strings encode them as 'a'..'z' (`colorChar` in graph.ts, `code()` in media/rows.js). `tipColors` maps the sha of every
  local/remote branch whose name (remote prefix stripped) matches → colour, earliest rule wins; `LayoutState.tipColor` makes `alloc` use it for a
  lane that starts there (tips and merge second parents), `LayoutState.pinColor` colours pinned lanes; the uncommitted row follows the current
  branch. Badges get `--bc` (`refColors`). Branch menus: Set/Change branch colour…, Set colour of all <prefix>/… branches… → quick pick (palette with
  emoji swatches, Custom colour… input with validation, Automatic = remove), written at the level that already sets the setting. Bad entries →
  one warning naming them. **Row colours**: `mergeline.rowColors` none|stripe|tint (header right-click menu writes it): stripe = inset
  box-shadow on the description cell, tint = 11% color-mix background placed before :hover/.sel/.cmp/.drop so those still win.
  **0.18.0 added** (Git Graph #387 "Collapsible Graph", 14 👍, open since 2020-09-22; also #591's `--simplify-by-decoration` ask; the top
  uncovered request by 👍 in `gh api search/issues ... sort=reactions`, read session 18): **compact graph** (toolbar **Compact**, setting
  `mergeline.compactGraph`). `src/core/compact.ts` (no VS Code dep): `compactPlan` keeps refs/HEAD/stash bases (`keep`), merges (`merges` from
  the unsliced parent list, so first-parent mode keeps them), roots, tips (0 children) and fork points (≥2 children); every other commit has
  1 parent and 1 child, so hidden commits are straight chains, each one placeholder row `~<top sha>` (kind `collapsed`, `fold: {n, oldest, last}`)
  placed at its top's position, parent = the kept commit below. A chain with any sha in `expand` is shown whole. `readCompactLog` in gitlog.ts:
  `git rev-list --parents <order> [--first-parent] <revs>` for the plan, then `git log --no-walk=unsorted --stdin` for the shown page's commits
  and each fold's ends only. Panel: `expand` set (message `expand` → reveal top; `collapse`; `loadTo` adds the history-search match so its run
  opens; cleared on repo change / compact toggle); counts `{total, hidden, expanded}` → toolbar hint "N of M commits folded · fold all".
  Webview: three-dot node, "⋯ N commits" + date span, click/Enter opens, menu (Show these N commits / Fold opened runs again / Turn off Compact),
  no details/drag/compare on folded rows. Off in file history and with the author filter. Cost on a synthetic 101,000-commit repo (1,000
  merged branches, `git fast-import`, git 2.53.0): first page 546–702 ms vs 255–293 ms for `readLog` (2 runs), whole history → 3,002 rows.
  **0.19.0 added** (Git Graph #598 notebook diffs, 17 👍; #781 graph in the side panel, 8 👍; #184 delete several branches, 6 👍; read session 19
  with `gh api repos/mhutchie/vscode-git-graph/issues/<n>`): **graph in the Source Control sidebar** (`contributes.views.scm` webview view
  `mergeline.sidebar`, collapsed by default; `GraphHost` in `src/ext/panel.ts` wraps a WebviewPanel or WebviewView, so one controller class runs
  both; `GraphPanel.current` = editor tab, `.view` = sidebar, `.last` = last used (for Manage Remotes / Apply Patch / Delete Branches commands);
  settings carry `host: 'view'` → webview body class `side`: labels and wide controls (`.full`: Remote branches, First parent, Order, Patch, Remotes…,
  Refresh) hidden, find on its own row; separate layout key `mergeline.layout.view`, default hides date/author/hash; view title: Refresh, Open in
  editor; commands `mergeline.showInSidebar`, `mergeline.openInEditor`; an action in one host schedules a refresh of the other).
  **Notebook and image diffs**: `mergeline:` revisions are now a read-only `FileSystemProvider` (`GitFileSystem` in `src/ext/content.ts`, bytes via
  `gitBytes` in gitlog.ts; 16-entry cache for full-sha refs; missing file or ref null = empty), replacing the `TextDocumentContentProvider`, so VS Code
  opens `.ipynb` in its notebook diff editor and images in the image preview. Control run (old provider restored, same e2e): no notebook diff tab.
  **Delete several branches** (`src/core/branches.ts`: `parseBranches` from `for-each-ref` + `branch --merged HEAD`, `deletable` leaves out HEAD and
  worktree branches and ranks merged+gone, merged, gone, rest; `planDelete` → `branch -d --` / `branch -D --`; action `deleteBranches` in
  actions.ts: multi-select quick pick, unmerged → "Delete all N" / "Delete the K merged", Undo recreates at the old sha and restores
  `branch.<b>.remote/merge`). Branch menu "Delete several branches…", command `mergeline.deleteBranches`.
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
  - After push: CI for main (da36687) and tag v0.8.0 (2fa89d5) green, both jobs (unit + e2e) in each; Pages deployed; live index (v0.8,
    `mergeline-0.8.0.vsix`), the 3 new guides, `screenshot-branches.png` and sitemap (23 URLs) return 200; release asset byte-identical
    (sha256 0177acd9…); sitemap resubmitted (HTTP 204).
  - Not verified: real mouse drags of a commit inside VS Code, the PR link actually opening a browser, and the "push first" prompt path
    (needs a click on a non-modal notification).
- Verified 2026-11-20 (session 9), on the minified packaged 0.9.0 build:
  - `corepack pnpm typecheck` clean; unit tests 28/28 (new `test/remotes.test.ts`: `git remote -v` parsing incl. separate push URL and CRLF,
    remote name validation, `readRemotes`/`remoteUsage` on a real bare remote with a tracking branch and a URL-less remote; and an `edit`
    stop in `test/progress.test.ts`: stops at b, staged change + continue amends b, messages kept, a untouched, autostash restored, HEAD refused).
    Also 28/28 with an empty `HOME` and `GIT_CONFIG_NOSYSTEM=1`.
  - `node scripts/e2e.mjs` in VS Code 1.147: 35/35 once on the development build and twice on the packaged build. New checks: review mode
    driven by real clicks in the webview (Ctrl-click compare → Review → Next unreviewed opens a diff tab for `search.txt` and ticks it →
    toggle `src.txt` on/off/on → reselect restores 2 of 2 from workspaceState → End review deletes it; working tree has no review); manage
    remotes (the command's quick pick lists `origin` with its URL and "Add remote…"; add+fetch shows `up/main` in the graph; a taken name is
    refused; rename moves refs and `branch.*.remote`; set-url; remove deletes refs and the upstream, keeps the branch); stop at a commit
    (bar says "stopped at … Stop S1", Continue amends it). Edit menu labels now include "Stop at this commit to change it…".
  - Headless Chromium: `REVIEW=1 node scripts/shot/shot.mjs` (dark and light; looked at both: 5 of 7 reviewed, ticked rows faded) saved as
    `docs/screenshot-review.png`; `INTERACT=1` interaction steps still pass (exit 0).
  - `code --install-extension mergeline-0.9.0.vsix` (temp extensions dir) lists `plainbyte.mergeline@0.9.0`. Package 64.8 KB, 30 keywords
    (added "code review", "git remote"; dropped "drag and drop", "history").
  - Guides (subagent): git 2.53.0 in throwaway repos (remote add/-f, rename moves `origin/*` and `branch.*.remote`, remove deletes tracking
    refs and `branch.*.remote`/`.merge`, prune variants, three-dot diff, difftool's built-in `vscode` tool); VS Code built-ins read from
    `/snap/code/281/.../extensions/git/package.json` (Add Remote…, Remove Remote, Fetch (Prune); no rename or change URL). I checked the
    Mergeline paragraphs against the shipped labels. Link check: 0 broken internal links, 0 descriptions over 155 chars.
  - Not verified: real clicks in the remote quick picks (the e2e passes `op` and stubs the modal); "Open on GitHub" for a remote opening a
    browser; review mode on a branch's "Changes since it split" diff (same key logic, not exercised end to end).
- Verified 2026-11-20 (session 10), on the minified packaged 0.10.0 build:
  - `corepack pnpm typecheck` clean; unit tests 29/29, also with an empty `HOME` and `GIT_CONFIG_NOSYSTEM=1` (new: `findFixups` matches by exact
    subject, hash prefix, subject prefix and nested `fixup! fixup!`, leaves out a fixup with no target, stops at a merge; autosquash from the root
    folds 3 fixups into the right commits with a staged file kept by autostash; and the random-DAG test now checks that laying out a list in two
    calls with the carried state gives the same packed rows and width as one call, 200 DAGs).
  - `node scripts/e2e.mjs` in VS Code 1.147: 37/37 twice on the packaged build (plus 36/36 and 37/37 runs during development). New checks: load more
    sends pages as `append` and the webview's rows, end text, HEAD-reachable count and editable-line count equal a full reload; a **real click** on the
    conflicted file in the bar opens a `TabInputTextMerge` tab for `m.txt`; fixup: menu item present, refused with no changes, stubbed "Stage all" stages
    only tracked files, `fixup! Fix F1` created, menu then shows "Squash 1 fixup commit into its target…", autosquash leaves `Fix F2`, `Fix F1` with the fix.
  - Mutation check: with the cache reset removed from `appendData`, the load-more e2e check fails on the HEAD-reachable count (so the check catches it).
  - Payload (`scripts/bench.ts`, commits-only clone of git.git at f7de8145, 83,079 commits, git 2.53.0): loading to 5,000 commits in pages of 500 posts
    11.85 MB re-sending everything vs 2.03 MB appending; extension-side layout + serialise 597 ms vs 89 ms. Webview-side time not measured.
  - Headless Chromium (`OPBAR=1`, dark and light; looked at both): five conflicted files show as `app.ts README.md index.ts +2 more ▾`; at 1280 px the
    Source Control button wraps to a second line. Saved as `docs/screenshot-rebase.png`. `INTERACT=1` steps still pass (exit 0).
  - `code --install-extension mergeline-0.10.0.vsix` (temp extensions dir) lists `plainbyte.mergeline@0.10.0`. Package 67.4 KB, 30 keywords
    (added "fixup commit", "merge editor"; dropped "tags", "branches").
  - Guides (subagent): git 2.53.0 in throwaway repos; VS Code labels read from `/snap/code/281/.../extensions/{git,merge-conflict}` and
    `out/nls.messages.json`. Link check: 1,071 internal links, 0 broken; 0 descriptions over 155 chars; sitemap 27 URLs.
  - Not verified: clicking "+N more ▾" inside VS Code (only rendered in Chromium); the "Squash now" button on the notification (the e2e calls the
    `autosquash` action directly); autosquash with `squash!` commits (git keeps both messages since no editor opens; not tested); Windows.
- Verified 2026-11-20 (session 12), on the minified packaged 0.12.0 build:
  - `corepack pnpm typecheck` clean; unit tests 40/40 (new `test/track.test.ts`, 5 tests: `parseRefs` upstream/ahead/behind/gone and old 3-field lines;
    a real bare remote with two clones gives main ahead 1 / behind 2, and `gone` after the remote branch is deleted and pruned; first-parent log keeps
    3 of 5 commits with every parent loaded, and history search for "side" finds only the merge; `parseSignature` codes; a real **SSH-signed** commit
    reads 'unchecked' without an allowed-signers file and 'good' (signer, `SHA256:` key) with one; unsigned → null). git 2.53.0.
  - `node scripts/e2e.mjs` in VS Code 1.147: 45/45 on the dev build and 45/45 on the packaged build (`/tmp/ml-e2e.txt`, `/tmp/ml-e2e2.txt`; the first
    dev run failed only the new badge check because the row was scrolled out of the virtualised list: the test now reveals it). New checks: First parent
    setting/checkbox (every row ≤1 parent, the merge keeps one, off restores the count); against a real bare remote, `trk` is ↓2 in data and the
    rendered badge reads `trk ↓2`, `updateBranch` fast-forwards it while HEAD and the checked-out branch stay put, the badge clears; `pullInto`
    fetches a remote branch whose local tracking ref was stale and merges the fetched tip (`HEAD^2` = their tip); an SSH-signed commit's details say
    unchecked, then `✓ Good signature from … SHA256:…` in the rendered pane once an allowed-signers file is set; an unsigned commit has none.
  - Headless Chromium (`node scripts/shot/shot.mjs`, dark and `THEME=light`; looked at both): `● main ↑2`, `feature/dark-mode ✕`, and the details line
    "✓ Good signature from ada@example.com SHA256:…" from a real SSH-signed merge in the demo repo (`scripts/shot/data.ts` now signs it and sets
    upstreams). Saved as `docs/screenshot-sync.png`. The ↑ mark was faint on the light current badge, so it is now `color: inherit; opacity: .8`.
  - `code --install-extension mergeline-0.12.0.vsix` (temp extensions dir) lists `plainbyte.mergeline@0.12.0`. Package 75.1 KB, sha256 44b05dd3….
  - Not verified: GPG-signed commits (only SSH ones; the %G? mapping is shared and unit-tested per letter); a gpg that hangs (the 10 s timeout is untested);
    `updateBranch` on a branch checked out in another worktree (git refuses; the error is shown, not exercised); real right-clicks on the new menu items
    in VS Code (the e2e posts the actions; the menu items render in code paths covered only by reading).
- Verified 2026-11-20 (session 13), on the minified packaged 0.13.0 build:
  - `corepack pnpm typecheck` clean; unit tests 44/44, also with an empty `HOME` and `GIT_CONFIG_NOSYSTEM=1` (new `test/bisect.test.ts`, 4 tests: `markArgs`,
    `shQuote`, `bisectRunLine`; a 10-commit repo with the bug planted at c7: none → waiting (start `main`) → bad only → 8 left / 4 steps → skip the commit
    under test → 7 left → answering truthfully ends at c7 → reset back on `main`; custom terms `broken`/`fine` and "only skipped left" = 3; and
    `bisectRunLine('test -f f.txt && ! grep -q bug f.txt')` run by sh finds c7). git 2.53.0.
  - `node scripts/e2e.mjs` in VS Code 1.147: 46/46 on the dev build and 46/46 twice on the packaged build (`/tmp/ml-e2e13*.txt`). New check: commit menu
    shows the two Start items; start bad at HEAD → bar "mark a good commit"; bisect menu with "mark as bad (disabled)" on the bad commit and no edit items;
    mark the root good → bar "testing … N commits left, about K steps" and the webview selects HEAD; badges bad + good rendered; **a real click** on the bar's
    Good/Bad button marks HEAD; finishing finds the planted commit and the bar says "First bad commit"; reset → back on main, bar and badges gone; then
    **Run a test command** in a real VS Code terminal (`git bisect run sh -c 'if git merge-base --is-ancestor <culprit> HEAD; then exit 1; else exit 0; fi'`)
    ends with `firstBad` = the culprit.
  - Headless Chromium (`BISECT=1 node scripts/shot/shot.mjs`, dark and `THEME=light`; looked at both): bar, `bad`/`good`/`skip` badges and the detached HEAD
    row are legible. Saved as `docs/screenshot-bisect.png`. `INTERACT=1` steps still pass (exit 0).
  - `code --install-extension mergeline-0.13.0.vsix` (temp extensions dir) lists `plainbyte.mergeline@0.13.0`. Package 78.6 KB, sha256 359607f2…; keyword
    "git tree" replaced by "git bisect" (30 keywords).
  - Guide (subagent): every git output line on the page reproduced with git 2.53.0 in throwaway repos (incl. exit codes 125/126/127/128, custom terms,
    `--first-parent`); VS Code 1.146 and 1.147's bundled git extension contain no "bisect". Link check: 1,702 internal file links, 0 broken; sitemap 35 URLs.
  - Not verified: bisect on Windows (`sh -c` with double quotes in PowerShell/cmd; Git for Windows runs the step with its own sh), a bisect with
    `--first-parent` or with paths (`git bisect start -- <path>`: the candidate count ignores paths, so "N left" would be too high), and real right-clicks
    on the new menu items (the e2e reads the item labels from the webview and posts the actions).
- Verified 2026-11-20 (session 15), on the minified packaged 0.15.0 build:
  - `corepack pnpm typecheck` clean; unit tests 52/52, also with an empty `HOME` and `GIT_CONFIG_NOSYSTEM=1` (new `test/authors.test.ts`, 4 tests:
    `nearestShown` equals a brute-force "kept ancestors through non-kept commits" on 300 random DAGs; a real repo with Ann/Bob/JoAnn (same email,
    name contains Ann) → only Ann's 4 commits, merge parents rewritten to [a3, a2], a page of 2 points at the next page's commit, first parent,
    history search keeps the filter and does not OR it, author counts; `--exclude` globs for local and remote branches, HEAD on a hidden branch
    still shown, a chosen branch list ignores them; notes add/replace/multi-line/remove). The first CI-conditions run failed 1 test: `git notes add`
    needs an identity (test defect, fixed with a repo-local identity).
  - `node scripts/e2e.mjs` in VS Code 1.147: 48/48 on the dev build and 48/48 twice on the packaged build (`/tmp/ml-e2e15b,c,d.txt`). New check:
    **real clicks** open the Authors checklist (3 authors read from the DOM) and tick Grace → 2 rows, newer's parent = older, older's parents []
    , label "Grace Hopper", commit menu offers "Show commits by all authors", the All authors button restores all; a note set → `git notes show`
    matches, row mark and details text, Edit/Remove in the menu, the editor opens with the note, removing clears the mark; `hide` writes
    `hiddenBranches`, the hotfix commit disappears, the checklist lists `hotfix/* ✕`, a real click on ✕ brings it back. The first dev run
    failed only because `lastData` lacked `notes` (fixed).
  - git.git commits-only clone (86,366 commits, f7de8145, git 2.53.0, `scripts/bench-authors.ts`, best of 3): no filter, first page 618 ms;
    busiest author (Junio, 27,401 commits) first page 1,935 ms with a separate "stops" query, **1,138 ms** after merging it into one read;
    a 3-commit author 868 ms; author list (2,866 identities) 763 ms. The 28 distinct off-page parents of the busiest author's first page are all
    his commits and all appear in later pages.
  - Headless Chromium (`AUTHORS=1 AUTHOR="Ada Lovelace <ada@example.com>"`, dark and light; looked at both): checklist with counts, button label
    and focus border, connected filtered graph incl. a rewritten merge line, note mark and Note block. Saved as `docs/screenshot-authors.png`.
    `INTERACT=1` steps still pass (exit 0).
  - Guides (subagent): every git output on both pages reproduced with git 2.53.0 in throwaway repos; it corrected my brief on notes and rewriting
    (amend/rebase do not drop notes; nothing is copied until `notes.rewriteRef` is set) and found the mailmap mismatch above. VS Code 1.147's
    bundled git extension never mentions notes. Link check (my script after my last edits): 40 pages, 1,917 relative links, 0 broken; sitemap 38.
    The index tagline still said "v0.13" (missed in session 14): now v0.15.
  - `code --install-extension mergeline-0.15.0.vsix` (temp extensions dir, VS Code 1.147.0) lists `plainbyte.mergeline@0.15.0`. Package 84.5 KB,
    sha256 3f63d1c0… (rebuilt after the mailmap fix; 48/48 e2e again on it); keywords "git notes", "git log author" in, "drop commit", "merge editor" out (30).
  - Not verified: notes refs other than the default (`notes.displayRef` is ignored); a repo where `git notes add` has no identity (git's error is
    shown); author filter on repos far bigger than git.git (each load walks all history with `rev-list --parents`; timed end to end on git.git only); real right-clicks on the new
    menu items (the e2e reads labels from the webview and posts the messages).
- Not verified: Cursor and Windsurf (not installed here); remote/SSH/WSL; the Explorer and
  editor-tab context-menu entries were not clicked (the e2e suite runs the command directly; the menu
  contributions are declarative and `vsce package` accepted them); "Open on GitHub" actually opening a browser
  (`openUrl` → `vscode.env.openExternal`, http/https only) was not clicked in the e2e run; real mouse drags inside
  VS Code (the drags were synthetic events in Chromium). (Corrected session 4: an older line here said rename
  following was not implemented; 0.3.0 implemented it.)

## Metrics

- 2026-11-20 (session 19): release downloads v0.1.0 to v0.17.0 2 each, v0.3.0 3, v0.18.0 1 (read before the v0.19.0 release); 0 stars, 0 forks,
  0 open issues; traffic views 0, clones 0 (`gh api .../releases`, `.../traffic/views`, `.../traffic/clones`). Search Console: no rows by query or
  page (2026-10-20 → 2026-11-20, `searchAnalytics.query`); sitemap pending, never downloaded, 0 errors (`sitemaps.list`).

- 2026-11-20 (session 18): release downloads v0.1.0 to v0.17.0 2 each, v0.3.0 3 (read before the v0.18.0 release); 0 stars, 0 forks; traffic views 0,
  clones 0 (`gh api .../releases`, `.../traffic/views`, `.../traffic/clones`). Search Console: no rows (2026-10-20 → 2026-11-20,
  `searchAnalytics.query` by query); sitemap pending, never downloaded, 0 errors (`sitemaps.list`).

- 2026-11-20 (session 17): release downloads v0.1.0 to v0.15.0 2 each, v0.3.0 3, v0.16.0 1, v0.17.0 0 (read right after the v0.17.0 release); 0 stars,
  0 forks, 0 issues; traffic views 0, clones 0 (`gh api .../releases`, repo, `.../traffic/views`, `.../traffic/clones`). Search Console: no rows by page
  (2026-10-20 → 2026-11-20, `searchAnalytics.query`); sitemap still pending, never downloaded, 0 errors, resubmitted 2026-11-20T17:00Z (HTTP 204, `sitemaps.list`).

- 2026-11-20 (session 16): release downloads v0.1.0 to v0.14.0 2 each, v0.3.0 3, v0.15.0 1 (read before the v0.16.0 release); 0 stars, 0 forks,
  0 issues; traffic views 0, clones 0 (`gh api .../releases`, repo, `.../traffic/views`, `.../traffic/clones`). Search Console: no rows by page
  (2026-10-20 → 2026-11-20, `searchAnalytics.query`); sitemap still pending, never downloaded, 0 errors, last submitted 2026-11-20T16:26Z (`sitemaps.list`).

- 2026-11-20 (session 15): release downloads v0.1.0 to v0.14.0 2 each, v0.3.0 3 (read before the v0.15.0 release); 0 stars, 0 forks, 0 issues;
  traffic views 0, clones 0 (`gh api .../releases`, `.../traffic/views`, `.../traffic/clones`). Search Console: no rows by page
  (2026-10-20 → 2026-11-20, `searchAnalytics.query`); sitemap still pending, never downloaded, 0 errors (`sitemaps.list`).

- 2026-11-20 (session 14): release downloads v0.1.0 2, v0.2.0 2, v0.3.0 3, v0.4.0 to v0.12.0 2 each, v0.13.0 1 (read before the v0.14.0 release);
  0 stars, 0 forks, 0 issues; traffic views 0, clones 0 (`gh api .../releases`, repo, `.../traffic/views`, `.../traffic/clones`). Search Console: no rows
  by query or page (2026-10-20 → 2026-11-20, `searchAnalytics.query`); sitemap still pending, never downloaded, 0 errors (`sitemaps.list`).

- 2026-11-20 (session 13): release downloads v0.1.0 2, v0.2.0 2, v0.3.0 3, v0.4.0 to v0.12.0 2 each, v0.13.0 0 (read right after the release; our own
  check download had not been counted yet); 0 stars, 0 forks, 0 issues; traffic views 0, clones 0 (`gh api .../releases`, `.../traffic/views`,
  `.../traffic/clones`). Search Console: no rows (2026-10-20 → 2026-11-20, `searchAnalytics.query` by query); sitemap still pending, never downloaded,
  0 errors, resubmitted 2026-11-20T15:45Z with 35 URLs (`sitemaps.list`).

- 2026-11-20 (session 12): release downloads v0.1.0 2, v0.2.0 2, v0.3.0 3, v0.4.0 2, v0.5.0 2, v0.6.0 2, v0.7.0 2, v0.8.0 2, v0.9.0 2, v0.10.0 2,
  v0.11.0 0 (read before the v0.12.0 release); 0 stars, 0 forks, 0 issues; traffic views 0, clones 0 (`gh api .../releases`, `.../traffic/views`,
  `.../traffic/clones`). Search Console: no rows (2026-10-20 → 2026-11-20, `searchAnalytics.query` by query); sitemap still pending, never downloaded,
  0 errors, last submitted 2026-11-20T15:09Z (`sitemaps.list`).

- 2026-11-20 (session 11): release downloads v0.1.0 2, v0.2.0 2, v0.3.0 3, v0.4.0 2, v0.5.0 2, v0.6.0 2, v0.7.0 2, v0.8.0 2, v0.9.0 2, v0.10.0 2
  (read before the v0.11.0 release); 0 stars, 0 forks, 0 issues; traffic views 0, clones 0 (`gh api .../releases`, `.../traffic/views`,
  `.../traffic/clones`). Search Console: no rows (2026-10-20 → 2026-11-20, `searchAnalytics.query` by query); sitemap still pending, never
  downloaded, 0 errors (`sitemaps.list`).

- 2026-11-20 (session 10): release downloads v0.1.0 2, v0.2.0 2, v0.3.0 3, v0.4.0 2, v0.5.0 2, v0.6.0 2, v0.7.0 2, v0.8.0 2, v0.9.0 1 (read before the
  v0.10.0 release); 0 stars, 0 forks; traffic views 0, clones 0 (`gh api .../releases`, `.../traffic/views`, `.../traffic/clones`). Search Console: no rows
  (2026-10-20 → 2026-11-20, `searchAnalytics.query` by query); sitemap still pending, never downloaded, 0 errors (`sitemaps.list`).

- 2026-11-20 (session 9): release downloads v0.1.0 2, v0.2.0 2, v0.3.0 3, v0.4.0 2, v0.5.0 2, v0.6.0 2, v0.7.0 2, v0.8.0 2 (read before the
  v0.9.0 release); 0 stars, 0 forks; traffic views 0, clones 0 (`gh api .../releases`, `.../traffic/views`, `.../traffic/clones`). Search
  Console: no rows (2026-10-20 → 2026-11-20, `searchAnalytics.query` by query); sitemap still pending, never downloaded, 0 errors (`sitemaps.list`).

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
1a. #598, #781 and #184 shipped in 0.19.0. Next uncovered Git Graph requests by 👍: #591 extra `git log` args (9: a validated
   `mergeline.extraLogArgs` that rejects format-changing flags), #757 interactive rebase in a text editor (7), #465 filter by tags (6), #777 list a
   commit's tags (6). Sidebar follow-ups: the editor toolbar wraps "Refresh" onto a second line at 1280 px wide (Chromium shot; 0.18 does the same, so
   not a regression: shorten "Remotes…"/"Patch" to icons or drop the Refresh button, the view title and auto-refresh cover it); a sidebar-only "⋯" menu for the hidden filters (Remote branches, First parent, Order); delete several *remote*
   branches (today local only). Notebook follow-up: the working-tree side of a compare is a `file:` URI, so it is editable; fine.
   Compact follow-ups: "Fold this run" on commits of an opened run (today only "fold all"); a per-row author summary ("3 authors") needs all
   chain members' metadata (only the ends are read); e2e for history search opening a folded run (unit-tested only through `expand`). Branch-colour follow-ups: colour a merged branch's line from the merge subject ("Merge branch 'feature/x'") when its ref is
   deleted (today only lines that start at a live ref get a colour); a colour swatch in the Branches checklist. #538 patches follow-ups: untracked files in "Save changes as a patch" (`git add -N` on a temp index via
   `GIT_INDEX_FILE`), `format-patch -o <folder>` (one file per commit) as a second save option, and drag-and-drop of a .patch file onto the graph.
   Author-filter follow-ups: a "me" quick button (`git config user.email`), `.mailmap` identities (`%aN <%aE>` + `--use-mailmap`), and cache the
   `rev-list --parents` map between Load more pages (each page re-walks all history today). Notes: show `notes.displayRef` refs too.
1b. Bisect follow-ups: count candidates with the bisect's paths and `--first-parent` (read `BISECT_NAMES` and `BISECT_FIRST_PARENT`) so "N left" matches
   git's own count; a "Bisect log" item (copy `git bisect log`); offer to stash when the working tree is dirty (git refuses the checkout today and the
   error is shown).
2. Big repos: "jump to date/commit" that loads straight to it, and measure webview-side time per append on git.git (Chromium shot with a
   large payload). Path search on git.git: time `path:` queries (one `git log -- <3 pathspecs>` over all refs) and add a progress hint if slow.
3. Review mode follow-ups: "Review changes since it split" on branch menus and a keyboard shortcut for Next unreviewed; a "Squash now"
   end-to-end check (click the notification button).
4. Still missing vs Git Graph: drag-and-drop cherry-pick onto a non-current branch (checks it out first); avatars for GitLab/Bitbucket hosts
   (0.11 covers GitHub noreply + Gravatar only); a per-repository settings dialog (user name/email, issue links per repo). 0.12 closed
   first-parent view, signature status and fetch-into-local-branch / pull-from-remote-branch.
4b. Signature follow-ups: a small mark on signed rows in the graph would need `%G?` in the main log (runs gpg per signed commit: measure on a
   repo with many signed commits before doing it); post the details pane before the signature arrives if gpg is slow (today it waits, up to 10 s).
5. CI runs e2e in the latest stable VS Code (session 8). Add VSCodium as a second target (download the tarball,
   `node scripts/e2e.mjs <codium>`; 610 MB extracted, so CI only).
6. History search positions in file-history mode are approximate (they come from the multi-name log, not
   the filtered one); fine for small file histories, revisit if users report misses.
7. Directories: awesome-vscode's CONTRIBUTING.md requires a Marketplace link (read session 17), so submit there right after the store listing.
8. Read Search Console weekly (`searchAnalytics.query`) from ~2026-12-18; after store launch, record installs
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
  in the panel; CI run 44752350144: unit + e2e 32/32 green; after push CI (main, tag) and Pages green, live pages 200, asset identical. Three guides by a subagent (cherry-pick, create a pull request, filter by branch),
  homepage cards, branch-checklist screenshot. Verified: 24/24 unit, 32/32 e2e ×5 locally on packaged builds, Chromium interaction steps
  11-15, vsix install.
- 2026-11-20 builder (session 9): store tokens still absent. Built 0.9.0: review mode (tick off files per commit/comparison, Next unreviewed,
  kept in the workspace), remote management (Remotes… quick picks: add+fetch, fetch, fetch and prune, change URL, rename, remove, copy, open),
  Stop at a commit to change it (rebase `edit` stop; Continue amends). Two guides by a subagent (code review, manage remotes; git 2.53 checked in
  throwaway repos), 17 meta descriptions shortened, releases links on 10 guides, review screenshot. Verified: 28/28 unit (also CI conditions),
  35/35 e2e ×3 locally (×2 packaged), Chromium review render (dark/light), vsix install. After push: CI for main and tag v0.9.0 green with unit
  28/28 + e2e 35/35 (run 44754814285), Pages deployed, live index (v0.9, `mergeline-0.9.0.vsix`), both guides, screenshot and sitemap (25 URLs)
  return 200, release asset byte-identical (sha256 0336189e…), sitemap resubmitted (HTTP 204).
- 2026-11-20 builder (session 10): store tokens still absent. Built 0.10.0: fixup commits (create from staged changes; squash all fixups into their
  targets with one autosquash rebase), conflicted files named in the in-progress bar (click → merge editor), append-only Load more (git.git to 5,000
  commits: 11.85 → 2.03 MB posted) and a stale-cache fix it exposed. Two guides by a subagent (fixup/autosquash, resolve merge conflicts; git 2.53
  checked), screenshot updated. Verified: 29/29 unit (also CI conditions), 37/37 e2e ×2 on the packaged build, a real click opening the merge editor,
  a mutation run proving the cache check, Chromium renders, vsix install. After push: CI for main (run 44757653429) and tag v0.10.0 (run 44757673441)
  green, unit 29/29 + e2e 37/37 each; Pages deployed; live index (v0.10, `mergeline-0.10.0.vsix`), both guides, screenshot and sitemap (27 URLs)
  return 200; release asset byte-identical (sha256 1111c60a…); sitemap resubmitted (HTTP 204). Inbox: 0.10.0 line appended.
- 2026-11-20 builder (session 11): store tokens still absent. Built 0.11.0: find by changed path (`path:` in Find, whole history), issue links
  for any tracker (`mergeline.issueLinks`), Save as archive (zip/tar.gz/tar) on commit/branch/tag menus, tag details (tagger, date, message)
  in the details pane, opt-in avatars (`mergeline.showAvatars`, GitHub noreply + Gravatar, initials fallback). Three guides by a subagent (find
  the commit that changed a file, link Jira issues, git archive; git 2.53 checked in throwaway repos), privacy page + index FAQ updated for the
  avatar exception, index card, README, screenshot-tags.png. Verified: 35/35 unit, 42/42 e2e ×2 on the packaged build (5 new checks: path
  search incl. the webview's Enter flow, tag details, issue links, avatars on/off, archive zip + tar.gz contents), Chromium renders dark/light,
  vsix installs as plainbyte.mergeline@0.11.0, docs link/HTML/meta check (32 pages, 0 real problems).
  After push: CI for main (run 44760164798) and tag v0.11.0 (run 44760164614) green, unit 35/35 + e2e 42/42; Pages deployed; live index (v0.11,
  `mergeline-0.11.0.vsix`), the three guides, screenshot-tags.png, privacy and sitemap (30 URLs) return 200; release asset byte-identical
  (sha256 ff58d44c…); sitemap resubmitted (HTTP 204). Inbox: 0.11.0 line appended.
- 2026-11-20 builder (session 12): store tokens still absent. Built 0.12.0, the Git Graph gaps users hit daily: ahead/behind (↑N ↓N, ✕ gone) on branch
  badges, Update a non-checked-out branch from its upstream (fast-forward), Fetch and merge a remote branch into the current one, a First parent
  toolbar toggle (`mergeline.firstParentOnly`), and GPG/SSH signature status in details (SSH fallback when git says N). Four guides (subagent; git
  outputs reproduced with git 2.53/GnuPG 2.4/OpenSSH 10.2), a 0.12 card + 4 guide cards on the index, a site-wide fix for squeezed guide tables.
  Verified: typecheck, unit 40/40, e2e 45/45 on dev and packaged builds, Chromium renders dark/light + menu + INTERACT, vsix installs as
  plainbyte.mergeline@0.12.0, new guides rendered at 1280 and 420 px. After push: CI main (run 44764061593: unit 40/40, e2e 45/45) and tag v0.12.0
  (run 44764067141) green; Pages run 44764060214 deployed; live index (v0.12, `mergeline-0.12.0.vsix`), 4 guides, screenshot-sync.png and sitemap
  (34 URLs) return 200; release asset byte-identical (sha256 44b05dd3…); sitemap resubmitted (HTTP 204). Inbox: 0.12.0 line appended.
- 2026-11-20 builder (session 13): store tokens still absent. Built 0.13.0: git bisect from the graph (start from the commit menu, Good/Bad/Skip/Reset bar
  with commits left and steps, bad/good/skip badges, follows the commit under test, Run a test command → `git bisect run sh -c` in a terminal, terminal-started
  bisects and custom terms shown). The new unit test found that `git bisect run '<cmd with &&>'` fails ("not found"), hence `sh -c`. Guide "git bisect in
  VS Code" by a subagent (git 2.53 outputs reproduced), 0.13 card on the index, README/CHANGELOG. Verified: typecheck, unit 44/44 (also CI conditions), e2e
  46/46 on dev and twice on the packaged build (incl. a real click on the bar and a real terminal `bisect run`), Chromium renders dark/light + INTERACT, vsix
  installs as plainbyte.mergeline@0.13.0. After push: CI main (run 44766177972: unit 44/44, e2e 46/46) and tag v0.13.0 (run 44766178314: same) green;
  Pages run 44766176481 deployed; live index (v0.13, `mergeline-0.13.0.vsix`), the guide, screenshot-bisect.png and sitemap (35 URLs) return 200; release
  asset byte-identical (sha256 359607f2…); sitemap resubmitted (HTTP 204). Inbox: 0.13.0 line appended.
- 2026-11-20 builder (session 14): store tokens still absent. Picked the work from Git Graph's open issues sorted by 👍 (`gh api search/issues`): #207
  "Persistent Branches get a dedicated column" (53 👍) is the most-upvoted one Mergeline did not cover (#70, 79 👍, is covered by file history / path
  search). Built 0.14.0: pinned branches (`mergeline.pinnedBranches`, default main/master/develop; each pinned first-parent line in its own fixed column and
  colour; Pin/Unpin on branch menus). The first screenshot showed the uncommitted row would be pushed into a side column above a pinned HEAD: fixed
  (it starts HEAD's line). Guide "Git flow graph in VS Code" by a subagent (it corrected my brief: #207 is the second-most-upvoted open issue overall),
  index card, before/after screenshots from a git-flow demo repo (`scripts/shot/gitflow.ts`). Verified: typecheck; unit 48/48 (new `test/pins.test.ts`:
  connectivity of drawn lines over 300 random histories × 3 pin sets, whole and appended); e2e 47/47 on dev and on the packaged build. One packaged run
  failed the bisect `bisect run` terminal wait (30 s). Two reruns of the identical build passed 47/47, so it is a flake under load; the wait is now 60 s.
  Chromium renders of both layouts looked at; the guide was rendered at 420 px wide. vsix installs as plainbyte.mergeline@0.14.0 (VS Code 1.147.0). After
  push: CI main (run 44768941490) and tag v0.14.0 (run 44768947877) both unit 48/48, e2e 47/47; Pages run 44768941102 deployed; live index (0.14 card,
  `mergeline-0.14.0.vsix`), the guide, both screenshots and the sitemap (36 URLs) return 200; the release asset is byte-identical (sha256 b57b2b03…); the
  sitemap was resubmitted (HTTP 204). Inbox: 0.14.0 line appended.
- 2026-11-20 builder (session 15): store tokens still absent. Built 0.15.0 from the next three Git Graph requests by 👍 (#171 filter by author, #475 git notes,
  #360 exclude branches by glob): an Authors checklist and "Show only commits by …" with parents rewritten to the nearest shown ancestor (git does not do
  this for `--author`; checked with git 2.53.0), git notes (row mark, details, Add/Edit/Remove with an in-graph editor), `mergeline.hiddenBranches` with
  Hide/unhide from the menus. Two guides by a subagent (author filter + hidden branches, git notes; it also found a `.mailmap` mismatch, fixed with
  `--no-use-mailmap` and a unit test that fails without it), index card, screenshot, stale "v0.13" tagline fixed. Verified: typecheck, unit 52/52 (also CI
  conditions), e2e 48/48 on dev and three packaged builds (real clicks in the checklist and the unhide ✕), git.git benchmark (busiest author 1.94 → 1.14 s
  first page; off-page parents all the author's), Chromium renders dark/light + INTERACT, vsix installs as plainbyte.mergeline@0.15.0. After push: CI main
  (run 44773221647) and tag v0.15.0 (run 44773226264) both unit 52/52, e2e 48/48; Pages run 44773221224 deployed; live index (v0.15 tagline, 0.15 card,
  `mergeline-0.15.0.vsix`), both guides, screenshot-authors.png and sitemap (38 URLs) return 200; release asset byte-identical (sha256 3f63d1c0…); sitemap
  resubmitted (HTTP 204). Inbox: 0.15.0 line appended.
- 2026-11-20 builder (session 16): store tokens still absent. Built 0.16.0 from Git Graph #538 (create/apply patches, 17 👍): save/copy a commit,
  a Ctrl-click series, a branch's commits, a diff, uncommitted changes or a stash as a patch; apply from file(s) or the clipboard with git am --3way /
  git apply --3way (fallback to plain apply) / reverse; toolbar Patch button and command `mergeline.applyPatch`. Found while testing: `git apply --stat`
  counts a file once per patch (switched to `--numstat` per path, e2e caught it), the "Squash N commits" label counted a stash row (screenshot caught it),
  and, from the guide subagent's git runs, `git am` on a dirty index leaves an am session behind (now checked before running; e2e asserts no
  `rebase-apply`) and `stash show -p` dropped `-u` untracked files (now `--include-untracked`). Guide `git-patch-vscode.html` by a subagent (every
  command run in a scratch repo), footer link on all 40 pages, index card, screenshot-patch.png. Verified: typecheck, unit 59/59, e2e 49/49 on the dev
  build and on the final minified package (real clicks: Ctrl-click row, compare-pane link, toolbar Patch menu item), Chromium renders dark/light,
  vsix installs as plainbyte.mergeline@0.16.0 (sha256 89d86940…).
  After push: CI main (run 44776533372) and tag v0.16.0 (run 44776533429) both unit 59/59, e2e 49/49; Pages run 44776532472 deployed; live index
  (v0.16 tagline, `mergeline-0.16.0.vsix`), the guide, screenshot-patch.png and sitemap (39 URLs) return 200; release asset byte-identical (sha256
  89d86940…); sitemap resubmitted (HTTP 204). Inbox: 0.16.0 line appended.
- 2026-11-20 builder (session 17): store tokens still absent (`.env` key names). Built 0.17.0 from Git Graph #254 (branch colours on all commits, 22 👍)
  + #809: `mergeline.branchColors` (name/glob → theme palette name or validated #hex/rgb/hsl; lines, pinned columns and badges; branch-menu quick pick)
  and `mergeline.rowColors` (stripe/tint, header menu). Guide `git-graph-branch-colors-vscode.html` (git 2.53 `log.graphColors`/`color.decorate.*` run
  in a throwaway repo; VS Code 1.147 `scmGraph.*` theme colours and defaults read from its workbench bundle + nls; Git Graph `git-graph.graph.colours` and
  GitLens `gitlens.graphLane1..10Color` from their published package.json; I dropped a "git's default list has 12 colours" claim I could not reproduce).
  Verified: typecheck clean; unit 65/65 (6 new in `test/colors.test.ts`, incl. 200 random histories with Load more checking packed rows decode exactly;
  reverting the rows.js decoder makes 3 fail); e2e 50/50 in VS Code 1.147 on the minified package (new check: setting colours a hex glob and a palette
  name incl. a merge-parent line, real right-click on the main badge → Set branch colour… → stubbed pick → setting → pinned main line, working-tree row and
  HEAD node green, Change → Automatic removes, a CSS-injection value is skipped with a warning, header right-click → Row colours: tint → computed row
  background, stripe → computed inset box-shadow in the row colour); headless Chromium shots dark/stripe and light/tint (looked at both; saved as
  `docs/screenshot-colors*.png`); guide page rendered and looked at; link check 42 pages, 2,159 relative links, 0 broken; sitemap 40 URLs;
  vsix 95,097 bytes, sha256 97cc28cb…, installs as plainbyte.mergeline@0.17.0. Keyword "branch colors" in, "fixup commit" out (30).
  Not verified: real mouse right-click inside VS Code (synthetic contextmenu events in its webview); a colour picked in the real quick pick UI (stubbed);
  how a custom hex colour reads in high-contrast themes.
  After push: CI tag v0.17.0 (run 44779014394) and main (run 44779009037) success, main log shows unit 65/65 and e2e 50/50 incl. "branch colours";
  Pages run 44779008467 deployed; live index (v0.17 tagline, `mergeline-0.17.0.vsix`), the guide, both screenshots and sitemap (40 URLs) return 200;
  release asset byte-identical (sha256 97cc28cb…). Directories: none submitted (awesome-vscode needs a Marketplace link). Inbox: 0.17.0 line appended.
- 2026-11-20 (session 18): **0.18.0 compact graph** (Git Graph #387, 14 👍, top uncovered request by 👍 per `gh api search/issues` this session). Done meant:
  folded rows render and stay connected, open/fold work by real click, and the release, site and CI are live. Evidence: `pnpm typecheck` clean; unit
  69/69 (new `test/compact.test.ts`: planner on 300 random histories — every commit shown or in exactly one straight-chain fold, kept commits in git's
  order, lines only go down, opening a fold by a middle commit shows exactly it — plus real git: 12-commit repo → 6 rows `merge, [2], [3], m6, [4], m1`,
  first-parent → 3 rows, a ref inside a run splits it, empty repo). e2e 51/51 three times locally (twice on the minified build, VS Code 1.147) incl.
  "compact graph" (real click on a folded row opens it and selects its newest commit; "fold all" link; off restores; folded + shown = `git rev-list
  --count`). Looked at Chromium shots dark + light (`scripts/shot/compact.ts`: 70 commits → 19 rows); fixed from looking: equal relative dates showed
  "1 month ago – 1 month ago", footer said "19 commits". Cost on 101k synthetic commits: see Status. Guide `compact-git-graph-vscode.html`: git's
  `--simplify-by-decoration` output on a 7-commit repo (drops the merged branch, fork point and root) and `--decorate-refs=refs/tags` checked with git
  2.53.0; VS Code 1.147's `scm.graph.*` settings read from its bundled workbench JS (5 settings, no fold option); #387 date from `gh api`.
  Corrected: Status said releases "v0.1.0 to v0.15.0"; vsce allows 30 keywords, so "format-patch" made room for "compact graph".
  Not verified: history search opening a folded run (`loadTo` path) has no e2e; Ctrl-click from a selected folded row is guarded but untested.
  After push: CI main (run 44781800840) and tag v0.18.0 (run 44781801375) success, main log unit 69/69 and e2e 51 ok incl. "compact graph"; Pages run
  44781799461 deployed; live index (v0.18, `mergeline-0.18.0.vsix`), guide, both screenshots, sitemap (41 URLs) return 200; release asset byte-identical
  (sha256 746df515…), installs as `plainbyte.mergeline@0.18.0` into a temp extensions dir. Directories: none (awesome-vscode needs a Marketplace
  link). Inbox: 0.18.0 line appended.
