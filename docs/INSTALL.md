# PolaPlayer Installation & Configuration Guide

## Prerequisites

| Component | Required? | Purpose |
|---|---|---|
| **foobar2000 v2.x (64-bit)** | Required | Hosts library index, playlists, ReplayGain scanner, and playback engine. |
| **Columns UI** (`foo_ui_columns`) | Required | Panel layout container and Light/Dark system theme notifications. |
| **JSplitter** (`foo_uie_jsplitter`, tested on `3.8.12+`) | Required | SpiderMonkey + GDI+ host running Verdant (`drag_n_drop` & `grab_focus`). |
| **`Verdant.Chrome`** (`native/VerdantChrome.dll`) | Optional (Recommended) | Enables frameless custom title bar with native **Windows 11 Snap Layouts** maximize-hover support. |
| **UI Wizard** (`foo_ui_wizard`) | Optional | Legacy fallback frameless chrome & window snap presets when `Verdant.Chrome` is not registered. |
| **`foo_navidrome`** | Optional | Required only for Navidrome / Subsonic server browsing, playback (`navidrome://`), and scrobbling. |
| **`foo_verdant`** | Optional | Discord Rich Presence integration (`Discord: show the playing track`). |

## Step-by-Step Setup

1. **Copy theme files**
   Download this repository and place its contents in a folder named `verdant` directly inside your foobar2000 v2 profile (for example, `%APPDATA%\foobar2000-v2\verdant`). For portable foobar2000, use `profile\verdant` beside `foobar2000.exe`. Keep this legacy directory name for compatibility. Install Columns UI and JSplitter separately using the links in the [README](../README.md#requirements).

2. **Add JSplitter panel in Columns UI**
   - Open **foobar2000 Preferences -> Display -> Columns UI -> Layout**.
   - Create a layout with a single full-window **JSplitter** panel.
   - *(Optional, when using `foo_navidrome`)* If your layout hosts native Navidrome or Lyrics helper panels, keep them present and Verdant will automatically lock/hide them at runtime (`hideNativePanel`).

3. **Load `main.js`**
   - Hold `Shift + Right Click` on the JSplitter panel -> **Configure...**
   - Include PolaPlayer's entry point:
     ```js
     include(fb.ProfilePath + 'verdant\\main.js');
     ```
   - Click **OK** to load PolaPlayer.

4. **(Optional) Register `Verdant.Chrome` for Windows 11 Snap Layouts**
   Run from PowerShell (per-user `HKCU` COM registration, no admin privileges required):
   ```powershell
   cd .\native
   .\register.ps1
   ```
   To rebuild `VerdantChrome.dll` from source (`verdant_chrome.cpp`), install 64-bit MinGW-w64 with `g++` on PATH and run `.\build.ps1` while foobar2000 is closed. To unregister, run `.\unregister.ps1`. The original helper name is intentionally unchanged.

5. **Configure Navidrome (optional)**
   Configure servers inside `foo_navidrome` itself. PolaPlayer uses the connection saved by `foo_navidrome` in `config.sqlite` inside your profile folder; it does not create a separate credential store.

## Welcome guide

On a new panel, choose **Local Music** or **Local Music + Navidrome**. Local-only mode hides the Navidrome source and doesn't query its server while browsing local music. Step 2 opens foobar2000 Preferences for adding Media Library folders or configuring `foo_navidrome` under Tools > Navidrome; if the component is missing, the guide links to its official download. Connection testing uses the saved configuration and is optional. Step 3 previews a colour mode and saves it when you finish.

You may skip the first run or cancel a reopened guide. Use **Setup** in the title bar (or the compact Menu) to change the sources and appearance later. Existing Verdant users are migrated without an automatic prompt. For a release layout generated from an existing panel, set `Setup: music sources (local / both)` to `pending` in the clean distribution layout so new installs receive the guide; do not overwrite this property on upgrades.

## Panel Properties Reference

Right-click an empty panel area (outside track rows/cards) or `Shift + Right Click` -> **Properties** to customize PolaPlayer settings:

| Property Name | Default | Behavior |
|---|---|---|
| `Display: UI font (auto / cui / font name)` | `auto` | Probes `HarmonyOS Sans SC`, `Noto Sans SC`, `Source Han Sans SC`, `PingFang SC`, `Microsoft YaHei UI`, `Segoe UI`; `'cui'` tracks Columns UI font; or specify any installed family name. |
| `Lyrics: font (auto = match UI / cui / font name)` | `auto` | Independent font override for right-pane and fullscreen lyrics (`'auto'` follows UI font). |
| `Display: UI scale (0 = auto)` | `0` | Manual UI scale multiplier (`0.75`–`3.0`); `0` follows current Windows monitor DPI (`DPI / 96`). Stored as string to preserve fractional edits (`1.25`, `1.5`, etc.). |
| `Display: colour mode (0 = auto, 1 = dark, 2 = light)` | `0` | `0` follows Columns UI dark/light mode live, `1` forces Dark, `2` forces Light (fullscreen remains dark over album art). |
| `Display: language (auto / en / zh-CN)` | `auto` | `'auto'` detects Windows `HKCU\Control Panel\International\LocaleName` (`zh-*` -> `zh-CN`, else `en`). |
| `Animation: target FPS (0 = auto)` | `0` | Smooth-scroll target cadence (`30`–`240`, `0` targets `120` FPS with dt-normalized decay). |
| `Playback: output ceiling (dB below max)` | `0` | Caps maximum slider gain (`-60` to `0` dB). |
| `Scrolling: wheel step (px)` | `180` | Scroll distance in DIPs per mouse wheel notch (min `20`). |
| `Discord: show the playing track (1 = on)` | `1` | Syncs presence state with `foo_verdant` (`0` turns off integration completely). |
| `Loved: tag field` | `LOVED` | ID3/Vorbis/APE tag field read and written for Local `Liked Songs`. |
| `Loved: tag value that means loved (empty = any non-empty value)` | `""` | Custom match value (e.g. `Loved` if sharing a multi-purpose `MOOD` field). Writes `'1'` when empty. |
| `Loved: write tags to files (1 = on)` | `1` | Set to `0` to make Local love icons read-only (disables file tag writes). |
| `Loved: tag write confirmed (0 / 1)` | `0` | Persists acceptance of the first-write tag confirmation prompt. |
| `Navigation: music source` | `'local'` | Remembers active source (`'local'` or `'navidrome'`). |
| `Navigation: right pane` | `'lyrics'` | Remembers right pane tab (`'lyrics'` or `'queue'`). |

*(Most load-time properties apply upon panel reload: `Shift + Right Click -> Reload`.)*
