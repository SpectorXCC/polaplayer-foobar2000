const http = require('node:http');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const audio = fs.readFileSync(process.argv[2]);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYxkAAAAASUVORK5CYII=', 'base64');
const song = { id: 'fixture-1', title: 'Remote Playback Fixture', artist: 'Fixture artist',
  album: 'Fixture album', coverArt: 'fixture-cover', duration: 60, suffix: 'wav', contentType: 'audio/wav' };
const playlist = { id: 'fixture-list', name: 'Navidrome Probe', owner: 'fixture', songCount: 1, entry: [song] };
const playlists = new Map([[playlist.id, playlist]]);

http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const salt = url.searchParams.get('s');
    assert.equal(url.searchParams.get('u'), 'fixture');
    assert.equal(url.searchParams.get('t'), createHash('md5').update('fixture-password' + salt).digest('hex'));
    assert.equal(url.searchParams.has('p'), false);
    const route = url.pathname.split('/').at(-1).split('.')[0];
    console.log(route);
    if (route === 'stream') {
      assert.equal(url.searchParams.get('id'), song.id);
      const start = Number(/^bytes=(\d+)-/.exec(req.headers.range || '')?.[1] || 0);
      const headers = { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': audio.length - start };
      if (req.headers.range) headers['Content-Range'] = `bytes ${start}-${audio.length - 1}/${audio.length}`;
      res.writeHead(req.headers.range ? 206 : 200, headers);
      res.end(req.method === 'HEAD' ? undefined : audio.subarray(start));
      return;
    }
    if (route === 'getCoverArt') {
      assert.ok([song.coverArt, 'pl-' + playlist.id].includes(url.searchParams.get('id')), 'unexpected cover id');
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
      res.end(png);
      return;
    }
    if (route === 'createPlaylist') {
      const created = { id:'fixture-edit', name:url.searchParams.get('name'), owner:'fixture', songCount:0, entry:[] };
      playlists.set(created.id, created);
      json({ playlist:created });
      return;
    }
    if (route === 'updatePlaylist') {
      const list = playlists.get(url.searchParams.get('playlistId'));
      assert.equal(list.id, 'fixture-edit');
      if (url.searchParams.has('name')) list.name = url.searchParams.get('name');
      if (url.searchParams.has('songIdToAdd')) {
        assert.equal(url.searchParams.get('songIdToAdd'), song.id);
        assert.equal(list.entry.length, 0);
        list.entry.push(song);
      }
      if (url.searchParams.has('songIndexToRemove')) {
        assert.equal(url.searchParams.get('songIndexToRemove'), '0');
        assert.equal(list.entry.length, 1);
        list.entry.splice(0, 1);
      }
      list.songCount = list.entry.length;
      json({});
      return;
    }
    if (route === 'deletePlaylist') {
      assert.equal(url.searchParams.get('id'), 'fixture-edit');
      assert.ok(playlists.delete('fixture-edit'));
      json({});
      return;
    }
    const responses = {
      ping: {},
      getPlaylists: { playlists: { playlist: [...playlists.values()] } },
      getPlaylist: { playlist: playlists.get(url.searchParams.get('id')) },
      getSong: { song },
      search3: { searchResult3: { song: [song] } },
      getStarred2: { starred2: {} },
      getAlbumList2: { albumList2: {} },
      getArtists: { artists: {} },
      getRandomSongs: { randomSongs: { song: [song] } },
      scrobble: {},
      getLyricsBySongId: { lyricsList: { structuredLyrics: [{
        lang: 'en', synced: true, offset: 0, line: [
          { start: 1000, value: 'Remote line one' }, { start: 7500, value: 'Remote line two' }
        ]
      }] } }
    };
    assert.ok(Object.hasOwn(responses, route), route);
    json(responses[route]);
  } catch (error) {
    console.error(error.message);
    res.writeHead(400);
    res.end();
  }

  function json(payload) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 'subsonic-response': { status:'ok', version:'1.16.1', ...payload } }));
  }
}).listen(Number(process.argv[3]) || 19372, '127.0.0.1', () => console.log('LISTENING'));
