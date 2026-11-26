'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createHarness } = require('../harness');

function run() {
  console.log('1. Fallback to GDI+ fullscreen when WebView2 is unavailable or forced to gdi...');
  {
    const hNoChrome = createHarness();
    assert.strictEqual(hNoChrome.ctx.fsWantWebView(), false, 'Without Verdant.Chrome, WebView2 is disabled');

    const hNoWv = createHarness({ verdantChrome: true, webViewAvailable: false });
    assert.strictEqual(hNoWv.ctx.fsWantWebView(), false, 'Without WebView2 runtime/loader, WebView2 is disabled');

    const hForcedGdi = createHarness({
      verdantChrome: true,
      webViewAvailable: true,
      props: { 'Fullscreen: renderer (auto / webview / gdi)': 'gdi' }
    });
    assert.strictEqual(hForcedGdi.ctx.fsWantWebView(), false, 'Fullscreen: renderer = gdi forces GDI+ fallback');
  }

  console.log('Use the native DLL-relative asset lookup when JS cannot resolve the script path...');
  {
    const h = createHarness({ verdantChrome: true, webViewAvailable: true });
    h.ctx.FS_BRIDGE_FILE = '';
    assert.strictEqual(h.ctx.fsWebAppDir(), '', 'No web bundle is installed under the mock profile');
    h.ctx.enterFullscreen();
    assert.strictEqual(h.verdantChromeMock.webViewInitCalls.length, 1, 'Native host may resolve assets beside its DLL');
    assert.strictEqual(h.ctx.fsBridgeIsShowing(), false, 'Keep GDI+ visible until native assets initialize');
  }

  console.log('2. Lazy WebView2 init -> GDI+ fallback until ready -> reveal + cover/lyrics/playback sync...');
  {
    const h = createHarness({ verdantChrome: true, webViewAvailable: true });
    const { ctx, verdantChromeMock: wv } = h;
    ctx.enterFullscreen();
    h.flushTimers(8000);
    assert.strictEqual(ctx.fsBridge.pollTimer, null);
    assert.strictEqual(ctx.fsBridgeIsShowing(), false);
    assert.strictEqual(wv.webViewDestroyCalls, 1);
    assert.notStrictEqual(ctx.fsClock, null);
    ctx.exitFullscreen();
    ctx.enterFullscreen();
    assert.strictEqual(wv.webViewInitCalls.length, 2);
    wv.WebViewPostMessage = () => false;
    wv.webViewInbox.push({ type: 'ready' });
    ctx.fsBridgePoll();
    assert.ok(!wv.webViewShowCalls.includes(true));
    assert.strictEqual(ctx.fsBridge.pollTimer, null);
  }
  {
    const h = createHarness({ verdantChrome: true, webViewAvailable: true });
    const ctx = h.ctx;
    const state = h.state;
    const wv = h.verdantChromeMock;

    const tr = h.makeHandle('C:\\Music\\WebView\\01.flac', { title: 'Test Song', artist: 'Test Artist' });
    state.nowPlayingHandle = tr;
    state.isPlaying = true;
    state.isPaused = false;
    state.playbackLength = 210;
    state.playbackTime = 14;
    ctx.updateNP();

    const ak = ctx.albKey(tr);
    ctx.artCache[ak] = h.makeImage(1000, 750);
    ctx.npArtCache[ctx.nowArtKey(tr)] = ctx.artCache[ak];

    ctx.NV.key = ctx.nvTrackKey();
    ctx.NV.status = 'ready';
    ctx.NV.lyrics = {
      synced: true,
      lines: [
        { t: 5, text: 'Hello world\n你好世界' },
        { t: 18, text: 'Second line' }
      ]
    };

    assert.strictEqual(wv.webViewInitCalls.length, 0, 'WebView2 must NOT initialize at startup before fullscreen');

    ctx.enterFullscreen();
    assert.strictEqual(wv.webViewInitCalls.length, 1, 'enterFullscreen triggers lazy WebViewInit');
    assert.strictEqual(ctx.fsBridgeIsShowing(), false, 'While warming up asynchronously, GDI+ remains active');
    assert.ok(ctx.fsClock !== null, 'GDI+ fsClock still ticks before WebView ready arrives');

    // GDI+ renders normally until ready arrives
    const grWarm = h.makeGraphics();
    ctx.on_paint(grWarm);
    assert.ok(ctx.fsBackdrop, 'GDI+ backdrop renders during warm-up');

    // Simulate WebView2 posting { type: "ready" }
    wv.WebViewReady = true;
    wv.webViewInbox.push({ type: 'ready' });
    ctx.fsBridgePoll();

    assert.strictEqual(ctx.fsBridgeIsShowing(), true, 'Once ready, WebView2 takes over fullscreen');
    assert.strictEqual(wv.webViewShowCalls[wv.webViewShowCalls.length - 1], true, 'WebViewShow(1) called');
    assert.strictEqual(ctx.fsClock, null, 'GDI+ fsClock stops while WebView2 is active');

    const initMsg = wv.webViewPosted.find(m => m.type === 'init');
    assert.ok(initMsg, 'init payload posted on reveal');
    assert.strictEqual(initMsg.track.title, 'Test Song');
    assert.ok(
      initMsg.track.coverUrl.startsWith('https://cache.verdant.local/cover_'),
      'Cover exported via virtual host cache URL'
    );
    const exportedFile = path.join(
      h.MOCK_PROFILE,
      'verdant-cache',
      'fs-art',
      initMsg.track.coverUrl.split('/').pop().split('?')[0]
    );
    assert.ok(fs.existsSync(exportedFile), 'Exported PNG file written to verdant-cache/fs-art');
    assert.strictEqual(initMsg.lyrics.model.synced, true);
    assert.strictEqual(initMsg.lyrics.model.lines.length, 2);

    // GDI+ skips painting behind active WebView2
    state.repaintCount = 0;
    ctx.on_playback_time();
    assert.strictEqual(state.repaintCount, 0, '1Hz on_playback_time skips GDI+ RepaintRect when WebView2 active');

    const grSkipped = h.makeGraphics();
    ctx.dirtyAll = true;
    ctx.on_paint(grSkipped);
    assert.strictEqual(grSkipped.drawImageCalls.length, 0, 'on_paint skips GDI+ work under active WebView2');
    assert.strictEqual(ctx.dirtyAll, false, 'on_paint clears dirty flags even when skipped');

    // Track switch alternates 2 cover slots (cover_0 / cover_1) and pushes track + lyrics + playback
    const tr2 = h.makeHandle('https://example.invalid/rest/stream.view?id=2&apiKey=synthetic-secret', { title: 'Track Two', artist: 'Artist Two' });
    state.nowPlayingHandle = tr2;
    state.playbackTime = 0;
    ctx.artCache[ctx.albKey(tr2)] = h.makeImage(600, 600);
    ctx.npArtCache[ctx.nowArtKey(tr2)] = ctx.artCache[ctx.albKey(tr2)];
    wv.webViewPosted.length = 0;
    ctx.on_playback_new_track();
    const trMsg = wv.webViewPosted.find(m => m.type === 'track');
    assert.ok(trMsg && trMsg.track.title === 'Track Two', 'Track change pushed to WebView2');
    assert.ok(Number.isSafeInteger(trMsg.track.key) && trMsg.track.key !== initMsg.track.key);
    assert.ok(!JSON.stringify(wv.webViewPosted).includes('synthetic-secret'));
    assert.strictEqual(wv.webViewPosted.find(m => m.type === 'lyrics').lyrics.model, null);
    assert.match(wv.webViewInitCalls[0].cacheDir, /[\\/]fs-art[\\/]?$/);
    assert.notStrictEqual(trMsg.track.coverUrl.split('?')[0], initMsg.track.coverUrl.split('?')[0], 'Alternates 2-slot cover filename');

    // Inbound seek, volume, volumeDelta, viz <-> lyrics hybrid handoff, Esc exit, and unload destroy
    wv.webViewInbox.push({ type: 'seek', key: trMsg.track.key, time: 42.5 });
    wv.webViewInbox.push({ type: 'seek', key: initMsg.track.key, time: 1 });
    wv.webViewInbox.push({ type: 'volume', pos: 0.5 });
    wv.webViewInbox.push({ type: 'volumeDelta', step: 1 });
    ctx.fsBridgePoll();
    assert.strictEqual(state.seekTo, 42.5, 'Inbound WebView seek updates fb.PlaybackTime');
    assert.ok(Math.abs(ctx.vol2pos(state.volumeDb) - 0.54) < 0.01, 'Inbound volume + volumeDelta update fb.Volume');

    // Hybrid visualizer handoff hides WebView2 and starts GDI+ viz
    wv.webViewInbox.push({ type: 'fsAct', act: 'viz' });
    ctx.fsBridgePoll();
    assert.strictEqual(ctx.fsView, 'viz');
    assert.strictEqual(ctx.fsBridgeIsShowing(), false);
    assert.strictEqual(wv.webViewShowCalls[wv.webViewShowCalls.length - 1], false, 'Switching to viz hides WebView2');
    assert.ok(ctx.vizTimer !== null, 'Native GDI+ vizTimer starts on viz handoff');

    // Switching back to lyrics reveals cached WebView2 immediately and stops viz
    ctx.setFsView('lyrics');
    assert.strictEqual(ctx.fsView, 'lyrics');
    assert.strictEqual(ctx.vizTimer, null);
    assert.strictEqual(ctx.fsBridgeIsShowing(), true);
    assert.strictEqual(wv.webViewShowCalls[wv.webViewShowCalls.length - 1], true, 'Switching back reveals WebView2 immediately');

    // Esc key from WebView2 exits fullscreen and hides WebView2
    wv.webViewInbox.push({ type: 'key', code: 27 });
    ctx.fsBridgePoll();
    assert.strictEqual(ctx.fsMode, false);
    assert.strictEqual(ctx.fsBridgeIsShowing(), false);
    assert.strictEqual(wv.webViewShowCalls[wv.webViewShowCalls.length - 1], false);

    ctx.on_script_unload();
    assert.strictEqual(wv.webViewDestroyCalls, 1, 'on_script_unload destroys native WebView2');
  }
}

module.exports = { run };
