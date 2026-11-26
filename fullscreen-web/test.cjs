'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

function webModules() {
  const root = __dirname;
  const esbuild = require('esbuild');
  function load(name) {
    const source = fs.readFileSync(path.join(root, 'src', name + '.ts'), 'utf8');
    const { code } = esbuild.transformSync(source, { loader: 'ts', format: 'cjs' });
    const module = { exports: {} };
    vm.runInNewContext(code, { module });
    return module.exports;
  }
  return { ...load('lyrics_adapter'), ...load('playback_clock') };
}

{
  console.log('WebView lyric timing and playback clock...');
  {
    const { PlaybackClock, toAmllLines } = webModules();
    const clock = new PlaybackClock();
    clock.sync(20, 100, true, true, 0);
    assert.strictEqual(clock.at(500), 20500);
    clock.sync(20.4, 100, true, false, 500);
    assert.strictEqual(clock.at(500), 20500, 'Ordinary snapshots do not jump backwards');
    assert.strictEqual(clock.at(750), 20700, 'Gradually correct a slow host clock');
    clock.sync(20.7, 100, false, false, 750);
    assert.strictEqual(clock.at(2000), 20700, 'Pause freezes the clock');
    clock.sync(20.7, 100, true, false, 2000);
    assert.strictEqual(clock.at(2100), 20800, 'Resume continues from the paused position');
    clock.sync(4, 100, true, true, 2100);
    assert.strictEqual(clock.at(2100), 4000, 'Explicit seek aligns immediately');

    const lines = toAmllLines({ synced: true, lines: [
      { t: 20, text: 'Last line' },
      { t: 2, text: 'First line\nInline translation' },
      { t: 2, text: 'First line', translatedLyric: 'Explicit translation', romanLyric: 'Romanized' },
      { t: 5, text: '\u2022 \u2022 \u2022' },
      { t: NaN, text: 'Invalid timestamp' }
    ] }, 22);
    assert.deepStrictEqual(Array.from(lines, line => line.startTime), [2000, 20000]);
    assert.strictEqual(lines[0].endTime, 5000, 'Interlude starts where the placeholder was');
    assert.strictEqual(lines[0].words[0].startTime, 2000);
    assert.strictEqual(lines[0].words[0].endTime, 5000);
    assert.strictEqual(lines[0].translatedLyric, 'Inline translation\nExplicit translation');
    assert.strictEqual(lines[0].romanLyric, 'Romanized');
    assert.strictEqual(lines[1].endTime, 22000, 'Final line ends at the actual track duration');
    assert.strictEqual(toAmllLines({ synced: false, lines: [{ t: -1, text: 'Plain lyrics' }] }, 22).length, 0);
  }
}
console.log('AMLL lyric timing and playback clock passed');
