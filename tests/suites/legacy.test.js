'use strict';

const fs = require('fs');
const assert = require('assert');
const { createHarness } = require('../harness');

function run() {
  const {
    state,
    sandbox,
    ctx,
    uiWizardMock,
    makeHandle,
    makeHandleList,
    makeImage,
    makeGraphics,
    flushOneHttp
  } = createHarness();

  console.log('1. Startup & SQLite 011B/011C config parsing...');
  const conn = ctx.nvConnection();
  assert.strictEqual(conn.name, 'Demo Primary');
  assert.strictEqual(conn.url, 'https://demo.example.invalid:4533');
  assert.strictEqual(conn.user, 'alice');
  assert.strictEqual(conn.pass, 'sec&ret=1');
  assert.strictEqual(ctx.NVApi.servers.length, 2);

  ctx.nvSelectServer('Home Backup');
  assert.strictEqual(ctx.nvConnection().url, 'http://192.168.1.9:4533');
  ctx.nvSelectServer('Demo Primary');
  assert.strictEqual(ctx.nvConnection().name, 'Demo Primary');

  console.log('2. Track URI & cover art path extraction...');
  const sampleSong = {
    id: 'tr-123',
    title: 'Test Track & More',
    artist: 'Artist A',
    albumArtist: 'Album Artist',
    album: 'Album One',
    albumId: 'al-9',
    artistId: 'ar-7',
    coverArt: 'al-9',
    duration: 215,
    track: 3,
    discNumber: 1,
    year: 2024,
    genre: 'Electronic',
    suffix: 'flac',
    bitRate: 980,
    size: 28000000
  };
  const uri = ctx.nvBuildTrackUri(sampleSong);
  assert.ok(uri.startsWith('navidrome://track/tr-123?'));
  assert.strictEqual(ctx.nvTrackId(uri), 'tr-123');
  assert.strictEqual(ctx.nvCoverIdFromPath(uri), 'al-9');
  assert.ok(uri.indexOf('title=' + encodeURIComponent(sampleSong.title)) >= 0);

  console.log('3. Concurrent HTTP dispatch + catalog/playlist/album/artist/starred/random loading...');
  ctx.switchLibrarySource('navidrome');
  assert.strictEqual(ctx.libSource, 'navidrome');
  assert.strictEqual(ctx.view, 'navidrome');
  assert.strictEqual(state.panelsState.Navidrome.visible, false, 'Legacy Navidrome panel stays hidden by default');
  assert.strictEqual(state.panelsState.Lyrics.visible, false, 'Native Lyrics panel stays permanently hidden');

  assert.ok(state.httpQueue.length >= 4, 'Expected concurrent catalog requests queued');
  flushOneHttp('getPlaylists.view', 200, {
    'subsonic-response': {
      status: 'ok',
      playlists: {
        playlist: [
          { id: 'pl-1', name: 'Server Synth', songCount: 2, duration: 400, coverArt: 'pl-1' },
          { id: 'pl-2', name: 'Chill Late', songCount: 1, duration: 180 }
        ]
      }
    }
  });
  flushOneHttp('getAlbumList2.view', 200, {
    'subsonic-response': {
      status: 'ok',
      albumList2: { album: [{ id: 'al-9', name: 'Album One', artist: 'Artist A', artistId: 'ar-7', coverArt: 'al-9', year: 2024, songCount: 10 }] }
    }
  });
  flushOneHttp('getAlbumList2.view', 200, {
    'subsonic-response': {
      status: 'ok',
      albumList2: { album: [{ id: 'al-10', name: 'Album Two', artist: 'Artist B', artistId: 'ar-8', coverArt: 'al-10', year: 2025, songCount: 8 }] }
    }
  });
  flushOneHttp('getStarred2.view', 200, {
    'subsonic-response': {
      status: 'ok',
      starred2: {
        song: [sampleSong],
        album: [],
        artist: [{ id: 'ar-7', name: 'Artist A', albumCount: 2 }]
      }
    }
  });
  assert.strictEqual(ctx.NVData.playlists.length, 2);
  assert.strictEqual(ctx.nvIsStarred('song', 'tr-123'), true);
  assert.strictEqual(ctx.nvIsStarred('artist', 'ar-7'), true);

  console.log('4. Failed HTTP & Subsonic error handling...');
  ctx.nvFetchArtists(true);
  flushOneHttp('getArtists.view', 500, 'Internal Error', true);
  assert.ok(ctx.NVData.artistsErr, 'HTTP failure records error without crashing');

  console.log('5. Playlist CRUD & duplicate check...');
  ctx.nvCreateServerPlaylist('Road Trip', ['tr-123']);
  flushOneHttp('createPlaylist.view', 200, {
    'subsonic-response': {
      status: 'ok',
      playlist: { id: 'pl-99', name: 'Road Trip', songCount: 1, entry: [sampleSong] }
    }
  });
  flushOneHttp('getPlaylists.view', 200, {
    'subsonic-response': {
      status: 'ok',
      playlists: {
        playlist: [
          { id: 'pl-1', name: 'Server Synth', songCount: 2, duration: 400, coverArt: 'pl-1' },
          { id: 'pl-2', name: 'Chill Late', songCount: 1, duration: 180 },
          { id: 'pl-99', name: 'Road Trip', songCount: 1, duration: 215 }
        ]
      }
    }
  });
  assert.ok(ctx.nvPlaylistById('pl-99'));

  ctx.nvRenameServerPlaylist('pl-99', 'Night Drive');
  flushOneHttp('updatePlaylist.view', 200, { 'subsonic-response': { status: 'ok' } });
  flushOneHttp('getPlaylists.view', 200, {
    'subsonic-response': {
      status: 'ok',
      playlists: {
        playlist: [
          { id: 'pl-1', name: 'Server Synth', songCount: 2, duration: 400, coverArt: 'pl-1' },
          { id: 'pl-2', name: 'Chill Late', songCount: 1, duration: 180 },
          { id: 'pl-99', name: 'Night Drive', songCount: 1, duration: 215 }
        ]
      }
    }
  });
  assert.strictEqual(ctx.nvPlaylistById('pl-99').name, 'Night Drive');

  ctx.nvFetchPlaylistDetail('pl-99', false);
  flushOneHttp('getPlaylist.view', 200, {
    'subsonic-response': {
      status: 'ok',
      playlist: { id: 'pl-99', name: 'Night Drive', songCount: 1, entry: [sampleSong] }
    }
  });
  assert.strictEqual(ctx.NVData.plDetails['pl-99'].songs.length, 1);
  ctx.nvRequestAddToPlaylist('pl-99', 'Night Drive', [sampleSong, Object.assign({}, sampleSong, { id: 'tr-456', title: 'Fresh Song' })]);
  assert.ok(ctx.dupPrompt && ctx.dupPrompt.kind === 'nv', 'Expected dupPrompt for existing tr-123');
  ctx.dupSkip();
  const addReq = flushOneHttp('updatePlaylist.view', 200, { 'subsonic-response': { status: 'ok' } });
  assert.ok(addReq.url.indexOf('songIdToAdd=tr-456') >= 0 && addReq.url.indexOf('songIdToAdd=tr-123') < 0, 'dupSkip adds only non-duplicate songs');
  flushOneHttp('getPlaylists.view', 200, {
    'subsonic-response': {
      status: 'ok',
      playlists: {
        playlist: [
          { id: 'pl-1', name: 'Server Synth', songCount: 2, duration: 400, coverArt: 'pl-1' },
          { id: 'pl-2', name: 'Chill Late', songCount: 1, duration: 180 },
          { id: 'pl-99', name: 'Night Drive', songCount: 2, duration: 430 }
        ]
      }
    }
  });

  console.log('6. Async playback race guard, canonical ROUTE order, & shuffle exit...');
  state.activePlaylist = 0;
  const songs = [
    Object.assign({}, sampleSong, { id: 's1', title: 'One' }),
    Object.assign({}, sampleSong, { id: 's2', title: 'Two' }),
    Object.assign({}, sampleSong, { id: 's3', title: 'Three' })
  ];
  ctx.nvPlaySongs(songs, 1, { subKind: 'playlist', id: 'pl-99', name: 'Night Drive' }, false);
  ctx.nvPlaySongs(songs, 2, { subKind: 'playlist', id: 'pl-99', name: 'Night Drive' }, false);
  assert.strictEqual(state.addTasks.length, 2);

  const job1 = state.addTasks[0];
  const job2 = state.addTasks[1];
  ctx.on_locations_added(job1.tid, makeHandleList(job1.urls.map(u => makeHandle(u))));
  assert.strictEqual(state.playingPlaylist, -1, 'Stale AddLocationsAsync task must NOT start playback');

  const outOfOrder = [job2.urls[2], job2.urls[0], job2.urls[1]].map(u => makeHandle(u));
  ctx.on_locations_added(job2.tid, makeHandleList(outOfOrder));
  assert.strictEqual(state.activePlaylist, 0, 'Playing Navidrome into hidden __verdant_np__ must preserve visible ActivePlaylist');
  assert.strictEqual(ctx.nvTrackId(state.nowPlayingHandle.Path), 's3');
  assert.strictEqual(ctx.pbSource.kind, 'nav');
  assert.strictEqual(ctx.pbSource.name, 'Night Drive');
  const npPlIdx = state.playlists.findIndex(p => p.name === '__verdant_np__');
  assert.strictEqual(state.playlists[npPlIdx].items.map(h => ctx.nvTrackId(h.Path)).join(','), 's1,s2,s3');

  ctx.toggleShuffle();
  assert.strictEqual(ctx.pbShuffle, true);
  const shufPlIdx = state.playlists.findIndex(p => p.name === ctx.SHUF);
  assert.ok(shufPlIdx >= 0);
  assert.strictEqual(ctx.nvTrackId(state.playlists[shufPlIdx].items[0].Path), 's3');

  ctx.toggleShuffle();
  assert.strictEqual(ctx.pbShuffle, false);
  assert.strictEqual(state.playingPlaylist, npPlIdx);
  assert.strictEqual(state.playingItemIndex, 2);

  console.log('7. Right-pane & fullscreen JS lyrics + click-to-seek + theme switch (Dark <-> Light)...');
  state.playbackLength = 215;
  state.playbackTime = 12;
  ctx.nvLoad();
  flushOneHttp('getLyricsBySongId.view', 200, {
    'subsonic-response': {
      status: 'ok',
      lyricsList: {
        structuredLyrics: [{
          synced: true,
          line: [
            { start: 0, value: 'First line' },
            { start: 10000, value: 'Second active line' },
            { start: 25000, value: 'Third line' }
          ]
        }]
      }
    }
  });
  const m = ctx.activeLyricsModel();
  assert.ok(m && m.synced && m.lines.length === 3);

  const gr = makeGraphics();
  for (const isDark of [true, false]) {
    state.darkUi = isDark;
    ctx.on_colours_changed();
    for (const nv of ['home', 'albums', 'artists', 'playlist', 'album', 'artist', 'starred', 'random']) {
      ctx.nvView = nv;
      ctx.nvViewId = nv === 'playlist' ? 'pl-99' : (nv === 'album' ? 'al-9' : (nv === 'artist' ? 'ar-7' : ''));
      ctx.on_paint(gr);
    }
    ctx.view = 'search';
    ctx.searchQuery = 'Test';
    ctx.NVData.search.requested = 'Test';
    ctx.NVData.search.songs = songs;
    ctx.on_paint(gr);
    ctx.view = 'navidrome';
    ctx.fsMode = true;
    ctx.fsView = 'lyrics';
    ctx.on_paint(gr);
    ctx.fsMode = false;
  }
  ctx.on_paint(gr);
  assert.ok(ctx.HB_QLY.length >= 3, 'Right-pane lyrics populated click-to-seek hitboxes');
  assert.strictEqual(state.panelsState.Lyrics.visible, false, 'Native Lyrics panel never shown');

  ctx.nvOpenHome();
  ctx.on_paint(gr);
  assert.strictEqual(typeof ctx.nvOpenLegacy, 'undefined', 'Legacy panel opener removed');
  assert.strictEqual(typeof ctx.nvDrawLegacyView, 'undefined', 'Legacy view renderer removed');
  assert.ok(!ctx.HB_NV_BTN.some(b => b.act === 'legacy'), 'Top strip has no legacy panel toggle button');
  assert.strictEqual(state.panelsState.Navidrome.visible, false, 'Native Navidrome panel stays hidden');

  console.log('8. Cover download + async image load pipeline...');
  ctx.nvRequestArt('al-9', false);
  let safety = 0;
  while ((state.dlQueue.length || state.loadImgQueue.length) && safety++ < 20) {
    while (state.dlQueue.length) {
      const dl = state.dlQueue.shift();
      fs.writeFileSync(dl.dstPath, 'imgbytes');
      ctx.on_download_file_done(dl.dstPath, true);
    }
    while (state.loadImgQueue.length) {
      const li = state.loadImgQueue.shift();
      ctx.on_load_image_done(li.cookie, makeImage(400, 400));
    }
  }
  assert.strictEqual(ctx.nvArtLoaded('al-9'), true);
  assert.ok(ctx.nvArtCache['al-9'], 'al-9 image cached cleanly');

  console.log('9. UI click, wheel, keyboard, context menu & modal flows...');
  const qlyTarget = ctx.HB_QLY.find(h => Math.abs(h.t - 10) < 0.01);
  assert.ok(qlyTarget, 'Expected synced lyric hitbox for t=10');
  ctx.on_mouse_lbtn_up((qlyTarget.x0 + qlyTarget.x1) / 2, (qlyTarget.y0 + qlyTarget.y1) / 2);
  assert.strictEqual(state.playbackTime, 10);

  ctx.NV.lyrics = { synced: false, lines: Array.from({ length: 40 }, (_, k) => ({ t: 0, text: 'Static Line ' + k })) };
  ctx.lyLay = { lyr: null, w: -1 };
  ctx.on_paint(gr);
  const prevStScroll = ctx.lyStScroll;
  ctx.mx = ctx.R.queue.x + 20;
  ctx.my = ctx.R.queue.y + 120;
  ctx.on_mouse_wheel(-3);
  assert.ok(ctx.lyStScroll > prevStScroll, 'Right-pane unsynced lyrics should scroll on wheel');

  ctx.nvOpenPlaylist('pl-99', 'Night Drive');
  flushOneHttp('getPlaylist.view', 200, {
    'subsonic-response': {
      status: 'ok',
      playlist: { id: 'pl-99', name: 'Night Drive', songCount: 2, entry: [sampleSong, Object.assign({}, sampleSong, { id: 'tr-456', title: 'Fresh Song' })] }
    }
  });
  ctx.on_paint(gr);
  assert.ok(ctx.HB_NV_SORT_DD, 'Playlist sort dropdown pill present');
  ctx.on_mouse_lbtn_up((ctx.HB_NV_SORT_DD.x0 + ctx.HB_NV_SORT_DD.x1) / 2, (ctx.HB_NV_SORT_DD.y0 + ctx.HB_NV_SORT_DD.y1) / 2);
  assert.strictEqual(ctx.nvPlSortOpen, true);
  ctx.on_paint(gr);
  const sortOpt = ctx.NV_SORT_DD_HB.find(o => o.v === 'title');
  assert.ok(sortOpt);
  ctx.on_mouse_lbtn_up((sortOpt.x0 + sortOpt.x1) / 2, (sortOpt.y0 + sortOpt.y1) / 2);
  assert.strictEqual(ctx.nvPlSort, 'title');
  assert.strictEqual(ctx.nvPlSortOpen, false);

  assert.ok(ctx.HB_NV_ADDPL);
  ctx.on_mouse_lbtn_up((ctx.HB_NV_ADDPL.x0 + ctx.HB_NV_ADDPL.x1) / 2, (ctx.HB_NV_ADDPL.y0 + ctx.HB_NV_ADDPL.y1) / 2);
  assert.ok(ctx.renameEdit && ctx.renameEdit.kind === 'nv-create');
  for (const ch of 'Synth') ctx.on_char(ch.charCodeAt(0));
  ctx.on_char(13);
  assert.strictEqual(ctx.renameEdit, null);
  assert.ok(flushOneHttp('createPlaylist.view', 200, { 'subsonic-response': { status: 'ok', playlist: { id: 'pl-101', name: 'Synth', songCount: 0 } } }));
  flushOneHttp('getPlaylists.view', 200, { 'subsonic-response': { status: 'ok', playlists: { playlist: [{ id: 'pl-101', name: 'Synth', songCount: 0 }] } } });

  const starBtn = ctx.HB_CTRL.find(c => c.act === 'nvstar');
  assert.ok(starBtn, 'Bar star toggle present when playing Navidrome track');
  ctx.on_mouse_lbtn_up((starBtn.x0 + starBtn.x1) / 2, (starBtn.y0 + starBtn.y1) / 2);
  const sUrl = state.httpQueue[state.httpQueue.length - 1].url;
  assert.ok(sUrl.indexOf('star.view') >= 0 || sUrl.indexOf('unstar.view') >= 0);
  flushOneHttp('.view', 200, { 'subsonic-response': { status: 'ok' } });

  ctx.nvOpenPlaylist('pl-99', 'Night Drive');
  ctx.on_paint(gr);
  const trHit = ctx.HB_NV_TR[0];
  assert.ok(trHit);
  assert.strictEqual(ctx.on_mouse_rbtn_up((trHit.x0 + trHit.x1) / 2, (trHit.y0 + trHit.y1) / 2), true);
  ctx.on_paint(gr);
  const qEntryCtx = ctx.CTX_HB.find(c => c.act === 'nv-trk-queue');
  assert.ok(qEntryCtx, 'Expected "添加到下一首播放" context entry');
  ctx.on_mouse_lbtn_up((qEntryCtx.x0 + qEntryCtx.x1) / 2, (qEntryCtx.y0 + qEntryCtx.y1) / 2);
  const qTask = state.addTasks.pop();
  assert.ok(qTask, 'Expected AddLocationsAsync task for queue');
  ctx.on_locations_added(qTask.tid, makeHandleList(qTask.urls.map(u => makeHandle(u))));
  assert.strictEqual(state.playbackQueue.length, 1);

  ctx.view = 'search';
  ctx.searchQuery = '';
  ctx.on_paint(gr);
  for (const ch of 'Echo') ctx.on_char(ch.charCodeAt(0));
  ctx.on_char(13);
  assert.ok(flushOneHttp('search3.view', 200, {
    'subsonic-response': { status: 'ok', searchResult3: { song: [sampleSong], album: [], artist: [] } }
  }));
  assert.strictEqual(ctx.NVData.search.songs.length, 1);

  console.log('10. Random mix infinite auto-top-up...');
  const rSongs = [
    Object.assign({}, sampleSong, { id: 'r1' }),
    Object.assign({}, sampleSong, { id: 'r2' })
  ];
  ctx.nvPlaySongs(rSongs, 1, { subKind: 'random', id: 'random', name: 'Navidrome 随机漫游' }, true);
  const rTask = state.addTasks.pop();
  ctx.on_locations_added(rTask.tid, makeHandleList(rTask.urls.map(u => makeHandle(u))));
  ctx.on_playback_new_track();
  const extraReq = flushOneHttp('getRandomSongs.view', 200, {
    'subsonic-response': { status: 'ok', randomSongs: { song: [Object.assign({}, sampleSong, { id: 'r3' }), Object.assign({}, sampleSong, { id: 'r4' })] } }
  });
  assert.ok(extraReq, 'Random mix topped up near end of queue');
  const topTask = state.addTasks.pop();
  assert.ok(topTask);
  const rPi = state.playlists.findIndex(p => p.name === ctx.ROUTE);
  const sPi = state.playlists.findIndex(p => p.name === ctx.SHUF);
  const beforeR = state.playlists[rPi].items.length;
  const beforeS = state.playlists[sPi].items.length;
  ctx.on_locations_added(topTask.tid, makeHandleList(topTask.urls.map(u => makeHandle(u))));
  assert.strictEqual(state.playlists[rPi].items.length, beforeR + 2);
  assert.strictEqual(state.playlists[sPi].items.length, beforeS + 2);

  console.log('11. Partial-scroll clipping & sticky header masking (albums, artists, artist, home)...');
  {
    const synthAlbums = [];
    for (let i = 0; i < 16; i++) {
      synthAlbums.push({ id: 'scroll-al-' + i, name: 'Scroll Album ' + i, artist: 'Artist ' + i, year: 2020 + (i % 5), coverArt: '' });
    }
    const synthArtists = [];
    for (let i = 0; i < 16; i++) {
      synthArtists.push({ id: 'scroll-ar-' + i, name: 'Scroll Artist ' + i, albumCount: 3 + i, coverArt: '' });
    }
    const synthSongs = [];
    for (let i = 0; i < 5; i++) {
      synthSongs.push(Object.assign({}, sampleSong, { id: 'scroll-tr-' + i, title: 'Top Track ' + i, coverArt: '' }));
    }
    ctx.NVData.albumsTab = 'recent';
    ctx.NVData.albumsByTab.recent = { list: synthAlbums, loading: false, loaded: true, err: '', hasMore: true, offset: 16 };
    ctx.NVData.artists = synthArtists;
    ctx.NVData.artistsLoading = false;
    ctx.NVData.artistsErr = '';
    ctx.NVData.artistDetails['scroll-ar-0'] = {
      meta: synthArtists[0],
      albums: synthAlbums.slice(0, 12),
      topSongs: synthSongs,
      loading: false,
      err: ''
    };
    ctx.NVData.recentAlbums = synthAlbums.slice(0, 12);
    ctx.NVData.recentAlbumsLoading = false;
    ctx.NVData.playlists = [];
    for (let i = 0; i < 8; i++) {
      ctx.NVData.playlists.push({ id: 'scroll-pl-' + i, name: 'Scroll PL ' + i, songCount: 10 + i, coverArt: '' });
    }
    ctx.NVData.playlistsLoaded = true;
    ctx.NVData.playlistsLoading = false;

    ctx.view = 'navidrome';
    const mainR = ctx.R.main;
    const cropY = mainR.y + mainR.h;
    const pad = ctx.M.cpad;
    const grid = ctx.nvDrawGridCols(mainR.w - pad * 2, 16, 176);
    const rowStep = grid.cardH + 8;

    function paintWithScrollCheck(nv, nvId, scrollVal, shelfVal, expectedClipY0, expectedClipY1, requireCardBlit) {
      ctx.nvView = nv;
      ctx.nvViewId = nvId || '';
      ctx.nvScroll = scrollVal;
      ctx.nvScrollT = scrollVal;
      if (shelfVal !== undefined) {
        ctx.nvShelfScroll = shelfVal;
        ctx.nvShelfScrollT = shelfVal;
      }
      gr.drawImageCalls.length = 0;
      const cBefore = state.imgCreateCount;
      const dBefore = state.imgDisposeCount;
      ctx.on_paint(gr);
      const created = state.imgCreateCount - cBefore;
      const disposed = state.imgDisposeCount - dBefore;
      const mainCalls = gr.drawImageCalls.filter(c => c.x >= ctx.px(mainR.x) && c.x < ctx.px(mainR.x + mainR.w) && c.imW >= ctx.px(80));
      if (expectedClipY0 !== undefined && expectedClipY1 !== undefined) {
        if (requireCardBlit !== false) {
          assert.ok(mainCalls.length > 0, nv + ': expected clipped main-panel DrawImage blits');
        }
        for (const call of mainCalls) {
          assert.ok(call.sx >= 0 && call.sy >= 0 && call.sw >= 1 && call.sh >= 1, nv + ': valid source blit rect');
          assert.ok(call.sx + call.sw <= call.imW && call.sy + call.sh <= call.imH, nv + ': source blit stays within offscreen bounds');
          assert.ok(call.y >= ctx.px(expectedClipY0), nv + ': clipped card draw stays below header mask (y=' + call.y + ' min=' + ctx.px(expectedClipY0) + ')');
          assert.ok(call.y + call.h <= ctx.px(expectedClipY1), nv + ': clipped card draw stays above bottom edge (y2=' + (call.y + call.h) + ' max=' + ctx.px(expectedClipY1) + ')');
        }
      }
      return { created, disposed, mainCalls };
    }

    function warmView(nv, nvId) {
      ctx.nvView = nv; ctx.nvViewId = nvId || '';
      ctx.nvScroll = 0; ctx.nvScrollT = 0;
      ctx.on_paint(gr);
    }

    ctx.clearNvCardCache();
    warmView('albums', '');
    assert.ok(ctx.nvCardN > 0, 'Albums warm pass must populate whole-card bitmap cache');
    const albGy = mainR.y + 52 + 48;
    const albResTop = paintWithScrollCheck('albums', '', 45, undefined, albGy, cropY);
    assert.ok(albResTop.mainCalls.length > 0, 'Albums partial scroll must blit cached/sliced card images');
    const albResWarm = paintWithScrollCheck('albums', '', 44, undefined, albGy, cropY);
    assert.strictEqual(albResWarm.created, 0, 'Warm albums scroll must allocate zero new card bitmaps');
    assert.strictEqual(albResWarm.disposed, 0, 'Warm albums scroll must dispose zero cached card bitmaps');
    const alb0 = ctx.HB_NV_CARDS.find(c => c.id === 'scroll-al-0');
    assert.ok(alb0, 'Albums top-straddling card scroll-al-0 must remain present when scrolled 44px');
    assert.strictEqual(alb0.y0, albGy, 'Albums top-straddling card hitbox starts cleanly at gy');
    assert.ok(alb0.y1 > alb0.y0 && (alb0.y1 - alb0.y0) < grid.cardH, 'Albums top-straddling card has partial clipped height');
    const bottomClipAlb = ctx.HB_NV_CARDS.filter(c => c.y1 === cropY && (c.y1 - c.y0) < grid.cardH);
    assert.ok(bottomClipAlb.length > 0, 'Albums view renders bottom-straddling cards up to cropY instead of hiding them');

    const totalRows = Math.ceil(synthAlbums.length / grid.cols);
    const moreScroll = totalRows * rowStep + 8 - (cropY - albGy - 18);
    if (moreScroll > 0 && moreScroll <= ctx.NV_MAXPX) {
      paintWithScrollCheck('albums', '', moreScroll, undefined, albGy, cropY, false);
      const moreBtn = ctx.HB_NV_BTN.find(b => b.act === 'more-albums');
      assert.ok(moreBtn, 'Load more albums button remains rendered when half clipped at cropY');
      assert.strictEqual(moreBtn.y1, cropY, 'Load more albums button hitbox is clamped at cropY');
      assert.ok(moreBtn.y0 < cropY && moreBtn.y0 >= albGy, 'Load more albums button top lies above cropY');
    }

    warmView('artists', '');
    const artGy = mainR.y + 58;
    const artResTop = paintWithScrollCheck('artists', '', 45, undefined, artGy, cropY);
    assert.ok(artResTop.mainCalls.length > 0, 'Artists partial scroll must blit card images');
    const artResWarm = paintWithScrollCheck('artists', '', 44, undefined, artGy, cropY);
    assert.strictEqual(artResWarm.created, 0, 'Warm artists scroll must allocate zero new card bitmaps');
    assert.strictEqual(artResWarm.disposed, 0, 'Warm artists scroll must dispose zero cached card bitmaps');
    const ar0 = ctx.HB_NV_CARDS.find(c => c.id === 'scroll-ar-0');
    assert.ok(ar0, 'Artists top-straddling card scroll-ar-0 must remain present when scrolled 44px');
    assert.strictEqual(ar0.y0, artGy, 'Artists top-straddling card hitbox starts cleanly at gy');
    assert.ok(ar0.y1 > ar0.y0 && (ar0.y1 - ar0.y0) < grid.cardH, 'Artists top-straddling card has partial clipped height');
    const bottomClipArt = ctx.HB_NV_CARDS.filter(c => c.y1 === cropY && (c.y1 - c.y0) < grid.cardH);
    assert.ok(bottomClipArt.length > 0, 'Artists view renders bottom-straddling cards up to cropY instead of hiding them');

    warmView('artist', 'scroll-ar-0');
    const detBodyTop = mainR.y + 228 + 8;
    paintWithScrollCheck('artist', 'scroll-ar-0', 55, undefined, detBodyTop, cropY, false);
    assert.ok(ctx.HB_NV_TR.length > 0, 'Artist detail keeps visible top tracks when scrolled 55px');
    for (const th of ctx.HB_NV_TR) {
      assert.ok(th.y0 >= detBodyTop && th.y1 <= cropY, 'Artist detail track hitbox clamped inside [bodyTop, cropY]');
    }
    const topH = 40 + 5 * 50 + 24;
    const detCardScroll = topH + 40 + 50;
    const detCardRes = paintWithScrollCheck('artist', 'scroll-ar-0', detCardScroll, undefined, detBodyTop, cropY);
    assert.ok(detCardRes.mainCalls.length > 0, 'Artist detail album grid partial scroll blits cached card slices');
    const detCardWarm = paintWithScrollCheck('artist', 'scroll-ar-0', detCardScroll - 1, undefined, detBodyTop, cropY);
    assert.strictEqual(detCardWarm.created, 0, 'Warm artist album grid scroll allocates zero new card bitmaps');
    const detAl0 = ctx.HB_NV_CARDS.find(c => c.id === 'scroll-al-0');
    assert.ok(detAl0, 'Artist detail top-straddling album card remains present');
    assert.strictEqual(detAl0.y0, detBodyTop, 'Artist detail top-straddling album card starts at bodyTop');

    ctx.nvShelfScroll = 0; ctx.nvShelfScrollT = 0;
    warmView('home', '');
    const homeRes = paintWithScrollCheck('home', '', 45, 45);
    assert.ok(homeRes.mainCalls.length > 0, 'Home view partial vertical & horizontal scroll blits cached card slices');
    const homeResWarm = paintWithScrollCheck('home', '', 44, 44);
    assert.strictEqual(homeResWarm.created, 0, 'Warm Home view scroll allocates zero new card bitmaps');
    const homePl0 = ctx.HB_NV_CARDS.find(c => c.id === 'scroll-pl-0');
    assert.ok(homePl0, 'Home playlist card 0 remains present when horizontally scrolled 44px');
    assert.strictEqual(homePl0.x0, mainR.x + pad, 'Home horizontally clipped card starts cleanly at shelf x0');
    ctx.nvScroll = 0; ctx.nvScrollT = 0; ctx.nvShelfScroll = 0; ctx.nvShelfScrollT = 0;

    assert.ok(ctx.nvCardN > 0, 'Expected cached Navidrome cards prior to clear');
    const liveCachedBefore = ctx.nvCardN;
    const dispBefore = state.imgDisposeCount;
    ctx.clearDisplayCaches();
    assert.strictEqual(ctx.nvCardN, 0, 'clearDisplayCaches() must flush nvCardCache');
    assert.ok(state.imgDisposeCount - dispBefore >= liveCachedBefore, 'clearDisplayCaches() must dispose every cached card bitmap');
    warmView('albums', '');
    const cachedThemeCount = ctx.nvCardN;
    assert.ok(cachedThemeCount > 0, 'Re-warmed albums populate nvCardCache');
    const dispThemeBefore = state.imgDisposeCount;
    const prevDark = state.darkUi;
    state.darkUi = !prevDark;
    assert.strictEqual(ctx.syncTheme(), true, 'syncTheme() detects theme mode switch');
    assert.strictEqual(ctx.nvCardN, 0, 'syncTheme() must flush theme-baked nvCardCache bitmaps');
    assert.ok(state.imgDisposeCount - dispThemeBefore >= cachedThemeCount, 'syncTheme() must dispose cached card bitmaps');
    state.darkUi = prevDark;
    ctx.syncTheme();
    ctx.dirtyAll = true;
    ctx.on_paint(gr);
  }

  console.log('12. High-refresh ANIM_MS, dt-normalized easing, & RepaintRect partial compositing...');
  {
    assert.strictEqual(ctx.ANIM_FPS_RAW, 0, 'Animation: target FPS defaults to 0 (auto)');
    assert.strictEqual(ctx.ANIM_FPS, 120, 'Auto target FPS defaults to 120');
    assert.strictEqual(ctx.ANIM_MS, 8, 'ANIM_MS targets ~120fps (8ms)');
    assert.strictEqual(ctx.VIZ_MS, 10, 'Visualizer timer clamps cleanly to >=10ms');

    ctx.fsMode = false;
    ctx.volumePopupOpen = false;
    ctx.nvAlbTabOpen = false;
    ctx.view = 'home';
    ctx.dirtyAll = true;
    ctx.on_paint(gr);

    state.repaintFullCount = 0;
    state.repaintRectCalls.length = 0;
    ctx.on_playback_time();
    assert.strictEqual(state.repaintFullCount, 0, 'on_playback_time() must NOT trigger full window.Repaint');
    assert.strictEqual(state.repaintRectCalls.length, 1, 'on_playback_time() must trigger a single RepaintRect for the player bar');
    assert.strictEqual(state.repaintRectCalls[0].y, ctx.px(ctx.R.barY), 'Bar RepaintRect starts at R.barY');
    ctx.on_paint(gr);

    ctx.HB_DOTS = [{ x0: 500, y0: 500, x1: 520, y1: 520, pl: 0, mx: 500, my: 500 }];
    state.repaintFullCount = 0;
    state.repaintRectCalls.length = 0;
    ctx.repaintNav();
    assert.strictEqual(state.repaintFullCount, 0, 'repaintNav() must use partial RepaintRect');
    assert.strictEqual(state.repaintRectCalls.length, 1, 'repaintNav() invalidates R.navLib rect');
    ctx.on_paint(gr);
    assert.strictEqual(ctx.HB_DOTS.length, 1, 'dirtyNav-only partial paint must NOT wipe main-panel HB_DOTS');

    ctx.view = 'home';
    state.repaintFullCount = 0;
    state.repaintRectCalls.length = 0;
    ctx.repaintMain();
    assert.strictEqual(state.repaintFullCount, 0, 'repaintMain() in home view must not call full Repaint');
    assert.strictEqual(state.repaintRectCalls.length, 1, 'home view clips cleanly inside R.main without bar bleed repaint');
    ctx.on_paint(gr);

    ctx.view = 'playlist';
    state.repaintFullCount = 0;
    state.repaintRectCalls.length = 0;
    ctx.repaintMain();
    assert.strictEqual(state.repaintFullCount, 0, 'repaintMain() in playlist view uses partial RepaintRects');
    assert.strictEqual(state.repaintRectCalls.length, 2, 'playlist view pairs R.main + R.barY RepaintRect for track-row bottom bleed');
    ctx.on_paint(gr);

    ctx.volumePopupOpen = true;
    state.repaintFullCount = 0;
    state.repaintRectCalls.length = 0;
    ctx.on_playback_time();
    assert.strictEqual(state.repaintFullCount, 1, 'Open volumePopupOpen forces full window.Repaint fallback');
    assert.strictEqual(state.repaintRectCalls.length, 0, 'Overlay fallback skips partial RepaintRect');
    ctx.volumePopupOpen = false;
    ctx.on_paint(gr);

    ctx.view = 'home';
    ctx.on_paint(gr);
    const homeBtn = ctx.HB_HOME;
    assert.ok(homeBtn);
    state.repaintFullCount = 0;
    state.repaintRectCalls.length = 0;
    ctx.on_mouse_move((homeBtn.x0 + homeBtn.x1) / 2, (homeBtn.y0 + homeBtn.y1) / 2);
    assert.strictEqual(state.repaintFullCount, 0, 'hoverZone change uses partial RepaintRect');
    assert.ok(state.repaintRectCalls.length >= 1, 'hoverZone change queues zone RepaintRect');
    ctx.on_paint(gr);

    ctx.view = 'artist';
    ctx.ART_MAXBLOCK = 500;
    ctx.artScroll = 100;
    ctx.on_paint(gr);
    ctx.on_mouse_move(ctx.R.main.x + 20, ctx.R.main.y + 40);
    state.repaintFullCount = 0;
    state.repaintRectCalls.length = 0;
    ctx.on_mouse_wheel(-1);
    assert.strictEqual(state.repaintFullCount, 0, 'Artist wheel scroll uses partial repaintMain() instead of repaintAll()');
    assert.ok(state.repaintRectCalls.length >= 1, 'Artist wheel scroll issues RepaintRect');
    ctx.on_paint(gr);

    ctx.view = 'songs';
    ctx.songsScroll = 0;
    ctx.songsScrollT = 200;
    state.mockNowMs = 10000;
    ctx.stopScrollAnim();
    ctx.startScrollAnim();
    const sTimer = Array.from(state.timers.values()).find(t => t.interval && t.ms === ctx.ANIM_MS);
    assert.ok(sTimer, 'startScrollAnim schedules interval at ANIM_MS (8ms)');
    state.mockNowMs = 10008;
    ctx.scrollTick();
    state.mockNowMs = 10016;
    ctx.scrollTick();
    const pos120 = ctx.songsScroll;
    ctx.stopScrollAnim();

    ctx.songsScroll = 0;
    ctx.songsScrollT = 200;
    state.mockNowMs = 20000;
    ctx.startScrollAnim();
    state.mockNowMs = 20016;
    ctx.scrollTick();
    const pos60 = ctx.songsScroll;
    ctx.stopScrollAnim();

    const expected16 = 200 * (1 - Math.exp(-17.5 * 0.016));
    assert.ok(Math.abs(pos120 - pos60) < 1e-9, 'dt-normalized scrollTick must match across 8ms vs 16ms step sizes');
    assert.ok(Math.abs(pos120 - expected16) < 1e-9, 'dt-normalized scrollTick matches continuous exponential decay');

    state.isPlaying = true;
    state.isPaused = false;
    state.playbackLength = 200;
    state.playbackTime = 5;
    ctx.enterFullscreen();
    const fsTimers = Array.from(state.timers.values()).filter(t => t.interval && t.ms === ctx.ANIM_MS);
    assert.ok(fsTimers.length >= 1, 'startFsClock registers ANIM_MS interval in fullscreen');
    const fsTimerFn = fsTimers[fsTimers.length - 1].fn;
    ctx.fsView = 'lyrics';
    ctx.NV.lines = [{ t: 0, text: 'Line 0' }, { t: 10, text: 'Line 1' }];
    ctx.NV.lyScroll = 100;
    state.mockNowMs = 30000;
    state.repaintFullCount = 0;
    fsTimerFn();
    state.mockNowMs = 30008;
    fsTimerFn();
    assert.ok(state.repaintFullCount >= 1, 'fsClock actively repaints scrolling lyrics at high refresh');
    ctx.fsView = 'default';
    state.mockNowMs = 31000;
    fsTimerFn();
    state.repaintFullCount = 0;
    state.mockNowMs = 31016;
    fsTimerFn();
    state.mockNowMs = 31100;
    fsTimerFn();
    assert.strictEqual(state.repaintFullCount, 0, 'fsClock throttles static seekbar repaints below 250ms');
    state.mockNowMs = 31300;
    fsTimerFn();
    assert.strictEqual(state.repaintFullCount, 1, 'fsClock repaints static seekbar once >=250ms elapses');
    ctx.exitFullscreen();

    ctx.fsMode = false;
    ctx.on_paint(gr);
    state.repaintFullCount = 0;
    state.repaintRectCalls.length = 0;
    ctx.lyScroll = 0;
    ctx.lyTarget = 200;
    state.mockNowMs = 40000;
    ctx.stopLyAnim();
    ctx.startLyAnim();
    const lyTimer = Array.from(state.timers.values()).find(t => t.interval && t.ms === ctx.ANIM_MS);
    assert.ok(lyTimer, 'startLyAnim schedules interval at ANIM_MS (8ms)');
    state.mockNowMs = 40008;
    ctx.lyTick();
    state.mockNowMs = 40016;
    ctx.lyTick();
    const ly120 = ctx.lyScroll;
    assert.strictEqual(state.repaintFullCount, 0, 'lyTick uses partial repaintQueue without full Repaint');
    assert.ok(state.repaintRectCalls.length >= 2 && state.repaintRectCalls.every(c => c.x === ctx.px(ctx.R.queue.x)), 'lyTick only invalidates R.queue rect');
    ctx.stopLyAnim();
    ctx.lyScroll = 0;
    ctx.lyTarget = 200;
    state.mockNowMs = 50000;
    ctx.startLyAnim();
    state.mockNowMs = 50016;
    ctx.lyTick();
    assert.ok(Math.abs(ly120 - ctx.lyScroll) < 1e-9, 'dt-normalized lyTick matches across 8ms vs 16ms step sizes');
    ctx.stopLyAnim();
    ctx.on_paint(gr);
  }

  console.log('13. Non-square cover aspect ratio preservation (Hybrid Contain & Cover)...');
  {
    ctx.clearDisplayCaches();
    ctx.nvClearAllArt();

    const fWide = Object.assign({}, ctx.artFitContain(400, 225, 160, 160));
    assert.deepStrictEqual(fWide, { w: 160, h: 90, x: 0, y: 35 }, '16:9 landscape Contain fit');
    const fTall = Object.assign({}, ctx.artFitContain(300, 400, 160, 160));
    assert.deepStrictEqual(fTall, { w: 120, h: 160, x: 20, y: 0 }, '3:4 portrait Contain fit');
    const fNearSq = Object.assign({}, ctx.artFitContain(400, 399, 160, 160));
    assert.deepStrictEqual(fNearSq, { w: 160, h: 160, x: 0, y: 0 }, 'Near-square (<=1%) snaps to 1:1');

    const cWide = Object.assign({}, ctx.artCoverCrop(400, 225, 40, 40));
    assert.deepStrictEqual(cWide, { sx: 87, sy: 0, sw: 225, sh: 225 }, '16:9 landscape center-crop to 1:1');
    const cTall = Object.assign({}, ctx.artCoverCrop(300, 400, 40, 40));
    assert.deepStrictEqual(cTall, { sx: 0, sy: 50, sw: 300, sh: 300 }, '3:4 portrait center-crop to 1:1');
    const cBg = ctx.artCoverCrop(400, 400, 1440, 900);
    assert.strictEqual(cBg.sw, 400);
    assert.ok(Math.abs((cBg.sw / cBg.sh) - (1440 / 900)) < 0.01, 'Backdrop crops 1:1 cover to screen aspect');

    state.loadImgQueue.push({ cookie: 9991, winId: 0, path: 'tall.img' });
    ctx.nvArtPending['tall-art'] = 'demand';
    ctx.nvArtLoads[9991] = { id: 'tall-art', timer: 0 };
    ctx.on_load_image_done(9991, makeImage(400, 1200));
    const clampedTall = ctx.nvArtCache['tall-art'];
    assert.ok(clampedTall, 'Portrait image stored in nvArtCache');
    assert.strictEqual(clampedTall.Height, ctx.ART_MAXPX, 'Portrait long edge clamped to ART_MAXPX');
    assert.strictEqual(clampedTall.Width, Math.round(400 * ctx.ART_MAXPX / 1200), 'Portrait width scaled proportionally');

    const wideBmp = makeImage(400, 225);
    const tallBmp = makeImage(300, 400);
    ctx.nvArtCache['cov-wide'] = wideBmp;
    ctx.nvArtCache['cov-tall'] = tallBmp;

    const gAspect = makeGraphics();
    ctx.nvDrawRounded(gAspect, 10, 10, 160, 8, 'cov-wide', 'wide');
    assert.strictEqual(gAspect.drawImageCalls.length, 1);
    const blW = gAspect.drawImageCalls[0];
    assert.strictEqual(blW.w, 160);
    assert.strictEqual(blW.h, 90);
    assert.strictEqual(blW.x, 10);
    assert.strictEqual(blW.y, 45);
    assert.strictEqual(blW.imW, 160);
    assert.strictEqual(blW.imH, 90);

    gAspect.drawImageCalls.length = 0;
    ctx.nvDrawRounded(gAspect, 10, 10, 160, 8, 'cov-tall', 'tall');
    assert.strictEqual(gAspect.drawImageCalls.length, 1);
    const blT = gAspect.drawImageCalls[0];
    assert.strictEqual(blT.w, 120);
    assert.strictEqual(blT.h, 160);
    assert.strictEqual(blT.x, 30);
    assert.strictEqual(blT.y, 10);
    assert.strictEqual(blT.imW, 120);
    assert.strictEqual(blT.imH, 160);

    const hLocalWide = makeHandle('C:\\Music\\wide.flac', { album: 'Local Wide' });
    ctx.artCache[ctx.albKey(hLocalWide)] = wideBmp;
    gAspect.drawImageCalls.length = 0;
    ctx.drawRounded(gAspect, 20, 30, 160, 6, hLocalWide, 'locw');
    assert.strictEqual(gAspect.drawImageCalls.length, 1);
    assert.strictEqual(gAspect.drawImageCalls[0].w, 160);
    assert.strictEqual(gAspect.drawImageCalls[0].h, 90);
    assert.strictEqual(gAspect.drawImageCalls[0].x, 20);
    assert.strictEqual(gAspect.drawImageCalls[0].y, 65);

    state.nowPlayingHandle = makeHandle('https://demo.example.invalid:4533/rest/stream.view?id=tr-w&coverArt=cov-wide', {
      title: 'Wide Track',
      artist: 'Wide Artist',
      album: 'Wide Album'
    });
    ctx.updateNP();
    ctx.npArtCache[ctx.nowArtKey(state.nowPlayingHandle)] = null;
    state.isPlaying = true;
    state.isPaused = false;
    ctx.fsMode = true;
    ctx.fsView = 'default';
    const grFs = makeGraphics();
    ctx.on_paint(grFs);
    const aFs = ctx.fsGeometry();
    const expBox = ctx.npCoverBox(Math.round((ctx.W - aFs.art) / 2), aFs.y, aFs.art);
    assert.ok(expBox.w > expBox.h, 'Fullscreen npCoverBox preserves 16:9 wide ratio (' + expBox.w + 'x' + expBox.h + ')');
    assert.ok(
      grFs.fillRoundRectCalls.some(r => r.x === expBox.x + 4 && r.y === expBox.y + 14 && r.w === expBox.w && r.h === expBox.h),
      'Fullscreen cover drop shadow hugs exact fitted non-square cover rectangle'
    );
    assert.ok(ctx.fsBackdrop, 'Fullscreen backdrop built for Navidrome non-square cover');
    assert.ok(
      Math.abs((ctx.fsBackdrop.Width / ctx.fsBackdrop.Height) - (ctx.W / ctx.H)) < 0.03,
      'Fullscreen blurred backdrop matches screen aspect ratio instead of 1:1 squish'
    );

    ctx.fsView = 'viz';
    const grViz = makeGraphics();
    ctx.on_paint(grViz);
    assert.ok(
      grViz.drawImageCalls.some(c => c.x === 64 && c.y === 78 && c.w === 64 && c.h === 64),
      'Visualizer fsMiniNP draws 64x64 Cover-cropped square mini cover'
    );
    ctx.fsMode = false;

    gAspect.drawImageCalls.length = 0;
    ctx.nvDrawThumb(gAspect, 12, 14, 48, 4, 'cov-wide', 'wide');
    const nvTh = ctx.nvThumbCache['cov-wide|48'];
    assert.ok(nvTh && nvTh.Width === 48 && nvTh.Height === 48, 'nvDrawThumb builds 48x48 square');
    assert.strictEqual(nvTh._drawOps[0].sw, nvTh._drawOps[0].sh, 'nvDrawThumb center-crops source symmetrically');

    ctx.getThumb(hLocalWide, ctx.albKey(hLocalWide), 40);
    const locTh = ctx.thumbCache[ctx.albKey(hLocalWide) + '|40'];
    assert.ok(locTh && locTh.Width === 40 && locTh.Height === 40, 'getThumb builds 40x40 square');
    assert.strictEqual(locTh._drawOps[0].sw, locTh._drawOps[0].sh, 'getThumb center-crops source symmetrically');

    gAspect.drawImageCalls.length = 0;
    ctx.nvDrawCircle(gAspect, 0, 0, 100, 'cov-tall', 'tall');
    const cirEntry = ctx.nvMaskCache['cov-tall|100|c'];
    assert.ok(cirEntry && cirEntry.w === 100 && cirEntry.h === 100, 'nvDrawCircle fills 100x100 circle slot');
    assert.strictEqual(cirEntry.img._drawOps[0].sw, 300);
    assert.strictEqual(cirEntry.img._drawOps[0].sh, 300, 'Artist circle center-crops portrait image without stretching');

    const hLocalTall = makeHandle('C:\\Music\\tall.flac', { album: 'Local Tall' });
    ctx.artCache[ctx.albKey(hLocalTall)] = tallBmp;
    const mix = ctx.mosaicImg([hLocalWide, hLocalTall, hLocalWide, hLocalTall], 'mix-non-sq', 100, 6);
    assert.ok(mix && mix.Width === 100 && mix.Height === 100, 'mosaicImg generates 100x100 bitmap');
    assert.strictEqual(mix._drawOps.length, 4, 'mosaicImg draws all 4 quadrant tiles directly');
    for (const q of mix._drawOps) {
      assert.ok(Math.abs((q.sw / q.sh) - (q.w / q.h)) < 0.03, 'mosaic cell source crop matches cell aspect ratio');
    }
  }

  console.log('14. CJK font architecture, weight mapping, properties/CUI, lineH & DrawString AA...');
  {
    const defaultFonts = new Set(state.installedFonts);

    assert.strictEqual(ctx.FONT_SPEC.ui.base, 'HarmonyOS Sans SC');
    assert.strictEqual(ctx.FONT.rowTitle.Name, 'HarmonyOS Sans SC Medium');
    assert.strictEqual(ctx.FONT.rowTitle.Style, 0);
    assert.strictEqual(ctx.FONT.rowArtist.Name, 'HarmonyOS Sans SC');
    assert.strictEqual(ctx.FONT.rowArtist.Style, 0);
    assert.strictEqual(ctx.FONT.sect.Name, 'HarmonyOS Sans SC');
    assert.strictEqual(ctx.FONT.sect.Style, 1);
    assert.strictEqual(ctx.FONT.icon.Name, 'Segoe MDL2 Assets');

    state.installedFonts.delete('HarmonyOS Sans SC');
    state.installedFonts.delete('HarmonyOS Sans SC Medium');
    state.installedFonts.delete('Noto Sans SC');
    state.installedFonts.delete('Noto Sans SC Medium');
    ctx.refreshFonts();
    assert.strictEqual(ctx.FONT_SPEC.ui.base, 'PingFang SC Regular');
    assert.strictEqual(ctx.FONT.rowTitle.Name, 'PingFang SC Medium');
    assert.strictEqual(ctx.FONT.rowTitle.Style, 0);
    assert.strictEqual(ctx.FONT.sect.Name, 'PingFang SC Bold');
    assert.strictEqual(ctx.FONT.sect.Style, 0, 'Split-family PingFang Bold uses native Bold family with style=0');
    assert.strictEqual(ctx.FONT.rowArtist.Name, 'PingFang SC Regular');
    assert.strictEqual(ctx.FONT.rowArtist.Style, 0);

    state.installedFonts.delete('PingFang SC Regular');
    state.installedFonts.delete('PingFang SC Medium');
    state.installedFonts.delete('PingFang SC Bold');
    ctx.refreshFonts();
    assert.strictEqual(ctx.FONT_SPEC.ui.base, 'Microsoft YaHei UI');
    assert.strictEqual(ctx.FONT.rowTitle.Name, 'Microsoft YaHei UI');
    assert.strictEqual(ctx.FONT.rowTitle.Style, 0);
    assert.strictEqual(ctx.FONT.sect.Name, 'Microsoft YaHei UI');
    assert.strictEqual(ctx.FONT.sect.Style, 1);

    state.installedFonts.delete('Microsoft YaHei UI');
    ctx.refreshFonts();
    assert.strictEqual(ctx.FONT_SPEC.ui.base, 'Segoe UI');
    assert.strictEqual(ctx.FONT.rowTitle.Name, 'Segoe UI Semibold');
    assert.strictEqual(ctx.FONT.sect.Name, 'Segoe UI');
    assert.strictEqual(ctx.FONT.sect.Style, 1);

    state.installedFonts = new Set(defaultFonts);

    state.props[ctx.UI_FONT_PROP] = 'MissingCustomFont_XYZ';
    ctx.refreshFonts();
    assert.strictEqual(ctx.FONT_SPEC.ui.base, 'HarmonyOS Sans SC');

    state.props[ctx.UI_FONT_PROP] = 'cui';
    state.cuiFontName = 'PingFang SC';
    const repBefore = state.repaintFullCount;
    ctx.on_font_changed();
    assert.strictEqual(ctx.FONT_SPEC.ui.base, 'PingFang SC Regular', 'cui resolves Regular variant for split-family CUI font');
    assert.ok(state.repaintFullCount > repBefore, 'on_font_changed triggers full repaint');

    state.cuiFontName = 'Noto Sans SC';
    ctx.on_font_changed();
    assert.strictEqual(ctx.FONT_SPEC.ui.base, 'Noto Sans SC');
    assert.strictEqual(ctx.FONT.rowTitle.Name, 'Noto Sans SC Medium');

    state.props[ctx.UI_FONT_PROP] = 'auto';
    state.props[ctx.LYRIC_FONT_PROP] = 'PingFang SC';
    ctx.refreshFonts();
    assert.strictEqual(ctx.FONT_SPEC.ui.base, 'HarmonyOS Sans SC');
    assert.strictEqual(ctx.FONT_SPEC.lyric.base, 'PingFang SC Regular');
    assert.strictEqual(ctx.FONT.rowTitle.Name, 'HarmonyOS Sans SC Medium');
    assert.strictEqual(ctx.FONT.qLyric.Name, 'PingFang SC Bold');
    assert.strictEqual(ctx.FONT.qLyricStatic.Name, 'PingFang SC Regular');
    assert.strictEqual(ctx.FONT.lyric.Name, 'PingFang SC Bold');
    assert.strictEqual(ctx.FONT.fsLyric.Name, 'PingFang SC Bold');
    assert.strictEqual(ctx.fsFont(22, 'bold').Name, 'HarmonyOS Sans SC');
    assert.strictEqual(ctx.fsFont(30, 'bold', 'lyric').Name, 'PingFang SC Bold');

    const grFont = makeGraphics();
    const lh = ctx.lineH(grFont, ctx.FONT.rowTitle);
    assert.strictEqual(lh, 22);
    assert.strictEqual(grFont.calcTextHeightCalls[0].text, 'Ag\u6b4c');

    ctx.view = 'navidrome';
    ctx.NV.key = ctx.nvTrackKey();
    ctx.NV.status = 'ready';
    ctx.NV.lyrics = {
      synced: true,
      lines: [
        { t: 0, text: '\u7b2c\u4e00\u53e5\u4e2d\u6587\u6b4c\u8bcd English Mix' },
        { t: 10, text: '\u7b2c\u4e8c\u53e5\u6b4c\u8bcd Line 2' }
      ]
    };
    ctx.lyricsFor = ctx.NP ? ctx.NP.Path : '';
    ctx.lyrics = ctx.NV.lyrics;
    state.playbackTime = 1;
    ctx.fsMode = true;
    ctx.fsView = 'lyrics';
    ctx.fsLy.snap = true;
    ctx.on_paint(grFont);
    assert.ok(grFont.drawStringCalls.length >= 2, 'Fullscreen lyrics rendered via DrawString');
    assert.strictEqual(grFont.drawStringCalls[0].font.Name, 'PingFang SC Bold');
    assert.deepStrictEqual(grFont.textHintCalls, [4, 0], 'Fullscreen DrawString toggles TextRenderingHint 4 (AntiAlias) and restores 0');

    ctx.fsMode = false;
    state.props[ctx.UI_FONT_PROP] = 'auto';
    state.props[ctx.LYRIC_FONT_PROP] = 'auto';
    ctx.refreshFonts();
  }

  console.log('15. Fullscreen lifecycle: window restore, Esc DlgCode, click/menu & hoverSig isolation...');
  {
    const grFs = makeGraphics();
    ctx.view = 'navidrome';
    ctx.nvView = 'albums';
    ctx.on_paint(grFs);
    assert.ok(ctx.HB_NV_CARDS.length > 0, 'Normal view populated HB_NV_CARDS');
    assert.ok(ctx.HB_MENU.length > 0 && ctx.HB_CAP, 'Normal view populated titlebar hitboxes');

    uiWizardMock.WindowState = 0;
    ctx.sgMenuOpen = true;
    ctx.enterFullscreen();
    assert.strictEqual(ctx.fsMode, true);
    assert.strictEqual(uiWizardMock.WindowState, 1, 'enterFullscreen maximizes normal window');
    assert.strictEqual(sandbox.window.DlgCode, sandbox.DLGC_WANTALLKEYS, 'enterFullscreen sets DLGC_WANTALLKEYS for Esc');
    assert.strictEqual(ctx.sgMenuOpen, false, 'enterFullscreen dismisses lingering normal dropdowns');
    assert.strictEqual(ctx.HB_NV_CARDS.length, 0, 'enterFullscreen clears stale HB_NV_CARDS');
    assert.strictEqual(ctx.HB_MENU.length, 0, 'enterFullscreen clears stale HB_MENU');
    assert.strictEqual(ctx.HB_CAP, null, 'enterFullscreen clears stale HB_CAP');

    ctx.on_paint(grFs);
    assert.ok(ctx.HB_FS.length > 0, 'drawFullscreen populates HB_FS');
    assert.ok(ctx.HB_CTRL.length > 0, 'drawFullscreen populates HB_CTRL');
    const firstFs = ctx.HB_FS[0];
    const firstCtrl = ctx.HB_CTRL[0];
    assert.ok(ctx.hoverSig((firstFs.x0 + firstFs.x1) / 2, (firstFs.y0 + firstFs.y1) / 2).startsWith('f'));
    assert.ok(ctx.hoverSig((firstCtrl.x0 + firstCtrl.x1) / 2, (firstCtrl.y0 + firstCtrl.y1) / 2).startsWith('fc'));

    ctx.HB_TR = [{ pl: 0, item: 0, x0: 300, y0: 300, x1: 500, y1: 350 }];
    ctx.HB_NV_TR = [{ info: { list: [], idx: 0, sourceMeta: {} }, x0: 300, y0: 300, x1: 500, y1: 350 }];
    ctx.HB_NV_TRDOTS = [{ info: {}, x0: 460, y0: 305, x1: 490, y1: 335, mx: 460, my: 335 }];
    ctx.HB_SG = { x0: 200, y0: 200, x1: 280, y1: 240 };
    ctx.HB_CAP = { minX: 1300, maxX: 1346, closeX: 1392, bw: 46 };
    ctx.HB_MENU = [{ x0: 12, y0: 0, x1: 60, y1: 32, root: 'file', mx: 12 }];

    const rHandled = ctx.on_mouse_rbtn_up(ctx.px(350), ctx.px(320));
    assert.strictEqual(rHandled, false, 'Right-click in fullscreen passes through instead of opening track menu');
    assert.strictEqual(ctx.ctxMenu, null, 'No phantom ctxMenu opened by fullscreen right-click');

    ctx.on_mouse_lbtn_up(ctx.px(240), ctx.px(220));
    assert.strictEqual(ctx.sgMenuOpen, false, 'Left-click over phantom HB_SG does not open normal dropdown');
    ctx.on_mouse_lbtn_up(ctx.px(475), ctx.px(320));
    assert.strictEqual(ctx.ctxMenu, null, 'Left-click over phantom HB_NV_TRDOTS does not open normal track menu');

    assert.strictEqual(ctx.hoverSig(24, 16), '', 'hoverSig over old TBH menu returns empty string in fullscreen');
    assert.strictEqual(ctx.hoverSig(1320, 16), '', 'hoverSig over old caption buttons returns empty string in fullscreen');
    assert.strictEqual(ctx.hoverSig(350, 320), '', 'hoverSig over old list rows returns empty string in fullscreen');
    assert.strictEqual(ctx.scrollSection(500, 500), '', 'scrollSection ignores normal panels in fullscreen');

    ctx.on_char(27);
    assert.strictEqual(ctx.fsMode, false);
    assert.strictEqual(uiWizardMock.WindowState, 0, 'exitFullscreen restores pre-fullscreen un-maximized window state');
    assert.strictEqual(sandbox.window.DlgCode, sandbox.DLGC_WANTCHARS, 'exitFullscreen restores DLGC_WANTCHARS');

    uiWizardMock.WindowState = 1;
    ctx.enterFullscreen();
    assert.strictEqual(uiWizardMock.WindowState, 1);
    assert.strictEqual(sandbox.window.DlgCode, sandbox.DLGC_WANTALLKEYS, 'Already-maximized window still gets DLGC_WANTALLKEYS on enterFullscreen');
    ctx.on_char(27);
    assert.strictEqual(ctx.fsMode, false);
    assert.strictEqual(uiWizardMock.WindowState, 1, 'exitFullscreen keeps window maximized if it was already maximized');
    assert.strictEqual(sandbox.window.DlgCode, sandbox.DLGC_WANTCHARS);
    uiWizardMock.WindowState = 0;

    ctx.fsMode = true;
    ctx.fsView = 'viz';
    state.playbackLength = 200;
    state.playbackTime = 20;
    ctx.drag = 'seek';
    ctx.dragFrac = 0.75;
    const grVizSeek = makeGraphics();
    ctx.on_paint(grVizSeek);
    const seekFillW = Math.round((ctx.W - 144) * 0.75);
    assert.ok(
      grVizSeek.fillSolidRectCalls.some(c => Math.abs(c.x - 72 * ctx.UISCALE) < 0.01 && Math.abs(c.y - (ctx.H - 132) * ctx.UISCALE) < 0.01 && Math.abs(c.w - seekFillW * ctx.UISCALE) < 0.01),
      'drawFsBar previews dragFrac width while dragging seekbar in Viz mode'
    );
    ctx.drag = null;

    state.nowPlayingHandle = makeHandle('https://demo.example.invalid:4533/rest/stream.view?id=tr-w&coverArt=cov-wide', {
      title: 'Radial Wide Art',
      artist: 'Tester',
      album: 'Wide'
    });
    ctx.updateNP();
    ctx.vizStyle = 'radial';
    const grRad = makeGraphics();
    ctx.on_paint(grRad);
    const radHalf = Math.min(((ctx.H - 172) - ctx.VIZ_TOP) / 2, (ctx.W - ctx.VIZ_MARGIN * 2) / 2);
    const radR0 = Math.round(Math.round(radHalf * ctx.VIZ_R_FILL) * ctx.VIZ_R_INNER);
    const radArt = Math.max(40, (radR0 - ctx.VIZ_ART_GAP) * 2);
    assert.strictEqual(grRad.fillEllipseCalls.length, 0, 'Radial Ring draws Navidrome art image instead of placeholder ellipse');
    assert.ok(ctx.nvMaskCache['cov-wide|' + radArt + '|c'], 'Radial Ring caches Navidrome circle bitmap in nvMaskCache');
    assert.ok(grRad.drawImageCalls.some(c => Math.abs(c.w - radArt * ctx.UISCALE) < 0.01 && Math.abs(c.h - radArt * ctx.UISCALE) < 0.01), 'Radial Ring blits circular Navidrome cover');
    ctx.vizStyle = 'bars';

    const savedW = ctx.W;
    const savedH = ctx.H;
    sandbox.window.Width = ctx.px(640);
    sandbox.window.Height = ctx.px(720);
    ctx.on_size(ctx.px(640), ctx.px(720));
    const grNarrow = makeGraphics();
    ctx.on_paint(grNarrow);
    const titleDraw = grNarrow.gdiDrawTextCalls.find(d => d.str === 'Radial Wide Art');
    assert.ok(titleDraw && ctx.HB_VIZ, 'Narrow Viz drew title and HB_VIZ');
    assert.ok(titleDraw.x + titleDraw.w <= ctx.HB_VIZ.x0 * ctx.UISCALE + 0.01, 'Narrow fsMiniNP title width does not overlap HB_VIZ dropdown');
    sandbox.window.Width = ctx.px(savedW);
    sandbox.window.Height = ctx.px(savedH);
    ctx.on_size(ctx.px(savedW), ctx.px(savedH));

    ctx.fsView = 'lyrics';
    ctx.NV.status = 'ready';
    ctx.NV.key = ctx.nvTrackKey();
    ctx.NV.lyrics = { synced: false, lines: [{ t: -1, text: 'Short Line 1' }, { t: -1, text: 'Short Line 2' }] };
    ctx.fsLyReset();
    const grShortLy = makeGraphics();
    ctx.on_paint(grShortLy);
    assert.strictEqual(ctx.fsLy.max, 0, 'Short static lyrics fitting one screen have fsLy.max === 0');
    const gA = ctx.fsGeometry();
    ctx.mx = gA.rx + 20;
    ctx.my = gA.ry + 20;
    assert.strictEqual(ctx.fsLyricsWheel(-1), false, 'Wheel over short static lyrics falls through instead of scrolling blank space');

    const longStaticLines = [];
    for (let li = 0; li < 40; li++) longStaticLines.push({ t: -1, text: 'Static Lyric Line ' + li });
    ctx.NV.lyrics = { synced: false, lines: longStaticLines };
    ctx.fsLyReset();
    const grLongLy = makeGraphics();
    ctx.on_paint(grLongLy);
    const expStaticMax = Math.max(0, ctx.fsLy.total - gA.rh);
    assert.strictEqual(ctx.fsLy.max, expStaticMax, 'Long static lyrics fsLy.max equals total - a.rh (not a.rh * 0.45)');

    ctx.exitFullscreen();
    ctx.fsLy.manualUntil = Date.now() + 5000;
    ctx.fsLy.target = 250;
    state.httpQueue.length = 0;
    ctx.enterFullscreen();
    assert.strictEqual(ctx.fsLy.manualUntil, 0, 'enterFullscreen resets stale fsLy.manualUntil');
    assert.strictEqual(ctx.fsLy.target, 0, 'enterFullscreen resets stale fsLy.target');
    assert.strictEqual(state.httpQueue.length, 0, 'enterFullscreen reuses cached/loaded NV lyrics without forcing server HTTP re-fetch');

    ctx.fsView = 'lyrics';
    const grBd1 = makeGraphics();
    ctx.on_paint(grBd1);
    const bd1 = ctx.fsBackdrop;
    assert.ok(bd1 && !bd1._disposed, 'fsBackdrop allocated for fullscreen');
    const dispBefore = state.imgDisposeCount;
    ctx.exitFullscreen();
    assert.strictEqual(bd1._disposed, true, 'exitFullscreen disposes fsBackdrop bitmap');
    assert.strictEqual(ctx.fsBackdrop, null);
    assert.ok(state.imgDisposeCount > dispBefore);

    ctx.enterFullscreen();
    const grBd2 = makeGraphics();
    ctx.on_paint(grBd2);
    const bd2 = ctx.fsBackdrop;
    assert.ok(bd2 && !bd2._disposed);
    ctx.on_size(ctx.px(savedW + 40), ctx.px(savedH));
    const grBd2b = makeGraphics();
    ctx.on_paint(grBd2b);
    assert.strictEqual(bd2._disposed, true, 'fsDrawBackdrop disposes previous fsBackdrop on window resize');
    const bd2b = ctx.fsBackdrop;
    assert.ok(bd2b && bd2b !== bd2 && !bd2b._disposed);
    ctx.on_size(ctx.px(savedW), ctx.px(savedH));
    ctx.on_paint(makeGraphics());
    const bd3 = ctx.fsBackdrop;
    ctx.clearDisplayCaches();
    assert.strictEqual(bd3._disposed, true, 'clearDisplayCaches disposes fsBackdrop bitmap');
    ctx.exitFullscreen();

    assert.strictEqual(ctx.THEME_LIGHT.cardHov, ctx.RGB(228, 229, 235), 'THEME_LIGHT.cardHov darkened to RGB(228,229,235) for clearer hover contrast');

    ctx.clearNvCardCache();
    const cachedNvAlb = ctx.nvCardImg('album', 'ct-al-1', 176, '', 'ct-al-1', false);
    assert.ok(cachedNvAlb, 'nvCardImg builds offscreen album card shell bitmap');
    assert.strictEqual(cachedNvAlb._gdiDrawTextOps.length, 0, 'Cached Navidrome album shell performs zero GdiDrawText calls');
    assert.strictEqual(cachedNvAlb._drawStringOps.length, 0, 'Cached Navidrome album shell performs zero DrawString calls');

    const cachedNvArt = ctx.nvCardImg('artist', 'ct-ar-1', 176, '', 'ct-ar-1', true);
    assert.ok(cachedNvArt, 'nvCardImg builds offscreen artist card shell bitmap');
    assert.strictEqual(cachedNvArt._gdiDrawTextOps.length, 0, 'Cached Navidrome artist shell performs zero GdiDrawText calls');
    assert.strictEqual(cachedNvArt._drawStringOps.length, 0, 'Cached Navidrome artist shell performs zero DrawString calls');

    const cachedLocalPl = ctx.renderPlCard(0, 176, false);
    assert.ok(cachedLocalPl, 'renderPlCard builds offscreen local playlist card shell bitmap');
    assert.strictEqual(cachedLocalPl._gdiDrawTextOps.length, 0, 'Cached local playlist shell performs zero GdiDrawText calls');
    assert.strictEqual(cachedLocalPl._drawStringOps.length, 0, 'Cached local playlist shell performs zero DrawString calls');

    const cachedLocalArt = ctx.artCardImg({ name: 'Mock Local Artist', handle: null }, 176);
    assert.ok(cachedLocalArt, 'artCardImg builds offscreen local artist card shell bitmap');
    assert.strictEqual(cachedLocalArt._gdiDrawTextOps.length, 0, 'Cached local artist shell performs zero GdiDrawText calls');
    assert.strictEqual(cachedLocalArt._drawStringOps.length, 0, 'Cached local artist shell performs zero DrawString calls');

    const grUnhov = makeGraphics();
    ctx.mx = -1;
    ctx.my = -1;
    ctx.nvDrawCard(grUnhov, 250, 200, 176, '', 'hov-seed', 'Normal Album', 'Normal Sub', false, 'album', 'norm-1', {});
    assert.strictEqual(grUnhov.textHintCalls.length, 0, 'Live unhovered Navidrome card never touches GDI+ TextRenderingHint');
    assert.strictEqual(grUnhov.drawStringCalls.length, 0, 'Live unhovered Navidrome card never uses DrawString');
    assert.strictEqual(grUnhov.gdiDrawTextCalls.length, 2, 'Live unhovered Navidrome card draws title & sub via Win32 GdiDrawText');
    assert.strictEqual(grUnhov.gdiDrawTextCalls[0].col, ctx.COL.text);
    assert.strictEqual(grUnhov.gdiDrawTextCalls[1].col, ctx.COL.text2);

    const grHov = makeGraphics();
    ctx.mx = 260;
    ctx.my = 220;
    ctx.nvDrawCard(grHov, 250, 200, 176, '', 'hov-seed', 'Hover Album', 'Hover Sub', false, 'album', 'hov-1', {});
    assert.strictEqual(grHov.textHintCalls.length, 0, 'Hovered live Navidrome card never uses ClearTypeGridFit(5)');
    assert.strictEqual(grHov.drawStringCalls.length, 0);
    assert.strictEqual(grHov.gdiDrawTextCalls.length, 2, 'Hovered live Navidrome card draws title & sub via Win32 GdiDrawText');
    assert.strictEqual(grHov.gdiDrawTextCalls[0].col, ctx.COL.green, 'Option A: Hovered card title highlights in COL.green');
    assert.strictEqual(grHov.gdiDrawTextCalls[1].col, ctx.COL.text, 'Option A: Hovered card subtitle brightens to COL.text');
    assert.ok(grHov.fillRoundRectCalls.some(c => c.col === ctx.COL.cardHov), 'Hovered card shell fills with COL.cardHov');

    const grLocal = makeGraphics();
    ctx.drawPlaylistCard(grLocal, 250, 200, 176, 0, 250, 500);
    const plTitleCall = grLocal.gdiDrawTextCalls.find(c => c.str === ctx.plName(0));
    const plSubCall = grLocal.gdiDrawTextCalls.find(c => c.str === ctx.plCount(0) + ' songs');
    assert.ok(plTitleCall && plSubCall, 'drawPlaylistCard renders title & sub via live GdiDrawText');
    assert.strictEqual(plTitleCall.col, ctx.COL.green, 'Hovered local playlist card title uses COL.green');
    assert.strictEqual(plSubCall.col, ctx.COL.text, 'Hovered local playlist card subtitle uses COL.text');

    const grArt = makeGraphics();
    ctx.drawArtistCard(grArt, 250, 200, 176, { name: 'Mock Local Artist', handle: null }, 200, 500);
    const artTitleCall = grArt.gdiDrawTextCalls.find(c => c.str === 'Mock Local Artist');
    const artSubCall = grArt.gdiDrawTextCalls.find(c => c.str === 'Artist');
    assert.ok(artTitleCall && artSubCall, 'drawArtistCard renders title & sub via live GdiDrawText');
    assert.strictEqual(artTitleCall.col, ctx.COL.green, 'Hovered local artist card title uses COL.green');
    assert.strictEqual(artSubCall.col, ctx.COL.text, 'Hovered local artist card subtitle uses COL.text');
    ctx.mx = -1;
    ctx.my = -1;

    const grClipR = makeGraphics();
    ctx.tCard(grClipR, 'Right Clipped Title', ctx.FONT.card, ctx.COL.text, 262, 370, 152, 20, false, undefined, 320, undefined, undefined);
    assert.strictEqual(grClipR.gdiDrawTextCalls.length, 1);
    assert.strictEqual(grClipR.gdiDrawTextCalls[0].w, 58, 'Right-clipped tCard caps width at clipR - tx');
    assert.strictEqual(grClipR.gdiDrawTextCalls[0].fmt & 0x8000, 0, 'Right-clipped tCard disables DT_END_ELLIPSIS');

    const grClipB = makeGraphics();
    ctx.tCard(grClipB, 'Bottom Clipped Title', ctx.FONT.card, ctx.COL.text, 262, 350, 152, 20, false, undefined, undefined, undefined, 364);
    assert.strictEqual(grClipB.gdiDrawTextCalls.length, 1);
    assert.strictEqual(grClipB.gdiDrawTextCalls[0].fmt & 0x4, 0, 'Bottom-clipped tCard clears DT_VCENTER so DrawText uses DT_TOP');
    assert.ok(grClipB.gdiDrawTextCalls[0].y + grClipB.gdiDrawTextCalls[0].h <= 364, 'Bottom-clipped tCard fits strictly above clipB');

    const grLeftClip = makeGraphics();
    ctx.nvDrawCard(grLeftClip, 250, 200, 176, '', 'lc-seed', 'Left Clipped Album', 'Left Clipped Sub', false, 'album', 'lc-1', {}, false, 290, 600, 200, 450);
    const scratch1 = ctx.cardTextScratch;
    assert.ok(scratch1 && !scratch1._disposed, 'Left-clipped shelf card allocates reusable cardTextScratch');
    assert.strictEqual(scratch1._gdiDrawTextOps.length, 0);
    assert.strictEqual(scratch1._drawStringOps.length, 2);
    assert.deepStrictEqual(scratch1._textHintOps.slice(-4), [4, 0, 4, 0], 'Left-clipped scratch strip uses grayscale AntiAlias(4), never ClearTypeGridFit(5)');
    const createBeforeWarmLc = state.imgCreateCount;
    ctx.nvDrawCard(makeGraphics(), 252, 200, 176, '', 'lc-seed', 'Left Clipped Album', 'Left Clipped Sub', false, 'album', 'lc-1', {}, false, 290, 600, 200, 450);
    assert.strictEqual(state.imgCreateCount, createBeforeWarmLc, 'Warm left-clipped shelf redraw reuses cardTextScratch with 0 bitmap allocations');

    sandbox.window.DPI = 120;
    sandbox.window.Width = 1800;
    sandbox.window.Height = 1125;
    ctx.checkDisplay(true);
    assert.strictEqual(ctx.UISCALE, 1.25, 'DPI=120 sets fractional UISCALE=1.25');
    assert.strictEqual(scratch1._disposed, true, 'clearDisplayCaches inside checkDisplay disposes cardTextScratch');
    ctx.view = 'navidrome';
    ctx.nvView = 'albums';
    ctx.nvScroll = 44;
    ctx.nvScrollT = 44;
    ctx.on_paint(makeGraphics());
    const grDpi = makeGraphics();
    ctx.on_paint(grDpi);
    const dpiMainR = ctx.R.main;
    const dpiCardBlits = grDpi.drawImageCalls.filter(c => c.x >= ctx.px(dpiMainR.x) && c.x < ctx.px(dpiMainR.x + dpiMainR.w) && c.imW >= 160);
    assert.ok(dpiCardBlits.length > 0, 'Expected cached card shell blits at fractional 1.25x UISCALE');
    for (const c of dpiCardBlits) {
      assert.ok(Number.isInteger(c.x) && Number.isInteger(c.y), 'blitCard destination coordinates must be physical integers at 1.25x');
      assert.strictEqual(c.w, c.sw, 'blitCard dstW must match srcW 1:1 without resampling');
      assert.strictEqual(c.h, c.sh, 'blitCard dstH must match srcH 1:1 without resampling');
      assert.ok(c.x >= ctx.px(dpiMainR.x) && c.x + c.w <= ctx.px(dpiMainR.x + dpiMainR.w), 'blitCard X stays within main panel bounds');
      assert.ok(c.y >= ctx.px(dpiMainR.y) && c.y + c.h <= ctx.px(dpiMainR.y + dpiMainR.h), 'blitCard Y stays within main panel bounds');
    }
    sandbox.window.DPI = 96;
    sandbox.window.Width = 1440;
    sandbox.window.Height = 900;
    ctx.checkDisplay(true);
    assert.strictEqual(ctx.UISCALE, 1, 'Restored DPI=96 returns UISCALE=1');

    ctx.view = 'navidrome';
    ctx.nvView = 'albums';
    ctx.NVData.albumsTab = 'recent';
    ctx.nvAlbTabOpen = false;
    ctx.nvPlSortOpen = false;
    ctx.nvSrvMenuOpen = false;
    ctx.on_paint(makeGraphics());
    assert.ok(ctx.HB_NV_ALB_DD, 'Albums view populates HB_NV_ALB_DD pill hitbox');

    const pillCx = (ctx.HB_NV_ALB_DD.x0 + ctx.HB_NV_ALB_DD.x1) / 2;
    const pillCy = (ctx.HB_NV_ALB_DD.y0 + ctx.HB_NV_ALB_DD.y1) / 2;
    ctx.on_mouse_lbtn_up(ctx.px(pillCx), ctx.px(pillCy));
    assert.strictEqual(ctx.nvAlbTabOpen, true, 'Clicking HB_NV_ALB_DD opens albums tab dropdown');

    const grDd = makeGraphics();
    ctx.on_paint(grDd);
    assert.deepStrictEqual(
      Array.from(ctx.NV_ALB_DD_HB, h => h.v),
      ['recent', 'newest', 'frequent', 'random', 'alphabeticalByName'],
      'NV_ALB_DD_HB lists all 5 Navidrome album tabs'
    );
    const menuBgDraws = grDd.fillRoundRectCalls.filter(c => c.col === ctx.COL.menu);
    const menuShadowDraws = grDd.fillSolidRectCalls.filter(c => c.col === ctx.COL.shadow);
    assert.strictEqual(menuBgDraws.length, 1, 'Albums dropdown panel is drawn once per frame (no duplicate overlay paint)');
    assert.strictEqual(menuShadowDraws.length, 1, 'Albums dropdown shadow is drawn once per frame');

    ctx.mx = ctx.px(ctx.R.main.x + 300);
    ctx.my = ctx.px(ctx.R.main.y + 300);
    ctx.nvScroll = 30;
    ctx.nvScrollT = 30;
    ctx.on_mouse_wheel(-1);
    assert.strictEqual(ctx.nvScrollT, 30, 'Wheel does not scroll album grid while nvAlbTabOpen is open');

    for (const targetTab of ['newest', 'frequent', 'alphabeticalByName', 'random']) {
      delete ctx.NVData.albumsByTab[targetTab];
      if (!ctx.nvAlbTabOpen) {
        ctx.on_mouse_lbtn_up(ctx.px(pillCx), ctx.px(pillCy));
        ctx.on_paint(makeGraphics());
      }
      ctx.nvScroll = 42;
      ctx.nvScrollT = 42;
      const itemHb = ctx.NV_ALB_DD_HB.find(h => h.v === targetTab);
      assert.ok(itemHb, 'Found dropdown item hitbox for ' + targetTab);
      state.httpQueue.length = 0;
      ctx.on_mouse_lbtn_up(ctx.px((itemHb.x0 + itemHb.x1) / 2), ctx.px((itemHb.y0 + itemHb.y1) / 2));
      assert.strictEqual(ctx.nvAlbTabOpen, false, 'Selecting ' + targetTab + ' closes nvAlbTabOpen');
      assert.strictEqual(ctx.NVData.albumsTab, targetTab, 'NVData.albumsTab switches to ' + targetTab);
      assert.strictEqual(ctx.nvViewId, targetTab, 'nvViewId updates to ' + targetTab);
      assert.strictEqual(ctx.nvScroll, 0, 'Selecting ' + targetTab + ' resets nvScroll');
      const req = flushOneHttp('getAlbumList2', 200, {
        'subsonic-response': {
          status: 'ok',
          albumList2: {
            album: [{ id: 'alb-' + targetTab, name: 'Alb ' + targetTab, artist: 'Tester', coverArt: '' }]
          }
        }
      });
      assert.ok(req && req.url.indexOf('type=' + targetTab) >= 0, 'Requested getAlbumList2 with type=' + targetTab);
    }

    ctx.on_mouse_lbtn_up(ctx.px(pillCx), ctx.px(pillCy));
    ctx.on_paint(makeGraphics());
    const freqHb = ctx.NV_ALB_DD_HB.find(h => h.v === 'frequent');
    state.httpQueue.length = 0;
    ctx.on_mouse_lbtn_up(ctx.px((freqHb.x0 + freqHb.x1) / 2), ctx.px((freqHb.y0 + freqHb.y1) / 2));
    assert.strictEqual(ctx.NVData.albumsTab, 'frequent');
    assert.strictEqual(state.httpQueue.length, 0, 'Cached frequent tab switches immediately without redundant HTTP request');

    ctx.on_mouse_lbtn_up(ctx.px(pillCx), ctx.px(pillCy));
    ctx.on_paint(makeGraphics());
    const randHb = ctx.NV_ALB_DD_HB.find(h => h.v === 'random');
    state.httpQueue.length = 0;
    ctx.on_mouse_lbtn_up(ctx.px((randHb.x0 + randHb.x1) / 2), ctx.px((randHb.y0 + randHb.y1) / 2));
    const reqRand2 = flushOneHttp('getAlbumList2', 200, {
      'subsonic-response': { status: 'ok', albumList2: { album: [{ id: 'alb-random-2', name: 'Random 2', artist: 'Tester' }] } }
    });
    assert.ok(reqRand2 && reqRand2.url.indexOf('type=random') >= 0, 'Re-selecting random tab forces a fresh random batch');

    ctx.on_mouse_lbtn_up(ctx.px(pillCx), ctx.px(pillCy));
    ctx.on_paint(makeGraphics());
    const newestHb = ctx.NV_ALB_DD_HB.find(h => h.v === 'newest');
    ctx.ctxMenu = null;
    ctx.HB_NV_TRDOTS = [{ info: { list: [], idx: 0, sourceMeta: {} }, x0: newestHb.x0, y0: newestHb.y0, x1: newestHb.x1, y1: newestHb.y1, mx: newestHb.x0, my: newestHb.y1 }];
    ctx.on_mouse_lbtn_up(ctx.px((newestHb.x0 + newestHb.x1) / 2), ctx.px((newestHb.y0 + newestHb.y1) / 2));
    assert.strictEqual(ctx.ctxMenu, null, 'nvAlbTabOpen beats overlapping HB_NV_TRDOTS instead of opening track menu');
    assert.strictEqual(ctx.NVData.albumsTab, 'newest');

    ctx.nvPlSort = 'default';
    ctx.nvPlSortOpen = true;
    ctx.NV_SORT_DD_HB = [{ x0: 780, y0: 162, x1: 960, y1: 202, v: 'title' }];
    ctx.HB_NV_TRDOTS = [{ info: { list: [], idx: 0, sourceMeta: {} }, x0: 780, y0: 162, x1: 960, y1: 202, mx: 780, my: 202 }];
    ctx.on_mouse_lbtn_up(ctx.px(870), ctx.px(182));
    assert.strictEqual(ctx.ctxMenu, null, 'nvPlSortOpen beats overlapping HB_NV_TRDOTS');
    assert.strictEqual(ctx.nvPlSort, 'title', 'nvPlSort updated when overlapping HB_NV_TRDOTS');

    ctx.NVData.albumsTab = 'newest';
    state.httpQueue.length = 0;
    ctx.nvRefreshAll(false);
    const refreshUrls = state.httpQueue.filter(h => h.url.indexOf('getAlbumList2') >= 0).map(h => h.url);
    assert.ok(refreshUrls.some(u => u.indexOf('type=newest') >= 0), 'nvRefreshAll refreshes active tab (newest)');
    assert.ok(refreshUrls.some(u => u.indexOf('type=recent') >= 0), 'nvRefreshAll refreshes Home recent shelf when on newest tab');
    assert.strictEqual(refreshUrls.length, 2, 'nvRefreshAll avoids duplicate newest fetch when albumsTab === newest');
    while (state.httpQueue.length) flushOneHttp('get', 200, { 'subsonic-response': { status: 'ok' } });

    ctx.NVData.albumsTab = 'recent';
    ctx.nvViewId = 'recent';
    ctx.nvAlbTabOpen = false;
    ctx.nvPlSortOpen = false;
    ctx.mx = -1;
    ctx.my = -1;

    console.log('15f. Light/Dark overlay back-button hover contrast & cross-view focus feedback...');
    const savedDark = state.darkUi;
    const savedTab = ctx.rightTab;
    const savedNvLyrics = ctx.NV.lyrics;
    const savedNvStatus = ctx.NV.status;
    const savedNvKey = ctx.NV.key;
    const savedShuffle = ctx.pbShuffle;
    const savedNp = ctx.NP;
    const savedNpTitle = ctx.npTitleStr;
    const savedNpArtist = ctx.npArtistStr;

    state.darkUi = false;
    ctx.syncTheme();
    assert.strictEqual(ctx.IS_LIGHT, true, '15f: Light mode enabled');
    assert.strictEqual(ctx.THEME_LIGHT.pillHot, ctx.RGBA(0, 0, 0, 44), 'THEME_LIGHT.pillHot uses translucent dark wash');
    assert.strictEqual(ctx.THEME_DARK.pillHot, ctx.RGBA(255, 255, 255, 44), 'THEME_DARK.pillHot uses translucent light wash');

    ctx.mx = -1; ctx.my = -1;
    const grMiniLightRest = makeGraphics();
    ctx.nvDrawMiniPill(grMiniLightRest, 100, 50, 68, 30, '\u8fd4\u56de', 'back', 'back', { overlay: true });
    assert.strictEqual(grMiniLightRest.fillRoundRectCalls[0].col, ctx.RGBA(0, 0, 0, 22), 'Light overlay mini-pill rest bg');
    assert.strictEqual(grMiniLightRest.drawRoundRectCalls[0].col, ctx.COL.line, 'Light overlay mini-pill rest border');
    assert.ok(grMiniLightRest.gdiDrawTextCalls.every(c => c.col === ctx.COL.text), 'Light overlay mini-pill rest uses COL.text');

    ctx.mx = 134; ctx.my = 65;
    const grMiniLightHot = makeGraphics();
    ctx.nvDrawMiniPill(grMiniLightHot, 100, 50, 68, 30, '\u8fd4\u56de', 'back', 'back', { overlay: true });
    assert.strictEqual(grMiniLightHot.fillRoundRectCalls[0].col, ctx.RGBA(0, 0, 0, 50), 'Light overlay mini-pill hover darkens bg');
    assert.strictEqual(grMiniLightHot.drawRoundRectCalls[0].col, ctx.COL.text2, 'Light overlay mini-pill hover draws crisp border');
    assert.ok(grMiniLightHot.gdiDrawTextCalls.every(c => c.col === ctx.COL.text && c.col !== ctx.COL.white), 'Light overlay mini-pill hover keeps dark ink (never COL.white)');

    state.darkUi = true;
    ctx.syncTheme();
    assert.strictEqual(ctx.IS_LIGHT, false, '15f: Dark mode restored');
    ctx.mx = -1; ctx.my = -1;
    const grMiniDarkRest = makeGraphics();
    ctx.nvDrawMiniPill(grMiniDarkRest, 100, 50, 68, 30, '\u8fd4\u56de', 'back', 'back', { overlay: true });
    assert.strictEqual(grMiniDarkRest.fillRoundRectCalls[0].col, ctx.RGBA(0, 0, 0, 96), 'Dark overlay mini-pill rest bg');
    assert.strictEqual(grMiniDarkRest.drawRoundRectCalls[0].col, ctx.RGBA(255, 255, 255, 34), 'Dark overlay mini-pill rest border');
    assert.ok(grMiniDarkRest.gdiDrawTextCalls.every(c => c.col === ctx.COL.white), 'Dark overlay mini-pill rest uses COL.white');

    ctx.mx = 134; ctx.my = 65;
    const grMiniDarkHot = makeGraphics();
    ctx.nvDrawMiniPill(grMiniDarkHot, 100, 50, 68, 30, '\u8fd4\u56de', 'back', 'back', { overlay: true });
    assert.strictEqual(grMiniDarkHot.fillRoundRectCalls[0].col, ctx.RGBA(255, 255, 255, 48), 'Dark overlay mini-pill hover bg');
    assert.strictEqual(grMiniDarkHot.drawRoundRectCalls[0].col, ctx.RGBA(255, 255, 255, 115), 'Dark overlay mini-pill hover border');
    assert.ok(grMiniDarkHot.gdiDrawTextCalls.every(c => c.col === ctx.COL.white), 'Dark overlay mini-pill hover uses COL.white');

    state.darkUi = false;
    ctx.syncTheme();
    ctx.NVData.albumDetails['alb-focus-1'] = {
      meta: { id: 'alb-focus-1', name: 'Focus Album', artist: 'Focus Artist', artistId: 'ar-focus-1', coverArt: '', year: 2024, duration: 200 },
      songs: [sampleSong],
      loading: false,
      err: ''
    };
    ctx.nvHistory = [{ nvView: 'albums', nvViewId: 'recent', nvViewTitle: 'Albums', nvScroll: 0 }];
    ctx.view = 'navidrome';
    ctx.nvView = 'album';
    ctx.nvViewId = 'alb-focus-1';
    ctx.mx = -1; ctx.my = -1;
    ctx.on_paint(makeGraphics());

    const backHb = ctx.HB_NV_BTN.find(b => b.act === 'back');
    const artHb = ctx.HB_NV_BTN.find(b => b.act === 'open-album-artist');
    assert.ok(backHb, 'Album view draws Back button hitbox when nvHistory is non-empty');
    assert.ok(artHb, 'Album view draws clickable artist subtitle hitbox when artistId is present');

    ctx.mx = (backHb.x0 + backHb.x1) / 2;
    ctx.my = (backHb.y0 + backHb.y1) / 2;
    const grAlbBackHot = makeGraphics();
    ctx.on_paint(grAlbBackHot);
    const backLabelCall = grAlbBackHot.gdiDrawTextCalls.find(c => c.str === '\u8fd4\u56de');
    const backGlyphCall = grAlbBackHot.gdiDrawTextCalls.find(c => c.str === ctx.GLYPH.back);
    assert.ok(backLabelCall && backLabelCall.col === ctx.COL.text, 'Light Album Back label stays COL.text on hover');
    assert.ok(backGlyphCall && backGlyphCall.col === ctx.COL.text, 'Light Album Back icon stays COL.text on hover');
    assert.ok(backLabelCall.col !== ctx.COL.white, 'Light Album Back label never turns white on hover');
    assert.ok(grAlbBackHot.fillRoundRectCalls.some(c => c.x === backHb.x0 && c.y === backHb.y0 && c.col === ctx.RGBA(0, 0, 0, 50)), 'Light Album Back button uses RGBA(0,0,0,50) hover fill');
    assert.ok(grAlbBackHot.drawRoundRectCalls.some(c => c.col === ctx.COL.text2), 'Light Album Back button draws COL.text2 hover outline');

    ctx.mx = (artHb.x0 + artHb.x1) / 2;
    ctx.my = (artHb.y0 + artHb.y1) / 2;
    const grAlbArtHot = makeGraphics();
    ctx.on_paint(grAlbArtHot);
    const artistCall = grAlbArtHot.gdiDrawTextCalls.find(c => c.str === 'Focus Artist');
    assert.ok(artistCall && artistCall.col === ctx.COL.green, 'Hovered album artist subtitle turns COL.green');
    assert.ok(grAlbArtHot.drawLineCalls.some(c => c.col === ctx.COL.green && c.y1 === c.y2 && c.x2 > c.x1), 'Hovered album artist subtitle renders green underline');

    ctx.mx = 150; ctx.my = 68;
    const grDdPill = makeGraphics();
    const ddAnchor = ctx.drawDropPill(grDdPill, 100, 50, 180, 36, 'Test Menu', true);
    assert.strictEqual(grDdPill.fillRoundRectCalls[0].col, ctx.RGBA(0, 0, 0, 44), 'Light drawDropPill uses RGBA(0,0,0,44) when open/hovered');
    assert.strictEqual(grDdPill.drawRoundRectCalls[0].col, ctx.COL.text2, 'Light drawDropPill uses COL.text2 outline when open/hovered');
    ctx.mx = (ddAnchor.x0 + ddAnchor.x1) / 2;
    ctx.my = ddAnchor.y1 + 6 + 5 + 20;
    const grDdMenu = makeGraphics();
    ctx.drawDropMenu(grDdMenu, ddAnchor, [['Item A', 'a'], ['Item B', 'b']], 'b', 180);
    assert.ok(grDdMenu.fillRoundRectCalls.some(c => c.col === ctx.RGBA(0, 0, 0, 24)), 'Light drawDropMenu uses RGBA(0,0,0,24) row hover highlight');

    ctx.rightTab = 'queue';
    ctx.mx = -1; ctx.my = -1;
    ctx.drawQueue(makeGraphics());
    const lyrTabHb = ctx.HB_TABS.find(t => t.tab === 'lyrics');
    assert.ok(lyrTabHb);
    ctx.mx = (lyrTabHb.x0 + lyrTabHb.x1) / 2;
    ctx.my = (lyrTabHb.y0 + lyrTabHb.y1) / 2;
    const grTabHot = makeGraphics();
    ctx.drawQueue(grTabHot);
    const lyrTabLbl = grTabHot.gdiDrawTextCalls.find(c => c.str === 'Lyrics');
    assert.ok(lyrTabLbl && lyrTabLbl.col === ctx.COL.text, 'Hovering inactive Lyrics tab brightens text to COL.text');
    assert.ok(grTabHot.fillRoundRectCalls.some(c => c.x === lyrTabHb.x0 && c.col === ctx.COL.rowHover), 'Hovering inactive Lyrics tab draws COL.rowHover pill');

    ctx.rightTab = 'lyrics';
    ctx.NP = makeHandle('navidrome://track/tr-focus?coverArt=al-9', { title: 'Focus Track', artist: 'Focus Artist', album: 'Focus Album' });
    ctx.npTitleStr = 'Focus Track';
    ctx.npArtistStr = 'Focus Artist';
    ctx.NV.key = ctx.nvTrackKey();
    ctx.NV.lyrics = null;
    ctx.NV.status = 'error';
    ctx.lyrics = 'none';
    ctx.mx = -1; ctx.my = -1;
    ctx.drawQueue(makeGraphics());
    assert.ok(ctx.HB_QLY_REF && ctx.HB_QLY_RETRY, 'Empty-lyrics pane preserves both HB_QLY_REF and HB_QLY_RETRY');
    assert.ok(ctx.HB_QLY_REF.y1 < ctx.HB_QLY_RETRY.y0, 'HB_QLY_REF and HB_QLY_RETRY occupy distinct disjoint areas');
    assert.strictEqual(ctx.hoverSig((ctx.HB_QLY_REF.x0 + ctx.HB_QLY_REF.x1) / 2, (ctx.HB_QLY_REF.y0 + ctx.HB_QLY_REF.y1) / 2), 'qlyf', 'Hovering HB_QLY_REF produces qlyf hoverSig');
    assert.strictEqual(ctx.hoverSig((ctx.HB_QLY_RETRY.x0 + ctx.HB_QLY_RETRY.x1) / 2, (ctx.HB_QLY_RETRY.y0 + ctx.HB_QLY_RETRY.y1) / 2), 'qlyr', 'Hovering HB_QLY_RETRY produces qlyr hoverSig');
    state.httpQueue.length = 0;
    ctx.on_mouse_lbtn_up(ctx.px((ctx.HB_QLY_REF.x0 + ctx.HB_QLY_REF.x1) / 2), ctx.px((ctx.HB_QLY_REF.y0 + ctx.HB_QLY_REF.y1) / 2));
    assert.ok(state.httpQueue.some(h => h.url.indexOf('getLyricsBySongId') >= 0), 'Clicking HB_QLY_REF triggers getLyricsBySongId reload');
    while (state.httpQueue.length) flushOneHttp('get', 200, { 'subsonic-response': { status: 'ok' } });

    ctx.pbShuffle = true;
    ctx.mx = -1; ctx.my = -1;
    ctx.drawBar(makeGraphics());
    const shufHb = ctx.HB_CTRL.find(b => b.act === 'shuffle');
    const playHb = ctx.HB_CTRL.find(b => b.act === 'play');
    assert.ok(shufHb && playHb);

    ctx.mx = (shufHb.x0 + shufHb.x1) / 2;
    ctx.my = (shufHb.y0 + shufHb.y1) / 2;
    const grBarShuf = makeGraphics();
    ctx.drawBar(grBarShuf);
    assert.ok(grBarShuf.fillEllipseCalls.some(c => c.x === shufHb.x0 && c.y === shufHb.y0 && c.col === ctx.RGBA(0, 0, 0, 26)), 'Light bar ctrlBtn draws RGBA(0,0,0,26) hover halo');
    assert.ok(grBarShuf.gdiDrawTextCalls.some(c => c.str === ctx.GLYPH.shuffle && c.col === ctx.COL.greenHot), 'Hovered active shuffle button uses COL.greenHot');

    ctx.mx = (playHb.x0 + playHb.x1) / 2;
    ctx.my = (playHb.y0 + playHb.y1) / 2;
    const grBarPlay = makeGraphics();
    ctx.drawBar(grBarPlay);
    assert.ok(grBarPlay.fillEllipseCalls.some(c => c.w === 52 && c.h === 52 && c.col === ctx.RGB(46, 46, 52)), 'Hovered Play/Pause expands +2px (w=52) with Light hover fill');

    ctx.enterFullscreen();
    ctx.mx = -1; ctx.my = -1;
    ctx.on_paint(makeGraphics());
    const fsExitHb = ctx.HB_FS.find(b => b.act === 'exit');
    const fsPlayHb = ctx.HB_CTRL.find(b => b.act === 'play');
    assert.ok(fsExitHb && fsPlayHb);

    ctx.mx = (fsExitHb.x0 + fsExitHb.x1) / 2;
    ctx.my = (fsExitHb.y0 + fsExitHb.y1) / 2;
    const grFsIconHot = makeGraphics();
    ctx.on_paint(grFsIconHot);
    assert.ok(grFsIconHot.fillEllipseCalls.some(c => c.x === fsExitHb.x0 && c.y === fsExitHb.y0 && c.col === ctx.RGBA(255, 255, 255, 34)), 'Fullscreen fsIcon draws RGBA(255,255,255,34) hover halo');

    ctx.mx = (fsPlayHb.x0 + fsPlayHb.x1) / 2;
    ctx.my = (fsPlayHb.y0 + fsPlayHb.y1) / 2;
    const grFsPlayHot = makeGraphics();
    ctx.on_paint(grFsPlayHot);
    assert.ok(grFsPlayHot.fillEllipseCalls.some(c => c.x === fsPlayHb.x0 && c.y === fsPlayHb.y0 && c.col === ctx.RGBA(255, 255, 255, 26)), 'Fullscreen fsTransport draws RGBA(255,255,255,26) hover halo');

    ctx.exitFullscreen();
    ctx.fsMode = false;
    ctx.mx = -1; ctx.my = -1;
    ctx.nvHistory = [];
    ctx.view = 'navidrome';
    ctx.nvView = 'albums';
    ctx.nvViewId = 'recent';
    ctx.rightTab = savedTab;
    ctx.pbShuffle = savedShuffle;
    ctx.NP = savedNp;
    ctx.npTitleStr = savedNpTitle;
    ctx.npArtistStr = savedNpArtist;
    ctx.NV.lyrics = savedNvLyrics;
    ctx.NV.status = savedNvStatus;
    ctx.NV.key = savedNvKey;
    state.darkUi = savedDark;
    ctx.syncTheme();
  }

  console.log('16. Unload & cleanup...');
  ctx.enterFullscreen();
  ctx.on_paint(makeGraphics());
  const bdUnload = ctx.fsBackdrop;
  assert.ok(bdUnload && !bdUnload._disposed);
  ctx.fsMode = false;
  ctx.nvDrawCard(makeGraphics(), 250, 200, 176, '', 'lc-seed', 'Left Clipped Album', 'Left Clipped Sub', false, 'album', 'lc-1', {}, false, 290, 600, 200, 450);
  const scratchUnload = ctx.cardTextScratch;
  assert.ok(scratchUnload && !scratchUnload._disposed);
  ctx.view = 'navidrome';
  ctx.nvView = 'albums';
  ctx.on_paint(gr);
  assert.ok(ctx.nvCardN > 0, 'Navidrome albums populate nvCardCache before unload');
  ctx.on_script_unload();
  assert.strictEqual(bdUnload._disposed, true, 'on_script_unload() disposes fsBackdrop bitmap');
  assert.strictEqual(ctx.fsBackdrop, null);
  assert.strictEqual(scratchUnload._disposed, true, 'on_script_unload() disposes cardTextScratch bitmap');
  assert.strictEqual(ctx.cardTextScratch, null);
  assert.strictEqual(ctx.nvCardN, 0, 'on_script_unload() disposes all nvCardCache bitmaps');
  assert.strictEqual(state.panelsState.Navidrome.visible, false);
  assert.strictEqual(state.panelsState.Lyrics.visible, false);
  assert.strictEqual(Object.keys(ctx.NVApi.httpTasks).length, 0);
}

module.exports = { run };
