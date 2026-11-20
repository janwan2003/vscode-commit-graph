# Store listing: Mergeline

Package: `corepack pnpm@9.15.0 install && corepack pnpm@9.15.0 package` → `mergeline-<version>.vsix`.
The VS Code Marketplace and Open VSX both render README.md as the listing page. `package.json` holds the rest.

- **Extension ID:** `plainbyte.mergeline` (publisher `plainbyte`). If the operator's publisher ID differs,
  change `publisher` in package.json; the ID must match the publisher account.
- **Display name:** Mergeline — Git Graph, History & Branch Actions
- **Short description:** see `description` in package.json.
- **Categories:** SCM Providers, Visualization, Other. **Keywords:** in package.json (17 of the 30 the Marketplace allows).
- **Icon:** media/icon.png (256×256). **Screenshots:** docs/screenshot.png and docs/screenshot-menu.png.
- **Privacy policy:** https://janwan2003.github.io/vscode-commit-graph/privacy.html
- **Support:** https://janwan2003.github.io/vscode-commit-graph/support.html

## Publish commands (need tokens the operator creates)

```sh
# VS Code Marketplace: Azure DevOps PAT with Marketplace (Manage) scope
VSCE_PAT=... npx @vscode/vsce publish --no-dependencies -i mergeline-0.1.0.vsix
# Open VSX: token from https://open-vsx.org/user-settings/tokens after signing the publisher agreement
npx ovsx create-namespace plainbyte -p $OVSX_PAT     # once
npx ovsx publish mergeline-0.1.0.vsix -p $OVSX_PAT
```
Store the tokens in the studio `.env` as `VSCE_PAT` and `OVSX_PAT` so builders can publish updates.
