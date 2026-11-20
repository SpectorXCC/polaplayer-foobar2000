# Verdant

A Spotify-style theme for **foobar2000 v2 (64-bit)** built from scratch on **Columns UI** and **JSplitter (`foo_uie_jsplitter`)**.

<!-- Screenshots: add Light Mode, Dark Mode, Navidrome, and Fullscreen captures here -->

## Features

- **Custom-drawn single-panel UI**: Navigation sidebar, main browse pane, right-side Queue & Lyrics pane, bottom transport bar, fullscreen Chill/Visualizer view, and optional frameless window title bar.
- **Dual music sources**: Switch between your **Local Library** (`foobar2000` playlists & media library) and **Navidrome / Subsonic** (`Home`, `Albums`, `Artists`, playlists, starred collection, infinite random mix, and search).
- **Native JavaScript lyrics**: Synced click-to-seek rolling lyrics and unsynced lyrics in both the right sidebar and fullscreen overlay (reading `.lrc` / `.txt` sidecars locally or Subsonic `getLyricsBySongId` / `getLyrics` remotely).
- **Audio spectrum visualizer**: Real-time FFT bar spectrum and radial ring visualizer (`fb.GetAudioChunk`) in fullscreen mode.
- **High-DPI & Adaptive Themes**: Per-monitor DPI scaling (`UISCALE`), Light/Dark mode auto-tracking with Columns UI, CJK-aware font resolution, split-layer native Win32 card text rendering, and hybrid Contain/Cover aspect-ratio artwork handling.
- **Local Library Extras**: Multi-level All Songs grouping (`artist`, `album`, `artist & album`), ReplayGain normalization prompt & toggle, drag-and-drop file/folder import, and duplicate-track detection.

## Requirements

| Component | Status | Notes |
|---|---|---|
| **foobar2000 v2.x (64-bit)** | Required | Hosts media library, playback engine, and ReplayGain scanner. |
| **Columns UI** (`foo_ui_columns`) | Required | Provides the host layout and dark/light colour mode events. |
| **JSplitter** (`foo_uie_jsplitter`, tested on 3.8.12) | Required | SpiderMonkey + GDI+ host running `main.js` (`drag_n_drop`, `grab_focus`). |
| **UI Wizard** (`foo_ui_wizard`) | Optional | Enables frameless window chrome and custom title-bar controls; degrades gracefully when absent. |
| **Navidrome component** (`foo_navidrome`) | Optional | Required only for Navidrome server playback/scrobbling (`navidrome://` decoder). |
| **Verdant Discord Presence** (`foo_verdant`) | Optional | Publishes the active track to Discord Rich Presence when installed; safely no-ops otherwise. |

## Credentials Notice

Verdant **does not store Navidrome credentials** of its own. When Navidrome mode is active, Verdant reads the server configuration already managed by `foo_navidrome` in `config.sqlite` inside your foobar2000 profile folder.

## Installation

1. Copy the `verdant` folder into your foobar2000 v2 profile directory (for example, `%APPDATA%\foobar2000-v2\verdant`).
2. Ensure **Columns UI** and **foo_uie_jsplitter** (64-bit) are installed in foobar2000.
3. In Columns UI Layout preferences, add a **JSplitter** panel sized as the full window container.
4. Open the JSplitter panel menu (`Shift + Right Click -> Configure...`) and load or include `verdant\main.js`:
   ```js
   include(fb.ProfilePath + 'verdant\\main.js');
   ```
5. Apply and reload the panel. If using `foo_navidrome` / native lyrics panels inside the layout, keep them hidden or let Verdant manage visibility cleanly.

## Panel Properties

Right-click an empty panel area -> *Properties* to customize these persisted settings (reload the panel after changing load-time properties):

| Property | Default | Description |
|---|---|---|
| `Display: UI font (auto / cui / font name)` | `auto` | Probes `HarmonyOS Sans SC`, `Noto Sans SC`, `Source Han Sans SC`, `PingFang SC`, `Microsoft YaHei UI`, `Segoe UI`; `'cui'` follows Columns UI font; or enter a font family name. |
| `Lyrics: font (auto = match UI / cui / font name)` | `auto` | Independent font override for right-pane and fullscreen lyrics (`'auto'` matches UI font). |
| `Display: UI scale (0 = auto)` | `0` | UI scale multiplier (`0.75`–`3.0`); `0` follows Windows DPI (`DPI / 96`). |
| `Display: colour mode (0 = auto, 1 = dark, 2 = light)` | `0` | `0` follows Columns UI / system dark mode, `1` forces dark, `2` forces light. |
| `Animation: target FPS (0 = auto)` | `0` | Animation frame rate (`30`–`240`); `0` auto-targets `120` FPS (`8 ms` tick, dt-normalized). |
| `Playback: output ceiling (dB below max)` | `0` | Caps maximum volume slider output (`-60` to `0` dB). |
| `Scrolling: wheel step (px)` | `180` | Scroll distance in DIPs per mouse wheel notch (min `20`). |
| `Discord: show the playing track (1 = on)` | `1` | Syncs the optional `foo_verdant` Discord Rich Presence menu toggle (`0` = off). |

Verdant also persists view state in `Navigation: music source` (`local` / `navidrome`) and `Navigation: right pane` (`queue` / `lyrics`).

## Development & Verification

Automated checks require **Node.js >= 18** (no npm runtime dependencies):

```powershell
node scripts/check.js   # Syntax-checks all .js files (node --check)
node tests/run.js       # Runs all test suites in a simulated JSplitter/foobar2000 VM host
```

Or via npm scripts (`cmd /c npm test` if PowerShell script execution policy restricts `npm.ps1`).

## Known Limitations (v1.3.0)

- **Automated tests run against a mock VM host** (`tests/harness.js`): GDI+ rasterization, ClearType text rendering, and real foobar2000 audio decoders require manual verification inside foobar2000.
- **Local vs Navidrome UI parity (work in progress)**: As of v1.3.0, Local Music and Navidrome still use separate view modules (`views/home.js`, `artist.js`, `playlist.js` vs `views/navidrome.js`), and UI strings are mixed English/Chinese. Unifying both sources behind a single `MusicSource` layer and adding i18n is tracked in `docs/ARCHITECTURE.md`.
- **Single UI thread**: Heavy library operations are sliced via `core/jobs.js` (`ensureBuilt`), which assumes synchronous TitleFormat evaluations fit reasonably within slice budgets.

## License

[MIT](LICENSE)
