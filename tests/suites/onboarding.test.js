'use strict';

const assert = require('assert');
const { createHarness } = require('../harness');

function press(h, action) {
  const c = h.ctx;
  c.on_paint(h.makeGraphics());
  const b = c.SETUP_HB.find(it => it.act === action);
  assert.ok(b, 'Wizard action available: ' + action);
  c.on_mouse_lbtn_down(c.px((b.x0+b.x1)/2), c.px((b.y0+b.y1)/2));
  c.on_mouse_lbtn_up(c.px((b.x0+b.x1)/2), c.px((b.y0+b.y1)/2));
}

function assertBounds(h) {
  const c=h.ctx;
  c.on_paint(h.makeGraphics());
  const items=Array.from(c.SETUP_HB);
  assert.ok(items.length>0, 'Wizard retains controls at compact size');
  for (const b of items) {
    assert.ok(b.x0>=0 && b.y0>=c.TBH && b.x1<=c.W && b.y1<=c.H && b.x1>b.x0 && b.y1>b.y0, 'Control stays in client area: '+b.act);
    for (const other of items) if (b!==other) {
      assert.ok(b.x1<=other.x0||other.x1<=b.x0||b.y1<=other.y0||other.y1<=b.y0, 'No overlapping controls: '+b.act+' / '+other.act);
    }
  }
}

function run() {
  const property = 'Setup: music sources (local / both)';
  const theme = 'Display: colour mode (0 = auto, 1 = dark, 2 = light)';
  console.log('First launch, local-only path, and reload...');
  const h = createHarness({ props: { 'Navigation: music source': '' } });
  assert.ok(h.ctx.setupPrompt, 'Fresh profile opens setup');
  assert.strictEqual(h.state.props[property], 'pending', 'Unfinished setup remains pending across reload');
  assert.strictEqual(h.state.httpQueue.length, 0, 'No Navidrome requests before source selection');
  h.ctx.on_char(32);
  assert.strictEqual(h.state.isPaused, false, 'Wizard blocks underlying playback input');
  press(h, 'next');
  press(h, 'local-prefs');
  assert.strictEqual(h.state.preferencesCalls, 1);
  press(h, 'next');
  press(h, 'theme-2');
  press(h, 'finish');
  assert.strictEqual(h.ctx.setupPrompt, null);
  assert.strictEqual(h.state.props[property], 'local');
  assert.strictEqual(h.state.props[theme], 2);
  assert.strictEqual(h.ctx.IS_LIGHT, true);
  assert.strictEqual(h.state.httpQueue.length, 0);
  h.ctx.on_paint(h.makeGraphics());
  assert.deepStrictEqual(Array.from(h.ctx.HB_SOURCE, b => b.source), ['local']);
  const reload = createHarness({ props: h.state.props });
  assert.strictEqual(reload.ctx.setupPrompt, null);
  assert.strictEqual(reload.ctx.setupMode, 'local');
  reload.ctx.switchLibrarySource('navidrome');
  assert.strictEqual(reload.ctx.libSource, 'local', 'Hidden source cannot be selected accidentally');

  console.log('Dual-source connection, retries and upgrade preservation...');
  const n = createHarness({ props: { [property]: 'pending', 'Navigation: music source': 'local' } });
  assert.ok(n.ctx.setupPrompt, 'Installer pending flag overrides exported default source');
  press(n, 'source-both'); press(n, 'next');
  assert.strictEqual(n.state.props[property],'pending-both');
  const restarted=createHarness({props:n.state.props});
  assert.ok(restarted.ctx.setupPrompt && restarted.ctx.setupPrompt.mode==='both', 'Restart remembers the unfinished source choice');
  assert.strictEqual(n.ctx.setupPrompt.navStatus, 'testing');
  assert.ok(n.flushOneHttp('/rest/ping.view', 200, { 'subsonic-response': { status: 'failed', error: { code: 40, message: 'Authentication failed' } } }));
  assert.strictEqual(n.ctx.setupPrompt.navStatus, 'failed');
  press(n, 'nav-test');
  assert.ok(n.flushOneHttp('/rest/ping.view', 200, { 'subsonic-response': { status: 'ok' } }));
  assert.strictEqual(n.ctx.setupPrompt.navStatus, 'connected');
  press(n, 'next'); press(n, 'finish');
  assert.strictEqual(n.ctx.setupMode, 'both');
  n.ctx.on_paint(n.makeGraphics());
  assert.deepStrictEqual(Array.from(n.ctx.HB_SOURCE, b => b.source), ['local','navidrome']);
  n.ctx.switchLibrarySource('navidrome');
  assert.strictEqual(n.ctx.libSource, 'navidrome');
  const upgrade = createHarness({ props: { 'Navigation: music source': 'navidrome', [theme]: 1 } });
  assert.strictEqual(upgrade.ctx.setupPrompt, null, 'Existing users are not forced through setup');
  assert.strictEqual(upgrade.ctx.libSource, 'navidrome');
  assert.strictEqual(upgrade.ctx.setupMode, 'both');
  upgrade.ctx.openMenu('setup', 0, 0);
  press(upgrade, 'source-local'); press(upgrade, 'next'); press(upgrade, 'next'); press(upgrade, 'theme-2');
  upgrade.ctx.on_char(27);
  assert.strictEqual(upgrade.ctx.libSource, 'navidrome');
  assert.strictEqual(upgrade.ctx.THEME_MODE, 1, 'Cancelled appearance preview is restored');

  console.log('Missing dependency, incomplete configuration, skip, high DPI...');
  const missing = createHarness({ props: { [property]: 'pending', 'Display: UI scale (0 = auto)': '2' }, navidromeInstalled: false });
  missing.ctx.on_size(720,640);
  assertBounds(missing);
  press(missing, 'source-both'); press(missing, 'next');
  assertBounds(missing);
  assert.strictEqual(missing.ctx.setupPrompt.navStatus, 'missing');
  assert.strictEqual(missing.state.httpQueue.length, 0);
  press(missing, 'nav-install');
  assert.strictEqual(missing.state.openedUrls.length, 1);
  missing.state.navidromeInstalled=true; missing.state.navidromeConfigured=false;
  press(missing, 'nav-test');
  assert.strictEqual(missing.ctx.setupPrompt.navStatus, 'unconfigured');
  press(missing, 'nav-prefs');
  assert.strictEqual(missing.state.preferencesCalls, 1);
  missing.state.navidromeConfigured=true;
  press(missing, 'nav-test');
  assert.strictEqual(missing.ctx.setupPrompt.navStatus, 'testing');
  press(missing, 'skip');
  assert.strictEqual(missing.ctx.setupPrompt, null);
  assert.strictEqual(missing.ctx.setupMode, 'local');
  missing.flushOneHttp('/rest/ping.view', 200, { 'subsonic-response': { status: 'ok' } });
  assert.strictEqual(missing.ctx.setupMode, 'local', 'Late response is ignored after skip');

  const zh = createHarness({props:{[property]:'pending','Display: UI scale (0 = auto)':'3'},localeName:'zh-CN'});
  zh.ctx.on_size(1080,960);
  assertBounds(zh); press(zh,'source-both'); press(zh,'next'); assertBounds(zh);
  press(zh,'next'); assertBounds(zh); press(zh,'finish');
  zh.ctx.on_paint(zh.makeGraphics());
  const compactMenu=zh.ctx.HB_MENU.find(b=>b.root==='compact');
  assert.ok(compactMenu||zh.ctx.HB_MENU.some(b=>b.root==='setup'),'Narrow title bar exposes setup directly or through Menu');
  // The harness's synthetic text widths may fit all four labels. Test the alternate menu explicitly.
  zh.ctx.openMenu('compact',compactMenu?compactMenu.mx:42,zh.ctx.TBH);
  zh.ctx.on_paint(zh.makeGraphics());
  const setupMenu=zh.ctx.CTX_HB.find(b=>b.act==='setup');
  assert.ok(setupMenu,'Settings available from compact menu');
  zh.ctx.on_mouse_lbtn_up(zh.ctx.px((setupMenu.x0+setupMenu.x1)/2),zh.ctx.px((setupMenu.y0+setupMenu.y1)/2));
  assert.ok(zh.ctx.setupPrompt,'Compact menu reopens setup');
}

module.exports = { run };
