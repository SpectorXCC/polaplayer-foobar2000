# PolaPlayer Architecture Notes (`v2.0.0`)

## Overview & Single-Thread Execution Model

PolaPlayer, based on Verdant, renders the entire player interface inside one `foo_uie_jsplitter` (SpiderMonkey + GDI+) panel in **foobar2000 v2 (64-bit) / Columns UI**.
- **Shared global scope (`main.js`)**: All scripts are included sequentially into one global VM context (`core/` -> `data/` -> `ui/` -> `views/` -> `app.js`). Runtime files never use CommonJS (`require`) or ESM (`import`/`export`).
- **Load-time vs call-time edges**: Only three module ordering constraints apply at load time:
  1. `core/props.js` -> `core/tokens.js` & `ui/chrome.js` (`UISCALE` & language/theme settings size fonts and title bar).
  2. `core/i18n.js` -> `core/tokens.js` (`LANG_METRIC_TEXT` CJK line-height probing; `onLangChange` listeners).
  3. `core/memory.js` -> `ui/skeleton.js` (`ART_CAP` ceiling governs reveal gate capacity).
- **Non-blocking frame budget**: Large library scans (`libTF` / `songs` / `localIdx`) execute as time-budgeted micro-steps via `core/jobs.js` (`ensureBuilt` / `jobRun`, 8ms first slice with `1ms` continuation timer), painting skeleton placeholders (`ui/skeleton.js`) cleanly until ready.

## Module Layout

| Directory | Responsibility |
|---|---|
| `core/` | Panel properties (`props.js`), `en`/`zh-CN` i18n (`i18n.js`), design tokens & fonts (`tokens.js`), helpers (`util.js`), HiDPI (`display.js`), compiled TitleFormats (`tf.js`), memory/cache budgets (`memory.js`), sliced background jobs (`jobs.js`). |
| `data/` | Source registry (`source.js`), local (`source_local.js`) and Navidrome (`source_navidrome.js`) adapters, prefix-dispatched artwork (`cover.js`, `art.js`, `navidrome_art.js`), local library/All Songs cache (`library.js`), local tag favorites (`loved.js`), local play history (`stats.js`), playback routing (`playback.js`, `navidrome_playback.js`), lyrics (`lyrics.js`, `navidrome_lyrics.js`), playlists/dedupe (`playlist_edit.js`, `dedupe.js`), ReplayGain (`replaygain.js`), Discord RPC (`discord.js`). |
| `ui/` | Frameless window chrome / modals / context menus / scrollbars (`chrome.js`), welcome/setup (`setup.js`), loading skeletons (`skeleton.js`). |
| `views/` | Shared browse components (`components.js`), unified 8-page browse renderer + local drop zone (`browse.js`), sidebar (`nav.js`), transport bar (`bar.js`), Queue & Lyrics right pane (`queue.js`), unified search (`search.js`), local `All Songs` (`songs.js`), fullscreen Chill & FFT visualizer (`fullscreen.js`). |
| `native/` | `Verdant.Chrome` Win32 C++ COM helper for native window dragging and Snap Layouts (`HTMAXBUTTON`, `HTCAPTION`, non-client message hooks). |
| `app.js` | Top-level window layout (`R`), dirty-rect partial repainting, input hit-testing, drag & drop handlers, and foobar2000 callbacks (`on_paint`, `on_playback_*`, `on_metadb_changed`, `on_library_*`, `on_playlists_changed`). |

## Unified `MusicSource` & `Rows` Contract

Views read exclusively from `activeSource()` (`data/source.js`), never raw `NVData` or raw library arrays directly:
- **View convergence**: Main panel state is `view` (`'browse' | 'songs' | 'search'`) and `brView` (`'home' | 'albums' | 'artists' | 'playlist' | 'album' | 'artist' | 'starred' | 'random'`).
- **Lazy `Rows` accessor**: Large playlists and track lists return `{ count, get(i) -> Song, all() -> Song[], sortKeys? }` (`localMakeLibIndexRows`, `localPlaylistRows`, `makeListRows`), instantiating track DTOs only for rows intersecting the viewport (plus fast `sortKeys` in `brSortedPlaylistRows`).
- **Capability gating**: Features unique to a source (`caps.albumTabs`, `caps.topSongs`, `caps.lovedKinds`, `caps.randomMix`, `caps.playlistEdit`, `caps.multiServer`, `caps.allSongs`) control UI visibility cleanly (e.g., Local hides `Like album` and `Follow`, Navidrome hides `All Songs`).

## Unified `cover.js` Protocol

Artwork identifiers stay plain strings throughout caches and hitboxes (`brCardCache`, `HB_BR_CARDS`), routed by prefix in `data/cover.js`:
- `local:<albkey>` (`coverKind === 'h'`) -> resolves local handle via `coverHandles` registry / `localHandleForAlbumKey`.
- `localar:<artistName>` (`coverKind === 'ar'`) -> resolves artist representative cover via `artistCover()` (`coverDrawCircle` draws directly through `maskedArt` + `drawBlitCentered` without calling back into `cover.js`).
- `localpl:<playlistIndex>` / `locallib` (`coverKind === 'mosaic'`) -> delegates to `drawPlCover` / `drawLibCover` 2x2 mosaics.
- Any other string (`coverKind === 'nv'`) -> delegates to `nvDrawRounded` / `nvDrawCircle` / `nvDrawThumb`.

## HiDPI & Native Window Chrome

- UI layout and hitboxes operate exclusively in 96-DPI design coordinates (DIPs), converting at the boundary via `px()` / `dip()` / `dpiGraphics()` / `dpiImage()` / `blitCard()` (`core/display.js`).
- Offscreen card shells (`brCardImg` in `views/components.js`) bake background + artwork once while card titles/subtitles paint live using Win32 ClearType `gdi.GdiDrawText` (`tCard`).
- `ui/chrome.js` attaches `Verdant.Chrome` (`native/`) on top of the Columns UI window when registered, falling back to `UIWizard` (`WM_NCHITTEST` caption + Snap quick-menu) when unavailable.

---

## Phase 1 Live Verification: `LOVED` Tag & Local Library Metadata (`foo_uie_jsplitter` / foobar2000 v2 x64)

Verified on a live foobar2000 v2 instance (`verdant-cache/spike_loved_result.txt`, run on `03 Credit Theme.flac` + 16-track local library):

### 1. Tag Write API (`UpdateFileInfoFromJSON`)
- **Host object**: `UpdateFileInfoFromJSON` exists on **`IFbMetadbHandleList`** (`fb.CreateHandleList()`), **not** on `IFbMetadbHandle` (`h.UpdateFileInfoFromJSON === undefined`). `UpdateFileInfoSimple` does not exist in `foo_uie_jsplitter`.
- **Accepted JSON payloads**: Both array syntax (`JSON.stringify([{ LOVED: '1' }])` matching `hl.Count`) and single-object syntax (`JSON.stringify({ LOVED: '1' })`, applied to the list) succeed and write `LOVED="1"` (`GetFileInfo().MetaFind('LOVED') >= 0`).
- **Return value & timing**: Returns `undefined` synchronously and commits asynchronously (~18-132 ms observed).
- **Deleting/clearing a tag**:
  - Passing `""` (empty string) or `[]` (empty array) **removes** the tag completely (`MetaFind('LOVED') === -1`, `infoVals === []`).
  - **Do NOT pass `null`**: `{"LOVED": null}` writes the literal string `"null"` into the tag (`MetaFind('LOVED') >= 0`, `infoVals = ["null"]`).
  - `data/loved.js` uses `""` (`JSON.stringify({ [LOVED_FIELD]: next ? (LOVED_MATCH || '1') : '' })`) and verifies actual file tags via a 1.5s rollback timer on read-only/stream failures.

### 2. TitleFormat Quirk (`"?"` for Missing Unbracketed Fields)
- Evaluating unbracketed `%LOVED%` or `%MOOD%` when a tag is absent returns literal **`"?"`** (`16/16` non-empty `"?"`), **not** `""`.
- **Rule**: All optional TitleFormat fields (`LOVED`, `MOOD`, `added`, `last_modified`, `play_count`, `last_played`) **must** be wrapped in square brackets in `core/tf.js`: `[%LOVED%]`, `[%added%]`, etc.
- `isLovedValue(v)` also defensively treats `'?'`, `""`, `'0'`, and `'false'` as unloved when `LOVED_MATCH` is empty.

### 3. `on_metadb_changed(handles, fromhook)` Behavior
- Every `UpdateFileInfoFromJSON` commit triggers `on_metadb_changed` **once** with `handles.Count === 1`, **`fromhook === false` (`boolean`)**, after the updated tag is already readable via TitleFormat.
- Because `fromhook` is `false`, `app.js` filters self-initiated writes through `lovedOnMetadbChanged(handles)` (`data/loved.js`, 3s match window) so toggling favorites updates `lovedSet` in place without invalidating the library or playlist caches.

### 4. Local Library Date / Play-Count Fields (`source_local.js` & `stats.js`)
- `[%last_modified%]`: reliably present (`"2024-09-27 21:01:31"`).
- `[%added%]`, `[%play_count%]`, `[%last_played%]`: empty when `foo_playcount` is not installed.
- `newest` uses `$if2([%added%],[%last_modified%])`.
- `recent` and `frequent` use `data/stats.js` (`STATS_MIN_MS = 30000`, persisted throttled to `verdant-cache\local-stats.json`, with one-time import from `[%play_count%]` / `[%last_played%]` when available and fallback to `newest` / `alphabeticalByName` when empty).
