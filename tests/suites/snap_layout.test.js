'use strict';

const assert = require('assert');
const { createHarness } = require('../harness');

function run() {
  console.log('1. Fallback UIWizard frame style, limits, & removed Window properties...');
  const hDefault = createHarness();
  const c1 = hDefault.ctx;
  assert.strictEqual(c1.WIN_NATIVE_CHROME, undefined, 'Window: native chrome property is no longer registered');
  assert.strictEqual(c1.WIN_FRAME_STYLE, undefined, 'Window: frame style property is no longer registered');
  assert.strictEqual(hDefault.uiWizardMock.FrameStyle, 2, 'Fallback FrameStyle should be 2 (no caption, snap-capable border)');
  assert.strictEqual(c1.TBH, 32, 'Custom title bar remains active');
  assert.ok(hDefault.uiWizardMock.sizeLimitsCalls.length >= 1, 'SetWindowSizeLimits applied at startup');
  assert.strictEqual(hDefault.uiWizardMock.sizeLimitsCalls[0].minW, 360, 'Minimum width lowered to 360px');
  assert.strictEqual(hDefault.uiWizardMock.sizeLimitsCalls[0].minH, 320, 'Minimum height lowered to 320px');

  hDefault.uiWizardMock.FrameStyle = 3;
  c1.on_size(960, 520);
  assert.strictEqual(hDefault.uiWizardMock.FrameStyle, 3, 'Subsequent resize does not overwrite user/live FrameStyle');

  console.log('2. Snap quick menu via snap button & maximize right-click...');
  c1.on_size(640, 380);
  c1.on_paint(hDefault.makeGraphics());
  assert.ok(c1.HB_CAP && c1.HB_CAP.hasSnap, 'Title bar shows snap quick button');
  assert.ok(c1.HB_NAVDRAWER, 'Narrow window shows title-bar nav drawer button');

  assert.strictEqual(
    c1.on_mouse_rbtn_up(c1.px(c1.HB_CAP.maxX + 4), c1.px(10)),
    true,
    'Right-clicking maximize button opens snap layout menu'
  );
  assert.ok(c1.ctxMenu && c1.ctxMenu.kind === 'snap', 'ctxMenu kind is snap');
  c1.on_paint(hDefault.makeGraphics());
  assert.strictEqual(
    c1.CTX_HB.length,
    10,
    'All 10 snap menu actions (1/2, 1/3, 1/4, maximize) fit without truncation even at H=380'
  );

  // Trigger left 1/3 snap preset
  const thirdLeft = c1.CTX_HB.find(it => it.act === 'snap:t-l');
  assert.ok(thirdLeft, 'snap:t-l menu item exists');
  c1.on_mouse_lbtn_up(c1.px(thirdLeft.x0 + 4), c1.px(thirdLeft.y0 + 4));
  assert.strictEqual(c1.ctxMenu, null, 'Snap menu closes after selection');
  assert.ok(hDefault.uiWizardMock.posCalls.length > 0 && hDefault.uiWizardMock.sizeCalls.length > 0, 'Snap preset sets window position and size');
  const lastSize = hDefault.uiWizardMock.sizeCalls[hDefault.uiWizardMock.sizeCalls.length - 1];
  assert.strictEqual(lastSize.w, Math.round(2560 / 3), 'Left 1/3 width matches 1/3 of screen width');

  console.log('3. Split-screen matrix geometry & view render safety (1/2, 1/3, 1/4)...');
  const sizes = [
    { name: '1080p 1/2', w: 960, h: 1040, navDrawer: false },
    { name: '2.5K@150% 1/2', w: 853, h: 1018, navDrawer: false },
    { name: '1080p 1/3', w: 640, h: 1040, navDrawer: true },
    { name: '2.5K@150% 1/3', w: 569, h: 1018, navDrawer: true },
    { name: 'narrow 1/4 col', w: 480, h: 1040, navDrawer: true },
    { name: '1080p 1/4', w: 960, h: 520, navDrawer: false },
    { name: '2.5K@150% 1/4', w: 853, h: 509, navDrawer: false },
    { name: '2.5K@200% 1/4', w: 640, h: 380, navDrawer: true }
  ];

  // Seed some local & browse data
  hDefault.state.libraryItems = [
    hDefault.makeHandle('C:\\Music\\a.flac', { title: 'Track A', artist: 'Artist A', album: 'Album A', lengthSec: 200 })
  ];
  hDefault.state.playlists[0].items = [hDefault.state.libraryItems[0]];

  for (const s of sizes) {
    c1.on_size(s.w, s.h);
    assert.strictEqual(c1.R.navDrawer, s.navDrawer, s.name + ' R.navDrawer mismatch');
    assert.strictEqual(c1.R.drawer, true, s.name + ' queue drawer active below 1120');
    assert.strictEqual(c1.R.barY + c1.M.barH, s.h, s.name + ' bar docks cleanly at bottom');
    assert.ok(c1.R.main.w > 200 && c1.R.main.h > 100, s.name + ' main panel keeps healthy area');
    if (s.navDrawer) {
      assert.strictEqual(c1.R.main.w, s.w - c1.M.gap * 2, s.name + ' main spans full width when nav is collapsed');
    }

    // Test local views (unified browse + songs + search)
    for (const bv of ['home', 'albums', 'artists', 'playlist', 'album', 'artist', 'starred', 'random']) {
      c1.libSource = 'local';
      c1.view = 'browse';
      c1.brView = bv;
      if (bv === 'playlist') { c1.brViewId = '0'; c1.brViewTitle = 'Mix'; }
      else if (bv === 'album') { c1.brViewId = 'Local Artist - Local Album'; c1.brViewTitle = 'Local Album'; }
      else if (bv === 'artist') { c1.brViewId = 'Local Artist'; c1.brViewTitle = 'Local Artist'; }
      else { c1.brViewId = ''; c1.brViewTitle = ''; }
      c1.on_paint(hDefault.makeGraphics());
      assert.ok(c1.HB_SEEK && c1.HB_SEEK.x0 >= 80 && c1.HB_SEEK.x1 <= s.w - 40, s.name + ' seek bar stays inside transport area on local browse:' + bv);
    }
    for (const v of ['songs', 'search']) {
      c1.libSource = 'local';
      c1.view = v;
      c1.on_paint(hDefault.makeGraphics());
      assert.ok(c1.HB_SEEK && c1.HB_SEEK.x0 >= 80 && c1.HB_SEEK.x1 <= s.w - 40, s.name + ' seek bar stays inside transport area on ' + v);
    }

    // Test nav drawer open/auto-close on narrow screen
    if (s.navDrawer) {
      c1.toggleNavDrawer();
      assert.strictEqual(c1.navDrawerOpen, true, s.name + ' nav drawer opens');
      c1.on_paint(hDefault.makeGraphics());
      assert.ok(c1.HB_HOME, s.name + ' nav drawer renders HB_HOME when open');
      c1.on_mouse_lbtn_up(c1.px(c1.HB_HOME.x0 + 4), c1.px(c1.HB_HOME.y0 + 4));
      assert.strictEqual(c1.navDrawerOpen, false, s.name + ' clicking nav item closes drawer');
    }

    // Test queue drawer in short screen
    c1.toggleQueueDrawer();
    c1.on_paint(hDefault.makeGraphics());
    assert.ok(c1.R.queue.x >= 0 && c1.R.queue.y + c1.R.queue.h <= c1.R.barY, s.name + ' queue drawer stays within bounds');
    c1.dismissQueueDrawer();
  }

  console.log('4. Browse views boundary safety in narrow (480x1040) and short (640x380) splits...');
  const brSong = { id: 's1', title: 'Song One', artist: 'Artist One', artistId: 'ar1', album: 'Album One', albumId: 'al1', duration: 180, track: 1, coverArt: 'al1', src: 'navidrome' };
  const brAlb = { id: 'al1', name: 'Album One', artist: 'Artist One', artistId: 'ar1', year: '2024', songCount: 1, duration: 180, coverArt: 'al1' };
  const brArt = { id: 'ar1', name: 'Artist One', albumCount: 1, coverArt: 'ar1' };
  const brPl = { id: 'pl1', name: 'My Playlist', songCount: 1, duration: 180, coverArt: 'pl1' };
  c1.NVData.playlists = [brPl]; c1.NVData.playlistsLoaded = true; c1.NVData.playlistsLoading = false; c1.NVData.error = '';
  c1.NVData.albumsByTab.recent = { list: [brAlb], loading: false, err: '', hasMore: false, ts: Date.now() };
  c1.NVData.artists = [brArt]; c1.NVData.artistsLoaded = true;
  c1.NVData.plDetails.pl1 = { meta: brPl, songs: [brSong], loading: false, err: '' };
  c1.NVData.albumDetails.al1 = { meta: brAlb, songs: [brSong], loading: false, err: '' };
  c1.NVData.artistDetails.ar1 = { meta: brArt, albums: [brAlb], topSongs: [brSong], loading: false, err: '' };
  c1.NVData.starred = { songs: [brSong], albums: [brAlb], artists: [brArt], loaded: true, loading: false, err: '', ts: Date.now() };
  c1.NVData.randomMix = { songs: [brSong], loading: false, err: '' };
  c1.libSource = 'navidrome';
  c1.view = 'browse';

  for (const dim of [{ w: 480, h: 1040 }, { w: 640, h: 380 }]) {
    c1.on_size(dim.w, dim.h);
    const pages = [
      { v: 'home', id: '' },
      { v: 'albums', id: 'recent' },
      { v: 'artists', id: '' },
      { v: 'playlist', id: 'pl1' },
      { v: 'album', id: 'al1' },
      { v: 'artist', id: 'ar1' },
      { v: 'starred', id: '' },
      { v: 'random', id: '' }
    ];
    for (const p of pages) {
      c1.brView = p.v; c1.brViewId = p.id;
      c1.on_paint(hDefault.makeGraphics());
      const maxX = c1.R.main.x + c1.R.main.w;
      for (const b of c1.HB_BR_BTN) {
        assert.ok(b.x0 >= c1.R.main.x && b.x1 <= maxX, `${dim.w}x${dim.h} browse ${p.v} button "${b.act}" exceeds main panel bounds (${b.x0}..${b.x1} vs ${c1.R.main.x}..${maxX})`);
      }
    }
  }

  console.log('5. Verdant.Chrome native Snap Layouts integration, UIWizard handoff & theme sync...');
  const hChrome = createHarness({ verdantChrome: true });
  const cChr = hChrome.ctx;
  assert.strictEqual(cChr.chromeAttached, true, 'Verdant.Chrome attaches at startup');
  assert.strictEqual(cChr.TBH, 32, 'Custom title bar stays active with Verdant.Chrome');
  assert.strictEqual(hChrome.uiWizardMock.FrameStyle, 0, 'UIWizard.FrameStyle is neutralized to 0 when Verdant.Chrome is active');
  assert.deepStrictEqual(
    hChrome.uiWizardMock.captionCalls,
    [{ x: 0, y: 0, w: 0, h: 0 }],
    'UIWizard.SetCaptionAreaSize is cleared once before Verdant.Chrome takes over'
  );
  assert.ok(hChrome.verdantChromeMock.themeCalls.length >= 1, 'Verdant.Chrome receives initial SetTheme on attach');
  assert.deepStrictEqual(
    hChrome.verdantChromeMock.themeCalls[0],
    { isDark: 1, canvasRef: 0x000000, borderRef: 0x002a2a2a },
    'Dark mode theme colors converted cleanly to Win32 COLORREF'
  );

  hChrome.state.darkUi = false;
  cChr.on_colours_changed();
  const lastTheme = hChrome.verdantChromeMock.themeCalls[hChrome.verdantChromeMock.themeCalls.length - 1];
  assert.deepStrictEqual(
    lastTheme,
    { isDark: 0, canvasRef: 0x00ece8e8, borderRef: 0x00cec8c8 },
    'Light mode switch forwards exact Win32 COLORREF values to Verdant.Chrome'
  );

  cChr.on_size(960, 520);
  cChr.on_paint(hChrome.makeGraphics());
  assert.ok(cChr.HB_CAP && cChr.HB_CAP.hasSnap === false, 'Extra snap button is hidden when Verdant.Chrome handles Win11 native Snap Layouts');
  assert.ok(hChrome.verdantChromeMock.metricsCalls.length > 0, 'Verdant.Chrome receives SetChromeMetrics');
  const lastM = hChrome.verdantChromeMock.metricsCalls[hChrome.verdantChromeMock.metricsCalls.length - 1];
  assert.strictEqual(lastM.mx, cChr.px(960 - cChr.CAPBW * 2), 'maxBtnRect aligns with custom maximize button X');
  assert.strictEqual(lastM.mw, cChr.px(cChr.CAPBW), 'maxBtnRect aligns with CAPBW');
  assert.strictEqual(lastM.minW, 360, 'Minimum width forwarded to Verdant.Chrome');
  assert.strictEqual(lastM.minH, 320, 'Minimum height forwarded to Verdant.Chrome');

  hChrome.flushTimers(350);
  assert.strictEqual(hChrome.verdantChromeMock.attachCalls, 2, 'Native chrome is reattached once after host startup');
  assert.strictEqual(hChrome.uiWizardMock.FrameStyle, 0, 'Reattachment neutralizes the host frame');

  hChrome.verdantChromeMock.MaxButtonHot = true;
  hChrome.flushTimers(50);
  assert.strictEqual(cChr.chromeMaxHot, true, 'Native maximum-button hover reaches the drawn title bar without child mouse messages');
  hChrome.verdantChromeMock.MaxButtonHot = false;
  hChrome.flushTimers(50);
  assert.strictEqual(cChr.chromeMaxHot, false, 'Leaving the maximum button clears its hover');

  const blankX = cChr.px((cChr.MENU_END + cChr.CAP_LEFT) / 2);
  const titleY = cChr.px(16);
  cChr.on_mouse_lbtn_dblclk(blankX,titleY);
  assert.strictEqual(hChrome.verdantChromeMock.WindowState, 0, 'Client fallback waits for double-click release');
  cChr.on_mouse_lbtn_up(blankX,titleY);
  assert.strictEqual(hChrome.verdantChromeMock.WindowState, 1, 'Client fallback toggles on the release of a caption double-click');
  cChr.on_mouse_lbtn_dblclk(blankX,titleY);
  cChr.on_mouse_lbtn_up(blankX,titleY+100);
  assert.strictEqual(hChrome.verdantChromeMock.WindowState, 1, 'Release outside the caption does not toggle');
  cChr.on_mouse_lbtn_up(cChr.px(cChr.HB_CAP.maxX+4),titleY);
  assert.strictEqual(hChrome.verdantChromeMock.WindowState, 0, 'Client max-button fallback still restores');

  cChr.UISCALE=1.25; cChr.W=959.2; cChr.capW=-1; cChr.applyCaption();
  const fractional=hChrome.verdantChromeMock.metricsCalls.slice(-1)[0];
  assert.strictEqual(fractional.mx+fractional.mw,cChr.px(cChr.W-cChr.CAPBW), 'Fractional DPI maximum-button right edge aligns with drawing');

  cChr.on_script_unload();
  assert.strictEqual(hChrome.verdantChromeMock.detachCalls, 1, 'Verdant.Chrome Detach() called on script unload');
  assert.strictEqual(cChr.chromeHoverTimer, null, 'Native hover watcher stops at unload');

  const hRetry = createHarness({ verdantChrome: true, verdantChromeAttachFails: true });
  assert.strictEqual(hRetry.ctx.chromeAttached, false, 'chromeAttached remains false when transient Attach fails');
  assert.strictEqual(hRetry.uiWizardMock.FrameStyle, 0, 'Never falls back to UIWizard.FrameStyle=2 when Verdant.Chrome is enabled');
  hRetry.ctx.on_script_unload();

  console.log('6. Closing Verdant retains the custom frame until the host is destroyed...');
  const hExit=createHarness({verdantChrome:true});
  const cExit=hExit.ctx;
  cExit.on_size(960,520);
  cExit.on_paint(hExit.makeGraphics());
  cExit.on_mouse_lbtn_up(cExit.px(cExit.HB_CAP.closeX+12),cExit.px(16));
  assert.strictEqual(hExit.state.exitCalls,1,'X still requests ordinary foobar exit');
  cExit.on_script_unload();
  assert.strictEqual(hExit.verdantChromeMock.detachCalls,0,'Exit must not restore the native frame');
  assert.strictEqual(hExit.verdantChromeMock.exitDetachCalls,1,'Exit uses the lifetime-safe release path');

  const hCancel=createHarness({verdantChrome:true});
  const cCancel=hCancel.ctx;
  cCancel.on_size(960,520);
  cCancel.on_paint(hCancel.makeGraphics());
  cCancel.on_mouse_lbtn_up(cCancel.px(cCancel.HB_CAP.closeX+12),cCancel.px(16));
  cCancel.on_mouse_lbtn_down(cCancel.px(40),cCancel.px(80));
  cCancel.on_script_unload();
  assert.strictEqual(hCancel.verdantChromeMock.detachCalls,1,'Further input after a cancelled exit restores ordinary reload behavior');
}

module.exports = { run };
