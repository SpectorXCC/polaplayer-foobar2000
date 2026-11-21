# Contributing to PolaPlayer for foobar2000

Thanks for contributing to PolaPlayer! The project is based on Verdant by superziper (MIT). Retain the original license and attribution, and do not change compatibility identifiers without a migration plan.

## Architecture Rules (JSplitter / Single-Thread Constraints)

1. **Shared global scope & `include()` load order**: `foo_uie_jsplitter` loads every script listed in `main.js` into one shared global scope. Do **not** use Node/CommonJS (`require`, `module.exports`) or ES module `import`/`export` syntax inside runtime files (`core/`, `data/`, `ui/`, `views/`, `app.js`, `main.js`).
2. **Load-time order in `main.js`**: Keep load-time dependencies respected (`core/props.js` -> `core/i18n.js` -> `core/tokens.js` & `ui/chrome.js`, `core/memory.js` -> `ui/skeleton.js`). Avoid executing layout/painting logic at top-level load time outside `app.js`.
3. **Source abstraction & capability gating**: Shared views (`views/browse.js`, `views/components.js`, `views/nav.js`, `views/search.js`) must talk only through `activeSource()` / `sourceById()` (`data/source.js`), `cover.js`, and capability helpers (`sourceHasCap`, `sourceCanLove`, `sourceAlbumTabs`), rather than reading `NVData` or local indexes directly. See [docs/PARITY.md](docs/PARITY.md).
4. **All user-visible strings belong in `core/i18n.js`**: Never hardcode raw UI strings or CJK literals inside `data/`, `ui/`, or `views/`. Always add matching keys to both `'en'` and `'zh-CN'` tables and call `T('key')`.
5. **HiDPI coordinate boundary (`core/display.js`)**: Layout and UI views operate in 96-DPI design units (DIPs). Physical pixel conversion happens via `px()`, `dip()`, `dpiGraphics()`, `dpiImage()`, and `blitCard()`.
6. **Dispose GDI+ images**: Any cached `gdi.CreateImage` / `Resize` bitmap stored in a module cache must be disposed cleanly when evicted, on DPI/theme invalidation (`clearDisplayCaches()`), and inside `on_script_unload()`.
7. **TitleFormat safety**: Wrap optional foobar2000 TitleFormat fields (`LOVED`, `added`, `last_modified`, `play_count`, `last_played`) in brackets (`[%FIELD%]`) so absent fields return `""` instead of literal `"?"`, and pass `""` (never `null`) when deleting tags via `UpdateFileInfoFromJSON`.
8. **Secrets & local paths**: Never commit personal paths, local machine identifiers, server URLs, usernames, or passwords. Test fixtures in `tests/` must stay synthetic.

## Local Checks

Run all three checks before submitting changes:

```powershell
node scripts/check.js
node scripts/lint-strings.js
node tests/run.js
```

Note that automated tests run inside the mock SpiderMonkey/foobar2000 VM (`tests/harness.js`) and **do not verify pixel rendering**. When changing visual drawing, hitboxes, or foobar2000 API calls (`UpdateFileInfoFromJSON`, `GetLibraryItems`, `Verdant.Chrome` / `UIWizard`, DPI scaling), run through [docs/MANUAL_CHECKLIST.md](docs/MANUAL_CHECKLIST.md) inside foobar2000 (`Shift + Right Click -> Reload`).

## Adding Tests

Place new suites under `tests/suites/*.test.js` exporting `run()`. `tests/run.js` discovers and executes all suites in `tests/suites/` automatically using `tests/harness.js`.
