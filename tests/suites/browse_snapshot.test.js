'use strict';

const assert = require('assert');
const { createHarness } = require('../harness');

function uniqueActs(btns) {
  return Array.from(new Set(btns.map(b => b.act))).sort();
}

function run() {
  console.log('1. Browse 8-view HB_BR_BTN action & control parity snapshot (navidrome baseline)...');
  const h = createHarness({
    props: {
      'Navigation: music source': 'navidrome',
      'Navidrome: servers': 'name=Primary&url=http%3A%2F%2F127.0.0.1%3A4533&user=demo&pass=demo\nname=Backup&url=http%3A%2F%2F127.0.0.2%3A4533&user=demo&pass=demo'
    }
  });
  const ctx = h.ctx;

  const songA = {
    id: 'tr-1',
    title: 'Alpha',
    artist: 'Artist One',
    artistId: 'ar-1',
    album: 'Album One',
    albumId: 'al-1',
    duration: 210,
    track: 1,
    coverArt: 'al-1',
    src: 'navidrome'
  };
  const songB = {
    id: 'tr-2',
    title: 'Beta',
    artist: 'Artist One',
    artistId: 'ar-1',
    album: 'Album One',
    albumId: 'al-1',
    duration: 185,
    track: 2,
    coverArt: 'al-1',
    src: 'navidrome'
  };
  const album1 = {
    id: 'al-1',
    name: 'Album One',
    artist: 'Artist One',
    artistId: 'ar-1',
    year: 2024,
    songCount: 2,
    duration: 395,
    coverArt: 'al-1'
  };
  const artist1 = {
    id: 'ar-1',
    name: 'Artist One',
    albumCount: 1,
    coverArt: 'ar-1'
  };
  const playlist1 = {
    id: 'pl-1',
    name: 'Synth Mix',
    songCount: 2,
    duration: 395,
    coverArt: 'pl-1'
  };

  ctx.NVData.playlists = [playlist1];
  ctx.NVData.playlistsLoaded = true;
  ctx.NVData.playlistsLoading = false;
  ctx.NVData.error = '';

  ctx.NVData.recentAlbums = [album1];
  ctx.NVData.recentAlbumsLoaded = true;
  ctx.NVData.albumsByTab.recent = { list: [album1], loading: false, err: '', hasMore: true, ts: Date.now() };
  ctx.NVData.albumsTab = 'recent';

  ctx.NVData.artists = [artist1];
  ctx.NVData.artistsLoaded = true;
  ctx.NVData.artistsLoading = false;
  ctx.NVData.artistsErr = '';

  ctx.NVData.plDetails['pl-1'] = { meta: playlist1, songs: [songA, songB], loading: false, err: '' };
  ctx.NVData.albumDetails['al-1'] = { meta: album1, songs: [songA, songB], loading: false, err: '' };
  ctx.NVData.artistDetails['ar-1'] = { meta: artist1, albums: [album1], topSongs: [songA, songB], loading: false, err: '' };

  ctx.NVData.starred = { songs: [songA], albums: [album1], artists: [artist1], loaded: true, loading: false, err: '', ts: Date.now() };
  ctx.NVData.randomMix = { songs: [songA, songB], loading: false, err: '' };

  ctx.view = 'browse';
  ctx.brHistory = [];
  ctx.brScroll = ctx.brScrollT = 0;
  ctx.brShelfScroll = ctx.brShelfScrollT = 0;
  ctx.mx = -1;
  ctx.my = -1;

  const expectedActs = {
    home: ['go-albums', 'go-artists', 'go-random', 'go-starred', 'new-pl', 'refresh'],
    albums: ['more-albums', 'refresh'],
    artists: ['refresh'],
    playlist: ['play-list', 'refresh', 'shuf-list'],
    album: ['open-album-artist', 'play-list', 'refresh', 'shuf-list', 'star-album'],
    artist: ['play-list', 'refresh', 'shuf-list', 'star-artist'],
    starred: ['play-list', 'refresh', 'shuf-list'],
    random: ['play-list', 'random-rebatch', 'refresh']
  };

  const viewIds = {
    home: '',
    albums: 'recent',
    artists: '',
    playlist: 'pl-1',
    album: 'al-1',
    artist: 'ar-1',
    starred: '',
    random: ''
  };

  for (const page of Object.keys(expectedActs)) {
    ctx.mx = -1;
    ctx.my = -1;
    ctx.brView = page;
    ctx.brViewId = viewIds[page];
    ctx.on_paint(h.makeGraphics());

    assert.deepStrictEqual(
      uniqueActs(ctx.HB_BR_BTN),
      expectedActs[page],
      'Exact HB_BR_BTN action set snapshot mismatch on view "' + page + '"'
    );

    if (page === 'home' || page === 'albums' || page === 'artists') {
      assert.ok(ctx.HB_BR_SRV_DD, page + ' non-overlay top strip renders server selector HB_BR_SRV_DD');
    } else {
      assert.strictEqual(ctx.HB_BR_SRV_DD, null, page + ' overlay top strip omits HB_BR_SRV_DD');
    }

    if (page === 'albums') {
      assert.ok(ctx.HB_BR_ALB_DD, 'albums page renders HB_BR_ALB_DD');
    }
    if (page === 'playlist') {
      assert.ok(ctx.HB_BR_SORT_DD && ctx.HB_BR_SORT_DIR, 'playlist page renders sort dropdown and direction hitboxes');
    }
    if (page === 'home' || page === 'albums' || page === 'artists' || page === 'artist') {
      assert.ok(ctx.HB_BR_CARDS.length > 0, page + ' populates card hitboxes');
    }
    if (page === 'playlist' || page === 'album' || page === 'artist' || page === 'starred' || page === 'random') {
      assert.ok(ctx.HB_BR_TR.length > 0, page + ' populates track row hitboxes');
      const tr0 = ctx.HB_BR_TR[0];
      ctx.mx = ctx.px((tr0.x0 + tr0.x1) / 2);
      ctx.my = ctx.px((tr0.y0 + tr0.y1) / 2);
      ctx.on_paint(h.makeGraphics());
      assert.ok(ctx.HB_BR_STAR.length > 0, page + ' populates track love hitboxes when row is hovered');
      assert.ok(ctx.HB_BR_TRDOTS.length > 0, page + ' populates track overflow menu hitboxes when row is hovered');
    }
  }
  ctx.mx = -1;
  ctx.my = -1;

  console.log('2. History back pill & error-state fallback actions...');
  ctx.brHistory = [{ brView: 'home', brViewId: '', brViewTitle: 'Navidrome', brScroll: 0 }];
  ctx.brView = 'album';
  ctx.brViewId = 'al-1';
  ctx.on_paint(h.makeGraphics());
  assert.deepStrictEqual(
    uniqueActs(ctx.HB_BR_BTN),
    ['back', 'open-album-artist', 'play-list', 'refresh', 'shuf-list', 'star-album'],
    'Non-empty brHistory adds back action pill'
  );

  ctx.brHistory = [];
  ctx.NVData.randomMix = { songs: [], loading: false, err: 'network timeout' };
  ctx.brView = 'random';
  ctx.brViewId = '';
  ctx.on_paint(h.makeGraphics());
  assert.deepStrictEqual(
    uniqueActs(ctx.HB_BR_BTN),
    ['random-rebatch', 'refresh'],
    'Error-state random view keeps random-rebatch and refresh recovery pills'
  );

  ctx.NVData.playlists = [];
  ctx.NVData.error = 'offline';
  ctx.brView = 'home';
  ctx.on_paint(h.makeGraphics());
  assert.deepStrictEqual(
    uniqueActs(ctx.HB_BR_BTN),
    ['refresh'],
    'Error-state home view renders reconnect/refresh pills'
  );
}

module.exports = { run };
