'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createHarness } = require('../harness');

function buildLocalLib(h) {
  const items = [
    h.makeHandle('C:\\Music\\Alpha\\Album1\\01.flac', {
      title: 'Alpha Dawn',
      artist: 'Artist Alpha',
      albumArtist: 'Artist Alpha',
      album: 'Album Alpha',
      tracknumber: '2',
      date: '2024-03-01',
      added: '2025-01-10 10:00:00',
      length: '3:00',
      lengthSec: 180,
      playCount: '5',
      lastPlayed: '2026-01-10 12:00:00',
      loved: '1'
    }),
    h.makeHandle('C:\\Music\\Alpha\\Album1\\02.flac', {
      title: 'Alpha Intro',
      artist: 'Artist Alpha',
      albumArtist: 'Artist Alpha',
      album: 'Album Alpha',
      tracknumber: '1',
      date: '2024-03-01',
      added: '2025-01-10 10:00:00',
      length: '2:00',
      lengthSec: 120
    }),
    h.makeHandle('C:\\Music\\Beta\\Album2\\01.flac', {
      title: 'Beta Song',
      artist: 'Artist Beta',
      albumArtist: 'Artist Beta',
      album: 'Zeta Album',
      tracknumber: '1',
      date: '2025-06-01',
      added: '2026-02-01 08:00:00',
      length: '4:10',
      lengthSec: 250
    }),
    h.makeHandle('C:\\Music\\ReadOnly\\01.flac', {
      title: 'Locked Tune',
      artist: 'Artist Gamma',
      albumArtist: 'Artist Gamma',
      album: 'Locked Album',
      tracknumber: '1',
      date: '2023-01-01',
      added: '2024-01-01 00:00:00',
      length: '3:30',
      lengthSec: 210,
      readOnly: true
    })
  ];
  return items;
}

function run() {
  console.log('1. Local play stats: foo_playcount import, 30s threshold, stop cancel, & persistence...');
  {
    const h = createHarness({
      props: { 'Navigation: music source': 'local' }
    });
    const ctx = h.ctx;
    const lib = buildLocalLib(h);
    h.state.libraryItems = lib;
    ctx.libChanged();
    ctx.SOURCES.local.ensureLoaded();
    h.flushTimers(1);

    const albAlpha = 'Artist Alpha - Album Alpha';
    assert.strictEqual(ctx.statsTrackCount(lib[0]), 5, 'One-time import brings in foo_playcount track plays');
    assert.strictEqual(ctx.statsAlbumInfo(albAlpha).count, 5, 'One-time import aggregates album count');
    assert.ok(ctx.statsAlbumInfo(albAlpha).lastPlayed > 0, 'One-time import preserves lastPlayed timestamp');
    assert.strictEqual(ctx.statsLoad().importedPlaycount, true, 'importedPlaycount marked true after import');

    // Playback < 30s must NOT record a play
    h.state.nowPlayingHandle = lib[2];
    h.state.isPlaying = true;
    h.state.isPaused = false;
    ctx.on_playback_new_track();
    assert.ok(ctx.statsPlayTimer !== null, 'statsOnNewTrack schedules 30s timer');
    ctx.on_playback_stop();
    h.state.isPlaying = false;
    assert.strictEqual(ctx.statsPlayTimer, null, 'statsOnPlaybackStop cancels pending 30s timer');
    h.flushTimers(ctx.STATS_MIN_MS);
    assert.strictEqual(ctx.statsTrackCount(lib[2]), 0, 'Short play cancelled before 30s records 0 plays');

    // Playback >= 30s records play & writes local-stats.json
    h.state.nowPlayingHandle = lib[2];
    h.state.isPlaying = true;
    h.state.isPaused = false;
    ctx.on_playback_new_track();
    h.flushTimers(ctx.STATS_MIN_MS);
    assert.strictEqual(ctx.statsTrackCount(lib[2]), 1, '30s timer increments track play count');
    assert.strictEqual(ctx.statsAlbumInfo('Artist Beta - Zeta Album').count, 1, '30s timer updates album count');

    h.flushTimers(ctx.STATS_SAVE_DELAY_MS);
    const statsFile = path.join(h.MOCK_PROFILE, 'verdant-cache', 'local-stats.json');
    assert.ok(fs.existsSync(statsFile), 'local-stats.json persisted to verdant-cache');

    // Second session reusing same profile loads persisted counts and does not overwrite with lower foo_playcount
    const h2 = createHarness({
      cleanProfile: false,
      props: { 'Navigation: music source': 'local' },
      libraryItems: lib
    });
    assert.strictEqual(h2.ctx.statsLoad().importedPlaycount, true);
    assert.strictEqual(h2.ctx.statsTrackCount(lib[2]), 1, 'Reloaded session preserves recorded play count');
  }

  console.log('2. LOVED tag writes: disabled toast, first-write confirm, self-write ignore, & read-only rollback...');
  {
    // Case A: Write disabled via property
    const hDis = createHarness({
      props: {
        'Navigation: music source': 'local',
        'Loved: write tags to files (1 = on)': 0
      }
    });
    const libDis = buildLocalLib(hDis);
    hDis.state.libraryItems = libDis;
    hDis.ctx.libChanged();
    let disRes = null;
    hDis.ctx.SOURCES.local.toggleLoved('song', hDis.ctx.lovedTrackId(libDis[1]), libDis[1], ok => { disRes = ok; });
    assert.strictEqual(disRes, false, 'toggleLoved fails cleanly when LOVED_WRITE is disabled');
    assert.strictEqual(hDis.state.tagWrites.length, 0, 'Disabled LOVED_WRITE never writes file tags');
    assert.ok(hDis.ctx.lovedToast.length > 0, 'Disabled LOVED_WRITE shows toast');

    // Case B: First-write modal confirm/cancel + self-write on_metadb_changed + unlove empty string
    const h = createHarness({
      props: { 'Navigation: music source': 'local' }
    });
    const ctx = h.ctx;
    const lib = buildLocalLib(h);
    h.state.libraryItems = lib;
    ctx.libChanged();
    ctx.SOURCES.local.ensureLoaded();
    h.flushTimers(1);

    assert.strictEqual(ctx.SOURCES.local.isLoved('song', ctx.lovedTrackId(lib[0]), lib[0]), true, 'Reads initial LOVED=1 tag');
    assert.strictEqual(ctx.SOURCES.local.isLoved('song', ctx.lovedTrackId(lib[1]), lib[1]), false, 'Unbracketed missing LOVED=false');

    // First write opens lovedPrompt modal
    ctx.SOURCES.local.toggleLoved('song', ctx.lovedTrackId(lib[1]), lib[1]);
    assert.ok(ctx.lovedPrompt !== null, 'First local love click opens confirmation dialog');
    assert.strictEqual(h.state.tagWrites.length, 0, 'No tag written prior to confirmation');

    const grDlg = h.makeGraphics();
    ctx.on_paint(grDlg);
    assert.ok(ctx.LOVED_HB && ctx.LOVED_HB.cancel && ctx.LOVED_HB.confirm, 'Modal draws cancel and confirm pills');

    // Click cancel
    const cBtn = ctx.LOVED_HB.cancel;
    ctx.on_mouse_lbtn_up((cBtn.x0 + cBtn.x1) / 2, (cBtn.y0 + cBtn.y1) / 2);
    assert.strictEqual(ctx.lovedPrompt, null);
    assert.strictEqual(h.state.tagWrites.length, 0);
    assert.strictEqual(ctx.SOURCES.local.isLoved('song', ctx.lovedTrackId(lib[1]), lib[1]), false);

    // Trigger again and confirm
    let loveCb = null;
    ctx.SOURCES.local.toggleLoved('song', ctx.lovedTrackId(lib[1]), lib[1], ok => { loveCb = ok; });
    ctx.on_paint(h.makeGraphics());
    const yBtn = ctx.LOVED_HB.confirm;
    ctx.on_mouse_lbtn_up((yBtn.x0 + yBtn.x1) / 2, (yBtn.y0 + yBtn.y1) / 2);
    assert.strictEqual(ctx.lovedPrompt, null);
    assert.strictEqual(h.state.props[ctx.LOVED_CONFIRMED_PROP], 1, 'Confirmation remembered in panel property');
    assert.strictEqual(h.state.tagWrites.length, 1);
    assert.strictEqual(h.state.tagWrites[0].patch[ctx.LOVED_FIELD], '1', 'Writes LOVED=1 via UpdateFileInfoFromJSON');
    assert.strictEqual(ctx.SOURCES.local.isLoved('song', ctx.lovedTrackId(lib[1]), lib[1]), true, 'Optimistic state reflects loved=true');

    // Simulated async on_metadb_changed(handles, false) must settle self-write without rebuilding localIdx
    const idxRefBefore = ctx.localIdx;
    ctx.on_metadb_changed(h.makeHandleList([lib[1]]), false);
    assert.strictEqual(loveCb, true, 'Matching self-write metadb callback invokes cb(true)');
    assert.strictEqual(ctx.localIdx, idxRefBefore, 'Self-write ignores full library index rebuild');
    assert.strictEqual(ctx.SOURCES.local.isLoved('song', ctx.lovedTrackId(lib[1]), lib[1]), true);

    // Subsequent toggle (no second prompt) unloves using empty string '' (never null)
    let unloveCb = null;
    ctx.SOURCES.local.toggleLoved('song', ctx.lovedTrackId(lib[1]), lib[1], ok => { unloveCb = ok; });
    assert.strictEqual(ctx.lovedPrompt, null, 'Already-confirmed session skips modal');
    assert.strictEqual(h.state.tagWrites[1].patch[ctx.LOVED_FIELD], '', 'Unlove passes "" (never null) to delete tag');
    ctx.on_metadb_changed(h.makeHandleList([lib[1]]), false);
    assert.strictEqual(unloveCb, true);
    assert.strictEqual(ctx.SOURCES.local.isLoved('song', ctx.lovedTrackId(lib[1]), lib[1]), false);

    // Case C: Read-only track silent failure rolls back after 1.5s + shows toast
    let roCb = null;
    ctx.SOURCES.local.toggleLoved('song', ctx.lovedTrackId(lib[3]), lib[3], ok => { roCb = ok; });
    assert.strictEqual(ctx.SOURCES.local.isLoved('song', ctx.lovedTrackId(lib[3]), lib[3]), true, 'Optimistic love set before 1.5s verify');
    h.flushTimers(1500);
    assert.strictEqual(roCb, false, 'Unmodified tag after 1.5s fails verification');
    assert.strictEqual(ctx.SOURCES.local.isLoved('song', ctx.lovedTrackId(lib[3]), lib[3]), false, 'Failed write rolls back heart state');
    assert.ok(ctx.lovedToast.length > 0, 'Failed write sets lovedToast error pill');
    ctx.on_paint(h.makeGraphics());

    // Stream handle refused immediately
    const nvStream = h.makeHandle('navidrome://track/x1', { title: 'Remote' });
    let stCb = null;
    ctx.lovedToggleLocal(nvStream, ok => { stCb = ok; });
    assert.strictEqual(stCb, false);
  }

  console.log('3. Cover dispatch (local:, localar:, localpl:, locallib) & non-recursive drawCircle...');
  {
    const h = createHarness({ props: { 'Navigation: music source': 'local' } });
    const ctx = h.ctx;
    const lib = buildLocalLib(h);
    h.state.libraryItems = lib;
    h.state.playlists[0].items = [lib[0], lib[1], lib[2]];
    ctx.libChanged();
    ctx.SOURCES.local.ensureLoaded();
    h.flushTimers(1);

    assert.strictEqual(ctx.coverKind('local:Artist Alpha - Album Alpha'), 'h');
    assert.strictEqual(ctx.coverKind('localar:Artist Alpha'), 'ar');
    assert.strictEqual(ctx.coverKind('localpl:0'), 'mosaic');
    assert.strictEqual(ctx.coverKind('locallib'), 'mosaic');

    const gr = h.makeGraphics();
    ctx.coverDrawRounded(gr, 0, 0, 120, 6, 'local:Artist Alpha - Album Alpha', 'seed');
    ctx.coverDrawRounded(gr, 0, 130, 120, 6, 'localpl:0', 'pl0');
    ctx.coverDrawRounded(gr, 0, 260, 120, 6, 'locallib', 'lib');
    ctx.coverDrawCircle(gr, 130, 0, 120, 'localar:Artist Alpha', 'Artist Alpha');
    ctx.drawCircle(gr, 260, 0, 120, lib[0], 'Artist Alpha');
    assert.ok(gr.fillRoundRectCalls.length >= 3, 'Cover helpers draw cleanly without stack overflow');
    assert.ok(typeof ctx.coverHue('local:Artist Alpha - Album Alpha', 'seed') === 'number');
  }

  console.log('4. LOCAL_SOURCE browse views, album tabs + fallback, top songs, CRUD, search, & top-up...');
  {
    const h = createHarness({
      props: { 'Navigation: music source': 'local' }
    });
    const ctx = h.ctx;
    const lib = buildLocalLib(h);
    // Add 62 more synthetic albums so pagination (>60) & tabs are tested
    for (let i = 0; i < 62; i++) {
      const code = String(i + 1).padStart(2, '0');
      lib.push(h.makeHandle('C:\\Music\\Extra\\Al' + code + '\\01.flac', {
        title: 'Extra Track ' + code,
        artist: 'ZArtist ' + code,
        albumArtist: 'ZArtist ' + code,
        album: 'Extra Album ' + code,
        tracknumber: '1',
        date: '2020-01-01',
        added: '2021-01-' + code + ' 00:00:00',
        length: '3:00',
        lengthSec: 180
      }));
    }
    // Strip playCount from lib[0] so initial state tests empty-stats fallback first
    lib[0]._meta.playCount = '';
    lib[0]._meta.lastPlayed = '';

    h.state.libraryItems = lib;
    h.state.playlists[0].items = [lib[0], lib[1], lib[2]];
    ctx.libChanged();
    ctx.SOURCES.local.ensureLoaded();
    h.flushTimers(1);

    const ls = ctx.SOURCES.local;
    assert.strictEqual(ls.albums('alphabeticalByName').list.length, 60, 'First album page caps at 60');
    assert.strictEqual(ls.albums('alphabeticalByName').hasMore, true, 'hasMore=true when >60 albums');
    ls.loadMoreAlbums('alphabeticalByName');
    assert.strictEqual(ls.albums('alphabeticalByName').list.length, 65, 'loadMoreAlbums reveals remaining albums');
    assert.strictEqual(ls.albums('alphabeticalByName').hasMore, false);

    // Empty-stats fallback: recent -> newest, frequent -> alphabeticalByName
    const newestFirst = ls.albums('newest').list[0].id;
    assert.strictEqual(newestFirst, 'Artist Beta - Zeta Album', 'Newest sorts by latest added/last_modified');
    assert.strictEqual(ls.albums('recent').list[0].id, newestFirst, 'Empty stats recent falls back to newest');
    assert.strictEqual(
      ls.albums('frequent').list[0].id,
      ls.albums('alphabeticalByName').list[0].id,
      'Empty stats frequent falls back to alphabeticalByName'
    );

    // Artist detail hides Top Songs when unplayed
    const artEmptyStats = ls.artist('Artist Alpha');
    assert.strictEqual(artEmptyStats.topRows.count, 0, 'Hides Top Songs when artist has no recorded play stats');

    // Album rows lazy Rows + tracknumber sort (track 1 before track 2)
    const albRes = ls.album('Artist Alpha - Album Alpha');
    assert.strictEqual(albRes.rows.count, 2);
    assert.strictEqual(albRes.rows.get(0).title, 'Alpha Intro', 'Album tracks sorted by tracknumber');
    assert.strictEqual(albRes.rows.get(1).title, 'Alpha Dawn');

    // Record plays -> recent/frequent switch away from fallbacks & Top Songs appear
    ctx.statsRecordPlay(lib[1], 9999999999000);
    ctx.statsRecordPlay(lib[1], 9999999999100);
    ctx.statsRecordPlay(lib[0], 9999999998000);
    assert.strictEqual(ls.albums('recent').list[0].id, 'Artist Alpha - Album Alpha', 'Recent puts most recently played album first');
    assert.strictEqual(ls.albums('frequent').list[0].id, 'Artist Alpha - Album Alpha', 'Frequent puts highest play count album first');
    const artWithStats = ls.artist('Artist Alpha');
    assert.strictEqual(artWithStats.topRows.count, 2, 'Artist Top Songs appear once tracks have stats');
    assert.strictEqual(artWithStats.topRows.get(0).title, 'Alpha Intro', 'Highest play count track ranks first');

    // Loved tracks list
    assert.strictEqual(ls.loved().rows.count, 1);
    assert.strictEqual(ls.loved().rows.get(0).id, ctx.lovedTrackId(lib[0]));

    // Search synchronous & cached
    ctx.searchQuery = 'Alpha';
    ls.search('Alpha');
    const sr = ls.searchResults();
    assert.ok(sr.artists.some(a => a.name === 'Artist Alpha'));
    assert.ok(sr.albums.some(a => a.name === 'Album Alpha'));
    assert.strictEqual(sr.rows.count, 2);

    ctx.searchQuery = 'Alpha Intro';
    ls.search('Alpha Intro');
    const srTrack = ls.searchResults();
    assert.strictEqual(srTrack.rows.count, 1);
    assert.strictEqual(srTrack.rows.get(0).title, 'Alpha Intro');

    // Random Mix + maybeTopUpRandom
    let picked = [];
    ls.fetchRandom(10, false, out => { picked = out; });
    assert.strictEqual(picked.length, 10);
    ls.play(ls.random().rows, 0, { subKind: 'random', id: 'random', name: 'Random' });
    const rp = h.state.playlists.findIndex(p => p.name === ctx.ROUTE);
    assert.ok(rp >= 0 && h.state.playlists[rp].items.length === 10);
    h.state.playingPlaylist = rp;
    h.state.playingItemIndex = 7; // rem = 2 <= 5
    h.state.nowPlayingHandle = h.state.playlists[rp].items[7];
    h.state.isPlaying = true;
    ctx.on_playback_new_track();
    assert.ok(h.state.playlists[rp].items.length > 10, 'maybeTopUpRandom appends more tracks when <= 5 left');

    // Playlist CRUD + dedupe + sort
    let created = null;
    ls.playlistOps.create('Road Trip', [ctx.lovedTrackId(lib[0])], m => { created = m; });
    assert.ok(created && created.name === 'Road Trip' && created.songCount === 1);
    ls.playlistOps.rename(created.id, 'Night Drive');
    assert.strictEqual(ctx.plName(Number(created.id)), 'Night Drive');

    // Adding duplicate track opens dupPrompt; adding new track inserts cleanly
    ls.playlistOps.addSongs(created.id, 'Night Drive', [lib[0], lib[2]]);
    assert.ok(ctx.dupPrompt !== null && ctx.dupPrompt.kind === 'local-add', 'Duplicate insert triggers dupPrompt');
    ctx.dupSkip();
    assert.strictEqual(ctx.plCount(Number(created.id)), 2, 'dupSkip adds only non-duplicate tracks');
    assert.strictEqual(ctx.dupPrompt, null);

    // Local playlist sort helper
    const plDet = ls.playlist(created.id);
    const plRows = plDet.rows;
    assert.ok(plRows.sortKeys && plRows.sortKeys.title.length === 2, 'localPlaylistRows provides sortKeys for brSortedPlaylistRows');
    ctx.brPlSort = 'title';
    ctx.brPlSortDir = 'asc';
    const sorted = ctx.brSortedPlaylistRows(plDet);
    assert.strictEqual(sorted.get(0).title, 'Alpha Dawn');
    assert.strictEqual(sorted.get(1).title, 'Beta Song');
    ctx.brPlSortDir = 'desc';
    const sortedDesc = ctx.brSortedPlaylistRows(plDet);
    assert.strictEqual(sortedDesc.get(0).title, 'Beta Song');
    ctx.brPlSort = 'default';
    ctx.brPlSortDir = 'asc';

    // Remove song & delete playlist while viewing it
    ctx.brView = 'playlist';
    ctx.brViewId = created.id;
    ls.playlistOps.removeSong(created.id, 0);
    assert.strictEqual(ctx.plCount(Number(created.id)), 1);
    ctx.doDeleteNvPlaylist(created.id, 'local');
    assert.strictEqual(ctx.brView, 'home', 'Deleting currently-viewed local playlist returns to home');

    // External foobar playlist deletion fires on_playlists_changed -> leaves stale playlist view
    ctx.brView = 'playlist';
    ctx.brViewId = '99';
    ctx.on_playlists_changed();
    assert.strictEqual(ctx.brView, 'home', 'on_playlists_changed leaves out-of-range local playlist view');

    // Render all 8 unified local browse pages + songs + search across Dark & Light themes
    const uniqueActs = btns => Array.from(new Set(btns.map(b => b.act))).sort();
    const expectedLocalActs = {
      home: ['go-albums', 'go-artists', 'go-random', 'go-starred', 'new-pl', 'refresh'],
      albums: ['more-albums', 'refresh'],
      artists: ['refresh'],
      playlist: ['play-list', 'refresh', 'shuf-list'],
      album: ['open-album-artist', 'play-list', 'refresh', 'shuf-list'],
      artist: ['play-list', 'refresh', 'shuf-list'],
      starred: ['play-list', 'refresh', 'shuf-list'],
      random: ['play-list', 'random-rebatch', 'refresh']
    };
    ls.setAlbumsTab('newest');
    for (const darkUi of [true, false]) {
      h.state.darkUi = darkUi;
      ctx.syncTheme();
      const views = [
        ['home', ''],
        ['albums', 'newest'],
        ['artists', ''],
        ['playlist', '0'],
        ['album', 'Artist Alpha - Album Alpha'],
        ['artist', 'Artist Alpha'],
        ['starred', ''],
        ['random', '']
      ];
      for (const [bv, bid] of views) {
        ctx.view = 'browse';
        ctx.brView = bv;
        ctx.brViewId = bid;
        ctx.brHistory = [];
        ctx.brScroll = ctx.brScrollT = 0;
        ctx.on_paint(h.makeGraphics());
        assert.strictEqual(ctx.HB_BR_SRV_DD, null, 'Local browse hides multiServer dropdown (' + bv + ')');
        if (bv === 'albums') {
          assert.deepStrictEqual(uniqueActs(ctx.HB_BR_BTN), ['refresh'], 'Local albums top scroll keeps refresh pill');
          ctx.brScroll = ctx.brScrollT = ctx.BR_MAXPX;
          ctx.on_paint(h.makeGraphics());
          assert.deepStrictEqual(uniqueActs(ctx.HB_BR_BTN), expectedLocalActs.albums, 'Local albums scrolled to bottom reveals more-albums pill');
          ctx.brScroll = ctx.brScrollT = 0;
        } else {
          assert.deepStrictEqual(
            uniqueActs(ctx.HB_BR_BTN),
            expectedLocalActs[bv],
            'Local browse "' + bv + '" HB_BR_BTN matches unified parity snapshot'
          );
        }
      }
      ctx.view = 'songs';
      ctx.on_paint(h.makeGraphics());
      assert.ok(ctx.HB_ALLSONGS !== null, 'Local nav shows pinned All Songs row');
      ctx.view = 'search';
      ctx.on_paint(h.makeGraphics());
    }

    // Switching to navidrome hides All Songs row
    ctx.switchLibrarySource('navidrome');
    ctx.on_paint(h.makeGraphics());
    assert.strictEqual(ctx.HB_ALLSONGS, null, 'Navidrome nav hides local-only All Songs row');
  }

  console.log('5. Phase 6: local playlist empty CTA / drop zone & unified All Songs view...');
  {
    const h = createHarness({
      props: { 'Navigation: music source': 'local' }
    });
    const ctx = h.ctx;
    const lib = buildLocalLib(h);
    h.state.libraryItems = lib;
    h.state.playlists = [
      { name: 'Empty Local', items: [], locked: false, auto: false },
      { name: 'Auto Locked', items: [], locked: true, auto: true }
    ];
    ctx.libChanged();
    ctx.SOURCES.local.ensureLoaded();
    h.flushTimers(1);

    // 5a. Empty editable local playlist renders Browse files / Browse folder pills + drop zone
    ctx.view = 'browse';
    ctx.brView = 'playlist';
    ctx.brViewId = '0';
    ctx.plDropHover = false;
    ctx.on_paint(h.makeGraphics());
    assert.ok(ctx.HB_PLADD_FILES && ctx.HB_PLADD_FOLDER, 'Empty local playlist shows Browse files & Browse folder CTAs');

    ctx.plDropHover = true;
    const grDropEmpty = h.makeGraphics();
    ctx.on_paint(grDropEmpty);
    assert.ok(
      grDropEmpty.gdiDrawTextCalls.some(c => c.str === ctx.T('empty.drop_to_add')),
      'Empty local playlist shows drop zone cue during plDropHover'
    );
    ctx.plDropHover = false;

    // Empty locked/autoplaylist omits manual Browse files/folder buttons
    ctx.brViewId = '1';
    ctx.on_paint(h.makeGraphics());
    assert.strictEqual(ctx.HB_PLADD_FILES, null, 'Locked autoplaylist omits Browse files CTA');
    assert.strictEqual(ctx.HB_PLADD_FOLDER, null, 'Locked autoplaylist omits Browse folder CTA');

    // Non-empty local playlist renders drop outline + pill during drag-over and arms dupWatch on drop
    ctx.brViewId = '0';
    h.state.playlists[0].items = [lib[0], lib[1]];
    ctx.invalidateItems();
    const dragAct = { IsInternal: false, Effect: 5, Playlist: -1, Base: -1, ToSelect: false };
    const dropX = ctx.px(ctx.R.main.x + 80), dropY = ctx.px(ctx.R.main.y + 320);
    ctx.on_drag_over(dragAct, dropX, dropY, 0);
    assert.strictEqual(dragAct.Effect, 1, 'External drag over local playlist accepts copy');
    assert.strictEqual(ctx.plDropHover, true, 'External drag over local playlist activates plDropHover');

    const grDropPop = h.makeGraphics();
    ctx.on_paint(grDropPop);
    assert.ok(
      grDropPop.gdiDrawTextCalls.some(c => c.str === ctx.T('empty.drop_to_add')),
      'Populated local playlist draws drop cue pill during plDropHover'
    );

    const dropAct = { IsInternal: false, Effect: 5, Playlist: -1, Base: -1, ToSelect: false };
    ctx.on_drag_drop(dropAct, dropX, dropY, 0);
    assert.strictEqual(dropAct.Playlist, 0, 'Drop targets local playlist index');
    assert.strictEqual(dropAct.Base, 2, 'Drop appends after existing playlist items');
    assert.ok(ctx.dupWatch && ctx.dupWatch.pl === 0, 'Drop arms duplicate watcher');
    ctx.dupWatch = null;
    assert.strictEqual(ctx.plDropHover, false);

    // 5b. Unified All Songs view: header, Normalize, Group-by, shared rows, hover love/menu, right-click, & grouping modes
    ctx.view = 'songs';
    ctx.songsGroup = 'none';
    ctx.invalidateLibrary();
    ctx.on_paint(h.makeGraphics());
    assert.ok(ctx.HB_RGNORM, 'All Songs draws Normalize pill');
    assert.ok(ctx.HB_SG, 'All Songs draws Group-by dropdown pill');
    assert.ok(ctx.HB_BR_BTN.some(b => b.act === 'refresh'), 'All Songs includes shared top strip refresh pill');
    assert.ok(ctx.HB_BR_TR.length === lib.length, 'All Songs populates shared HB_BR_TR track rows');

    // Hovering track row populates shared heart + ... buttons
    const tr0 = ctx.HB_BR_TR[0];
    ctx.mx = (tr0.x0 + tr0.x1) / 2;
    ctx.my = (tr0.y0 + tr0.y1) / 2;
    ctx.on_paint(h.makeGraphics());
    assert.ok(ctx.HB_BR_STAR.length > 0, 'All Songs hovered track exposes shared heart hitbox');
    assert.ok(ctx.HB_BR_TRDOTS.length > 0, 'All Songs hovered track exposes shared overflow hitbox');

    // Right-click in All Songs opens unified nv-track context menu
    const rOk = ctx.on_mouse_rbtn_up(ctx.px(ctx.mx), ctx.px(ctx.my));
    assert.strictEqual(rOk, true, 'Right-click on All Songs track is handled');
    assert.ok(ctx.ctxMenu && ctx.ctxMenu.kind === 'nv-track', 'Right-click in All Songs opens unified track menu');
    ctx.ctxMenu = null;
    ctx.mx = -1;
    ctx.my = -1;

    // Double-click in All Songs starts playback via unified LOCAL_SOURCE.play
    ctx.on_mouse_lbtn_dblclk(ctx.px((tr0.x0 + tr0.x1) / 2), ctx.px((tr0.y0 + tr0.y1) / 2));
    assert.ok(h.state.isPlaying && h.state.nowPlayingHandle === ctx.HB_BR_TR[0].info.song.h, 'Double-click plays All Songs track');

    // Normalize prompt opens and cancels cleanly
    const nzBtn = ctx.HB_RGNORM;
    ctx.on_mouse_lbtn_up((nzBtn.x0 + nzBtn.x1) / 2, (nzBtn.y0 + nzBtn.y1) / 2);
    assert.ok(ctx.rgPrompt && ctx.rgPrompt.n === lib.length, 'Clicking Normalize opens ReplayGain scan prompt');
    ctx.on_paint(h.makeGraphics());
    assert.ok(ctx.RG_HB && ctx.RG_HB.cancel);
    ctx.on_mouse_lbtn_up((ctx.RG_HB.cancel.x0 + ctx.RG_HB.cancel.x1) / 2, (ctx.RG_HB.cancel.y0 + ctx.RG_HB.cancel.y1) / 2);
    assert.strictEqual(ctx.rgPrompt, null);

    // Grouping modes ('album', 'artist', 'both') render in Dark & Light and artist banner clicks navigate to Browse artist
    for (const grp of ['album', 'artist', 'both']) {
      ctx.setSongsGroup(grp);
      for (const darkUi of [true, false]) {
        h.state.darkUi = darkUi;
        ctx.syncTheme();
        ctx.on_paint(h.makeGraphics());
        assert.ok(ctx.HB_BR_TR.length > 0, 'Grouped All Songs (' + grp + ') renders shared track rows');
      }
      if (grp === 'artist' || grp === 'both') {
        assert.ok(ctx.HB_BR_CARDS.some(c => c.kind === 'artist'), 'All Songs (' + grp + ') populates HB_BR_CARDS artist headers');
      }
    }
    const artCard = ctx.HB_BR_CARDS.find(c => c.kind === 'artist');
    ctx.on_mouse_lbtn_up((artCard.x0 + artCard.x1) / 2, (artCard.y0 + artCard.y1) / 2);
    assert.strictEqual(ctx.view, 'browse', 'Clicking All Songs artist header switches to browse view');
    assert.strictEqual(ctx.brView, 'artist', 'Clicking All Songs artist header opens artist page');
  }
}

module.exports = { run };
