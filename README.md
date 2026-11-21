# PolaPlayer for foobar2000

A modern music interface for **foobar2000 v2 (64-bit)** on Windows, bringing **Local Music** and **Navidrome / Subsonic** together with synced lyrics, a fullscreen player, adaptive HiDPI and native Windows Snap.

[简体中文](README.zh-CN.md) | [Installation guide](docs/INSTALL.md)

PolaPlayer is an independent, open-source development of [Verdant](https://github.com/superziper/verdant-foobar2000-theme) by superziper (MIT), built on **Columns UI** and **JSplitter**. It is a theme/UI script with an optional native window helper, not a standalone player or an official foobar2000 component. The original license and attribution are retained.

## Highlights (`v2.0.0`)

- **Unified Views, Dual Sources**: Switch seamlessly between **Local Music** (`foobar2000` library & playlists) and **Navidrome / Subsonic** inside the exact same Home, Albums (`Recently played`, `Recently added`, `Most played`, `Random`, `By name`), Artists, Artist Detail, Album Detail, Playlist Detail, Liked Songs, Radio Mix, and Search views.
- **Local Play Stats & File-Tag Favorites**:
  - `data/stats.js` records tracks/albums played for 30+ seconds into `verdant-cache\local-stats.json` (with one-time import from `foo_playcount` when installed).
  - `data/loved.js` reads/writes configurable `LOVED` tags on local files with a first-write confirmation modal, non-blocking `on_metadb_changed` self-write filtering, and 1.5s read-only rollback toast.
- **Local Power Features Integrated**: Multi-level `All Songs` grouping (`artist`, `album`, `artist & album`), ReplayGain `Normalize volume` scan/toggle, empty-playlist file/folder browser CTAs, drag-and-drop import overlay, and duplicate detection.
- **Native Bilingual i18n (`en` / `zh-CN`)**: Auto-detects Windows UI locale or switches cleanly via panel properties, verified with static string checks.
- **First-run Setup**: Choose local-only or Local + Navidrome, configure library folders and test your existing server connection, then preview Light/Dark/System appearance. Reopen anytime from **Setup** in the title bar.
- **Lyrics, FFT Visualizer & Adaptive HiDPI**: Synced click-to-seek JS lyrics (right pane & Apple Music-inspired fullscreen), real-time FFT spectrum (`Bars`, `Radial ring`), per-monitor HiDPI scaling, CJK-aware typography, Light/Dark themes, and optional **Windows 11 Snap Layouts**, including dragging to snap, via `Verdant.Chrome`.

## Requirements

| Component | Status | Notes |
|---|---|---|
| **[foobar2000 v2.x (64-bit)](https://www.foobar2000.org/download)** | Required | Hosts media library, playlists, playback engine, and ReplayGain scanner. |
| **[Columns UI](https://www.foobar2000.org/components/view/foo_ui_columns)** (`foo_ui_columns`) | Required | Provides the layout host and dark/light colour mode notifications. |
| **[JSplitter](https://hydrogenaudio.org/index.php/topic,126743.0.html)** (`foo_uie_jsplitter`, tested on `3.8.12`) | Required | SpiderMonkey + GDI+ host running `main.js` (`drag_n_drop`, `grab_focus`). |
| **`Verdant.Chrome`** (`native/VerdantChrome.dll`) | Optional | Frameless custom chrome with native drag-to-snap and Windows 11 Snap Layouts. |
| **[UI Wizard](https://github.com/The-Wizardium/UI-Wizard)** (`foo_ui_wizard`) | Optional | Fallback custom frame & snap presets when `Verdant.Chrome` is not installed. |
| **[Navidrome component](https://www.foobar2000.org/components/view/foo_navidrome)** (`foo_navidrome`) | Optional | Required only for Navidrome server playback/scrobbling (`navidrome://` decoder). |
| **Verdant Discord Presence** (`foo_verdant`) | Optional | Publishes the active track to Discord Rich Presence when installed. |

## Quick Start

1. Install the required components, download or clone this repository, and copy the repository contents into a directory called `verdant` inside your foobar2000 v2 profile (`%APPDATA%\foobar2000-v2\verdant` for a standard installation, or `profile\verdant` beside the executable for a portable setup). The old folder name and `Verdant.Chrome` COM name intentionally remain for compatibility.
2. Add a full-window **JSplitter** panel inside **Columns UI**, open **Configure...**, and load:
   ```js
   include(fb.ProfilePath + 'verdant\\main.js');
   ```
3. *(Optional)* Run `native\register.ps1` from PowerShell in the installed theme directory to enable Windows 11 Snap Layouts on custom window controls. Review the script first; it registers the helper for the current Windows user, without requiring administrator privileges.
4. Complete the welcome guide, or skip straight to Local Music. Existing installations keep their source and theme preferences; use **Setup** to change them.

See [docs/INSTALL.md](docs/INSTALL.md) for full setup, Navidrome credential notes, and property details. Third-party foobar2000 components are not bundled; install them from their respective sources. Back up your existing layout before changing it.

## Panel Properties

Customize via right-click -> *Properties* (reload the panel after changing load-time properties):

| Property | Default | Description |
|---|---|---|
| `Display: UI font (auto / cui / font name)` | `auto` | Probes CJK/UI font stack, `'cui'` follows Columns UI font, or specify a font family name. |
| `Lyrics: font (auto = match UI / cui / font name)` | `auto` | Independent font override for right-pane and fullscreen lyrics. |
| `Display: UI scale (0 = auto)` | `0` | UI scale multiplier (`0.75`–`3.0`); `0` follows Windows DPI (`DPI / 96`). |
| `Display: colour mode (0 = auto, 1 = dark, 2 = light)` | `0` | `0` follows Columns UI / Windows mode live, `1` forces dark, `2` forces light. |
| `Display: language (auto / en / zh-CN)` | `auto` | `'auto'` detects Windows locale (`zh-*` -> `zh-CN`, else `en`). |
| `Animation: target FPS (0 = auto)` | `0` | Smooth scroll cadence (`30`–`240`, `0` targets `120` FPS). |
| `Playback: output ceiling (dB below max)` | `0` | Caps maximum volume slider output (`-60` to `0` dB). |
| `Scrolling: wheel step (px)` | `180` | Scroll distance in DIPs per mouse wheel notch (min `20`). |
| `Discord: show the playing track (1 = on)` | `1` | Enables optional `foo_verdant` Discord Rich Presence (`0` = off). |
| `Loved: tag field` | `LOVED` | Tag field name read/written for Local `Liked Songs`. |
| `Loved: tag value that means loved (empty = any non-empty value)` | `""` | Custom match value when sharing multi-value fields; empty writes `'1'`. |
| `Loved: write tags to files (1 = on)` | `1` | Enables/disables writing `LOVED` tags onto audio files (`0` = read-only). |

*(Panel view preferences are persisted automatically in `Navigation: music source`, `Navigation: right pane`, and `Loved: tag write confirmed (0 / 1)`.)*

## Documentation

- [docs/INSTALL.md](docs/INSTALL.md) — Setup instructions, `Verdant.Chrome` registration, and complete property table.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Module layout, `MusicSource` adapter contract, lazy `Rows`, cover protocol, and live foobar2000 API notes.
- [docs/PARITY.md](docs/PARITY.md) — Source capability & view parity matrix (Local vs Navidrome).
- [docs/MANUAL_CHECKLIST.md](docs/MANUAL_CHECKLIST.md) — Live verification checklist for foobar2000 v2.

## Development & Verification

Automated checks require **Node.js >= 18** (zero npm runtime dependencies):

```powershell
node scripts/check.js          # Syntax-checks all runtime & test .js files
node scripts/lint-strings.js   # Verifies en/zh-CN i18n parity & no bare CJK literals in runtime code
node tests/run.js              # Runs all JavaScript regression suites
./tests/test-native-focus.ps1  # Native chrome regression tests (requires MinGW-w64 g++ on PATH)
```

*(Or run via `cmd /c npm run check`, `cmd /c npm run lint:strings`, `cmd /c npm test`.)*

## Known Limitations

- **Simulated automated host**: `tests/harness.js` runs in a mocked SpiderMonkey/foobar2000 VM; pixel rendering, ClearType text, real decoders, and `UpdateFileInfoFromJSON` on read-only/cue files require live foobar2000 verification (see [docs/MANUAL_CHECKLIST.md](docs/MANUAL_CHECKLIST.md)).
- **Navidrome credentials**: Managed by `foo_navidrome` in `config.sqlite`. PolaPlayer uses the saved connection for browsing and playback, and does not add a separate credential store.
- **User data**: Editing server playlists changes them on your Navidrome server. Optional local favorites and ReplayGain can write file metadata after confirmation. Only source and the native helper are distributed here, never a personal foobar2000 profile, music library, or server credentials.

## License

[MIT](LICENSE). Based on [Verdant](https://github.com/superziper/verdant-foobar2000-theme) by superziper. See [third-party notices](THIRD-PARTY-NOTICES.md). PolaPlayer is independent of foobar2000, Navidrome, Spotify and Apple Music.
