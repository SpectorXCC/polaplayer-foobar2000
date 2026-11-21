# Source Parity Matrix (Local vs Navidrome)

PolaPlayer `2.0.0` renders **Local Music** (`LOCAL_SOURCE`) and **Navidrome** (`NAVIDROME_SOURCE`) through the same unified views (`views/browse.js`, `views/components.js`, `views/nav.js`, `views/search.js`). Feature differences are expressed explicitly through each adapter's `caps` descriptor (`data/source.js`), rather than separate view implementations.

## Capability Descriptors

| Capability (`caps`) | Local (`source_local.js`) | Navidrome (`source_navidrome.js`) |
|---|---|---|
| `albumTabs` | `['recent', 'newest', 'frequent', 'random', 'alphabeticalByName']` | `['recent', 'newest', 'frequent', 'random', 'alphabeticalByName']` |
| `topSongs` | `true` (shown when artist has play stats in `stats.js`) | `true` (from Subsonic `getTopSongs`) |
| `lovedKinds` | `['song']` | `['song', 'album', 'artist']` |
| `randomMix` | `true` (auto-tops up queue near end) | `true` (auto-tops up queue near end) |
| `playlistEdit` | `'foobar'` (`plman` playlists) | `'server'` (Subsonic REST API) |
| `multiServer` | `false` | `true` (`HB_BR_SRV_DD` shown when >1 server configured) |
| `allSongs` | `true` | `false` |

## Page & Feature Parity Matrix

| Feature / View | Local | Navidrome | Notes |
|---|---|---|---|
| **Home** (`brView: 'home'`) | Yes | Yes | Playlists shelf, 2x2 Quick Shortcuts, Recently Played albums grid |
| **Albums Directory** (`brView: 'albums'`) | Yes | Yes | Same 5 tabs; Local `recent` falls back to `newest` and `frequent` to `alphabeticalByName` until play history exists |
| **Artists Directory** (`brView: 'artists'`) | Yes | Yes | Circular avatars (`coverDrawCircle`), album counts, partial-scroll masking |
| **Artist Detail** (`brView: 'artist'`) | Yes | Yes | Top Tracks + Albums; `Follow` button hidden on Local (`lovedKinds` excludes `'artist'`) |
| **Album Detail** (`brView: 'album'`) | Yes | Yes | Track list + Play/Shuffle + Artist link; `Like album` hidden on Local (`lovedKinds` excludes `'album'`) |
| **Playlist Detail** (`brView: 'playlist'`) | Yes | Yes | Play/Shuffle, Sort dropdown (`Default`, `Title`, `Artist`, `Album`, `Duration`) + direction, lazy `Rows` accessors |
| **Playlist CRUD** | Yes | Yes | Shared modals (`renameEdit`, `confirmDel`) & unified context menus (`playlist_edit.js`) |
| **Liked Songs** (`brView: 'starred'`) | Yes (`LOVED` tag) | Yes (server `star`) | First local write asks confirmation; 1.5s read-only rollback toast; server `star2` syncs remotely |
| **Radio Mix** (`brView: 'random'`) | Yes | Yes | Infinite auto-top-up when `<= 5` tracks remain (`maybeTopUpRandom` -> `appendRandomHandlesToRouteShuf`) |
| **Search** (`view: 'search'`) | Yes (sync cached) | Yes (debounced 280ms) | Artists shelf, Albums shelf, Songs list with shared track rows & menus |
| **Top Strip** (`back` / `refresh`) | Yes | Yes | History stack navigation (`brHistory`); Navidrome adds multi-server dropdown when configured |
| **Track Row Actions** | Yes | Yes | Play glyph hover, Heart toggle, `...` overflow menu, right-click menu (`openNvTrackMenu`) |
| **All Songs** (`view: 'songs'`) | Yes | Hidden | Local-only grouping (`none`/`artist`/`album`/`both`), ReplayGain `Normalize volume` scan/toggle, shared header/rows |
| **Local Playlist Drop / Browse** | Yes | Hidden | Empty local editable playlist shows Browse files/folder CTAs; dragging files shows drop overlay + duplicate scan |

## Automated Parity Enforcement

- [`tests/suites/parity.test.js`](../tests/suites/parity.test.js) renders every browse page + Search across `local` and `navidrome`, Dark and Light modes, and `en` and `zh-CN` languages, verifying matching `HB_BR_BTN` action sets (capability-adjusted for `star-album` / `star-artist`), shared track row hover hitboxes (`HB_BR_STAR`, `HB_BR_TRDOTS`), and zero leaked untranslated `i18n` keys.
- [`scripts/lint-strings.js`](../scripts/lint-strings.js) enforces full key parity between `en` and `zh-CN` in `core/i18n.js` and forbids raw CJK string literals in `data/`, `ui/`, and `views/`.
