/* verdant/data/navidrome_lyrics.js -- Subsonic lyrics lookup (shared across right pane + fullscreen)
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

var NV = { key: null, status: 'idle', lyrics: null, generation: 0, cache: {}, order: [] };
function nvTrackKey(){ return NP ? String(NP.Path) : ''; }

function nvShouldLoadLyrics(){
  if(fsMode && fsView === 'lyrics') return true;
  if(!fsMode && rightTab === 'lyrics' && (!R.drawer || queueDrawerOpen)) return true;
  return false;
}

function nvParseStructured(body){
  var all = body && body.lyricsList && body.lyricsList.structuredLyrics || [], chosen = null;
  if(!Array.isArray(all)) all = [all];
  for(var i = 0; i < all.length; i++){
    if(!all[i].line || !all[i].line.length) continue;
    if(!chosen || (!chosen.synced && all[i].synced)) chosen = all[i];
  }
  if(!chosen) return null;
  var rows = [], synced = chosen.synced === true, offset = Number(chosen.offset) || 0;
  for(i = 0; i < chosen.line.length && i < 5000; i++){
    var row = chosen.line[i], text = String(row.value || '').replace(/\r/g, '').trim();
    if(!text) text = '\u2022 \u2022 \u2022';
    var t = (Number(row.start) - offset) / 1000;
    if(synced && !isFinite(t)) continue;
    rows.push({ t: synced ? Math.max(0, t) : -1, text: text });
  }
  if(synced) rows.sort(function(a, b){ return a.t - b.t; });
  var lines = [];
  for(i = 0; i < rows.length; i++){
    var last = lines.length ? lines[lines.length - 1] : null;
    if(synced && last && last.t === rows[i].t) last.text += '\n' + rows[i].text;
    else lines.push(rows[i]);
  }
  return lines.length ? { lines: lines, synced: synced } : null;
}

function nvAccept(generation, lyric, status){
  if(generation !== NV.generation || NV.key !== nvTrackKey()) return;
  NV.lyrics = lyric; NV.status = status;
  if(lyric){
    NV.cache[NV.key] = lyric; NV.order.push(NV.key);
    while(NV.order.length > 12) delete NV.cache[NV.order.shift()];
  }
  lySnap = true; lyStScroll = 0; lyLay = { lyr: null, w: -1 };
  fsLyReset();
  if(typeof fsBridgePushLyrics === 'function') fsBridgePushLyrics();
  if(!(typeof fsMode === 'boolean' && fsMode && typeof fsBridgeIsShowing === 'function' && fsBridgeIsShowing())){
    repaintAll();
  }
}

function nvLyricsReq(c, endpoint, params, generation, done){
  nvApiRequest(c, endpoint, params, {
    client: 'VerdantLyrics',
    timeoutMs: 12000,
    maxBytes: 3000000,
    checkCancel: function(){ return generation !== NV.generation; }
  }, done);
}

function nvLoad(force){
  loadLyrics();
  var key = nvTrackKey();
  if(!force && NV.key === key) return;
  nvCancel(); NV.key = key; NV.lyrics = null;
  lySnap = true; lyStScroll = 0; lyLay = { lyr: null, w: -1 }; fsLyReset();
  if(!key){ NV.status = 'idle'; return; }
  if(!force && NV.cache[key]){ NV.lyrics = NV.cache[key]; NV.status = 'ready'; return; }
  NV.status = 'loading';
  var generation = NV.generation;
  var c = nvConnection();
  if(!c){ nvAccept(generation, null, 'fallback'); return; }

  function legacy(){
    nvLyricsReq(c, 'getLyrics', { artist: npArtistStr, title: npTitleStr }, generation, function(body){
      var text = body && body.lyrics && body.lyrics.value;
      var l = text ? parseLyrics(text) : null;
      nvAccept(generation, l && l.lines.length ? l : null, l && l.lines.length ? 'ready' : (body ? 'empty' : 'fallback'));
    });
  }
  function byId(id){
    nvLyricsReq(c, 'getLyricsBySongId', { id: id }, generation, function(body){
      var l = nvParseStructured(body);
      if(l) nvAccept(generation, l, 'ready'); else legacy();
    });
  }
  var id = nvTrackId(key);
  if(id){ byId(id); return; }
  nvLyricsReq(c, 'search3', { query: npTitleStr, songCount: 40, artistCount: 0, albumCount: 0 }, generation, function(body){
    if(!body){ nvAccept(generation, null, 'fallback'); return; }
    var songs = body.searchResult3 && body.searchResult3.song || [], norm = function(s){ return String(s || '').trim().toLowerCase(); };
    for(var i = 0; i < songs.length; i++){
      if(norm(songs[i].title) === norm(npTitleStr) && norm(songs[i].artist) === norm(npArtistStr)){ byId(songs[i].id); return; }
    }
    legacy();
  });
}

function nvCancel(){ NV.generation++; }
function fsNeedsNativeLyrics(){ return false; }
