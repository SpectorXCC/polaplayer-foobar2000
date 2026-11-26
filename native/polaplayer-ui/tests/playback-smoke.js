// Inject before the app module in a disposable portable profile. Load an active
// playlist with WAV titles ending in First track, Second track, and Smoke complete.
// Give First track a same-name LRC file with a timed line "PolaPlayer smoke line".
// To exercise Navidrome, run node mock-navidrome.cjs <fixture.wav> <port>
// with a WAV of at least 10 seconds, then set data-navidrome-port on the script tag.
(async () => {
  const bridge = window.chrome.webview;
  const navidromePort = Number(document.currentScript?.dataset.navidromePort || 0);
  const pending = new Map();
  const latest = new Map();
  let nextId = 1000000000;
  let step = 'boot';

  function mark(next) {
    step = next;
    localStorage.setItem('POLASMOKE_' + next, 'ok');
  }

  function expect(condition, message) {
    if (!condition) throw new Error(message);
  }

  function onMessage({ data }) {
    if (data?.type === 'rpc-res') {
      const reply = pending.get(data.id);
      if (reply) {
        pending.delete(data.id);
        clearTimeout(reply.timer);
        if (data.ok) reply.resolve(data.data);
        else reply.reject(new Error(reply.method + ': ' + data.error));
      }
    } else if (data?.type === 'event') {
      latest.set(data.event, data.data);
    } else if (data?.type === 'init') {
      latest.set('fullscreen.init', data);
    }
  }

  function rpc(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Timed out calling ' + method));
      }, 12000);
      pending.set(id, { method, resolve, reject, timer });
      bridge.postMessage({ type: 'rpc', id, method, params });
    });
  }

  async function waitFor(label, getValue) {
    const deadline = performance.now() + 12000;
    while (performance.now() < deadline) {
      const value = getValue();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Timed out waiting for ' + label);
  }

  function hostEvent(name, matches) {
    return waitFor(name, () => {
      const payload = latest.get(name);
      return payload && matches(payload) ? payload : null;
    });
  }

  function endedWith(title) {
    return row => row.title?.endsWith(title);
  }

  async function verifyNavidrome(port) {
    const connection = { server: 'http://127.0.0.1:' + port, user: 'fixture', password: 'fixture-password' };
    await rpc('settings.testServer', connection);
    await hostEvent('nav.connection', data => data.status === 'connected');
    await rpc('settings.save', { themeMode: 0, languageMode: 'en', sources: 'both', connection });
    await rpc('source.select', { source: 'navidrome' });
    await hostEvent('settings', data => data.activeSource === 'navidrome' && data.configured);
    const playlists = await hostEvent('playlists', data => data.source === 'navidrome' && !data.loading &&
      data.list.some(playlist => playlist.id === 'fixture-list'));
    expect(!playlists.error, 'Navidrome fixture catalog has an error');
    const search = await rpc('search.full', { query: 'Remote Playback', offset: 0, limit: 10 });
    expect(search.songTotal === 1 && search.songs[0].title === 'Remote Playback Fixture', 'Unexpected Navidrome search rows');
    mark('nav_catalog');

    const remote = await rpc('playlists.tracks', { id: 'fixture-list', offset: 0, limit: 10 });
    expect(remote.status === 'ready' && remote.total === 1, 'Unexpected Navidrome playlist rows');
    const result = await rpc('playlists.play', { id: 'fixture-list', index: remote.rows[0].index });
    expect(result.started, 'Navidrome fixture stream did not start');
    const track = await hostEvent('track', data => data.source === 'navidrome' && data.title === 'Remote Playback Fixture');
    await hostEvent('playback', data => data.playing && !data.paused);
    const hasFixtureLyric = data => data.key === track.key && data.remote && data.model?.synced &&
      data.model.lines.some(line => line.text === 'Remote line two' && line.t === 7.5);
    await hostEvent('lyrics', hasFixtureLyric);
    await rpc('fullscreen.enter', { view: 'lyrics' });
    await hostEvent('fullscreen.init', data => data.track.key === track.key && hasFixtureLyric(data.lyrics));
    await rpc('playback.seek', { key: track.key, time: 7.5 });
    await hostEvent('playback', data => data.playing && Math.abs(data.time - 7.5) < 0.75);
    await rpc('fullscreen.exit');
    await hostEvent('windowState', state => !state.fullscreen);
    mark('nav_playback');
  }

  mark(step);
  bridge.addEventListener('message', onMessage);
  try {
    await hostEvent('settings', data => data.activeSource === 'local');
    await rpc('settings.completeOnboarding');
    const playlist = await waitFor('active three-track fixture playlist', () => {
      const state = latest.get('playlists');
      return state?.list.find(list => list.id === state.selected && list.songCount === 3);
    });
    const { rows } = await rpc('playlists.tracks', { id: playlist.id, offset: 0, limit: 3 });
    const first = rows.find(endedWith('First track'));
    const second = rows.find(endedWith('Second track'));
    const third = rows.find(endedWith('Smoke complete'));
    expect(first && second && third, 'Fixture playlist has unexpected tracks');
    mark('playlist');

    const query = '%filename% HAS First';
    await rpc('search.query', { query });
    await hostEvent('search.updated', info => info.query === query && info.status === 'ready');
    const { rows: results } = await rpc('search.page', { offset: 0, limit: 10 });
    expect(results.length === 1 && endedWith('First track')(results[0]), 'Unexpected search rows');
    mark('search');

    async function enqueue(row, title) {
      const result = await rpc('queue.enqueue', { playlistId: playlist.id, index: row.index });
      expect(result.queued, 'Queue rejected fixture track');
      return waitFor('manual queue row ' + title, () => latest.get('queue')?.manual.find(endedWith(title)));
    }

    const queuedFirst = await enqueue(first, 'First track');
    await rpc('queue.playManual', { index: queuedFirst.index });
    const track = await hostEvent('track', endedWith('First track'));
    await hostEvent('playback', data => data.playing && !data.paused);
    await hostEvent('queue', data => data.manual.length === 0);
    mark('playing');

    await rpc('playback.ctrl', { act: 'play' });
    await hostEvent('playback', data => data.paused);
    mark('paused');
    await rpc('playback.seek', { key: track.key, time: 5 });
    await hostEvent('playback', data => data.paused && Math.abs(data.time - 5) < 0.5);
    mark('seek');

    const hasFixtureLyric = data => data.key === track.key && data.model?.synced &&
      data.model.lines.some(line => line.text === 'PolaPlayer smoke line' && line.t === 5);
    await hostEvent('lyrics', hasFixtureLyric);
    await rpc('fullscreen.enter', { view: 'lyrics' });
    await hostEvent('windowState', state => state.fullscreen && state.fsView === 'lyrics');
    await hostEvent('fullscreen.init', data => data.track.key === track.key && hasFixtureLyric(data.lyrics));
    const lyricHost = await waitFor('fullscreen lyric player', () =>
      document.querySelector('.fs-overlay .fs-amll-host:not(.hidden) > *'));
    await rpc('playback.ctrl', { act: 'play' });
    await waitFor('rendered fullscreen lyric', () =>
      lyricHost.textContent.includes('PolaPlayer smoke line'));
    mark('fullscreen');
    await rpc('fullscreen.exit');
    await hostEvent('windowState', state => !state.fullscreen);
    mark('exit_fullscreen');

    const queuedSecond = await enqueue(second, 'Second track');
    await rpc('queue.removeManual', { index: queuedSecond.index });
    await hostEvent('queue', data => data.manual.length === 0);
    mark('queue_removed');

    const result = await rpc('playlists.play', { id: playlist.id, index: third.index });
    expect(result.started, 'Final track did not start');
    await hostEvent('track', endedWith('Smoke complete'));
    await hostEvent('playback', data => data.playing && !data.paused);
    mark('local_complete');
    if (navidromePort) await verifyNavidrome(navidromePort);
    mark('complete');
  } catch (error) {
    localStorage.setItem('POLASMOKE_FAILED', step + ': ' + error.message);
    console.error(error);
  } finally {
    bridge.removeEventListener('message', onMessage);
  }
})();
