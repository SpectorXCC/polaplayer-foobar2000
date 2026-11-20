# Contributing to Verdant

Thanks for your interest in contributing to Verdant!

## Architecture Rules (JSplitter / Single-Thread Constraints)

1. **Shared global scope & `include()` load order**: `foo_uie_jsplitter` loads every script listed in `main.js` into one shared global scope. Do **not** use Node/CommonJS (`require`, `module.exports`) or ES module `import`/`export` syntax inside runtime files (`core/`, `data/`, `ui/`, `views/`, `app.js`, `main.js`).
2. **Load-time order in `main.js`**: Keep load-time dependencies respected (`core/props.js` -> `core/tokens.js` & `ui/chrome.js`, `core/memory.js` -> `ui/skeleton.js`). Avoid executing layout/painting logic at top-level load time outside `app.js`.
3. **HiDPI coordinate boundary (`core/display.js`)**: Layout and UI views operate in 96-DPI design units (DIPs). Physical pixel conversion happens via `px()`, `dip()`, `dpiGraphics()`, `dpiImage()`, and `blitCard()`.
4. **Dispose GDI+ images**: Any cached `gdi.CreateImage` / `Resize` bitmap stored in a module cache must be disposed cleanly when evicted, on DPI/theme invalidation (`clearDisplayCaches()`), and inside `on_script_unload()`.
5. **Secrets & local paths**: Never commit personal paths, local machine identifiers, server URLs, usernames, or passwords. Test fixtures in `tests/` must stay synthetic.

## Local Checks

Run both commands before submitting changes:

```powershell
node scripts/check.js
node tests/run.js
```

Note that automated tests run inside the mock SpiderMonkey/foobar2000 VM (`tests/harness.js`) and **do not verify pixel rendering**. When changing visual drawing, hitboxes, or foobar2000 API calls (`UpdateFileInfoFromJSON`, `GetLibraryItems`, UI Wizard, DPI scaling), also verify inside foobar2000 (`Shift + Right Click -> Reload`) and note what was manually verified.

## Adding Tests

Place new suites under `tests/suites/*.test.js` exporting `run()`. `tests/run.js` discovers and executes all suites in `tests/suites/` automatically using `tests/harness.js`.
