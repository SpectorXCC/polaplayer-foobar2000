'use strict';

const assert = require('assert');
const { createHarness } = require('../harness');

function rectsOverlap(a, b) {
  if (!a || !b || a.w <= 0 || a.h <= 0 || b.w <= 0 || b.h <= 0) return false;
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function run() {
  console.log('1. Pre-baked opaque fsBackdrop & zero per-frame 16-band gradient fills...');
  {
    const h = createHarness();
    const ctx = h.ctx;
    const state = h.state;
    const tr = h.makeHandle('C:\\Music\\Fs\\01.flac', { title: 'Backdrop Track', artist: 'Perf Artist' });
    state.nowPlayingHandle = tr;
    state.isPlaying = true;
    state.isPaused = false;
    state.playbackLength = 240;
    state.playbackTime = 12;
    ctx.updateNP();
    const ak = ctx.albKey(tr);
    ctx.artCache[ak] = h.makeImage(600, 600);
    ctx.npArtCache[ctx.nowArtKey(tr)] = ctx.artCache[ak];

    ctx.enterFullscreen();
    ctx.fsView = 'default';
    const gr1 = h.makeGraphics();
    ctx.on_paint(gr1);

    const bd = ctx.fsBackdrop;
    assert.ok(bd && !bd._disposed, 'fsBackdrop allocated upon entering fullscreen');
    assert.strictEqual(bd.Width, ctx.px(ctx.W), 'fsBackdrop width matches physical screen pixels');
    assert.strictEqual(bd.Height, ctx.px(ctx.H), 'fsBackdrop height matches physical screen pixels');
    assert.strictEqual(
      gr1.fillSolidRectCalls.filter(c => c.w >= ctx.px(ctx.W) && c.h >= ctx.px(ctx.H)).length,
      0,
      'Main fullscreen canvas blits baked backdrop instead of 16 per-frame full-screen fills'
    );

    const gr2 = h.makeGraphics();
    ctx.dirtyAll = true;
    ctx.on_paint(gr2);
    assert.strictEqual(ctx.fsBackdrop, bd, 'Repeated full paint reuses baked fsBackdrop without re-blurring');

    ctx.exitFullscreen();
    assert.strictEqual(bd._disposed, true, 'exitFullscreen disposes baked fsBackdrop');
  }

  console.log('2. Lyric line bitmap caching, viewport culling, LRU eviction, & partial scroll/hover repaints...');
  {
    const h = createHarness();
    const ctx = h.ctx;
    const state = h.state;
    const tr = h.makeHandle('C:\\Music\\Fs\\02.flac', { title: 'Lyrics Track', artist: 'Perf Artist' });
    state.nowPlayingHandle = tr;
    state.isPlaying = true;
    state.isPaused = false;
    state.playbackLength = 300;
    state.playbackTime = 0;
    ctx.updateNP();

    const lines = [];
    for (let i = 0; i < 80; i++) {
      lines.push({ t: i * 3, text: 'Verse line number ' + i + ' \u4e2d\u6587\u6b4c\u8bcd\u6d4b\u8bd5' });
    }
    ctx.enterFullscreen();
    ctx.fsView = 'lyrics';
    ctx.NV.key = ctx.nvTrackKey();
    ctx.NV.status = 'ready';
    ctx.NV.lyrics = { synced: true, lines };
    ctx.lyricsFor = tr.Path;
    ctx.lyrics = ctx.NV.lyrics;

    const grInit = h.makeGraphics();
    ctx.on_paint(grInit);

    const cachedInitial = ctx.fsLyBmpQueue.length;
    assert.ok(cachedInitial > 0 && cachedInitial < 40, 'Viewport culling only rasterizes visible lyric lines initially (got ' + cachedInitial + ')');
    assert.strictEqual(grInit.drawStringCalls.length, 0, 'Fullscreen lyrics use cached bitmaps instead of main-canvas DrawString');

    // Slight scroll stays within cached lines -> zero new bitmaps, partial RepaintRect only
    const grScroll = h.makeGraphics();
    const createdBeforeScroll = state.imgCreateCount;
    ctx.fsLy.scroll = 12;
    ctx.fsLy.target = 12;
    state.repaintFullCount = 0;
    state.repaintRectCalls.length = 0;
    ctx.repaintFsLyrics();
    // Calling a second time while dirtyFsLyrics is still pending must coalesce (no duplicate RepaintRect)
    ctx.repaintFsLyrics();
    assert.strictEqual(state.repaintFullCount, 0, 'Lyric scroll must NOT call window.Repaint()');
    assert.strictEqual(state.repaintRectCalls.length, 1, 'In-flight guard coalesces repeated lyric repaints');

    const topCountBefore = ctx.HB_FS_TOP.length;
    const ctrlCountBefore = ctx.HB_CTRL.length;
    ctx.on_paint(grScroll);
    assert.strictEqual(state.imgCreateCount, createdBeforeScroll, 'Warm scroll frame allocates zero new bitmaps');
    assert.strictEqual(grScroll.drawStringCalls.length, 0);
    assert.strictEqual(
      grScroll.fillSolidRectCalls.filter(c => c.w >= ctx.px(ctx.W)).length,
      0,
      'Partial lyric repaint never clears the full screen width'
    );
    assert.strictEqual(ctx.HB_FS_TOP.length, topCountBefore, 'Partial lyric repaint preserves top mode icon hitboxes');
    assert.strictEqual(ctx.HB_CTRL.length, ctrlCountBefore, 'Partial lyric repaint preserves transport control hitboxes');

    // Hovering across lyric lines uses partial RepaintRect on lyRect cleanly
    assert.ok(ctx.HB_FS_LY.length >= 2, 'Lyrics view records clickable seek hitboxes in HB_FS_LY');
    const l0 = ctx.HB_FS_LY[0];
    const l1 = ctx.HB_FS_LY[1];
    state.repaintFullCount = 0;
    state.repaintRectCalls.length = 0;
    ctx.on_mouse_move(ctx.px((l0.x0 + l0.x1) / 2), ctx.px((l0.y0 + l0.y1) / 2));
    assert.strictEqual(state.repaintFullCount, 0, 'Hovering a lyric line must NOT call window.Repaint()');
    assert.strictEqual(state.repaintRectCalls.length, 1, 'Hovering a lyric line emits single RepaintRect');
    ctx.on_paint(h.makeGraphics());

    state.repaintFullCount = 0;
    state.repaintRectCalls.length = 0;
    ctx.on_mouse_move(ctx.px((l1.x0 + l1.x1) / 2), ctx.px((l1.y0 + l1.y1) / 2));
    assert.strictEqual(state.repaintFullCount, 0);
    assert.strictEqual(state.repaintRectCalls.length, 1, 'Moving between two lyric lines coalesces into single lyRect RepaintRect');
    ctx.on_paint(h.makeGraphics());

    // Scroll through entire 80-line song -> verifies LRU eviction keeps <= FS_LY_BMP_CAP bitmaps alive
    for (let s = 0; s <= ctx.fsLy.max + 200; s += 260) {
      ctx.fsLy.manualUntil = Date.now() + 5000;
      ctx.fsLy.scroll = s;
      ctx.fsLy.target = s;
      ctx.repaintFsLyrics();
      ctx.on_paint(h.makeGraphics());
      assert.ok(ctx.fsLyBmpQueue.length <= ctx.FS_LY_BMP_CAP, 'Lyric bitmap LRU respects FS_LY_BMP_CAP=' + ctx.FS_LY_BMP_CAP);
    }

    // Settlement check: fsAnimTimer stops itself cleanly once scroll reaches target
    ctx.fsLy.scroll = 100;
    ctx.fsLy.target = 100.1;
    ctx.startFsAnim();
    assert.ok(ctx.fsAnimTimer !== null);
    state.mockNowMs += 8;
    ctx.fsAnimTick();
    assert.strictEqual(ctx.fsAnimTimer, null, 'fsAnimTimer stops cleanly once lyric scroll settles');

    // Exiting fullscreen disposes all cached lyric bitmaps + backdrop
    const liveBmps = ctx.fsLyBmpQueue.map(e => e.img);
    const dispBefore = state.imgDisposeCount;
    ctx.exitFullscreen();
    assert.strictEqual(ctx.fsLyBmpQueue.length, 0);
    assert.ok(state.imgDisposeCount >= dispBefore + liveBmps.length, 'exitFullscreen disposes every cached lyric bitmap');
    for (const img of liveBmps) assert.strictEqual(img._disposed, true);
  }

  console.log('3. Seek, controls, & top-icon disjoint regions + scoped partial repaints across layouts...');
  {
    const h = createHarness();
    const ctx = h.ctx;
    const state = h.state;
    const tr = h.makeHandle('C:\\Music\\Fs\\03.flac', { title: 'Controls Track', artist: 'Perf Artist' });
    state.nowPlayingHandle = tr;
    state.isPlaying = true;
    state.isPaused = false;
    state.playbackLength = 200;
    state.playbackTime = 50;
    ctx.updateNP();

    for (const [w, hh] of [[1440, 900], [800, 600]]) {
      h.sandbox.window.Width = ctx.px(w);
      h.sandbox.window.Height = ctx.px(hh);
      ctx.on_size(ctx.px(w), ctx.px(hh));

      ctx.enterFullscreen();
      ctx.fsView = 'lyrics';
      ctx.NV.key = ctx.nvTrackKey();
      ctx.NV.status = 'ready';
      ctx.NV.lyrics = { synced: true, lines: [{ t: 0, text: 'Alpha' }, { t: 30, text: 'Beta' }] };
      ctx.on_paint(h.makeGraphics());

      // Verify regions are mutually disjoint
      const lm = ctx.fsLayoutMetrics(h.makeGraphics());
      assert.ok(!rectsOverlap(lm.seekRect, lm.ctrlRect), `${w}x${hh}: seekRect & ctrlRect disjoint`);
      assert.ok(!rectsOverlap(lm.seekRect, lm.topRect), `${w}x${hh}: seekRect & topRect disjoint`);
      assert.ok(!rectsOverlap(lm.seekRect, lm.lyRect), `${w}x${hh}: seekRect & lyRect disjoint`);
      assert.ok(!rectsOverlap(lm.ctrlRect, lm.topRect), `${w}x${hh}: ctrlRect & topRect disjoint`);
      assert.ok(!rectsOverlap(lm.ctrlRect, lm.lyRect), `${w}x${hh}: ctrlRect & lyRect disjoint`);
      assert.ok(!rectsOverlap(lm.topRect, lm.lyRect), `${w}x${hh}: topRect & lyRect disjoint`);

      // 1Hz on_playback_time in fullscreen uses scoped seekRepaint
      state.repaintFullCount = 0;
      state.repaintRectCalls.length = 0;
      state.playbackTime = 51;
      ctx.on_playback_time();
      assert.strictEqual(state.repaintFullCount, 0, `${w}x${hh}: on_playback_time skips window.Repaint()`);
      assert.strictEqual(state.repaintRectCalls.length, 1);
      ctx.on_paint(h.makeGraphics());

      // Seeking drag (flush lbtn_down frame, then verify scoped RepaintRect + in-flight coalescing)
      const sb = ctx.HB_SEEK;
      assert.ok(sb);
      ctx.on_mouse_lbtn_down(ctx.px((sb.x0 + sb.x1) / 2), ctx.px((sb.y0 + sb.y1) / 2));
      assert.strictEqual(ctx.drag, 'seek');
      ctx.on_paint(h.makeGraphics());
      state.repaintFullCount = 0;
      state.repaintRectCalls.length = 0;
      ctx.on_mouse_move(ctx.px(sb.x0 + sb.w * 0.8), ctx.px((sb.y0 + sb.y1) / 2));
      ctx.on_mouse_move(ctx.px(sb.x0 + sb.w * 0.85), ctx.px((sb.y0 + sb.y1) / 2));
      assert.strictEqual(state.repaintFullCount, 0, 'Seeking drag never calls window.Repaint()');
      assert.strictEqual(state.repaintRectCalls.length, 1, 'Seeking drag coalesces pending RepaintRect');
      ctx.on_paint(h.makeGraphics());
      ctx.on_mouse_lbtn_up(ctx.px(sb.x0 + sb.w * 0.85), ctx.px((sb.y0 + sb.y1) / 2));
      assert.strictEqual(ctx.drag, null);
      ctx.on_paint(h.makeGraphics());

      // Hovering transport ctrl & top icons
      const cBtn = ctx.HB_CTRL[2];
      state.repaintFullCount = 0;
      state.repaintRectCalls.length = 0;
      ctx.on_mouse_move(ctx.px((cBtn.x0 + cBtn.x1) / 2), ctx.px((cBtn.y0 + cBtn.y1) / 2));
      assert.strictEqual(state.repaintFullCount, 0);
      assert.strictEqual(state.repaintRectCalls.length, 1);
      ctx.on_paint(h.makeGraphics());

      const tBtn = ctx.HB_FS_TOP[2];
      state.repaintFullCount = 0;
      state.repaintRectCalls.length = 0;
      ctx.on_mouse_move(ctx.px((tBtn.x0 + tBtn.x1) / 2), ctx.px((tBtn.y0 + tBtn.y1) / 2));
      assert.strictEqual(state.repaintFullCount, 0);
      assert.ok(state.repaintRectCalls.length >= 1);
      ctx.on_paint(h.makeGraphics());
      assert.strictEqual(ctx.HB_FS_TOP.length, 3);
      assert.strictEqual(ctx.HB_FS_LY.length, 2, 'Partial ctrl/top repaints leave HB_FS_LY intact');

      ctx.exitFullscreen();
    }
  }

  console.log('4. Visualizer tight bounding rect, 1Hz seek isolation, & background art warm-up guard...');
  {
    const h = createHarness();
    const ctx = h.ctx;
    const state = h.state;
    const tr = h.makeHandle('C:\\Music\\Fs\\04.flac', { title: 'Viz Track', artist: 'Perf Artist' });
    state.nowPlayingHandle = tr;
    state.isPlaying = true;
    state.isPaused = false;
    state.playbackLength = 200;
    state.playbackTime = 10;
    ctx.updateNP();

    ctx.enterFullscreen();
    ctx.setFsView('viz');
    ctx.on_paint(h.makeGraphics());

    for (const style of ['bars', 'radial']) {
      ctx.setVizStyle(style);
      ctx.on_paint(h.makeGraphics());
      const vr = ctx.vizDirtyRect();
      assert.ok(vr.w > 0 && vr.h > 0 && vr.w * vr.h < ctx.W * (ctx.H - 172 - ctx.VIZ_TOP), style + ' vizDirtyRect is tighter than full band');

      ctx.vizBars[0] = 0.8;
      state.repaintFullCount = 0;
      state.repaintRectCalls.length = 0;
      ctx.repaintViz();
      ctx.repaintViz(); // queued while dirtyViz already true
      assert.strictEqual(state.repaintFullCount, 0);
      assert.strictEqual(state.repaintRectCalls.length, 1, style + ' repaintViz coalesces in-flight frames');

      // 1Hz playback clock during viz must NOT trigger window.Repaint() or clobber dirtyViz
      state.playbackTime = 11;
      ctx.on_playback_time();
      assert.strictEqual(state.repaintFullCount, 0, style + ' 1Hz on_playback_time in viz uses partial seekRepaint only');
      assert.strictEqual(ctx.dirtyViz, true, style + ' on_playback_time preserves pending dirtyViz');

      const grPartialViz = h.makeGraphics();
      ctx.on_paint(grPartialViz);
      assert.strictEqual(ctx.dirtyViz, false);
      assert.strictEqual(
        grPartialViz.fillSolidRectCalls.filter(c => c.w >= ctx.px(ctx.W) && c.h >= ctx.px(ctx.H)).length,
        0,
        style + ' partial paint never fills whole screen'
      );
    }

    // Background library cover arrival in fullscreen must not spam repaints
    const repBefore = state.repaintCount;
    ctx.artWarmRepaint();
    h.flushTimers(60);
    h.flushTimers(260);
    assert.strictEqual(state.repaintCount, repBefore, 'artWarmRepaint is suppressed while in fullscreen');

    ctx.exitFullscreen();
  }

  console.log('5. High-DPI (150%/200%) exact RepaintRect vs partial blit parity & backdrop bicubic overscan...');
  {
    for (const [dpi, physW, physH] of [[144, 2560, 1440], [192, 3840, 2160]]) {
      const h = createHarness();
      const ctx = h.ctx;
      const state = h.state;
      h.sandbox.window.DPI = dpi;
      h.sandbox.window.Width = physW;
      h.sandbox.window.Height = physH;
      ctx.checkDisplay(true);
      assert.strictEqual(ctx.UISCALE, dpi / 96, `DPI ${dpi}: UISCALE active`);
      assert.strictEqual(ctx.px(ctx.W), physW, `DPI ${dpi}: physical width matches`);
      assert.strictEqual(ctx.px(ctx.H), physH, `DPI ${dpi}: physical height matches`);

      const tr = h.makeHandle('C:\\Music\\Fs\\05.flac', { title: 'HighDPI Track', artist: 'HighDPI Artist' });
      state.nowPlayingHandle = tr;
      state.isPlaying = true;
      state.isPaused = false;
      state.playbackLength = 220;
      state.playbackTime = 12;
      ctx.updateNP();
      const ak = ctx.albKey(tr);
      ctx.artCache[ak] = h.makeImage(800, 800);
      ctx.npArtCache[ctx.nowArtKey(tr)] = ctx.artCache[ak];

      // Simulate tall CJK font metrics (1.58x em height, differing from 1.35x estimate)
      function makeTallGraphics() {
        const g = h.makeGraphics();
        g.CalcTextHeight = (str, font) => Math.ceil((font && font.Size ? font.Size : 14) * 1.58);
        return g;
      }

      ctx.enterFullscreen();
      ctx.fsView = 'lyrics';
      ctx.NV.key = ctx.nvTrackKey();
      ctx.NV.status = 'ready';
      ctx.NV.lyrics = { synced: true, lines: [{ t: 0, text: 'Line 1' }, { t: 10, text: 'Line 2' }] };

      // Verify !gr fallback itself stays in DIPs (never double-multiplies by UISCALE)
      const lmEst = ctx.fsLayoutMetrics();
      assert.ok(lmEst.titleH <= 50 && lmEst.artistH <= 38,
        `DPI ${dpi}: !gr fallback titleH/artistH stay in DIPs (got ${lmEst.titleH}/${lmEst.artistH})`);

      // Before first full paint, partial repaint requests must safely fall back to repaintAll()
      state.repaintFullCount = 0;
      state.repaintRectCalls.length = 0;
      ctx.repaintFsSeek();
      assert.strictEqual(state.repaintFullCount, 1, `DPI ${dpi}: pre-paint repaintFsSeek falls back to repaintAll`);
      assert.strictEqual(state.repaintRectCalls.length, 0);

      // Full paint caches exact gr-measured metrics & overscanned backdrop
      const grFull = makeTallGraphics();
      ctx.on_paint(grFull);
      const bd = ctx.fsBackdrop;
      assert.ok(bd && bd._drawOps && bd._drawOps.length === 1, `DPI ${dpi}: fsBackdrop baked from cover`);
      const op = bd._drawOps[0];
      assert.ok(op.x < 0 && op.y < 0 && op.x + op.w > bd.Width && op.y + op.h > bd.Height,
        `DPI ${dpi}: fsBackdrop overscans blur beyond dst bounds to avoid bicubic edge halo`);

      const lmWithGr = ctx.fsLayoutMetrics(makeTallGraphics());
      const lmCached = ctx.fsLayoutMetrics();
      assert.deepStrictEqual(lmCached.seekRect, lmWithGr.seekRect, `DPI ${dpi}: seekRect exact match with/without gr`);
      assert.deepStrictEqual(lmCached.ctrlRect, lmWithGr.ctrlRect, `DPI ${dpi}: ctrlRect exact match with/without gr`);
      assert.deepStrictEqual(lmCached.topRect, lmWithGr.topRect, `DPI ${dpi}: topRect exact match with/without gr`);
      assert.deepStrictEqual(lmCached.lyRect, lmWithGr.lyRect, `DPI ${dpi}: lyRect exact match with/without gr`);

      // Verify hitboxes sit completely inside their painted regions
      assert.ok(ctx.HB_SEEK.x0 >= lmCached.seekRect.x && ctx.HB_SEEK.x1 <= lmCached.seekRect.x + lmCached.seekRect.w);
      assert.ok(ctx.HB_SEEK.y0 >= lmCached.seekRect.y && ctx.HB_SEEK.y1 <= lmCached.seekRect.y + lmCached.seekRect.h);
      for (const b of ctx.HB_CTRL) {
        assert.ok(b.x0 >= lmCached.ctrlRect.x && b.x1 <= lmCached.ctrlRect.x + lmCached.ctrlRect.w);
        assert.ok(b.y0 >= lmCached.ctrlRect.y && b.y1 <= lmCached.ctrlRect.y + lmCached.ctrlRect.h);
      }
      assert.ok(ctx.HB_VOL.x0 >= lmCached.ctrlRect.x && ctx.HB_VOL.x1 <= lmCached.ctrlRect.x + lmCached.ctrlRect.w);
      assert.ok(ctx.HB_VOL.y0 >= lmCached.ctrlRect.y && ctx.HB_VOL.y1 <= lmCached.ctrlRect.y + lmCached.ctrlRect.h);

      // Every partial RepaintRect MUST equal the exact physical rect blitted from fsBackdrop in on_paint
      for (const [label, trigger] of [
        ['seek', () => ctx.repaintFsSeek()],
        ['ctrl', () => ctx.repaintFsCtrl()],
        ['top', () => ctx.repaintFsTop()],
        ['lyrics', () => ctx.repaintFsLyrics()]
      ]) {
        state.repaintFullCount = 0;
        state.repaintRectCalls.length = 0;
        trigger();
        assert.strictEqual(state.repaintFullCount, 0, `DPI ${dpi} ${label}: uses partial RepaintRect`);
        assert.strictEqual(state.repaintRectCalls.length, 1, `DPI ${dpi} ${label}: emits 1 RepaintRect`);
        const rr = state.repaintRectCalls[0];
        const grPart = makeTallGraphics();
        ctx.on_paint(grPart);
        const blitOp = grPart.drawImageCalls.find(c => c.imW === bd.Width && c.imH === bd.Height);
        assert.ok(blitOp, `DPI ${dpi} ${label}: partial paint blits from fsBackdrop`);
        assert.deepStrictEqual(
          { x: blitOp.x, y: blitOp.y, w: blitOp.w, h: blitOp.h },
          { x: rr.x, y: rr.y, w: rr.w, h: rr.h },
          `DPI ${dpi} ${label}: blitted backdrop rect must match RepaintRect bit-for-bit`
        );
      }

      // on_size invalidates fsMetricsCache so stale rects cannot survive resize
      h.sandbox.window.Width = Math.round(physW * 0.75);
      h.sandbox.window.Height = Math.round(physH * 0.75);
      ctx.on_size(h.sandbox.window.Width, h.sandbox.window.Height);
      assert.strictEqual(ctx.fsCachedMetrics(), null, `DPI ${dpi}: on_size clears fsMetricsCache`);

      ctx.exitFullscreen();
    }
  }
}

module.exports = { run };
