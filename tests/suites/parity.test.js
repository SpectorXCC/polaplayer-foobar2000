'use strict';

const assert = require('assert');
const { createHarness } = require('../harness');

function uniqueActs(btns) {
  return Array.from(new Set(btns.map(b => b.act))).sort();
}

function drawnStrings(gr) {
  const out = [];
  for (const c of gr.gdiDrawTextCalls) if (c && typeof c.str === 'string') out.push(c.str);
  for (const c of gr.drawStringCalls) if (c && typeof c.str === 'string') out.push(c.str);
  return out;
}

const RAW_KEY_RE = /^(source|nav|tab|queue|lyrics|btn|eyebrow|col|home|meta|sort|alb_tab|group|viz|empty|search|menu|snap|dlg|err|rg)\.[a-z0-9_]+$/;
const CJK_RE = /[\u4e00-\u9fff]/;

function seedSymmetricHarness() {
  const h = createHarness({
    props: {
      'Navigation: music source': 'local',
      'Navidrome: servers':
        'name=Primary&url=http%3A%2F%2F127.0.0.1%3A4533&user=demo&pass=demo\n' +
        'name=Backup&url=http%3A%2F%2F127.0.0.2%3A4533&user=demo&pass=demo'
    }
  });
  const ctx = h.ctx;

  // Seed local library + playlist + play stats
  const locTracks = [
    h.makeHandle('C:\\Music\\Symmetry\\01.flac', {
      title: 'Symmetry Track One',
      artist: 'Symmetry Artist',
      albumArtist: 'Symmetry Artist',
      album: 'Symmetry Album',
      tracknumber: '1',
      date: '2025-01-01',
      added: '2026-01-01 00:00:00',
      length: '3:20',
      lengthSec: 200,
      loved: '1'
    }),
    h.makeHandle('C:\\Music\\Symmetry\\02.flac', {
      title: 'Symmetry Track Two',
      artist: 'Symmetry Artist',
      albumArtist: 'Symmetry Artist',
      album: 'Symmetry Album',
      tracknumber: '2',
      date: '2025-01-01',
      added: '2026-01-01 00:00:00',
      length: '3:40',
      lengthSec: 220
    })
  ];
  h.state.libraryItems = locTracks;
  h.state.playlists = [{ name: 'Symmetry Mix', items: locTracks.slice(), locked: false, auto: false }];
  ctx.libChanged();
  ctx.SOURCES.local.ensureLoaded();
  h.flushTimers(1);
  ctx.statsRecordPlay(locTracks[0], Date.now());
  ctx.SOURCES.local.fetchRandom(2, false);

  // Seed symmetric Navidrome state
  const nvSongs = [
    { id: 'nv-1', title: 'Symmetry Track One', artist: 'Symmetry Artist', artistId: 'nv-ar-1', album: 'Symmetry Album', albumId: 'nv-al-1', duration: 200, track: 1, coverArt: 'nv-al-1', src: 'navidrome' },
    { id: 'nv-2', title: 'Symmetry Track Two', artist: 'Symmetry Artist', artistId: 'nv-ar-1', album: 'Symmetry Album', albumId: 'nv-al-1', duration: 220, track: 2, coverArt: 'nv-al-1', src: 'navidrome' }
  ];
  const nvAlbum = { id: 'nv-al-1', name: 'Symmetry Album', artist: 'Symmetry Artist', artistId: 'nv-ar-1', year: 2025, songCount: 2, duration: 420, coverArt: 'nv-al-1' };
  const nvArtist = { id: 'nv-ar-1', name: 'Symmetry Artist', albumCount: 1, coverArt: 'nv-ar-1' };
  const nvPl = { id: 'nv-pl-1', name: 'Symmetry Mix', songCount: 2, duration: 420, coverArt: 'nv-pl-1' };

  ctx.NVData.playlists = [nvPl];
  ctx.NVData.playlistsLoaded = true;
  ctx.NVData.playlistsLoading = false;
  ctx.NVData.error = '';
  ctx.NVData.recentAlbums = [nvAlbum];
  ctx.NVData.recentAlbumsLoaded = true;
  ctx.NVData.albumsByTab.recent = { list: [nvAlbum], loading: false, err: '', hasMore: false, ts: Date.now() };
  ctx.NVData.albumsTab = 'recent';
  ctx.NVData.artists = [nvArtist];
  ctx.NVData.artistsLoaded = true;
  ctx.NVData.artistsLoading = false;
  ctx.NVData.artistsErr = '';
  ctx.NVData.plDetails['nv-pl-1'] = { meta: nvPl, songs: nvSongs, loading: false, err: '' };
  ctx.NVData.albumDetails['nv-al-1'] = { meta: nvAlbum, songs: nvSongs, loading: false, err: '' };
  ctx.NVData.artistDetails['nv-ar-1'] = { meta: nvArtist, albums: [nvAlbum], topSongs: nvSongs, loading: false, err: '' };
  ctx.NVData.starred = { songs: [nvSongs[0]], albums: [nvAlbum], artists: [nvArtist], loaded: true, loading: false, err: '', ts: Date.now() };
  ctx.NVData.randomMix = { songs: nvSongs, loading: false, err: '' };
  ctx.NVData.search = {
    query: 'Symmetry',
    requested: 'Symmetry',
    artists: [nvArtist],
    albums: [nvAlbum],
    songs: nvSongs,
    loading: false,
    err: '',
    pending: false
  };

  return h;
}

function run() {
  console.log('1. Cross-source / Dark+Light / en+zh-CN parity matrix across unified views...');
  {
    const h = seedSymmetricHarness();
    const ctx = h.ctx;

    const expectedCommonActs = {
      home: ['go-albums', 'go-artists', 'go-random', 'go-starred', 'new-pl', 'refresh'],
      albums: ['refresh'],
      artists: ['refresh'],
      playlist: ['play-list', 'refresh', 'shuf-list'],
      album: ['open-album-artist', 'play-list', 'refresh', 'shuf-list'],
      artist: ['play-list', 'refresh', 'shuf-list'],
      starred: ['play-list', 'refresh', 'shuf-list'],
      random: ['play-list', 'random-rebatch', 'refresh']
    };

    const viewIds = {
      local: {
        home: '', albums: 'recent', artists: '',
        playlist: '0', album: 'Symmetry Artist - Symmetry Album',
        artist: 'Symmetry Artist', starred: '', random: ''
      },
      navidrome: {
        home: '', albums: 'recent', artists: '',
        playlist: 'nv-pl-1', album: 'nv-al-1',
        artist: 'nv-ar-1', starred: '', random: ''
      }
    };

    for (const lang of ['en', 'zh-CN']) {
      ctx.setLang(lang);
      for (const darkUi of [true, false]) {
        h.state.darkUi = darkUi;
        ctx.syncTheme();

        for (const sourceId of ['local', 'navidrome']) {
          ctx.switchLibrarySource(sourceId);
          const src = ctx.activeSource();
          assert.strictEqual(src.id, sourceId);

          for (const page of Object.keys(expectedCommonActs)) {
            ctx.mx = -1;
            ctx.my = -1;
            ctx.view = 'browse';
            ctx.brView = page;
            ctx.brViewId = viewIds[sourceId][page];
            ctx.brHistory = [];
            ctx.brScroll = ctx.brScrollT = 0;

            const gr = h.makeGraphics();
            ctx.on_paint(gr);

            // Exact HB_BR_BTN action parity (capability-adjusted only for star-album / star-artist)
            const expected = expectedCommonActs[page].slice();
            if (page === 'album' && ctx.sourceCanLove(src, 'album')) expected.push('star-album');
            if (page === 'artist' && ctx.sourceCanLove(src, 'artist')) expected.push('star-artist');
            expected.sort();

            assert.deepStrictEqual(
              uniqueActs(ctx.HB_BR_BTN),
              expected,
              `Action set mismatch (${sourceId}, ${lang}, dark=${darkUi}, page=${page})`
            );

            // Album tabs capability parity: 5 tabs on both
            assert.strictEqual(ctx.brAlbumTabOptions(src).length, 5);

            // Top strip controls parity
            if (sourceId === 'navidrome' && (page === 'home' || page === 'albums' || page === 'artists')) {
              assert.ok(ctx.HB_BR_SRV_DD, 'Navidrome multiServer renders server selector');
            } else {
              assert.strictEqual(ctx.HB_BR_SRV_DD, null, 'Non-multiServer or overlay omits server selector');
            }
            if (page === 'playlist') {
              assert.ok(ctx.HB_BR_SORT_DD && ctx.HB_BR_SORT_DIR, `${sourceId} playlist renders sort controls`);
            }

            // History back pill parity
            ctx.brHistory = [{ brView: 'home', brViewId: '', brViewTitle: 'Home', brScroll: 0 }];
            const grBack = h.makeGraphics();
            ctx.on_paint(grBack);
            assert.ok(ctx.HB_BR_BTN.some(b => b.act === 'back'), `${sourceId} ${page} renders back pill when history non-empty`);
            ctx.brHistory = [];

            // Sidebar capability parity
            if (sourceId === 'local') {
              assert.ok(ctx.HB_ALLSONGS !== null, 'Local nav includes All Songs entry');
            } else {
              assert.strictEqual(ctx.HB_ALLSONGS, null, 'Navidrome nav omits All Songs entry');
            }

            // Track row interaction parity (heart + overflow dots)
            if (page === 'playlist' || page === 'album' || page === 'artist' || page === 'starred' || page === 'random') {
              assert.ok(ctx.HB_BR_TR.length > 0, `${sourceId} ${page} has track rows`);
              const tr0 = ctx.HB_BR_TR[0];
              ctx.mx = (tr0.x0 + tr0.x1) / 2;
              ctx.my = (tr0.y0 + tr0.y1) / 2;
              const grHov = h.makeGraphics();
              ctx.on_paint(grHov);
              assert.ok(ctx.HB_BR_STAR.length > 0, `${sourceId} ${page} hovered track shows love button`);
              assert.ok(ctx.HB_BR_TRDOTS.length > 0, `${sourceId} ${page} hovered track shows ... button`);
            }

            // Localized T() strings: no raw translation keys and zero stray CJK in 'en'
            const texts = drawnStrings(grBack);
            assert.ok(texts.length > 0, `${sourceId} ${page} renders text`);
            for (const s of texts) {
              assert.ok(!RAW_KEY_RE.test(s), `Untranslated i18n key leaked: "${s}" on ${sourceId} ${page} (${lang})`);
              if (lang === 'en') {
                assert.ok(!CJK_RE.test(s), `Unexpected CJK string in en mode: "${s}" on ${sourceId} ${page}`);
              }
            }
          }

          // Search view parity (cards at scroll=0, song rows when scrolled)
          ctx.mx = -1;
          ctx.my = -1;
          ctx.view = 'search';
          ctx.searchQuery = 'Symmetry';
          ctx.searchScroll = ctx.searchScrollT = 0;
          src.search('Symmetry');
          const grSrch = h.makeGraphics();
          ctx.on_paint(grSrch);
          assert.ok(ctx.HB_BR_CARDS.length > 0, `${sourceId} search renders artist/album cards`);
          ctx.searchScroll = ctx.searchScrollT = ctx.SEARCH_MAXPX;
          const grSrchSongs = h.makeGraphics();
          ctx.on_paint(grSrchSongs);
          assert.ok(ctx.HB_BR_TR.length > 0, `${sourceId} search renders track rows when scrolled`);
          ctx.searchScroll = ctx.searchScrollT = 0;
          for (const s of drawnStrings(grSrch).concat(drawnStrings(grSrchSongs))) {
            assert.ok(!RAW_KEY_RE.test(s), `Untranslated i18n key leaked in search: "${s}"`);
            if (lang === 'en') assert.ok(!CJK_RE.test(s), `Unexpected CJK string in en search: "${s}"`);
          }
        }
      }
    }
  }

  console.log('2. Track & playlist context menu T() localization parity across sources...');
  {
    const h = seedSymmetricHarness();
    const ctx = h.ctx;

    for (const lang of ['en', 'zh-CN']) {
      ctx.setLang(lang);
      for (const sourceId of ['local', 'navidrome']) {
        ctx.switchLibrarySource(sourceId);
        const src = ctx.activeSource();
        const pls = src.playlists().list;
        assert.ok(pls.length > 0);
        const det = src.playlist(pls[0].id);
        const song = det.rows.get(0);

        ctx.openNvPlaylistMenu(pls[0], 100, 100);
        assert.ok(ctx.ctxMenu && ctx.ctxMenu.items.length > 0);
        for (const it of ctx.ctxMenu.items) {
          if (it.sep) continue;
          assert.ok(it.label && !RAW_KEY_RE.test(it.label), `Playlist menu label invalid: ${it.label}`);
          if (lang === 'en') assert.ok(!CJK_RE.test(it.label), `Unexpected CJK in en playlist menu: ${it.label}`);
        }
        ctx.ctxMenu = null;

        ctx.openNvTrackMenu({ song, list: det.rows, idx: 0, sourceMeta: { subKind: 'playlist', id: pls[0].id, name: pls[0].name }, plId: pls[0].id, songIdx: 0 }, 100, 100);
        assert.ok(ctx.ctxMenu && ctx.ctxMenu.items.length > 0);
        for (const it of ctx.ctxMenu.items) {
          if (it.sep) continue;
          assert.ok(it.label && !RAW_KEY_RE.test(it.label), `Track menu label invalid: ${it.label}`);
          if (lang === 'en') assert.ok(!CJK_RE.test(it.label), `Unexpected CJK in en track menu: ${it.label}`);
        }
        ctx.ctxMenu = null;
      }
    }
  }
}

module.exports = { run };
