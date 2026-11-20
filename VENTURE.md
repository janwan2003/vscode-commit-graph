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

**Mergeline 0.3.0 is built, released on GitHub and documented; it is not in the stores yet**
(store tokens `VSCE_PAT`/`OVSX_PAT` are still absent from the studio `.env`, checked 2026-11-20, session 3).

- Repo https://github.com/janwan2003/vscode-commit-graph (MIT). Releases v0.1.0, v0.2.0 and v0.3.0
  (`mergeline-0.3.0.vsix`, 38 KB): https://github.com/janwan2003/vscode-commit-graph/releases
- Site https://janwan2003.github.io/vscode-commit-graph/ has index, privacy, support,
  8 SEO guides (Git Graph alternative, visualising branches in VS Code, rebase vs
  merge, undo with reset/revert/cherry-pick, stash guide, file history in VS Code, `git log --graph`,
  git graph in Cursor/VSCodium/Windsurf), 404 and sitemap (11 URLs).
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
  Right-click actions on commits, branches, remote branches, tags, stashes and the
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
  - `node scripts/e2e.mjs`: 22/22 in VS Code 1.147, five runs in a row after fixing a test race
    (an assertion made before a deferred refresh landed). New checks: rename-following file history
    with the "also as" bar in the webview, and history search → `loadTo` → the webview selects the match.
  - Payload, git.git first 5,000 commits (`scripts/bench.ts` on a `--filter=tree:0` clone, 86,366 commits):
    graph data 6.58 → 0.57 MB, whole message 8.03 → 2.03 MB; all 86,366 commits 174 → 36 MB.
  - Rendering unchanged: the same git.git payload (500 commits) rendered by the 0.2.0 and 0.3.0 webviews in
    headless Chromium is pixel-identical below the toolbar (PIL `ImageChops.difference`, 1280×755 px).
  - After push: CI and Pages succeeded for 47af3a6; live new guides return 200; the v0.3.0 asset
    downloads byte-identical (sha256 62a4abf3…); `code --install-extension` lists `plainbyte.mergeline@0.3.0`.
- Not verified: Cursor, VSCodium and Windsurf (not installed here); remote/SSH/WSL; the Explorer and
  editor-tab context-menu entries were not clicked (the e2e suite runs the command directly; the menu
  contributions are declarative and `vsce package` accepted them); rename following in file history
  (not implemented).

## Metrics

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
2. Test in VSCodium or Cursor (Open VSX users are the core audience). Neither is installed here; a
   VSCodium tarball (~100 MB) in /tmp would fit the disk budget if deleted after.
3. Features users ask for that are still missing: resizable columns, drag-and-drop branch to merge or
   rebase, worktree badges, avatars (opt-in; needs network, off by default).
4. Load-more still re-reads and re-sends every loaded commit; append only the new page (layout state is
   already resumable) for repos where users scroll deep.
5. History search positions in file-history mode are approximate (they come from the multi-name log, not
   the filtered one); fine for small file histories, revisit if users report misses.
6. Read Search Console weekly (`searchAnalytics.query`) from ~2026-12-18; after store launch, record installs
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
  ×5 on the packaged build, pixel-identical render vs 0.2.0, vsix install, CI + Pages green for 47af3a6,
  live pages 200, release asset byte-identical.
