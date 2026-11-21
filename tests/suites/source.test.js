'use strict';

const assert = require('assert');
const { createHarness } = require('../harness');

function run() {
  console.log('1. Source registry, activeSource(), & capability helpers...');
  {
    const h = createHarness({
      props: { 'Navigation: music source': 'navidrome' }
    });
    const ctx = h.ctx;

    assert.ok(ctx.SOURCES && ctx.SOURCES.navidrome, 'Navidrome adapter registered in SOURCES');
    assert.strictEqual(ctx.activeSource(), ctx.SOURCES.navidrome, 'activeSource() resolves to navidrome');
    assert.strictEqual(ctx.sourceById('navidrome'), ctx.SOURCES.navidrome);
    assert.strictEqual(ctx.sourceAlbumTabs(ctx.SOURCES.navidrome).length, 5);
    assert.strictEqual(ctx.sourceHasCap(ctx.SOURCES.navidrome, 'multiServer'), true);
    assert.strictEqual(ctx.sourceCanLove(ctx.SOURCES.navidrome, 'song'), true);
    assert.strictEqual(ctx.sourceCanLove(ctx.SOURCES.navidrome, 'album'), true);
    assert.strictEqual(ctx.sourceCanLove(ctx.SOURCES.navidrome, 'artist'), true);

    // Track classification across both navidrome:// URIs and resolved /rest/stream URLs
    const hNv = h.makeHandle('navidrome://track/t1?coverArt=al-1', { title: 'T1' });
    const hStream = h.makeHandle('https://demo.example.invalid/rest/stream.view?id=t2&coverArt=al-2', { title: 'T2' });
    const hLocal = h.makeHandle('C:\\Music\\track.flac', { title: 'Local' });
    assert.strictEqual(ctx.sourceForHandle(hNv), ctx.SOURCES.navidrome);
    assert.strictEqual(ctx.sourceForHandle(hStream), ctx.SOURCES.navidrome);
    assert.strictEqual(ctx.sourceForHandle(hLocal), ctx.SOURCES.local, 'Local adapter registered in Phase 5');
    assert.strictEqual(ctx.coverIdForHandle(hNv), 'al-1');
    assert.strictEqual(ctx.coverIdForHandle(hStream), 'al-2');
    assert.strictEqual(ctx.coverIdForHandle(hLocal), '');

    // Switching back to local sets activeSource() to SOURCES.local while remote NP still finds navidrome source
    ctx.switchLibrarySource('local');
    assert.strictEqual(ctx.activeSource(), ctx.SOURCES.local);
    assert.strictEqual(ctx.view, 'browse');
    assert.strictEqual(ctx.sourceForHandle(hNv), ctx.SOURCES.navidrome);
  }

  console.log('2. Unified Rows accessor & cover protocol dispatch...');
  {
    const h = createHarness();
    const ctx = h.ctx;
    const rows = ctx.makeListRows([{ id: 's1', coverArt: '' }, { id: 's2', coverArt: '' }]);
    assert.strictEqual(rows.count, 2);
    assert.strictEqual(rows.get(0).id, 's1');
    assert.strictEqual(rows.get(5), null);
    assert.strictEqual(rows.all().length, 2);
    assert.strictEqual(ctx.EMPTY_ROWS.count, 0);

    assert.strictEqual(ctx.coverKind('local:alb-1'), 'h');
    assert.strictEqual(ctx.coverKind('localpl:0'), 'mosaic');
    assert.strictEqual(ctx.coverKind('locallib'), 'mosaic');
    assert.strictEqual(ctx.coverKind('al-9'), 'nv');

    const gr = h.makeGraphics();
    ctx.coverDrawRounded(gr, 0, 0, 100, 6, 'local:fallback', 'seed');
    assert.strictEqual(gr.fillRoundRectCalls.length, 1, 'Non-nv fallback draws rounded placeholder without crashing');
  }

  console.log('3. Capability-gated love buttons in album & artist views...');
  {
    const h = createHarness({
      props: { 'Navigation: music source': 'navidrome' }
    });
    const ctx = h.ctx;
    const mockAdapter = {
      id: 'mock_local',
      caps: {
        albumTabs: ['recent'],
        topSongs: false,
        lovedKinds: ['song'],
        randomMix: true,
        playlistEdit: 'foobar',
        multiServer: false,
        allSongs: true
      },
      ensureLoaded() {},
      refresh() {},
      playlists() { return { list: [], loading: false, loaded: true, err: '' }; },
      albumsTab() { return 'recent'; },
      setAlbumsTab() {},
      albums() { return { list: [], loading: false, err: '', hasMore: false }; },
      fetchAlbums() {},
      album() {
        return {
          meta: { id: 'al-1', name: 'Local Album', artist: 'Local Artist', artistId: 'Local Artist', coverArt: '', year: '2024', duration: 200 },
          songs: [{ id: 's1', title: 'Track 1', artist: 'Local Artist', album: 'Local Album', track: 1, duration: 200, coverArt: '' }],
          rows: ctx.makeListRows([]),
          loading: false,
          err: ''
        };
      },
      fetchAlbum() {},
      artist() {
        return {
          meta: { id: 'Local Artist', name: 'Local Artist', albumCount: 1, coverArt: '' },
          albums: [{ id: 'al-1', name: 'Local Album', artist: 'Local Artist', year: '2024', coverArt: '' }],
          topSongs: [],
          loading: false,
          err: ''
        };
      },
      fetchArtist() {},
      isLoved() { return false; },
      toggleLoved() {},
      isTrackPlaying() { return false; },
      servers() { return []; },
      activeServer() { return null; }
    };
    ctx.registerSource(mockAdapter);
    ctx.libSource = 'mock_local';
    ctx.view = 'browse';
    ctx.brView = 'album';
    ctx.brViewId = 'al-1';
    ctx.on_paint(h.makeGraphics());
    assert.ok(!ctx.HB_BR_BTN.some(b => b.act === 'star-album'), 'Hides Like album button when lovedKinds excludes album');

    ctx.brView = 'artist';
    ctx.brViewId = 'Local Artist';
    ctx.on_paint(h.makeGraphics());
    assert.ok(!ctx.HB_BR_BTN.some(b => b.act === 'star-artist'), 'Hides Follow artist button when lovedKinds excludes artist');
  }
}

module.exports = { run };
