'use strict';

const assert = require('assert');
const { createHarness } = require('../harness');

function run() {
  const h = createHarness({ verdantChrome: true, webViewAvailable: true });
  const { ctx, state, verdantChromeMock: web } = h;
  const last = type => web.webViewPosted.filter(message => message.type === type).at(-1);
  const send = (type, payload) => {
    web.webViewInbox.push({ ...payload, type });
    ctx.fsBridgePoll();
  };

  state.playlists[0].items = Array.from({ length: 260 }, (_, index) =>
    h.makeHandle('C:\\Music\\' + index + '.flac', { title: 'Local track ' + index, artist: 'Test artist' }));
  ctx.invalidateItems();
  ctx.webPreviewOpen();
  assert.ok(!web.webViewShowCalls.includes(true), 'Preserve classic UI while preview is initializing');
  web.WebViewReady = true;
  send('ready');
  for (let i = 0; i < 20; i++) {
    h.flushTimers();
    ctx.webPreviewSync();
    if (last('preview-list')?.count === 260) break;
  }
  const local = last('preview-list');
  assert.strictEqual(local.source, 'local');
  assert.strictEqual(local.count, 260);
  send('preview-page', { index: 100, revision: local.revision });
  const page = last('preview-page');
  assert.strictEqual(page.rows.length, 100);
  assert.strictEqual(page.rows[0].title, 'Local track 100');
  assert.ok(!JSON.stringify(page).includes('.flac'), 'Send display fields only');

  send('preview-play', { index: 104, revision: local.revision });
  assert.strictEqual(state.nowPlayingHandle, state.playlists[0].items[104], 'Play the selected track with shuffle on or off');
  ctx.on_playback_new_track();
  ctx.webPreviewSync();
  const playing = last('preview-playback');
  assert.strictEqual(playing.track.title, 'Local track 104');
  send('preview-seek', { time: 60, key: playing.track.key });
  assert.strictEqual(state.playbackTime, 60);
  send('preview-fullscreen');
  assert.strictEqual(last('init').track.key, playing.track.key);
  assert.ok(ctx.fsBridgeIsShowing());
  send('key', { code: 27 });
  assert.ok(ctx.webPreviewIsShowing(), 'Fullscreen returns to the WebView preview');

  ctx.NVData.playlistsLoaded = true;
  ctx.NVData.playlists = [{ id: 'demo-list', name: 'Cloud playlist' }];
  const songs = [{ id: 'remote-song', title: 'Cloud track', artist: 'Cloud artist', duration: 190 }];
  ctx.NVData.plDetails['demo-list'] = { meta: ctx.NVData.playlists[0], songs, loading: false, err: '' };
  send('preview-source', { source: 'navidrome' });
  const remote = last('preview-list');
  assert.strictEqual(remote.count, 1);
  assert.strictEqual(remote.source, 'navidrome');
  send('preview-play', { index: 0, revision: local.revision });
  assert.strictEqual(state.addTasks.length, 0, 'Drop a click from an earlier list revision');
  send('preview-page', { index: 0, revision: remote.revision });
  assert.strictEqual(last('preview-page').rows[0].title, 'Cloud track');
  send('preview-play', { index: 0, revision: remote.revision });
  assert.strictEqual(state.addTasks.length, 1);
  const request = state.addTasks[0];
  ctx.on_locations_added(request.tid, h.makeHandleList(request.urls.map(uri => h.makeHandle(uri, { title: 'Cloud track' }))));
  assert.strictEqual(ctx.nvTrackId(state.nowPlayingHandle.Path), 'remote-song');
  ctx.on_playback_new_track();
  ctx.webPreviewSync();
  assert.strictEqual(last('preview-playback').track.title, 'Cloud track');
  send('preview-fullscreen');
  assert.ok(last('init').lyrics.remote);
  assert.ok(!JSON.stringify(web.webViewPosted).includes('demo.example.invalid'), 'Keep streaming URLs outside the view');
  send('key', { code: 27 });

  web.webViewPosted.length = 0;
  send('ready');
  assert.ok(last('preview-open') && last('preview-list') && last('preview-playback'), 'Page reload receives a fresh snapshot');
  send('preview-close');
  assert.ok(!ctx.webPreview.active);
  assert.strictEqual(ctx.fsBridge.pollTimer, null);
  assert.strictEqual(ctx.fsBridge.syncTimer, null);

  ctx.webPreviewOpen();
  const song = h.makeHandle('C:\\Fixture\\Morning Train.flac', { title: 'Morning Train', artist: 'Test Artist' });
  state.libraryItems = [song];
  ctx.invalidateLibrary();
  send('preview-search', { query: 'Morning Train' });
  assert.strictEqual(last('preview-list').query, 'Morning Train');
  assert.strictEqual(last('preview-list').count, 1);
  send('key', { code: 32 });
  assert.ok(last('preview-space'), 'Route Space to the page so text fields can accept it');
  send('preview-enqueue', { revision:last('preview-list').revision, index:0 });
  assert.strictEqual(state.playbackQueue[0].Handle, song);
  send('preview-view', { mode:'queue' });
  const queue = last('preview-list');
  send('preview-page', { revision:queue.revision, index:0 });
  assert.strictEqual(last('preview-page').rows[0].kind, 'manual');
  send('preview-remove-queue', { revision:queue.revision, index:0 });
  assert.strictEqual(state.playbackQueue.length, 0);

  send('preview-view', { mode:'playlist' });
  const edit = (action, payload) => send('preview-edit', { revision:last('preview-list').revision, action, ...payload });
  edit('create', { name:'Preview editable' });
  const playlistId = Number(last('preview-list').selected);
  edit('rename', { name:'Preview renamed' });
  assert.strictEqual(state.playlists[playlistId].name, 'Preview renamed');
  send('preview-search', { query:'Morning Train' });
  edit('add', { index:0 });
  edit('add', { index:0 });
  assert.strictEqual(last('preview-result').reason, 'duplicate');
  assert.strictEqual(state.playlists[playlistId].items.length, 1);
  send('preview-view', { mode:'playlist' });
  for (let i = 0; i < 20 && last('preview-list').count !== 1; i++) {
    h.flushTimers();
    ctx.webPreviewSync();
  }
  edit('remove', { index:0 });
  assert.strictEqual(state.playlists[playlistId].items.length, 0);
  edit('delete');
  assert.ok(!state.playlists.some(p => p.name === 'Preview renamed'));

  send('preview-source', { source:'navidrome' });
  send('preview-search', { query:'Cloud track' });
  assert.strictEqual(last('preview-list').status, 'loading');
  assert.ok(h.flushOneHttp('query=Cloud%20track',200,{'subsonic-response':{status:'ok',searchResult3:{song:[{id:'cloud2',title:'Cloud track',duration:130}]}}}));
  ctx.webPreviewSync();
  assert.strictEqual(last('preview-list').count, 1);
  assert.strictEqual(last('preview-list').status, 'ready');
  edit('add', { index:0 });
  assert.ok(h.flushOneHttp('songIdToAdd=cloud2',200,{'subsonic-response':{status:'ok'}}));
  assert.ok(last('preview-result').ok);
  assert.ok(!JSON.stringify(web.webViewPosted).includes('demo.example.invalid'));
  send('preview-config', { theme:2,language:'zh-CN',sources:'local' });
  assert.strictEqual(last('preview-settings').language, 'zh-CN');
  assert.strictEqual(last('preview-settings').light, true);
  assert.strictEqual(last('preview-list').source, 'local');
  assert.strictEqual(state.props['Setup: music sources (local / both)'], 'local');

  const cold = createHarness({ verdantChrome: true, webViewAvailable: true });
  cold.ctx.webPreviewOpen();
  cold.flushTimers(8000);
  assert.ok(!cold.ctx.webPreview.active, 'Preview times out into the classic interface');
  assert.strictEqual(cold.ctx.fsBridge.pollTimer, null);
}

module.exports = { run };
