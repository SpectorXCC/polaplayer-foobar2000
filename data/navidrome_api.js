/* verdant/data/navidrome_api.js -- Subsonic client, credentials, URI builder, catalog & playlist CRUD
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

var NV_CFG_PREFIX = 'cfg_var.A1B2C3D4-1111-2222-AABB-CCDDEEFF';
var NV_CFG_SUFFIXES = ['0101', '0102', '0103', '010A', '011B', '011C'];

var NVApi = {
  connCache: null,
  connTs: 0,
  servers: [],
  activeServerName: '',
  httpTasks: {},
  defaultMaxBytes: 33554432   // 32 MB ceiling for large catalog/playlist responses
};

var NVData = {
  initDone: false,
  loading: false,
  error: '',
  playlists: [],
  playlistsLoaded: false,
  playlistsLoading: false,
  plDetails: {},          // id -> { meta, songs, loading, err, ts }
  albumsTab: 'recent',
  albumsByTab: {},        // type -> { list, loading, err, hasMore, ts }
  albumDetails: {},       // id -> { meta, songs, loading, err, ts }
  artists: null,          // null | [...]
  artistsLoading: false,
  artistsErr: '',
  artistDetails: {},      // id -> { meta, albums, topSongs, loading, err, ts }
  starred: { songs: [], albums: [], artists: [], loading: false, loaded: false, err: '' },
  starredMap: { song: {}, album: {}, artist: {} },
  randomMix: { songs: [], loading: false, err: '', ts: 0 },
  search: { query: '', requested: '', artists: [], albums: [], songs: [], loading: false, err: '' }
};

function nvAsArr(v){
  if(!v) return [];
  return Array.isArray(v) ? v : [v];
}

function nvDecodeQSVal(v){
  try{ return decodeURIComponent(String(v || '').replace(/\+/g, ' ')); }
  catch(e){ return String(v || ''); }
}

function nvParseQS(qs){
  var out = {}, pairs = String(qs || '').split('&'), i, at, k;
  for(i = 0; i < pairs.length; i++){
    at = pairs[i].indexOf('=');
    if(at <= 0) continue;
    k = nvDecodeQSVal(pairs[i].slice(0, at)).trim();
    if(k) out[k] = nvDecodeQSVal(pairs[i].slice(at + 1));
  }
  return out;
}

function nvParseServerList(raw, fallbackUrl, fallbackUser, fallbackPass, fallbackHeaders){
  var out = [], lines = String(raw || '').split(/\r?\n/), i, row, url;
  for(i = 0; i < lines.length; i++){
    var ln = lines[i].replace(/^\s+|\s+$/g, '');
    if(!ln) continue;
    row = nvParseQS(ln);
    url = String(row.url || '').trim().replace(/\/+$/, '');
    if(!/^https?:\/\//i.test(url) || !row.user) continue;
    out.push({
      name: String(row.name || url),
      url: url,
      user: String(row.user || ''),
      pass: String(row.pass || ''),
      headers: String(row.headers || ''),
      filter: String(row.filter || ''),
      libs: String(row.libs || '')
    });
  }
  var fUrl = String(fallbackUrl || '').trim().replace(/\/+$/, '');
  if(!out.length && /^https?:\/\//i.test(fUrl) && fallbackUser){
    out.push({
      name: 'Default',
      url: fUrl,
      user: String(fallbackUser || ''),
      pass: String(fallbackPass || ''),
      headers: String(fallbackHeaders || ''),
      filter: '',
      libs: ''
    });
  }
  return out;
}

function nvTrackId(path){
  var m = /^navidrome:\/\/track\/([^?]+)/i.exec(path || '');
  if(!m){
    var stream = nvStreamConnection(path);
    return stream ? stream.id : '';
  }
  try{ return decodeURIComponent(m[1]); }catch(e){ return m[1]; }
}

function nvIsRemotePath(path){
  return /^navidrome:\/\/track\/|\/rest\/stream/i.test(String(path || ''));
}

function nvStreamConnection(path){
  var m = /^(https?:\/\/.+?)\/rest\/stream(?:\.view)?\?([^#]+)/i.exec(path || '');
  if(!m) return null;
  var pairs = m[2].split('&'), auth = {}, id = '', i, at, key, value;
  for(i = 0; i < pairs.length; i++){
    at = pairs[i].indexOf('='); if(at < 0) continue;
    key = pairs[i].slice(0, at);
    try{ value = decodeURIComponent(pairs[i].slice(at + 1).replace(/\+/g, ' ')); }catch(e){ continue; }
    if(key === 'id') id = value;
    if(key === 'u' || key === 'p' || key === 't' || key === 's' || key === 'apiKey') auth[key] = value;
  }
  if(!id || (!auth.apiKey && !(auth.u && (auth.p || (auth.t && auth.s))))) return null;
  return { url: m[1], auth: auth, id: id, headers: '' };
}

function nvResetConnection(){
  NVApi.connCache = null;
  NVApi.connTs = 0;
}

function nvConnection(forceRefresh, savedOnly){
  var stream = (!savedOnly && typeof nvTrackKey === 'function') ? nvStreamConnection(nvTrackKey()) : null;
  if(stream) return stream;
  var now = Date.now();
  if(!forceRefresh && NVApi.connCache && (now - NVApi.connTs) < 8000) return NVApi.connCache;

  var path = fb.ProfilePath + 'config.sqlite', db = null;
  try{
    if(!utils.IsFile(path)) return null;
    var saved = null;
    if(typeof utils.OpenDatabase === 'function'){
      db = utils.OpenDatabase(path);
      if(!db) return null;
      db.Exec('PRAGMA query_only=ON');
    } else saved = nvReadSqliteSettings(path);

    function field(suffix){
      if(saved) return saved[NV_CFG_PREFIX + suffix] || '';
      var rows = db.Query('SELECT value FROM configStrings WHERE name = ?', [NV_CFG_PREFIX + suffix]);
      return rows.length ? String(rows[0].value || '') : '';
    }

    var servers = nvParseServerList(field('011B'), field('0101'), field('0102'), field('0103'), field('010A'));
    NVApi.servers = servers;
    var wantName = NVApi.activeServerName || field('011C');
    var chosen = null, i;
    if(wantName){
      for(i = 0; i < servers.length; i++){
        if(servers[i].name === wantName){ chosen = servers[i]; break; }
      }
    }
    if(!chosen && servers.length){
      var u101 = field('0101').trim().replace(/\/+$/, '');
      for(i = 0; i < servers.length; i++){
        if(servers[i].url === u101 && servers[i].user === field('0102')){ chosen = servers[i]; break; }
      }
      if(!chosen) chosen = servers[0];
    }
    if(!chosen){
      var legacyUrl = field('0101').trim().replace(/\/+$/, '');
      if(/^https?:\/\//i.test(legacyUrl) && field('0102')){
        chosen = { name: wantName || 'Default', url: legacyUrl, user: field('0102'), pass: field('0103'), headers: field('010A'), filter: '', libs: '' };
      }
    }
    if(chosen) NVApi.activeServerName = chosen.name;
    NVApi.connCache = chosen;
    NVApi.connTs = now;
    return chosen;
  }catch(e){
    return null;
  }finally{
    if(db) try{ db.Close(); }catch(e){}
  }
}

/* Compatibility reader for JSplitter 3.8. Reads only foo_navidrome cfg_var keys from SQLite. */
function nvReadSqliteSettings(path){
  var b, raw, i;
  if(typeof utils.ReadBinaryFile === 'function') b = new Uint8Array(utils.ReadBinaryFile(path));
  else{
    raw = utils.ReadTextFile(path, 28591); b = new Uint8Array(raw.length);
    for(i = 0; i < raw.length; i++) b[i] = raw.charCodeAt(i) & 255;
  }
  if(b.length < 100 || String.fromCharCode.apply(null, Array.prototype.slice.call(b, 0, 15)) !== 'SQLite format 3') throw Error('sqlite-format');
  var pageSize = (b[16] << 8) | b[17]; if(pageSize === 1) pageSize = 65536;
  if(pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1))) throw Error('sqlite-page');
  var usable = pageSize - b[20], encoding = ((b[56] * 16777216) + (b[57] << 16) + (b[58] << 8) + b[59]);
  if(encoding !== 1) throw Error('sqlite-encoding');
  function u32(a, p){ return a[p] * 16777216 + (a[p + 1] << 16) + (a[p + 2] << 8) + a[p + 3]; }
  function vint(a, p){
    var n = 0, j;
    for(j = 0; j < 9; j++){
      if(p + j >= a.length) throw Error('sqlite-range');
      var c = a[p + j];
      n = n * (j === 8 ? 256 : 128) + (j === 8 ? c : c & 127);
      if(j === 8 || c < 128) return { n: n, next: p + j + 1 };
    }
    throw Error('sqlite-varint');
  }
  function text(a, p, n){ var s = ''; for(var k = 0; k < n; k++) s += '%' + ('0' + a[p + k].toString(16)).slice(-2); return decodeURIComponent(s); }
  function record(a){
    var h = vint(a, 0), pos = h.next, types = [];
    if(h.n > a.length) throw Error('sqlite-header');
    while(pos < h.n){ var t = vint(a, pos); types.push(t.n); pos = t.next; }
    var out = []; pos = h.n;
    for(var j = 0; j < types.length; j++){
      var type = types[j], size = type >= 12 ? Math.floor((type - 12) / 2) : [0, 1, 2, 3, 4, 6, 8, 8, 0, 0][type];
      if(size === undefined || pos + size > a.length) throw Error('sqlite-record');
      var value = null;
      if(type >= 13 && type % 2) value = text(a, pos, size);
      else if(type === 8 || type === 9) value = type - 8;
      else if(type > 0 && type < 7){ value = 0; for(var k = 0; k < size; k++) value = value * 256 + a[pos + k]; }
      out.push(value); pos += size;
    }
    return out;
  }
  function payload(pos, n){
    if(n > 1000000 || n < 0) throw Error('sqlite-payload');
    var max = usable - 35, min = Math.floor((usable - 12) * 32 / 255) - 23, local = n;
    if(n > max){ local = min + (n - min) % (usable - 4); if(local > max) local = min; }
    var out = new Uint8Array(n); if(pos + local > b.length) throw Error('sqlite-range'); out.set(b.subarray(pos, pos + local));
    var copied = local, next = n > local ? u32(b, pos + local) : 0, seen = {};
    while(copied < n){
      if(!next || seen[next]) throw Error('sqlite-overflow'); seen[next] = true;
      var start = (next - 1) * pageSize, take = Math.min(n - copied, usable - 4);
      if(start + 4 + take > b.length) throw Error('sqlite-range');
      out.set(b.subarray(start + 4, start + 4 + take), copied); copied += take; next = u32(b, start);
    }
    return out;
  }
  function table(root, visit){
    var pending = [root], seen = {}, limit = 0;
    while(pending.length){
      var page = pending.pop(); if(seen[page] || ++limit > 2000) throw Error('sqlite-tree'); seen[page] = true;
      var base = (page - 1) * pageSize, start = base + (page === 1 ? 100 : 0);
      if(start + 12 > b.length || page < 1) throw Error('sqlite-range');
      var kind = b[start], count = (b[start + 3] << 8) | b[start + 4], header = kind === 5 ? 12 : 8;
      if((kind !== 5 && kind !== 13) || count * 2 + header > usable) throw Error('sqlite-table');
      if(kind === 5) pending.push(u32(b, start + 8));
      for(var j = 0; j < count; j++){
        var ptr = start + header + j * 2, cell = base + ((b[ptr] << 8) | b[ptr + 1]);
        if(kind === 5){ pending.push(u32(b, cell)); continue; }
        var n = vint(b, cell), row = vint(b, n.next);
        if(visit(record(payload(row.next, n.n))) === false) return;
      }
    }
  }
  var root = 0, out = {}, wanted = {};
  NV_CFG_SUFFIXES.forEach(function(s){ wanted[NV_CFG_PREFIX + s] = true; });
  table(1, function(row){ if(row[0] === 'table' && row[1] === 'configStrings'){ root = Number(row[3]); return false; } });
  if(!root) throw Error('sqlite-settings');
  table(root, function(row){ if(wanted[row[0]]) out[row[0]] = String(row[1] || ''); });
  return out;
}

function nvBuildUrl(c, endpoint, params, clientName){
  var query = [];
  function pushParam(k, v){
    if(v === undefined || v === null) return;
    query.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  pushParam('v', '1.16.1');
  pushParam('c', clientName || 'VerdantNav');
  pushParam('f', 'json');
  if(c.auth){
    for(var ak in c.auth) pushParam(ak, c.auth[ak]);
  } else {
    var salt = utils.MD5(String(Date.now()) + ':' + Math.random()).slice(0, 12);
    var token = utils.MD5(String(c.pass || '') + salt);
    pushParam('u', c.user);
    pushParam('t', token);
    pushParam('s', salt);
  }
  if(params){
    for(var k in params){
      var val = params[k];
      if(val === undefined || val === null) continue;
      if(Array.isArray(val)){
        for(var j = 0; j < val.length; j++) pushParam(k, val[j]);
      } else pushParam(k, val);
    }
  }
  return c.url + '/rest/' + endpoint + '.view?' + query.join('&');
}

function nvParseHeaders(raw){
  var headers = {};
  if(!raw) return headers;
  try{
    var parsed = JSON.parse(raw);
    if(parsed && typeof parsed === 'object') return parsed;
  }catch(e){}
  var lines = String(raw).split(/\r?\n/), i, at;
  for(i = 0; i < lines.length; i++){
    at = lines[i].indexOf(':');
    if(at > 0) headers[lines[i].slice(0, at).trim()] = lines[i].slice(at + 1).trim();
  }
  return headers;
}

function nvApiRequest(c, endpoint, params, opts, done){
  if(typeof opts === 'function'){ done = opts; opts = null; }
  opts = opts || {};
  if(!c){
    if(done) done(null, { error: T('err.not_configured'), status: 0 });
    return 0;
  }
  try{
    var url = nvBuildUrl(c, endpoint, params, opts.client || 'VerdantNav');
    var headers = nvParseHeaders(c.headers);
    var hasHdr = false; for(var hk in headers){ if(Object.prototype.hasOwnProperty.call(headers, hk)){ hasHdr = true; break; } }
    var id = utils.HTTPRequestAsync(opts.method || 0, url, hasHdr ? JSON.stringify(headers) : '{}');
    var timeoutMs = opts.timeoutMs || 15000;
    var timer = window.SetTimeout(function(){
      if(!NVApi.httpTasks[id]) return;
      delete NVApi.httpTasks[id];
      if(done) done(null, { error: T('err.timeout'), status: 0 });
    }, timeoutMs);
    NVApi.httpTasks[id] = {
      done: done,
      timer: timer,
      maxBytes: opts.maxBytes || NVApi.defaultMaxBytes,
      checkCancel: opts.checkCancel || null
    };
    return id;
  }catch(e){
    if(done) done(null, { error: String(e.message || e), status: 0 });
    return 0;
  }
}

function nvCancelHttpTasks(){
  for(var id in NVApi.httpTasks){
    try{ window.ClearTimeout(NVApi.httpTasks[id].timer); }catch(e){}
  }
  NVApi.httpTasks = {};
}

function nvHttpDispatch(id, success, response, status){
  var task = NVApi.httpTasks[id];
  if(!task) return false;
  delete NVApi.httpTasks[id];
  try{ window.ClearTimeout(task.timer); }catch(e){}
  if(task.checkCancel && task.checkCancel()) return true;

  var meta = { error: '', status: Number(status) || 0, code: 0 }, body = null, txt = String(response || '');
  if(!success || meta.status < 200 || meta.status >= 300){
    meta.error = T('err.http_status', meta.status || T('err.failed'));
  } else if(txt.length > task.maxBytes){
    meta.error = T('err.too_large');
  } else {
    try{
      var json = JSON.parse(txt);
      var sr = json && json['subsonic-response'];
      if(sr && sr.status === 'ok') body = sr;
      else if(sr && sr.error){ meta.error = sr.error.message || T('err.subsonic'); meta.code = Number(sr.error.code) || 0; }
      else meta.error = T('err.invalid_resp');
    }catch(e){
      meta.error = T('err.invalid_json');
    }
  }
  if(task.done) task.done(body, meta);
  return true;
}

/* URI format verified against foo_navidrome.dll input_decoder & metadb.sqlite */
function nvBuildTrackUri(song){
  if(!song || !song.id) return '';
  var params = [];
  function add(k, v){
    if(v === undefined || v === null || v === '') return;
    params.push(k + '=' + encodeURIComponent(String(v)));
  }
  add('title', song.title);
  add('artist', song.artist);
  add('album', song.album);
  add('tracknumber', song.track);
  add('date', song.year);
  if(song.duration > 0) add('duration', Math.round(Number(song.duration)));
  add('coverArt', song.coverArt);
  add('rating', song.userRating);
  add('suffix', song.suffix);
  add('albumId', song.albumId);
  if(song.starred) add('starred', '1');
  add('disc', song.discNumber);
  add('albumArtist', song.albumArtist);
  add('genre', song.genre);
  add('composer', song.composer);
  add('bpm', song.bpm);
  add('mbid', song.musicBrainzId);
  if(song.replayGain){
    add('rgTrackGain', song.replayGain.trackGain);
    add('rgTrackPeak', song.replayGain.trackPeak);
    add('rgAlbumGain', song.replayGain.albumGain);
    add('rgAlbumPeak', song.replayGain.albumPeak);
  }
  return 'navidrome://track/' + encodeURIComponent(String(song.id)) + (params.length ? '?' + params.join('&') : '');
}

function nvNormSong(s){
  if(!s) return null;
  var id = String(s.id || '');
  if(s.starred && id) NVData.starredMap.song[id] = true;
  return {
    id: id,
    title: String(s.title || T('meta.unknown_title')),
    artist: String(s.artist || ''),
    album: String(s.album || ''),
    albumId: String(s.albumId || ''),
    artistId: String(s.artistId || ''),
    albumArtist: String(s.albumArtist || s.displayAlbumArtist || ''),
    track: Number(s.track) || 0,
    discNumber: Number(s.discNumber) || 1,
    year: s.year ? String(s.year) : '',
    duration: Math.max(0, Number(s.duration) || 0),
    coverArt: String(s.coverArt || s.albumId || ''),
    suffix: String(s.suffix || ''),
    genre: String(s.genre || ''),
    userRating: Number(s.userRating) || 0,
    starred: !!s.starred,
    composer: String(s.composer || ''),
    bpm: Number(s.bpm) || 0,
    musicBrainzId: String(s.musicBrainzId || ''),
    replayGain: s.replayGain || null,
    loved: !!s.starred,
    src: 'navidrome'
  };
}

function nvNormAlbum(a){
  if(!a) return null;
  var id = String(a.id || '');
  if(a.starred && id) NVData.starredMap.album[id] = true;
  return {
    id: id,
    name: String(a.name || a.title || T('meta.unknown_album')),
    artist: String(a.artist || ''),
    artistId: String(a.artistId || ''),
    year: a.year ? String(a.year) : '',
    genre: String(a.genre || ''),
    songCount: Number(a.songCount) || 0,
    duration: Math.max(0, Number(a.duration) || 0),
    coverArt: String(a.coverArt || a.id || ''),
    starred: !!a.starred,
    loved: !!a.starred
  };
}

function nvNormArtist(a){
  if(!a) return null;
  var id = String(a.id || '');
  if(a.starred && id) NVData.starredMap.artist[id] = true;
  return {
    id: id,
    name: String(a.name || T('meta.unknown_artist')),
    albumCount: Number(a.albumCount) || 0,
    coverArt: String(a.coverArt || (id ? ('ar-' + id) : '')),
    starred: !!a.starred,
    loved: !!a.starred
  };
}

function nvNormPlaylist(p){
  return {
    id: String(p.id || ''),
    name: String(p.name || T('meta.untitled_playlist')),
    songCount: Number(p.songCount) || 0,
    duration: Math.max(0, Number(p.duration) || 0),
    coverArt: String(p.coverArt || (p.id ? ('pl-' + p.id) : '')),
    owner: String(p.owner || ''),
    public: !!p.public,
    comment: String(p.comment || ''),
    editable: true
  };
}

function nvIsStarred(kind, id){
  if(!id) return false;
  return !!(NVData.starredMap[kind] && NVData.starredMap[kind][id]);
}

function nvFolderParams(){
  var c = nvConnection();
  var out = {};
  if(c && c.libs){
    var parts = String(c.libs).split(','), clean = [], i;
    for(i = 0; i < parts.length; i++){
      var t = parts[i].trim();
      if(t) clean.push(t);
    }
    if(clean.length === 1) out.musicFolderId = clean[0];
  }
  return out;
}

function nvSelectServer(name){
  NVApi.activeServerName = String(name || '');
  nvResetConnection();
  nvRefreshAll(true);
}

function nvPlaylistById(id){
  for(var i = 0; i < NVData.playlists.length; i++){
    if(NVData.playlists[i].id === id) return NVData.playlists[i];
  }
  return null;
}

function nvFetchPlaylists(force, cb){
  if(NVData.playlistsLoading) return;
  if(!force && NVData.playlistsLoaded){ if(cb) cb(true); return; }
  var c = nvConnection(!!force);
  if(!c){ NVData.error = T('err.no_server_cfg'); if(cb) cb(false); repaintAll(); return; }
  NVData.playlistsLoading = true;
  NVData.error = '';
  nvApiRequest(c, 'getPlaylists', {}, function(body, meta){
    NVData.playlistsLoading = false;
    if(!body){
      NVData.error = (meta && meta.error) || T('err.conn_failed');
      if(cb) cb(false);
      repaintAll();
      return;
    }
    var raw = nvAsArr(body.playlists && body.playlists.playlist);
    NVData.playlists = raw.map(nvNormPlaylist);
    NVData.playlistsLoaded = true;
    if(cb) cb(true);
    repaintAll();
  });
}

function nvFetchPlaylistDetail(id, force, cb){
  if(!id) return;
  var cur = NVData.plDetails[id];
  if(cur && cur.loading) return;
  if(!force && cur && !cur.err){ if(cb) cb(cur); return; }
  var c = nvConnection();
  NVData.plDetails[id] = { meta: cur ? cur.meta : nvPlaylistById(id), songs: cur ? cur.songs : [], loading: true, err: '', ts: 0 };
  repaintAll();
  nvApiRequest(c, 'getPlaylist', { id: id }, function(body, meta){
    if(!body || !body.playlist){
      NVData.plDetails[id] = { meta: nvPlaylistById(id), songs: [], loading: false, err: (meta && meta.error) || T('err.pl_load_failed'), ts: Date.now() };
      if(cb) cb(NVData.plDetails[id]);
      repaintAll();
      return;
    }
    var pl = body.playlist;
    var songs = nvAsArr(pl.entry).map(nvNormSong);
    var pmeta = nvNormPlaylist(pl);
    if(!pmeta.duration){
      var tot = 0; for(var i = 0; i < songs.length; i++) tot += songs[i].duration;
      pmeta.duration = tot;
    }
    pmeta.songCount = songs.length;
    var slot = nvPlaylistById(id);
    if(slot){ slot.name = pmeta.name; slot.songCount = pmeta.songCount; slot.duration = pmeta.duration; slot.coverArt = pmeta.coverArt; }
    NVData.plDetails[id] = { meta: pmeta, songs: songs, loading: false, err: '', ts: Date.now() };
    if(cb) cb(NVData.plDetails[id]);
    repaintAll();
  });
}

function nvFetchAlbums(type, append, force, cb){
  type = type || NVData.albumsTab || 'recent';
  var slot = NVData.albumsByTab[type];
  if(slot && slot.loading) return;
  if(!append && !force && slot && slot.list.length && !slot.err){ if(cb) cb(slot); return; }
  var c = nvConnection(), offset = (append && slot) ? slot.list.length : 0, size = 60;
  NVData.albumsByTab[type] = {
    list: (append && slot) ? slot.list.slice() : [],
    loading: true,
    err: '',
    hasMore: slot ? slot.hasMore : true,
    ts: Date.now()
  };
  repaintAll();
  var params = nvFolderParams();
  params.type = type; params.size = size; params.offset = offset;
  nvApiRequest(c, 'getAlbumList2', params, function(body, meta){
    var st = NVData.albumsByTab[type];
    st.loading = false;
    if(!body){ st.err = (meta && meta.error) || T('err.alb_list_failed'); if(cb) cb(st); repaintAll(); return; }
    var batch = nvAsArr(body.albumList2 && body.albumList2.album).map(nvNormAlbum);
    if(append) st.list = st.list.concat(batch);
    else st.list = batch;
    st.hasMore = batch.length >= size;
    if(cb) cb(st);
    repaintAll();
  });
}

function nvFetchAlbumDetail(id, force, cb){
  if(!id) return;
  var cur = NVData.albumDetails[id];
  if(cur && cur.loading) return;
  if(!force && cur && !cur.err){ if(cb) cb(cur); return; }
  var c = nvConnection();
  NVData.albumDetails[id] = { meta: cur ? cur.meta : null, songs: cur ? cur.songs : [], loading: true, err: '', ts: 0 };
  repaintAll();
  nvApiRequest(c, 'getAlbum', { id: id }, function(body, meta){
    if(!body || !body.album){
      NVData.albumDetails[id] = { meta: null, songs: [], loading: false, err: (meta && meta.error) || T('err.alb_load_failed'), ts: Date.now() };
      if(cb) cb(NVData.albumDetails[id]);
      repaintAll();
      return;
    }
    var songs = nvAsArr(body.album.song).map(nvNormSong);
    songs.sort(function(a, b){ return (a.discNumber - b.discNumber) || (a.track - b.track); });
    NVData.albumDetails[id] = { meta: nvNormAlbum(body.album), songs: songs, loading: false, err: '', ts: Date.now() };
    if(cb) cb(NVData.albumDetails[id]);
    repaintAll();
  });
}

function nvFetchArtists(force, cb){
  if(NVData.artistsLoading) return;
  if(!force && NVData.artists !== null){ if(cb) cb(NVData.artists); return; }
  var c = nvConnection();
  NVData.artistsLoading = true; NVData.artistsErr = '';
  repaintAll();
  nvApiRequest(c, 'getArtists', nvFolderParams(), function(body, meta){
    NVData.artistsLoading = false;
    if(!body){ NVData.artistsErr = (meta && meta.error) || T('err.art_list_failed'); if(cb) cb([]); repaintAll(); return; }
    var idxs = nvAsArr(body.artists && body.artists.index), out = [], i, j;
    for(i = 0; i < idxs.length; i++){
      var ar = nvAsArr(idxs[i].artist);
      for(j = 0; j < ar.length; j++) out.push(nvNormArtist(ar[j]));
    }
    NVData.artists = out;
    if(cb) cb(out);
    repaintAll();
  });
}

function nvFetchArtistDetail(id, nameHint, force, cb){
  if(!id) return;
  var cur = NVData.artistDetails[id];
  if(cur && cur.loading) return;
  if(!force && cur && !cur.err){ if(cb) cb(cur); return; }
  var c = nvConnection();
  NVData.artistDetails[id] = {
    meta: cur ? cur.meta : { id: id, name: nameHint || '', albumCount: 0, coverArt: 'ar-' + id },
    albums: cur ? cur.albums : [],
    topSongs: cur ? cur.topSongs : [],
    loading: true,
    err: '',
    ts: 0
  };
  repaintAll();
  nvApiRequest(c, 'getArtist', { id: id }, function(body, meta){
    if(!body || !body.artist){
      NVData.artistDetails[id].loading = false;
      NVData.artistDetails[id].err = (meta && meta.error) || T('err.art_load_failed');
      if(cb) cb(NVData.artistDetails[id]);
      repaintAll();
      return;
    }
    var artMeta = nvNormArtist(body.artist);
    var albums = nvAsArr(body.artist.album).map(nvNormAlbum);
    albums.sort(function(a, b){ return (Number(b.year) || 0) - (Number(a.year) || 0); });
    var st = NVData.artistDetails[id];
    st.meta = artMeta;
    st.albums = albums;
    st.loading = false;
    st.ts = Date.now();
    // Fetch top songs opportunistically; view renders albums cleanly even if unsupported or empty.
    nvApiRequest(c, 'getTopSongs', { artist: artMeta.name, count: 10 }, function(b2){
      if(b2 && b2.topSongs){
        NVData.artistDetails[id].topSongs = nvAsArr(b2.topSongs.song).map(nvNormSong);
        repaintAll();
      }
      if(cb) cb(NVData.artistDetails[id]);
    });
    repaintAll();
  });
}

function nvFetchStarred(force, cb){
  if(NVData.starred.loading) return;
  if(!force && NVData.starred.loaded){ if(cb) cb(NVData.starred); return; }
  var c = nvConnection();
  NVData.starred.loading = true; NVData.starred.err = '';
  repaintAll();
  nvApiRequest(c, 'getStarred2', nvFolderParams(), function(body, meta){
    NVData.starred.loading = false;
    if(!body){ NVData.starred.err = (meta && meta.error) || T('err.loved_load_failed'); if(cb) cb(NVData.starred); repaintAll(); return; }
    var d = body.starred2 || {};
    var songs = nvAsArr(d.song).map(nvNormSong);
    var albums = nvAsArr(d.album).map(nvNormAlbum);
    var artists = nvAsArr(d.artist).map(nvNormArtist);
    NVData.starredMap = { song: {}, album: {}, artist: {} };
    var i;
    for(i = 0; i < songs.length; i++) NVData.starredMap.song[songs[i].id] = true;
    for(i = 0; i < albums.length; i++) NVData.starredMap.album[albums[i].id] = true;
    for(i = 0; i < artists.length; i++) NVData.starredMap.artist[artists[i].id] = true;
    NVData.starred.songs = songs;
    NVData.starred.albums = albums;
    NVData.starred.artists = artists;
    NVData.starred.loaded = true;
    if(cb) cb(NVData.starred);
    repaintAll();
  });
}

function nvFetchRandomSongs(count, append, cb){
  if(NVData.randomMix.loading) return;
  var c = nvConnection();
  NVData.randomMix.loading = true; NVData.randomMix.err = '';
  repaintAll();
  var params = nvFolderParams();
  params.size = count || 80;
  nvApiRequest(c, 'getRandomSongs', params, function(body, meta){
    NVData.randomMix.loading = false;
    if(!body){
      NVData.randomMix.err = (meta && meta.error) || T('err.random_load_failed');
      if(cb) cb([]);
      repaintAll();
      return;
    }
    var batch = nvAsArr(body.randomSongs && body.randomSongs.song).map(nvNormSong);
    if(append){
      var seen = {}, i;
      for(i = 0; i < NVData.randomMix.songs.length; i++) seen[NVData.randomMix.songs[i].id] = true;
      for(i = 0; i < batch.length; i++) if(!seen[batch[i].id]){ NVData.randomMix.songs.push(batch[i]); seen[batch[i].id] = true; }
    } else NVData.randomMix.songs = batch;
    NVData.randomMix.ts = Date.now();
    if(cb) cb(batch);
    repaintAll();
  });
}

function nvRunSearch(query){
  var q = String(query || '').trim();
  NVData.search.query = q;
  if(!q){
    NVData.search.requested = '';
    NVData.search.artists = [];
    NVData.search.albums = [];
    NVData.search.songs = [];
    NVData.search.loading = false;
    NVData.search.err = '';
    return;
  }
  if(q === NVData.search.requested) return;
  NVData.search.requested = q;
  NVData.search.loading = true;
  NVData.search.err = '';
  var c = nvConnection();
  var params = nvFolderParams();
  params.query = q; params.artistCount = 24; params.albumCount = 24; params.songCount = 80;
  nvApiRequest(c, 'search3', params, function(body, meta){
    if(NVData.search.requested !== q) return;
    NVData.search.loading = false;
    if(!body){ NVData.search.err = (meta && meta.error) || T('err.search_failed'); repaintAll(); return; }
    var r3 = body.searchResult3 || {};
    NVData.search.artists = nvAsArr(r3.artist).map(nvNormArtist);
    NVData.search.albums = nvAsArr(r3.album).map(nvNormAlbum);
    NVData.search.songs = nvAsArr(r3.song).map(nvNormSong);
    repaintAll();
  });
}

function nvEnsureLoaded(){
  if(NVData.initDone) return;
  NVData.initDone = true;
  nvFetchPlaylists(false);
  nvFetchAlbums('recent', false, false);
  nvFetchAlbums('newest', false, false);
  nvFetchStarred(false);
}

function nvRefreshAll(clearArt){
  NVApi.connCache = null;
  NVData.playlistsLoaded = false;
  NVData.plDetails = {};
  NVData.albumsByTab = {};
  NVData.albumDetails = {};
  NVData.artists = null;
  NVData.artistDetails = {};
  NVData.starred.loaded = false;
  NVData.search.requested = '';
  if(clearArt && typeof nvClearAllArt === 'function') nvClearAllArt();
  nvFetchPlaylists(true);
  var curAlbTab = NVData.albumsTab || 'recent';
  nvFetchAlbums(curAlbTab, false, true);
  if(curAlbTab !== 'recent') nvFetchAlbums('recent', false, true);
  if(curAlbTab !== 'newest') nvFetchAlbums('newest', false, true);
  nvFetchStarred(true);
  if(typeof brRefreshActiveDetail === 'function') brRefreshActiveDetail();
}

function nvToggleStar(kind, id, itemObj, cb){
  if(!id) return;
  var c = nvConnection(); if(!c) return;
  var prev = nvIsStarred(kind, id), next = !prev;
  NVData.starredMap[kind][id] = next;
  if(kind === 'song'){
    if(next && itemObj){
      var has = false, i;
      for(i = 0; i < NVData.starred.songs.length; i++) if(NVData.starred.songs[i].id === id){ has = true; break; }
      if(!has) NVData.starred.songs.unshift(itemObj);
    } else {
      NVData.starred.songs = NVData.starred.songs.filter(function(s){ return s.id !== id; });
    }
  } else if(kind === 'album'){
    if(next && itemObj){
      NVData.starred.albums = [itemObj].concat(NVData.starred.albums.filter(function(a){ return a.id !== id; }));
    } else NVData.starred.albums = NVData.starred.albums.filter(function(a){ return a.id !== id; });
  } else if(kind === 'artist'){
    if(next && itemObj){
      NVData.starred.artists = [itemObj].concat(NVData.starred.artists.filter(function(a){ return a.id !== id; }));
    } else NVData.starred.artists = NVData.starred.artists.filter(function(a){ return a.id !== id; });
  }
  repaintAll();

  var params = {};
  if(kind === 'song') params.id = id;
  else if(kind === 'album') params.albumId = id;
  else if(kind === 'artist') params.artistId = id;

  nvApiRequest(c, next ? 'star' : 'unstar', params, function(body){
    if(!body){
      NVData.starredMap[kind][id] = prev;   // roll back on failure
      NVData.starred.loaded = false;
      repaintAll();
    }
    if(cb) cb(!!body, next);
  });
}

function nvCreateServerPlaylist(name, songIds, cb){
  var nm = String(name || '').trim();
  if(!nm) return;
  var c = nvConnection();
  var params = { name: nm };
  if(songIds && songIds.length) params.songId = songIds.slice(0, 50);
  nvApiRequest(c, 'createPlaylist', params, function(body, meta){
    if(!body){ if(cb) cb(null, meta); return; }
    var pl = body.playlist ? nvNormPlaylist(body.playlist) : null;
    if(pl && !nvPlaylistById(pl.id)) NVData.playlists.push(pl);
    if(pl && body.playlist && body.playlist.entry){
      NVData.plDetails[pl.id] = {
        meta: pl,
        songs: nvAsArr(body.playlist.entry).map(nvNormSong),
        loading: false,
        err: '',
        ts: Date.now()
      };
    }
    NVData.playlistsLoaded = false;
    nvFetchPlaylists(true, function(){
      if(!pl && NVData.playlists.length){
        for(var i = NVData.playlists.length - 1; i >= 0; i--){
          if(NVData.playlists[i].name === nm){ pl = NVData.playlists[i]; break; }
        }
      }
      if(cb) cb(pl, meta);
    });
  });
}

function nvRenameServerPlaylist(id, newName, cb){
  var nm = String(newName || '').trim();
  if(!id || !nm) return;
  var c = nvConnection();
  nvApiRequest(c, 'updatePlaylist', { playlistId: id, name: nm }, function(body, meta){
    if(!body){ if(cb) cb(false, meta); return; }
    var slot = nvPlaylistById(id), oldName = slot ? slot.name : '';
    if(slot) slot.name = nm;
    if(NVData.plDetails[id] && NVData.plDetails[id].meta) NVData.plDetails[id].meta.name = nm;
    if(typeof pbSource === 'object' && pbSource && pbSource.id === id) pbSource.name = nm;
    if(typeof shufSrcName === 'string' && oldName && shufSrcName === oldName) shufSrcName = nm;
    if(typeof routeSrcName === 'string' && oldName && routeSrcName === oldName) routeSrcName = nm;
    NVData.playlistsLoaded = false;
    nvFetchPlaylists(true);
    if(cb) cb(true, meta);
  });
}

function nvDeleteServerPlaylist(id, cb){
  if(!id) return;
  var c = nvConnection();
  nvApiRequest(c, 'deletePlaylist', { id: id }, function(body, meta){
    if(!body){ if(cb) cb(false, meta); return; }
    NVData.playlists = NVData.playlists.filter(function(p){ return p.id !== id; });
    delete NVData.plDetails[id];
    if(cb) cb(true, meta);
    repaintAll();
  });
}

function nvAddSongsToServerPlaylist(plId, songs, cb){
  if(!plId || !songs || !songs.length){ if(cb) cb(false); return; }
  var ids = [], i;
  for(i = 0; i < songs.length; i++) if(songs[i] && songs[i].id) ids.push(songs[i].id);
  if(!ids.length){ if(cb) cb(false); return; }

  var c = nvConnection(), offset = 0, CHUNK = 50;
  function step(){
    if(offset >= ids.length){
      delete NVData.plDetails[plId];
      nvFetchPlaylists(true);
      if(typeof brView === 'string' && brView === 'playlist' && brViewId === plId) nvFetchPlaylistDetail(plId, true);
      if(cb) cb(true);
      return;
    }
    var part = ids.slice(offset, offset + CHUNK);
    offset += CHUNK;
    nvApiRequest(c, 'updatePlaylist', { playlistId: plId, songIdToAdd: part }, function(body){
      if(!body){ if(cb) cb(false); return; }
      step();
    });
  }
  step();
}

function nvRemoveSongFromServerPlaylist(plId, songIdx, cb){
  if(!plId || songIdx < 0) return;
  var c = nvConnection();
  nvApiRequest(c, 'updatePlaylist', { playlistId: plId, songIndexToRemove: songIdx }, function(body){
    if(!body){ if(cb) cb(false); return; }
    var d = NVData.plDetails[plId];
    if(d && d.songs && songIdx < d.songs.length){
      d.songs.splice(songIdx, 1);
      var tot = 0; for(var i = 0; i < d.songs.length; i++) tot += d.songs[i].duration;
      if(d.meta){ d.meta.songCount = d.songs.length; d.meta.duration = tot; }
      var slot = nvPlaylistById(plId);
      if(slot){ slot.songCount = d.songs.length; slot.duration = tot; }
    }
    nvFetchPlaylists(true);
    if(cb) cb(true);
    repaintAll();
  });
}
