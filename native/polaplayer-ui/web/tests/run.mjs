import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webDir, '..', '..', '..');

async function loadTsModule(entryRelPath) {
  const res = esbuild.buildSync({
    entryPoints: [path.join(webDir, entryRelPath)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent'
  });
  const code = res.outputFiles[0].text;
  const modUrl = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
  return import(modUrl);
}

async function runTests() {
  console.log('=== pola-ui/web tests ===');

  // 1. i18n dictionary completeness & EN <-> ZH-CN parity
  console.log('1. Checking i18n key parity, placeholder interpolation & formatting...');
  const stringsMod = await loadTsModule('src/i18n/strings.ts');
  const stringsSrc = fs.readFileSync(path.join(webDir, 'src/i18n/strings.ts'), 'utf8');

  const extractKeys = (blockName) => {
    const start = stringsSrc.indexOf(`const ${blockName}`);
    const end = stringsSrc.indexOf('};', start);
    assert.ok(start >= 0 && end > start, `Missing ${blockName} block`);
    const body = stringsSrc.slice(start, end);
    const map = new Map();
    const re = /'([^']+)':\s*'((?:\\'|[^'])*)'/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      map.set(m[1], m[2]);
    }
    return map;
  };

  const enMap = extractKeys('EN');
  const zhMap = extractKeys('ZH_CN');
  assert.ok(enMap.size >= 110, `Expected >=110 EN keys, got ${enMap.size}`);

  for (const [k, enVal] of enMap) {
    assert.ok(zhMap.has(k), `ZH_CN missing key: ${k}`);
    const zhVal = zhMap.get(k);
    assert.ok(zhVal.trim().length > 0, `ZH_CN empty translation for: ${k}`);
    const phEn = [...enVal.matchAll(/\{\d+\}/g)].map((x) => x[0]).sort();
    const phZh = [...zhVal.matchAll(/\{\d+\}/g)].map((x) => x[0]).sort();
    assert.deepEqual(phZh, phEn, `Placeholder mismatch for key "${k}": EN=${phEn} ZH=${phZh}`);
  }
  for (const k of zhMap.keys()) {
    assert.ok(enMap.has(k), `Extra ZH_CN key absent in EN: ${k}`);
  }

  // Verify parity with essential keys from original Verdant core/i18n.js
  const requiredKeys = [
    'source.local', 'source.navidrome', 'nav.all_songs', 'nav.albums', 'nav.artists', 'nav.loved', 'nav.random',
    'menu.add_files', 'menu.add_folder', 'menu.sync_nv', 'menu.trk_play', 'menu.trk_shuf', 'menu.trk_play_next',
    'menu.trk_queue', 'menu.trk_open_folder', 'menu.trk_properties', 'menu.trk_remove',
    'dlg.dup_one', 'dlg.dup_many', 'dlg.rg_title', 'dlg.rg_need', 'btn.normalize', 'btn.scan_normalize',
    'btn.star_album', 'btn.follow_artist', 'fs.bars', 'fs.radial', 'fs.toggle_lyrics', 'fs.toggle_viz'
  ];
  for (const rk of requiredKeys) {
    assert.ok(enMap.has(rk) && zhMap.has(rk), `Missing required parity key: ${rk}`);
  }

  assert.equal(stringsMod.t('zh-CN', 'setup.imported_ok', 3), '已导入 3 个服务器配置。');
  assert.equal(stringsMod.fmtTime(125), '2:05');
  assert.equal(stringsMod.fmtDur(3725), '1 hr 2 min');

  // 2. PlaybackClock accuracy & monotonic bounds
  console.log('2. Testing PlaybackClock convergence and clamping...');
  const { PlaybackClock } = await loadTsModule('src/bridge/playbackClock.ts');
  const clock = new PlaybackClock();
  clock.sync(10, 200, true, true, 1000);
  assert.equal(clock.at(1000), 10000);
  assert.equal(clock.at(2500), 11500);
  // Pauses cleanly without advancing
  clock.sync(11.5, 200, false, false, 2500);
  assert.equal(clock.at(5000), 11500);
  // Clamps to duration
  clock.sync(199, 200, true, true, 5000);
  assert.equal(clock.at(10000), 200000);
  // Rejects NaN safely
  clock.sync(Number.NaN, -5, false, true, 10000);
  assert.equal(clock.at(12000), 0);

  // 3. AMLL bilingual & timestamp lyric adapter
  console.log('3. Testing AMLL toAmllLines adapter...');
  const { toAmllLines } = await loadTsModule('src/bridge/lyricsAdapter.ts');
  assert.deepEqual(toAmllLines({ synced: false, lines: [{ text: 'Plain' }] }, 180), []);
  const lines = toAmllLines(
    {
      synced: true,
      lines: [
        { t: 1.5, text: '• • •' },
        { t: 2.0, text: 'Hello world\n你好世界' },
        { t: 2.0, text: 'Hello world', translatedLyric: '你好世界', romanLyric: 'ni hao' },
        { t: 6.5, text: 'Second line' }
      ]
    },
    120
  );
  assert.equal(lines.length, 2);
  assert.equal(lines[0].startTime, 2000);
  assert.equal(lines[0].endTime, 6500);
  assert.equal(lines[0].words[0].word, 'Hello world');
  assert.equal(lines[0].translatedLyric, '你好世界');
  assert.equal(lines[0].romanLyric, 'ni hao');
  assert.equal(lines[1].startTime, 6500);
  assert.equal(lines[1].endTime, 120000);

  // 4. Web UI capability gating & bundle integrity
  console.log('4. Verifying Web UI Navidrome parity & TrackTable virtualization...');
  const mainShellSrc = fs.readFileSync(path.join(webDir, 'src/components/MainShell.tsx'), 'utf8');
  assert.ok(!mainShellSrc.includes("if (route.kind === 'albums') {\n    if (isNavidrome)"), 'Albums must support Navidrome');
  assert.ok(!mainShellSrc.includes("if (route.kind === 'artists') {\n    if (isNavidrome)"), 'Artists must support Navidrome');
  assert.ok(!mainShellSrc.includes("if (route.kind === 'loved') {\n    if (isNavidrome)"), 'Loved must support Navidrome');
  assert.ok(!mainShellSrc.includes("if (route.kind === 'random') {\n    if (isNavidrome)"), 'Random must support Navidrome');
  assert.ok(mainShellSrc.includes("if (route.kind === 'all_songs') {\n    if (isNavidrome)"), 'AllSongs stays gated cleanly');

  const trackTableSrc = fs.readFileSync(path.join(webDir, 'src/components/TrackTable.tsx'), 'utf8');
  assert.ok(trackTableSrc.includes('rows.length > 140'), 'Virtual windowing must remain active at >140 rows');

  // 5. Fullscreen overlay 1:1 fidelity with fullscreen-web
  console.log('5. Verifying FullscreenOverlay 1:1 layout/controls fidelity...');
  const fsSrc = fs.readFileSync(path.join(webDir, 'src/fullscreen/FullscreenOverlay.tsx'), 'utf8');
  for (const needle of ['fs-bg-fallback', 'fs-top-actions', 'fs-slider-track', 'fs-ctrl-row', "act: 'shuffle'", "act: 'repeat'", 'data-compact', 'setAlignPosition(0.44)']) {
    assert.ok(fsSrc.includes(needle), `FullscreenOverlay missing 1:1 feature: ${needle}`);
  }

  // 6. Navidrome All Songs capability gating & active source persistence
  console.log('6. Verifying Navidrome All Songs gating & activeSource persistence...');
  const sidebarSrc = fs.readFileSync(path.join(webDir, 'src/components/Sidebar.tsx'), 'utf8');
  assert.ok(sidebarSrc.includes('hasAllSongs') && sidebarSrc.includes('{hasAllSongs && ('), 'Sidebar must hide All Songs when unsupported');
  const mainTsxSrc = fs.readFileSync(path.join(webDir, 'src/main.tsx'), 'utf8');
  assert.ok(mainTsxSrc.includes('allowAllSongs'), 'main.tsx must leave all_songs when switching to Navidrome');
  const cppSrc = fs.readFileSync(path.join(webDir, '..', 'polaplayer_ui.cpp'), 'utf8');
  assert.ok(
    cppSrc.includes('activeSourceRemoteSetting') &&
      cppSrc.includes('remoteView_ = remoteEnabled.get() && activeSourceRemoteSetting.get()'),
    'polaplayer_ui.cpp must persist and restore activeSource across restarts'
  );

  // 7. CSS token integrity & range track validity
  console.log('7. Verifying CSS token integrity & WebView2 range track rules...');
  const cssSrc = fs.readFileSync(path.join(webDir, 'src/styles/app.css'), 'utf8');
  assert.ok(!cssSrc.includes('--col-accent'), 'Undefined --col-accent must not exist in app.css');
  assert.ok(!cssSrc.includes('--range-progress: progress('), 'Bare unitless progress() breaks linear-gradient stops');
  assert.ok(cssSrc.includes('.sort-dir-btn'), 'sort-dir-btn must be styled in app.css');
  assert.ok(cssSrc.includes('max-width: 168px;'), 'shelf-card-wrap must clamp card width to 168px');
  assert.ok(cppSrc.includes('__verdant_shuffle__'), 'Hidden Verdant utility playlists must be omitted');
  assert.ok(cppSrc.includes('sentTrackKey_ != trackKey_'), 'New track must always emit track + lyrics via sentTrackKey_');

  // Verify core i18n file readable from repo root
  assert.ok(fs.existsSync(path.join(repoRoot, 'core/i18n.js')));

  console.log('ALL POLA-UI WEB TESTS PASSED!');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
