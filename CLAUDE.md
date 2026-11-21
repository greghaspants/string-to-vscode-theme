# CLAUDE.md

Guidance for Claude and other contributors working in this repo. `README.md` is for users and maintainers; this file is about how to change the code without breaking what matters.

## What this project is

A single web page that turns a project name into a deterministic VS Code theme `settings.json` snippet (copy and paste JSON only, with one `//` comment line on top linking back to the page; see below). The point: many project windows open at once, each recognizable by color, and the same name gives the same colors on every machine.

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
2. **The frame never changes between light and dark.** The 22 `FRAME_KEYS` (title bar, activity bar, status bar and their hover and badge keys) are built only from the accent fit, never from the `dark` flag. The snippet relies on this: with matching on, the frame is written unscoped and only the rest is scoped to `[*Dark*]` and `[*Light*]`. A unit test checks every name. Whether the frame is bright with dark text (`brightBar`, `barFg`) or deep with light text is also decided from the seed alone, never the mode; see invariant 10.
3. **Every contrast check passes for every name.** Targets are 7:1 body text, 4.5:1 text, 3:1 non-text, measured on the final hex values after gamut mapping. `fit()` moves lightness until a color meets its target on every surface it appears on. If you add a color, add a `chk(...)` for it and make sure the 3,000-theme test still passes.
4. **Hex only.** VS Code theme colors accept `#rrggbb` (and `#rrggbbaa`). Colors are designed in OKLCH and gamut-mapped by lowering chroma at fixed lightness and hue.
5. **One self-contained file, zero external requests.** System fonts only (`--sans`, `--mono` stacks), no CDN, no analytics, no remote images. An e2e test asserts no request leaves the page's origin, and the inline favicon exists so browsers never request `/favicon.ico`.
6. **The URL hash holds inputs only, and only non-defaults.** Format is a plain `#name` shape (letters, digits, hyphens) with tokens joined by `--`, because the Claude artifact host passes through nothing else (no `?query`, no `key=value`). Names that cannot be written plainly become `--s-<base32>`. Writes use `location.replace` so the Back button is not spammed, and the `hashchange` handler ignores the page's own writes. Reserved: `settings`, `sidebar`, `customize`, `upgrade`, `downloads`, `comment-*`.
7. **The snippet never depends on the preview.** With matching on, switching Light mode and Dark mode in the preview changes the view only. The snippet is identical either way (tested).
8. **Do not emit window or theme-selection settings.** The snippet deliberately never sets `window.autoDetectColorScheme`, `workbench.preferredDarkColorTheme` or `workbench.preferredLightColorTheme`, and never sets `workbench.colorTheme` while matching is on. `workbench.colorTheme` is written only for "Color everything" with matching off.
9. **Instructions in the page are about workspace settings only** (`Preferences: Open Workspace Settings (JSON)` and `.vscode/settings.json`). Do not reintroduce user-settings wording. An e2e test checks it.
10. **A color in the name field sets the hue, and (if it is light) the bar brightness.** `parseColor` accepts CSS color names (any case; spaces, hyphens and underscores allowed between words only), `#rgb` `#rgba` `#rrggbb` `#rrggbbaa` (alpha ignored), Tailwind families with an optional shade (`sky`, `sky-500`; bare = 500; CSS names win for bare names, a shade always means Tailwind), and `rgb()` `rgba()` `hsl()` `hsla()` `hwb()` `oklch()`. Nothing else: no bare hex (`facade` and `bad` are words), no `lab()`, `color()`, `calc()`, `var()` or relative colors. A parsed color is always used as the color it is, and the canonical hex is what gets hashed (for the syntax arrangement), so the same color is the same theme however it is typed. If its OKLCH chroma is at least `MIN_COLOR_CHROMA` (0.03) the theme uses its hue. Below that (gray, white, black, near-whites) the color has no hue and the theme is **neutral** (`theme.color.neutral`): a `T = 0` tint factor zeroes the chroma of every hue-tinted surface, text, accent, button and bar color, the deep bar is the gray's own lightness (clamped to `NEUTRAL_MIN_BAR_L` .. 0.46), a light gray gets a bright bar like any light color, and only the syntax and terminal colors stay chromatic, spreading from `NEUTRAL_BASE_HUE` (250). Only text that is not a color is hashed for its hue. Lightness and chroma of the editor surfaces stay as they are. The one exception is the frame (title bar, activity bar, status bar): if the typed color is light (`BRIGHT_BAR_L`, OKLCH L ≥ 0.6) `buildTheme` sets `brightBar`, the bar uses the color's own L (capped at `BRIGHT_BAR_MAX_L`) and chroma, and every frame foreground (`barFg`) flips to dark text, with hover and pressed a step darker; button and badge keys keep `lightText`. Strings that are not colors with a hue take the same branch for about `BRIGHT_SHARE` (35%) of seeds, decided by their own hash (`hash32('\u0003' + key)`, read by nothing else) with the bar lightness spread over `BRIGHT_HASH_L` (0.64 to 0.88); changing either constant recolors the frame of those names and nothing else (syntax, editor and every other key stay put), so run the golden update on purpose. The frame is still identical in dark and light, and the frame checks use `barFg`. `CSS_COLORS` must match the browser's table and the function parsing must match the browser's canvas (e2e tests compare both). Words in the shuffle list must not parse as colors (`words.test.js`). Changing a table, the threshold or the accepted forms recolors every input that is a color, so run the golden update on purpose. The Tailwind table is generated: see `scripts/gen-tailwind.js` for how to refresh it.
11. **The snippet starts with one link comment, and only the page adds it.** `makeSnippet(t, { url })` puts `// Generated by String-to-VS-Code-theme util: <url>` on the first line (newlines in the url are stripped, so it can never become a second line); with no `url` the output is plain JSON as before, and the golden snapshot and the engine tests call it without one. The page passes `pageUrl()`: the current address with `U.encode(state)` as the hash (every option, and only those that differ from the defaults), and only when `location.protocol` is http or https. `highlightJson` draws that line as a comment. The e2e `snippet()` helper strips the comment so color tests do not depend on the address; use `snippetRaw()` when the comment itself matters (Copy puts the raw text on the clipboard). The smoke test checks the comment against the real deployed address.

## Architecture

### `src/engine.js`

Two top-level consts, no DOM:

- `ThemeEngine`: `buildTheme(seed, mode)` returns `{ seed, color, colors, textMateRules, semanticRules, checks, cvd, tok, ansi, palette, dark, hue, baseTheme }` (`color` is `null` for ordinary names, else `{ kind: 'name' | 'hex', hex, used }`, with `used: false` for grays). `parseColor`, `hexToOklch`, `CSS_COLORS`, `TAILWIND_COLORS` and `TAILWIND_SHADES` are exported too. `makeSnippet(theme, opts)` builds the text. Also `cssVars`, `contrast`, `simulateHex`, `oklchToHex`, the key groups `FRAME_KEYS`, `EXPLORER_KEYS`, `EDITOR_KEYS`, `PANEL_KEYS`, and `SCOPE_DARK` / `SCOPE_LIGHT`.
- `UrlState` (also at `ThemeEngine.UrlState`): `DEFAULTS`, `encode(state)`, `parse(hash)`.

`makeSnippet` has three branches: `adapt` (light and dark matching), `everything` without adapt, and partial without adapt. Keep them consistent. Its option defaults differ from the page's defaults on purpose: `makeSnippet` defaults to `adapt: false` so older callers are unchanged; the page defaults to `adapt: true`.

Key groups are explicit arrays so a reader can see exactly what each option colors. A test asserts that groups exist in the theme and do not overlap.

`CHECK_AREA` maps each contrast check label to the option that turns it on (`frame`, `explorer`, `editor`, `panel`); anything unlisted is `all` and needs "Color everything". Syntax checks default to `editor`.

### `src/template.html`

Markup, CSS and one inline IIFE (ES5 style: `var`, function expressions; keep that style). Placeholders replaced by the build: `__BUILD_ID__`, `/*ROOT_VARS*/`, `<!--ENGINE-->`.

State lives in one `state` object. Pipeline: `update()` calls `render()` then `writeHash()`. `render()` builds `current` (and `other` when matching is on) and runs `applyVars`, `applyPreviewVars`, `renderSwatches`, `renderSnippet`, `renderReport`, `renderVision`.

`scope()` says which areas are colored (`explorer`, `editor`, `panel`, `all`); `REGIONS` maps areas to preview elements, and areas that are not colored are drawn with `DEFAULT_LOOK` (a stand-in for Default Dark and Light Modern). The report only counts checks whose `area` is in scope.

"Color everything" implies the other options: they show ticked and locked (`syncOptions`), but their own values are kept in `state` for when it is unticked.

The two "?" popups ("Why?" and "What can I type?" beside the name label) both use `initPopup(wrapId, btnId, popId)`: the wrap holds the button and the popup (`.whypop` / `.whybox`); a mouse hover on the button or a click, tap or Enter opens it; the pointer leaving the wrap, a press elsewhere, focus leaving or Esc closes it. There is deliberately no note under the name field: a color is used silently, grays included (they give a neutral theme); the "What can I type?" popup is where it is explained. The examples shown in the popups are checked by e2e tests against `parseColor`, so change the accepted forms and the popup text together.

The title has an asterisk button after "VS-Code" (`#starBtn`) whose note, "and other editors built on VS Code (results may vary)" (`#starTip`), lives outside the `<h1>` and is placed by `initStar()` under the asterisk, clamped to the screen. It opens on mouse hover or on click/tap/Enter, and closes on pointer leave, a press elsewhere, blur or Esc. The `<h1>` text is therefore `String-to-VS-Code*-theme util` (tests assert that); the `<title>` and the heading's accessible name stay `String-to-VS-Code-theme util`.

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

`.github/workflows/ci.yml`: `verify` (all branches and PRs) then `deploy` and `smoke` (main only). The deployed artifact is the `dist/` that passed verification, built once with `BUILD_ID=$GITHUB_SHA`. Smoke compares the live `<meta name="build">` to that SHA. Pinned versions: Node from `.node-version`, pnpm from `packageManager`; do not also set `version:` on `pnpm/action-setup` (it errors when the two disagree). Every action is pinned to a full commit SHA with its release version in a trailing comment (`uses: owner/name@<40-hex-sha> # v1.2.3`), and Dependabot bumps both together. Never replace a SHA with a tag; to change one, look up the commit the release tag points to (`git ls-remote --tags https://github.com/<owner>/<name>.git`, taking the peeled `^{}` line for annotated tags).

When you change the Node or pnpm version, change it in `.node-version`, `package.json` (`engines` and `packageManager`) and `README.md`, then run `pnpm install` to refresh the lockfile.

## Style

- Plain JavaScript, `'use strict'`, no new runtime dependencies. The only dev dependency is `@playwright/test`; think hard before adding another.
- Match the existing code style in each file. The template's script is ES5.
- Prose in the page and docs: plain, direct sentences. No hype, no filler.
- Comments explain why, not what.
