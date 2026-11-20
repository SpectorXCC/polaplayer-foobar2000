# Changelog

All notable changes to Verdant will be documented in this file.

## [Unreleased]

- Phase 1 live verification completed for `IFbMetadbHandleList.UpdateFileInfoFromJSON`, bracketed TitleFormat evaluation (`[%LOVED%]`), tag deletion semantics (`""` vs `null`), and `on_metadb_changed` `fromhook` behavior (documented in `docs/ARCHITECTURE.md`).
- Repository foundation initialized (MIT `LICENSE`, `README.md`, `CONTRIBUTING.md`, `package.json`, `scripts/check.js`, modular `tests/` harness & suites).

## [1.3.0] — Baseline

- Spotify-inspired custom UI rendered in a single `foo_uie_jsplitter` panel on foobar2000 v2 + Columns UI, with optional `foo_ui_wizard` frameless window title bar.
- Local Music views (`Home`, `Playlists`, `All Songs` grouping & ReplayGain normalize pill, `Artist`, `Search`, drag-and-drop import, duplicate detection).
- Navidrome (`foo_navidrome`) integration (`Home`, `Albums` categories, `Artists`, `Starred`, `Random Mix` infinite auto-top-up, server playlists, search, disk-cached artwork).
- Native JavaScript synced/unsynced lyrics (`Queue` / `Lyrics` right pane + fullscreen mode) and real-time audio spectrum visualizer (`Bars`, `Radial ring`).
- Adaptive Light/Dark palettes, CJK font stack probing & true subfamily weights, per-monitor HiDPI scaling, Split-Layer Win32 `GdiDrawText` card rendering, and consistent Light/Dark hover contrast & focus states.
