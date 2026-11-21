'use strict';

const assert = require('assert');
const { createHarness } = require('../harness');

function run() {
  console.log('1. Auto-detect locale via WScript.Shell RegRead & safe fallback...');
  {
    const hEn = createHarness({ localeName: 'en-US' });
    assert.strictEqual(hEn.ctx.LANG, 'en');
    assert.strictEqual(hEn.ctx.T('source.local'), 'Local Music');

    const hZh = createHarness({ localeName: 'zh-CN' });
    assert.strictEqual(hZh.ctx.LANG, 'zh-CN');
    assert.strictEqual(hZh.ctx.T('source.local'), '\u672c\u5730\u97f3\u4e50');
    assert.strictEqual(hZh.ctx.T('menu.settings'), '\u8bbe\u7f6e');
    assert.strictEqual(hZh.ctx.T('setup.welcome'), '\u6b22\u8fce\u4f7f\u7528 PolaPlayer');
    assert.strictEqual(hZh.ctx.T('setup.next'), '\u7ee7\u7eed');

    const hFallback = createHarness({ localeName: 'ja-JP' });
    assert.strictEqual(hFallback.ctx.LANG, 'en');

    const hRegErr = createHarness({ localeName: null });
    assert.strictEqual(hRegErr.ctx.LANG, 'en');
  }

  console.log('2. Explicit language property overrides OS locale...');
  {
    const hForceEn = createHarness({
      localeName: 'zh-CN',
      props: { 'Display: language (auto / en / zh-CN)': 'en' }
    });
    assert.strictEqual(hForceEn.ctx.LANG, 'en');

    const hForceZh = createHarness({
      localeName: 'en-US',
      props: { 'Display: language (auto / en / zh-CN)': 'zh-CN' }
    });
    assert.strictEqual(hForceZh.ctx.LANG, 'zh-CN');
  }

  console.log('3. Placeholder interpolation, fallback keys, & dictionary parity...');
  {
    const h = createHarness({ localeName: 'en-US' });
    const ctx = h.ctx;
    assert.strictEqual(ctx.T('meta.songs', 12), '12 songs');
    assert.strictEqual(ctx.T('meta.albums_and_songs', 3, '|', 24), '3 albums | 24 songs in your library');
    assert.strictEqual(ctx.T('nonexistent.key'), 'nonexistent.key');

    const enKeys = Object.keys(ctx.LANGS.en).sort();
    const zhKeys = Object.keys(ctx.LANGS['zh-CN']).sort();
    assert.deepStrictEqual(enKeys, zhKeys);
  }

  console.log('4. Runtime setLang() updates dropdown arrays & rendered views...');
  {
    const h = createHarness({ localeName: 'en-US' });
    const { ctx, makeGraphics } = h;

    assert.strictEqual(ctx.MENUS[0][0], 'File');
    assert.strictEqual(ctx.SONGS_GROUPS[0][0], 'No grouping');
    assert.strictEqual(ctx.VIZ_STYLES[0][0], 'Bars');

    const grEnQueue = makeGraphics();
    ctx.drawQueue(grEnQueue);
    assert.ok(grEnQueue.gdiDrawTextCalls.some(c => c.str === 'Queue'));
    assert.ok(grEnQueue.gdiDrawTextCalls.some(c => c.str === 'Lyrics'));

    ctx.setLang('zh-CN');
    assert.strictEqual(ctx.LANG, 'zh-CN');
    assert.strictEqual(ctx.MENUS[0][0], '\u6587\u4ef6');
    assert.strictEqual(ctx.SONGS_GROUPS[0][0], '\u4e0d\u5206\u7ec4');
    assert.strictEqual(ctx.VIZ_STYLES[0][0], '\u9891\u8c31\u67f1');
    assert.strictEqual(ctx.BR_PL_SORTS[0][0], '\u9ed8\u8ba4\u987a\u5e8f');
    assert.strictEqual(ctx.BR_ALB_TABS[0][0], '\u6700\u8fd1\u64ad\u653e');

    const grZhQueue = makeGraphics();
    ctx.drawQueue(grZhQueue);
    assert.ok(grZhQueue.gdiDrawTextCalls.some(c => c.str === '\u961f\u5217'));
    assert.ok(grZhQueue.gdiDrawTextCalls.some(c => c.str === '\u6b4c\u8bcd'));

    ctx.view = 'browse';
    ctx.brView = 'random';
    const grZhNv = makeGraphics();
    ctx.on_paint(grZhNv);
    assert.ok(grZhNv.gdiDrawTextCalls.some(c => c.str === '\u5168\u5e93\u968f\u673a\u6f2b\u6e38'));

    ctx.setLang('en');
    const grEnNv = makeGraphics();
    ctx.on_paint(grEnNv);
    assert.ok(grEnNv.gdiDrawTextCalls.some(c => c.str === 'Radio Mix'));
    assert.ok(grEnNv.gdiDrawTextCalls.some(c => c.str === 'Refresh'));

    const refreshBtn = ctx.HB_BR_BTN.find(b => b.act === 'refresh');
    assert.ok(refreshBtn && (refreshBtn.x1 - refreshBtn.x0) > 68, 'English Refresh pill widens past 68px');
  }
}

module.exports = { run };
