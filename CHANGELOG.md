# Changelog

All notable changes to PolaPlayer for foobar2000 will be documented in this file. Earlier entries describe the Verdant-derived baseline.

## [Unreleased]

### Added
- **PolaPlayer Native 1.0.0** provides a Windows x64 foobar2000 user interface with local library browsing, optional Navidrome, playlist editing, a playback queue, and persistent settings.
- The native fullscreen player shows synchronized local and Navidrome lyrics, cover art, and an audio spectrum.

### Changed
- The Columns UI theme can render fullscreen lyrics with WebView2 and AMLL. It falls back to GDI+ when WebView2 is unavailable and uses GDI+ for the visualizer.
- Fullscreen playback tracks seeks and track changes across renderers and keeps cover exports in a separate cache.
- The native build accepts SDK and compiler paths as arguments or environment variables.

## [2.0.0] — PolaPlayer for foobar2000, unified Local / Navidrome

### Added
- **PolaPlayer branding**: Public project name and interface branding, retaining original Verdant attribution and the legacy profile folder / COM helper identifiers for existing users.
- **Welcome and setup guide**: First-run source selection, local music folder guidance, optional Navidrome component detection and connection test, live colour mode preview, and a reusable Setup menu. Upgrades retain existing settings.
- **Internationalization (`core/i18n.js`, `scripts/lint-strings.js`)**: Complete `en` and `zh-CN` dictionaries (221 keys), `Display: language (auto / en / zh-CN)` auto-detection from Windows `LocaleName`, dynamic `onLangChange` listener hooks, and automated i18n parity/CJK lint check.
- **Unified `MusicSource` & Cover Abstraction (`data/source.js`, `data/cover.js`, `data/source_navidrome.js`)**: Normalized `Song` / `Album` / `Artist` / `Playlist` / lazy `Rows` data contracts across both Local and Navidrome, prefix-routed cover helpers (`local:`, `localar:`, `localpl:`, `locallib`, Navidrome IDs), and capability gating (`caps`).
- **Generalized Shared UI (`views/browse.js`, `views/components.js`)**: Single 8-page browse architecture (`home`, `albums`, `artists`, `playlist`, `album`, `artist`, `starred`, `random`) with unified top bar, pill controls, card shells, track rows, sort dropdowns, and capability-gated love buttons.
- **Local Music Adapter (`data/source_local.js`, `data/stats.js`, `data/loved.js`)**:
  - Time-sliced local index build (`jobRun`) with lazy track rows and paginated album views (`recent`, `newest`, `frequent`, `random`, `alphabeticalByName`).
  - 30-second play statistics tracking saved to `verdant-cache\local-stats.json`, one-time `foo_playcount` import, and automatic fallback sorting before play history accumulates.
  - Configurable `LOVED` tag reading/writing via `IFbMetadbHandleList.UpdateFileInfoFromJSON`, first-write confirmation dialog, non-blocking `on_metadb_changed` self-write ignore, and 1.5s read-only failure rollback toast.
- **Native Windows 11 Snap Layouts (`native/VerdantChrome.dll`)**: Optional COM helper (`Verdant.Chrome`) with `UIWizard` fallback for frameless custom window chrome.
- **Automated Test & Doc Suite**: Added `i18n.test.js`, `source.test.js`, `browse_snapshot.test.js`, `local_source.test.js`, `snap_layout.test.js`, and `parity.test.js`, plus [docs/PARITY.md](docs/PARITY.md), [docs/INSTALL.md](docs/INSTALL.md), [docs/MANUAL_CHECKLIST.md](docs/MANUAL_CHECKLIST.md), and expanded [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Changed
- Converged `view` state to `'browse' | 'songs' | 'search'` and retired redundant per-source view files (`views/navidrome.js`, `views/home.js`, `views/artist.js`, `views/cards.js`, `views/playlist.js`).
- Unified Local and Navidrome playlist/track context menus, creation/rename/delete dialogs, search, and `Radio Mix` auto-top-up (`playback.js`, `navidrome_playback.js`, `playlist_edit.js`, `dedupe.js`).
- Upgraded `views/songs.js` (`All Songs`) to shared browse header metrics, track rows, column headers, and track context/love actions while preserving multi-level grouping and `Normalize volume` ReplayGain workflow.

### Fixed
- Bracketed optional TitleFormat evaluations (`[%LOVED%]`, `[%added%]`, `[%last_modified%]`, `[%play_count%]`, `[%last_played%]`) to avoid `"?"` literals in foobar2000 when fields are unset.
- Used `""` (empty string) instead of `null` when clearing `LOVED` tags so foobar2000 removes metadata rather than writing `"null"`.
- Avoided circular `drawCircle` -> `coverIdForHandle` -> `coverDrawCircle` recursion in `data/cover.js`.

## [1.3.0] — Baseline

- Spotify-inspired custom UI rendered in a single `foo_uie_jsplitter` panel on foobar2000 v2 + Columns UI, with optional `foo_ui_wizard` frameless window title bar.
- Local Music views (`Home`, `Playlists`, `All Songs` grouping & ReplayGain normalize pill, `Artist`, `Search`, drag-and-drop import, duplicate detection).
- Navidrome (`foo_navidrome`) integration (`Home`, `Albums` categories, `Artists`, `Starred`, `Random Mix` infinite auto-top-up, server playlists, search, disk-cached artwork).
- Native JavaScript synced/unsynced lyrics (`Queue` / `Lyrics` right pane + fullscreen mode) and real-time audio spectrum visualizer (`Bars`, `Radial ring`).
- Adaptive Light/Dark palettes, CJK font stack probing & true subfamily weights, per-monitor HiDPI scaling, Split-Layer Win32 `GdiDrawText` card rendering, and consistent Light/Dark hover contrast & focus states.
