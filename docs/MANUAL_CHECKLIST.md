# PolaPlayer Manual Verification Checklist (foobar2000 v2)

Automated tests (`node tests/run.js`) validate logic and drawing calls against a mocked JSplitter VM host. Run this live checklist inside **foobar2000 v2 (64-bit)** whenever changing rendering, host interop, native window chrome, or playback behavior.

## 0. First-run Setup
- [ ] New panel: complete or skip the welcome guide; confirm local-only hides Navidrome and Setup remains accessible.
- [ ] Existing installation: verify music source, server selection and colour mode are preserved; open Setup manually, test a configured Navidrome server, and confirm restarting or cancelling is safe.
- [ ] Check all three setup pages in English and Simplified Chinese at high DPI, including a narrow window.

## 1. Local Music — Unified Browse & Sidebar
- [ ] Switch source to **Local Music** (`Navigation: music source = local`).
- [ ] **Sidebar**: Confirm `Home`, `Search`, pinned `All Songs`, 2x2 quick grid (`Artists`, `Albums`, `Liked Songs`, `Radio Mix`), and local playlists list appear (hidden `ROUTE` / `SHUF` utility playlists omitted).
- [ ] **Home**: Verify horizontal playlist shelf scrolls smoothly and snaps at card boundaries, New Playlist pill creates a playlist, and Recent Albums grid renders covers cleanly.
- [ ] **Albums Directory**: Switch all 5 tabs (`Recently played`, `Recently added`, `Most played`, `Random albums`, `By name`). With empty `local-stats.json`, confirm `Recently played` falls back to `Recently added` order and `Most played` falls back to alphabetical order; verify `Load more albums` loads beyond the first 60 albums.
- [ ] **Artists & Artist Detail**: Confirm circular artist avatars render without flickering; open an artist and confirm `Follow` button is omitted and `Top Tracks` appears once tracks accumulate play stats.
- [ ] **Album Detail**: Verify Play / Shuffle, track number ordering, clickable Artist link, and absence of `Like album`.
- [ ] **Local Playlist Detail**:
  - [ ] Test **Sort dropdown** (`Default order`, `Title`, `Artist`, `Album`, `Duration`) and asc/desc direction toggle on a large playlist (>1,000 tracks) without UI stall.
  - [ ] Create an empty playlist: confirm `Browse files` / `Browse folder` buttons open native pickers and add tracks cleanly.
  - [ ] Drag audio files from Windows Explorer onto: (a) an empty local playlist, (b) a populated local playlist, and (c) sidebar `Your Library` (creates a new playlist). Confirm drop outlines/cues appear and duplicate prompt (`dupPrompt`) offers `Skip duplicates` / `Add anyway`.
  - [ ] Confirm locked / Autoplaylists omit manual `Browse files` / `Browse folder` CTAs, drop overlays, `Rename`, and `Remove from this playlist`.
  - [ ] Rename, remove a track (even while sorted!), and delete a playlist via shared modals and context menus.
- [ ] **Liked Songs (`starred`) & Loved Tag Writes**:
  - [ ] With `Loved: write tags to files (1 = on) = 1`, click a track heart icon for the first time: confirm modal warning explains file tag writes (`LOVED`); cancel leaves tag untouched; allow writes `LOVED=1` (check foobar2000 Properties dialog).
  - [ ] Click heart while scrolling/browsing: verify self-write ignore (`lovedOnMetadbChanged`) updates heart state smoothly without rebuilding the full library index or losing scroll position.
  - [ ] Toggle off (unlove): verify `LOVED` tag is removed completely (not literal `"null"`), and track disappears from `Liked Songs`.
  - [ ] Test heart click on a **read-only file** (or when `Loved: write tags to files = 0`): confirm state rolls back and toast message appears.
- [ ] **Play Stats & Radio Mix**:
  - [ ] Play a local track past 30 seconds -> confirm `verdant-cache\local-stats.json` updates (`Recent` & `Frequent` tabs + Artist `Top Tracks` update; stopping before 30s does NOT increment counts).
  - [ ] Open `Radio Mix`, click `Start Radio`, skip near the end (`<= 5` remaining): verify automatic top-up appends tracks seamlessly.
- [ ] **All Songs (`view = 'songs'`)**:
  - [ ] Switch grouping (`No grouping`, `By artist`, `By album`, `By artist & album`), click an artist banner to jump to Browse Artist, hover a row to verify heart + `...` icons, right-click for unified track menu, double-click to play, and test `Normalize volume` scan confirmation & toggle.

## 2. Navidrome Regression
- [ ] Switch source to **Navidrome**: confirm pinned `All Songs` hides in sidebar and multi-server dropdown appears on `Home` / `Albums` / `Artists` (if >1 server configured in `foo_navidrome`).
- [ ] Verify server switching reloads playlists/albums cleanly.
- [ ] Open Navidrome Album (`Like album`) and Artist (`Follow`): confirm love toggles sync with server (`star` / `unstar`).
- [ ] Test Navidrome Playlist create/rename/delete/add-songs/remove-song, Search (280ms debounce + Enter immediate), `Navidrome Radio Mix` infinite top-up, and server lyrics loading.

## 3. Search, Transport, Queue/Lyrics & Fullscreen
- [ ] Search local library and confirm instant filtering of Artists, Albums, and Songs with scroll & context menu.
- [ ] Right pane: toggle `Queue` and `Lyrics`, click a synced lyric line to seek, click Retry on missing lyrics.
- [ ] Fullscreen (`Chill` mode): switch between default Now Playing, Lyrics, and Visualizer (`Bars` / `Radial ring`); test `Esc` and keyboard shortcuts without background list clicks bleeding through.

## 4. Visual, HiDPI, i18n & Window Chrome
- [ ] Switch **Light / Dark mode** via Columns UI (`Display: colour mode = 0`) and Panel Properties (`1` / `2`) across Home, Browse, All Songs, Search, and modals.
- [ ] Switch language (`Display: language` -> `auto` / `en` / `zh-CN`) and verify menus, dropdowns, modals, and card subtitles update cleanly without CJK fallback glitches or truncated labels.
- [ ] Check HiDPI scaling (`100%`, `125%`, `150%` or `Display: UI scale = 1.25`) and narrow/short panel splits (collapsing nav/queue drawers).
- [ ] If using **`Verdant.Chrome`**: verify Win11 Snap Layouts popup on maximize hover, Aero Snap (`Win+Arrow`), Alt-drag resize, and clean panel reload/close (`Ctrl+W` / closing panel retains custom frame until foobar exits).
