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

**Mergeline 0.1.0 is built, released on GitHub and documented; it is not in the stores yet.**

- Repo https://github.com/janwan2003/vscode-commit-graph (MIT). Release v0.1.0 with
  `mergeline-0.1.0.vsix` (32.5 KB): https://github.com/janwan2003/vscode-commit-graph/releases/tag/v0.1.0
- Site https://janwan2003.github.io/vscode-commit-graph/ has index, privacy, support,
  5 SEO guides (Git Graph alternative, visualising branches in VS Code, rebase vs
  merge, undo with reset/revert/cherry-pick, stash guide), 404 and sitemap.
- Features: graph with lanes, merges, branches, remotes, tags, stashes and an
  uncommitted row; virtualised table with a pinned header; details pane with diffs;
  Ctrl/Cmd-click compare; find; branch filter; remotes toggle; fetch; auto-refresh; multi-repo.
  Right-click actions on commits, branches, remote branches, tags, stashes and the
  working tree (full list in README.md). Design and clean-room note: DESIGN.md.
- Verified 2026-11-20:
  - `pnpm test`: 7/7 unit tests pass (real fixture repos; lane continuity, load-more paging, renames, root commit, empty repo).
  - `node scripts/e2e.mjs`: 15/15 checks pass in real VS Code 1.147 (headless). They cover activation, the graph data, webview rows rendered, details, compare, diff editor content, stash pop, checkout, cherry-pick, revert, copy, create branch, `--no-ff` merge, hard reset, delete branch and delete tag. The run was against the minified packaged build.
  - The `.vsix` installs with `code --install-extension` (`plainbyte.mergeline@0.1.0` listed).
  - `node scripts/shot/shot.mjs` renders the real webview in headless Chromium with real data → `docs/screenshot*.png`, plus a DOM smoke check.
  - Benchmark (`scripts/bench.ts` on a synthetic 100K-commit linear repo built with `git fast-import`): first page of 500 commits in 349 ms git + 1 ms layout; all 100K in 691 ms git + 74 ms layout, 25.8 MB payload.
- Not verified: Cursor, VSCodium and Windsurf (not installed here); remote/SSH/WSL;
  push, pull and fetch against a real remote (the e2e fixture has no remote); a real
  large repo with many lanes (the synthetic one is linear); the light theme of the webview.

## Metrics

- 2026-11-20: not in any store yet, so there are no installs to read. GitHub release
  download count starts at 0 (`gh api repos/janwan2003/vscode-commit-graph/releases`).

## Next steps

1. **Operator:** create the Marketplace publisher and Open VSX namespace `plainbyte`
   (inbox, 2026-11-20). Then publish with the commands in `store/LISTING.md`. This is
   the validation channel; nothing else counts until it is done.
2. Test in VSCodium or Cursor (Open VSX users are the core audience) and in the light theme.
3. Real-remote test: push, pull, fetch and delete remote branch against a local bare repo in the e2e suite.
4. Wide-graph quality: try a repo with many parallel branches (e.g. a shallow
   `--filter=blob:none` clone of a busy OSS repo, outside the venture dir, deleted after)
   and tune lane reuse and colours.
5. Features users ask for that are still missing: drag-and-drop branch to merge or
   rebase, avatars (opt-in; it would need network access, so off by default), a
   commit-message search in all history (not just loaded commits), file-history
   view ("show this file's history in the graph"), worktree badges, pinned columns resizable.
6. After store launch: record installs and ratings weekly in `## Metrics`; add
   Search Console for the site (operator).

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
