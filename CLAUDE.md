# CLAUDE.md

Guidance for Claude and other contributors working in this repo. `README.md` is for users and maintainers; this file is about how to change the code without breaking what matters.

## What this project is

A single web page that turns a project name into a deterministic VS Code theme `settings.json` snippet (copy and paste JSON only). The point: many project windows open at once, each recognizable by color, and the same name gives the same colors on every machine.

It is plain JavaScript with no framework and no bundler. `scripts/build.js` inlines `src/engine.js` into `src/template.html` and writes one file, `dist/index.html`. GitHub Pages serves that file.

## Commands

```sh
pnpm install                 # Node 24.22.3 and pnpm 12.18.0 only (engineStrict)
pnpm playwright:install      # once, for the e2e tests
pnpm build                   # dist/index.html
pnpm test:unit               # node:test, ~25 s
pnpm test:e2e                # builds, then Playwright, ~25 s
pnpm test                    # both; this is what CI runs
pnpm golden:update           # only for intentional output changes, see below
```

Always run `pnpm test` before saying a change is done. If a browser is not installed, `CHROME_PATH=/path/to/chrome pnpm exec playwright test` uses an installed one.

## Invariants (do not break)

1. **Determinism is the product.** The same name must give the same hex colors forever. Do not touch `hash32`, `buildTheme` formulas or constants, or the contents of a key group without meaning to. `tests/unit/golden.test.js` fails when output changes. Never run `pnpm golden:update` just to make a failing test pass; understand the diff first, and say in the PR that colors change.
2. **The frame never changes between light and dark.** The 22 `FRAME_KEYS` (title bar, activity bar, status bar and their hover and badge keys) are built only from the accent fit, never from the `dark` flag. The snippet relies on this: with matching on, the frame is written unscoped and only the rest is scoped to `[*Dark*]` and `[*Light*]`. A unit test checks every name.
3. **Every contrast check passes for every name.** Targets are 7:1 body text, 4.5:1 text, 3:1 non-text, measured on the final hex values after gamut mapping. `fit()` moves lightness until a color meets its target on every surface it appears on. If you add a color, add a `chk(...)` for it and make sure the 3,000-theme test still passes.
4. **Hex only.** VS Code theme colors accept `#rrggbb` (and `#rrggbbaa`). Colors are designed in OKLCH and gamut-mapped by lowering chroma at fixed lightness and hue.
5. **One self-contained file, zero external requests.** System fonts only (`--sans`, `--mono` stacks), no CDN, no analytics, no remote images. An e2e test asserts no request leaves the page's origin, and the inline favicon exists so browsers never request `/favicon.ico`.
6. **The URL hash holds inputs only, and only non-defaults.** Format is a plain `#name` shape (letters, digits, hyphens) with tokens joined by `--`, because the Claude artifact host passes through nothing else (no `?query`, no `key=value`). Names that cannot be written plainly become `--s-<base32>`. Writes use `location.replace` so the Back button is not spammed, and the `hashchange` handler ignores the page's own writes. Reserved: `settings`, `sidebar`, `customize`, `upgrade`, `downloads`, `comment-*`.
7. **The snippet never depends on the preview.** With matching on, switching Light mode and Dark mode in the preview changes the view only. The snippet is identical either way (tested).
8. **Do not emit window or theme-selection settings.** The snippet deliberately never sets `window.autoDetectColorScheme`, `workbench.preferredDarkColorTheme` or `workbench.preferredLightColorTheme`, and never sets `workbench.colorTheme` while matching is on. `workbench.colorTheme` is written only for "Color everything" with matching off.
9. **Instructions in the page are about workspace settings only** (`Preferences: Open Workspace Settings (JSON)` and `.vscode/settings.json`). Do not reintroduce user-settings wording. An e2e test checks it.

## Architecture

### `src/engine.js`

Two top-level consts, no DOM:

- `ThemeEngine`: `buildTheme(seed, mode)` returns `{ colors, textMateRules, semanticRules, checks, cvd, tok, ansi, palette, dark, hue, baseTheme }`. `makeSnippet(theme, opts)` builds the text. Also `cssVars`, `contrast`, `simulateHex`, `oklchToHex`, the key groups `FRAME_KEYS`, `EXPLORER_KEYS`, `EDITOR_KEYS`, `PANEL_KEYS`, and `SCOPE_DARK` / `SCOPE_LIGHT`.
- `UrlState` (also at `ThemeEngine.UrlState`): `DEFAULTS`, `encode(state)`, `parse(hash)`.

`makeSnippet` has three branches: `adapt` (light and dark matching), `everything` without adapt, and partial without adapt. Keep them consistent. Its option defaults differ from the page's defaults on purpose: `makeSnippet` defaults to `adapt: false` so older callers are unchanged; the page defaults to `adapt: true`.

Key groups are explicit arrays so a reader can see exactly what each option colors. A test asserts that groups exist in the theme and do not overlap.

`CHECK_AREA` maps each contrast check label to the option that turns it on (`frame`, `explorer`, `editor`, `panel`); anything unlisted is `all` and needs "Color everything". Syntax checks default to `editor`.

### `src/template.html`

Markup, CSS and one inline IIFE (ES5 style: `var`, function expressions; keep that style). Placeholders replaced by the build: `__BUILD_ID__`, `/*ROOT_VARS*/`, `<!--ENGINE-->`.

State lives in one `state` object. Pipeline: `update()` calls `render()` then `writeHash()`. `render()` builds `current` (and `other` when matching is on) and runs `applyVars`, `applyPreviewVars`, `renderSwatches`, `renderSnippet`, `renderReport`, `renderVision`.

`scope()` says which areas are colored (`explorer`, `editor`, `panel`, `all`); `REGIONS` maps areas to preview elements, and areas that are not colored are drawn with `DEFAULT_LOOK` (a stand-in for Default Dark and Light Modern). The report only counts checks whose `area` is in scope.

"Color everything" implies the other options: they show ticked and locked (`syncOptions`), but their own values are kept in `state` for when it is unticked.

Exactly one brightness control is shown at a time: with matching on, **Light mode / Dark mode** (preview only); with matching off, **Theme brightness** (shapes the snippet). Do not show both.

### `scripts/build.js`

Injects with function replacers (a string replacement would interpret `$&` and friends in the engine source). It fails if a placeholder is missing or duplicated. `BUILD_ID` (CI sets it to the commit SHA) lands in `<meta name="build">`, which the post-deploy smoke test reads.

## Adding or changing an option: checklist

Say a new group `foo`:

1. `src/engine.js`: add `FOO_KEYS` (explicit list, no overlap with other groups) and export it. Add `opts.foo` (default `false`) in `makeSnippet` in **both** the adapt branch (`keys = ...concat(opts.foo ? FOO_KEYS : [])`) and the partial branch. `everything` already includes it. Map its checks in `CHECK_AREA`.
2. `UrlState`: add to `DEFAULTS`, `encode` (push a token in a stable position), `parse`, and the header comment. Never rename an existing token; people have links.
3. `src/template.html`: `state.foo`, `scope()`, `REGIONS` (preview elements), a checkbox with `id="optFoo"`, `syncOptions` (lock under everything), `syncControls`, the `change` handler, `renderSnippet` (pass `foo` to `makeSnippet`, update the adapt note condition), swatches if it adds colors.
4. Tests: extend the option matrix in `tests/unit/snippet.test.js` (`expectedKeys`, the leak assertions, the bit-mask loop), the codec tests in `tests/unit/url.test.js` (random state generator and explicit examples), the group test in `tests/unit/themes.test.js`, and e2e cases in `tests/e2e/app.spec.js`.
5. `pnpm golden:update` only if the golden diff is exactly what you expect (new keys change the `allAreas` and `everything` hashes).
6. Update the options table in `README.md`.

## VS Code facts these files rely on

- Unscoped keys in `workbench.colorCustomizations` apply to every theme. A `"[Theme]"` block is matched against the theme's settings id, case-sensitive; `*` works only at the start or end; `[A][B]` is OR; scoped blocks are merged after the global ones. The same scoped syntax works in `editor.tokenColorCustomizations` (with `textMateRules`) and `editor.semanticTokenColorCustomizations` (with `rules`). That is why the snippet uses `[*Dark*]` and `[*Light*]`.
- Built-in theme ids today include `Dark 2026`, `Light 2026`, `Dark+`, `Dark Modern`, `Light+`, `Light Modern`, `Visual Studio Dark`, `Visual Studio Light`, and the two high-contrast ones. Older `Default Dark Modern` style ids are migrated for `workbench.colorTheme`, which is why the base-theme option still works.
- The Secondary Side Bar (where Chat lives by default) is painted with `sideBar.background`, `sideBar.border` and `sideBar.foreground`, so "Color the side bars" covers it. Chat's own `chat.*` keys are not set by this tool.
- Terminal colors come from `terminal.*` and `terminalCursor.*`; the bottom panel from `panel.*` and `panelTitle.*`.
- `workbench.colorCustomizations` and the token settings are valid in workspace settings, which is the only place the page tells people to put them.

## Testing rules

- Add or update tests with every behavior change. Do not loosen a threshold or delete an assertion to get green; if a test is wrong, say why in the commit message.
- Unit tests load the engine with `require('../../src/engine.js')`; e2e tests do too, to compute expected colors, so the browser output is compared against the source engine.
- E2E gotchas: headings are uppercased by CSS (`text-transform`), so assert on `textContent` or case-insensitively; the page fades colors over 250 ms, and `app.spec.js` injects a style to disable transitions, so keep reading colors after that; hover tests need the mouse to move away first because `pointerenter` does not fire for a pointer that is already there; the clipboard needs `context.grantPermissions`.
- The smoke test must stay quick and stable: it runs against production on every deploy. Do not add checks that depend on timing or on the viewport.

## CI/CD

`.github/workflows/ci.yml`: `verify` (all branches and PRs) then `deploy` and `smoke` (main only). The deployed artifact is the `dist/` that passed verification, built once with `BUILD_ID=$GITHUB_SHA`. Smoke compares the live `<meta name="build">` to that SHA. Pinned versions: Node from `.node-version`, pnpm from `packageManager`; do not also set `version:` on `pnpm/action-setup` (it errors when the two disagree). Actions are pinned to major versions and kept current by Dependabot.

When you change the Node or pnpm version, change it in `.node-version`, `package.json` (`engines` and `packageManager`) and `README.md`, then run `pnpm install` to refresh the lockfile.

## Style

- Plain JavaScript, `'use strict'`, no new runtime dependencies. The only dev dependency is `@playwright/test`; think hard before adding another.
- Match the existing code style in each file. The template's script is ES5.
- Prose in the page and docs: plain, direct sentences. No hype, no filler.
- Comments explain why, not what.
