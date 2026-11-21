/* verdant/data/source_local.js -- Local MusicSource adapter (foobar2000 library + playlists + stats + loved tags)
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

var localIdx = null;
var localIdxVer = 0;
var localAlbumsTab = 'recent';
var localRandomIndices = [];
var localRandomRowsCache = null;
var localLovedCache = { ver: -1, idxVer: -1, rows: EMPTY_ROWS };
var localPlRowsCache = {};
var localSearchCache = { q: null, idxVer: -1, res: null };

var LOCAL_FIELDS = ['title', 'artist', 'artistName', 'album', 'len', 'lensec', 'albkey', 'trackno', 'year', 'addedOrMod', 'loved'];

function localOnLibraryChanged(){
  localIdx = null;
  localIdxVer++;
  localRandomIndices = [];
  localRandomRowsCache = null;
  localLovedCache.ver = -1;
  localSearchCache.idxVer = -1;
  if(typeof clearCoverHandles === 'function') clearCoverHandles();
  if(typeof lovedInvalidate === 'function') lovedInvalidate();
}

function localOnItemsChanged(){
  localPlRowsCache = {};
}

function localOnPlaylistsChanged(){
  localPlRowsCache = {};
  if(typeof libSource === 'string' && libSource === 'local' && typeof view === 'string' && view === 'browse' && typeof brView === 'string' && brView === 'playlist'){
    var pi = parseInt(brViewId, 10);
    if(isNaN(pi) || pi < 0 || pi >= plman.PlaylistCount || isHiddenPl(plName(pi))){
      if(typeof brOpenHome === 'function') brOpenHome();
    } else {
      brViewTitle = plName(pi);
    }
  }
}

function localHandleForAlbumKey(key){
  return (localIdx && localIdx.albFirstHandle && localIdx.albFirstHandle[key]) || null;
}

function localHandleForId(id){
  if(!id) return null;
  if(localIdx && localIdx.handlesById && localIdx.handlesById[id]) return localIdx.handlesById[id];
  var lib = libItems();
  if(lib && lib.Count){
    for(var i = 0; i < lib.Count; i++){
      var h = lib[i];
      if(h && lovedTrackId(h) === id) return h;
    }
  }
  return null;
}

function localBuildIdxNow(){
  var lib = libItems();
  var idx = {
    albums: [],
    albumsById: {},
    albFirstHandle: {},
    artists: [],
    artistsById: {},
    handlesById: {},
    albTabLists: {},
    albTabLimits: {},
    statsVer: (typeof statsVersion === 'number') ? statsVersion : 0,
    libRef: lib
  };
  if(!lib || !lib.Count){
    if(!artistList) artistList = [];
    if(!artistTracksMap) artistTracksMap = {};
    localIdx = idx;
    localIdxVer++;
    return;
  }

  var ti = libTF('title'), ar = libTF('artist'), aa = libTF('artistName'),
      al = libTF('album'), ls = libTF('lensec'), ak = libTF('albkey'),
      tn = libTF('trackno'), yr = libTF('year'), added = libTF('addedOrMod');
  var albOrder = [], artMap = {}, artSeen = {};
  if(!artistTracksMap) artistTracksMap = {};

  var i, n = lib.Count;
  for(i = 0; i < n; i++){
    var h = lib[i];
    if(!h) continue;
    var tid = lovedTrackId(h);
    if(tid && !idx.handlesById[tid]) idx.handlesById[tid] = h;

    var arName = aa[i] || ar[i] || T('meta.unknown_artist');
    var alName = al[i] || T('meta.unknown_album');
    var aKey = ak[i] || (arName + ' - ' + alName);
    var sec = parseInt(ls[i], 10) || Math.round(h.Length || 0) || 0;
    var yStr = String(yr[i] || '');
    var mod = String(added[i] || '');

    if(typeof registerCoverHandle === 'function') registerCoverHandle(aKey, h);
    if(!idx.albFirstHandle[aKey]) idx.albFirstHandle[aKey] = h;

    var alb = idx.albumsById[aKey];
    if(!alb){
      alb = {
        meta: {
          id: aKey,
          name: alName,
          artist: arName,
          artistId: arName,
          year: yStr,
          songCount: 0,
          duration: 0,
          coverArt: 'local:' + aKey,
          loved: false
        },
        trackIndices: [],
        newestVal: mod,
        nameK: alName.toLowerCase()
      };
      idx.albumsById[aKey] = alb;
      albOrder.push(alb);
    }
    alb.trackIndices.push(i);
    alb.meta.songCount++;
    alb.meta.duration += sec;
    if(!alb.meta.year && yStr) alb.meta.year = yStr;
    if(mod && mod > alb.newestVal) alb.newestVal = mod;

    if(!artistTracksMap[arName]) artistTracksMap[arName] = [];
    artistTracksMap[arName].push(h);
    if(!artSeen[arName]) artSeen[arName] = true;

    var art = artMap[arName];
    if(!art){
      art = {
        meta: {
          id: arName,
          name: arName,
          albumCount: 0,
          coverArt: 'localar:' + arName,
          loved: false
        },
        albumSet: {},
        albums: [],
        trackIndices: [],
        nameK: arName.toLowerCase()
      };
      artMap[arName] = art;
      idx.artistsById[arName] = art;
      idx.artists.push(art.meta);
    }
    art.trackIndices.push(i);
    if(!art.albumSet[aKey]){
      art.albumSet[aKey] = true;
      art.albums.push(alb.meta);
      art.meta.albumCount = art.albums.length;
    }
  }

  for(i = 0; i < albOrder.length; i++){
    var ae = albOrder[i];
    ae.trackIndices.sort(function(ia, ib){
      var ta = parseInt(tn[ia], 10) || 0, tb = parseInt(tn[ib], 10) || 0;
      if(ta !== tb) return ta - tb;
      var sa = String(ti[ia] || '').toLowerCase(), sb = String(ti[ib] || '').toLowerCase();
      return sa < sb ? -1 : (sa > sb ? 1 : (ia - ib));
    });
    idx.albums.push(ae.meta);
  }

  idx.artists.sort(function(a, b){
    var an = a.name.toLowerCase(), bn = b.name.toLowerCase();
    return an < bn ? -1 : (an > bn ? 1 : 0);
  });

  if(!artistList){
    var outList = [];
    for(var nm in artSeen){
      if(Object.prototype.hasOwnProperty.call(artSeen, nm) && artistTracksMap[nm] && artistTracksMap[nm].length){
        outList.push({ name: nm, handle: artistTracksMap[nm][0] });
      }
    }
    outList.sort(function(a, b){
      var an = a.name.toLowerCase(), bn = b.name.toLowerCase();
      return an < bn ? -1 : (an > bn ? 1 : 0);
    });
    artistList = outList;
  }

  localIdx = idx;
  localIdxVer++;
}

function localIdxSteps(){
  var steps = [];
  for(var i = 0; i < LOCAL_FIELDS.length; i++){
    steps.push((function(f){ return function(){ libTF(f); }; })(LOCAL_FIELDS[i]));
  }
  steps.push(function(){ if(typeof statsEnsureImported === 'function') statsEnsureImported(); });
  steps.push(function(){ if(typeof lovedEnsureScanned === 'function') lovedEnsureScanned(); });
  steps.push(function(){ localBuildIdxNow(); });
  return steps;
}

function localEnsureBuilt(){
  return ensureBuilt('localIdx', function(){ return !!localIdx; }, localIdxSteps);
}

function localSongAtLibIdx(i){
  var lib = libItems();
  if(!lib || i < 0 || i >= lib.Count) return null;
  var h = lib[i];
  if(!h) return null;
  var ti = libTF('title'), ar = libTF('artist'), aa = libTF('artistName'),
      al = libTF('album'), ls = libTF('lensec'), ak = libTF('albkey'), tn = libTF('trackno');
  var arName = aa[i] || ar[i] || T('meta.unknown_artist');
  var alName = al[i] || T('meta.unknown_album');
  var aKey = ak[i] || (arName + ' - ' + alName);
  if(typeof registerCoverHandle === 'function') registerCoverHandle(aKey, h);
  return {
    id: lovedTrackId(h),
    title: ti[i] || T('meta.unknown_title'),
    artist: ar[i] || '',
    album: al[i] || '',
    albumId: aKey,
    artistId: arName,
    albumArtist: arName,
    track: parseInt(tn[i], 10) || 0,
    duration: parseInt(ls[i], 10) || Math.round(h.Length || 0) || 0,
    coverArt: 'local:' + aKey,
    loved: lovedIsHandleLoved(h),
    src: 'local',
    h: h
  };
}

function localMakeLibIndexRows(indices){
  var arr = Array.isArray(indices) ? indices : [];
  if(!arr.length) return EMPTY_ROWS;
  return {
    count: arr.length,
    get: function(i){ return (i >= 0 && i < arr.length) ? localSongAtLibIdx(arr[i]) : null; },
    all: function(){
      var out = [];
      for(var i = 0; i < arr.length; i++){
        var s = localSongAtLibIdx(arr[i]);
        if(s) out.push(s);
      }
      return out;
    }
  };
}

function localPlaylistMeta(pi){
  if(isNaN(pi) || pi < 0 || pi >= plman.PlaylistCount) return null;
  var nm = plName(pi);
  if(isHiddenPl(nm)) return null;
  var m = plMetaMap[pi];
  return {
    id: String(pi),
    name: nm || T('meta.untitled_playlist'),
    songCount: plCount(pi),
    duration: m ? (m.totalSec || 0) : 0,
    coverArt: 'localpl:' + pi,
    editable: (typeof canEditPl === 'function') ? canEditPl(pi) : true,
    src: 'local'
  };
}

function localPlaylistRows(pi){
  var items = getItems(pi);
  var meta = getMeta(pi);
  var c = localPlRowsCache[pi];
  if(c && c.meta === meta && c.count === (items ? items.Count : 0)) return c.rows;

  var n = items ? Math.min(items.Count, meta.title.length) : 0;
  var rows;
  if(!n){
    rows = EMPTY_ROWS;
  } else {
    var keys = plKeys(pi);
    function songAt(i){
      if(i < 0 || i >= n) return null;
      var h = items[i];
      if(!h) return null;
      var aKey = (meta.artkey && meta.artkey[i]) ? meta.artkey[i] : '';
      var aa = (meta.artistName && meta.artistName[i]) || (meta.artist && meta.artist[i]) || '';
      if(aKey && typeof registerCoverHandle === 'function') registerCoverHandle(aKey, h);
      return {
        id: lovedTrackId(h),
        title: (meta.title && meta.title[i]) || T('meta.unknown_title'),
        artist: (meta.artist && meta.artist[i]) || '',
        album: (meta.album && meta.album[i]) || '',
        albumId: (localIdx && localIdx.albumsById[aKey]) ? aKey : '',
        artistId: (localIdx && localIdx.artistsById[aa]) ? aa : '',
        albumArtist: aa,
        track: (meta.trackno && parseInt(meta.trackno[i], 10)) || 0,
        duration: (meta.lensec && parseInt(meta.lensec[i], 10)) || Math.round(h.Length || 0) || 0,
        coverArt: aKey ? ('local:' + aKey) : '',
        loved: lovedIsHandleLoved(h),
        src: 'local',
        h: h
      };
    }
    rows = {
      count: n,
      sortKeys: {
        title: keys.t,
        artist: keys.a,
        album: keys.l,
        dur: meta.lensec || []
      },
      get: songAt,
      all: function(){
        var out = [];
        for(var k = 0; k < n; k++){
          var s = songAt(k);
          if(s) out.push(s);
        }
        return out;
      }
    };
  }
  localPlRowsCache[pi] = { meta: meta, count: n, rows: rows };
  return rows;
}

function localSortAlbumTab(tab, force){
  if(!localIdx) return [];
  var stVer = (typeof statsVersion === 'number') ? statsVersion : 0;
  if((tab === 'recent' || tab === 'frequent') && localIdx.statsVer !== stVer){
    delete localIdx.albTabLists.recent;
    delete localIdx.albTabLists.frequent;
    localIdx.statsVer = stVer;
  }
  if(force || !localIdx.albTabLists[tab]){
    var base = localIdx.albums.slice();
    var byId = localIdx.albumsById;
    var out = base;
    if(tab === 'newest'){
      out.sort(function(a, b){
        var na = byId[a.id].newestVal, nb = byId[b.id].newestVal;
        if(na !== nb) return na > nb ? -1 : 1;
        var ka = byId[a.id].nameK, kb = byId[b.id].nameK;
        return ka < kb ? -1 : (ka > kb ? 1 : 0);
      });
    } else if(tab === 'alphabeticalByName'){
      out.sort(function(a, b){
        var ka = byId[a.id].nameK, kb = byId[b.id].nameK;
        return ka < kb ? -1 : (ka > kb ? 1 : 0);
      });
    } else if(tab === 'random'){
      shuffleArr(out);
    } else if(tab === 'recent'){
      var played = [];
      for(var i = 0; i < out.length; i++){
        var inf = statsAlbumInfo(out[i].id);
        if(inf.lastPlayed > 0) played.push(out[i]);
      }
      if(played.length){
        played.sort(function(a, b){
          return statsAlbumInfo(b.id).lastPlayed - statsAlbumInfo(a.id).lastPlayed;
        });
        out = played;
      } else {
        out = localSortAlbumTab('newest', false).slice();
      }
    } else if(tab === 'frequent'){
      var freq = [];
      for(var j = 0; j < out.length; j++){
        if(statsAlbumInfo(out[j].id).count > 0) freq.push(out[j]);
      }
      if(freq.length){
        freq.sort(function(a, b){
          var sa = statsAlbumInfo(a.id), sb = statsAlbumInfo(b.id);
          if(sb.count !== sa.count) return sb.count - sa.count;
          return sb.lastPlayed - sa.lastPlayed;
        });
        out = freq;
      } else {
        out = localSortAlbumTab('alphabeticalByName', false).slice();
      }
    }
    localIdx.albTabLists[tab] = out;
    if(!localIdx.albTabLimits[tab] || force) localIdx.albTabLimits[tab] = 60;
  }
  return localIdx.albTabLists[tab];
}

function localExtractHandles(rowsOrSongs){
  var out = [], i, s, h;
  if(!rowsOrSongs) return out;
  if(typeof rowsOrSongs.count === 'number' && typeof rowsOrSongs.get === 'function'){
    for(i = 0; i < rowsOrSongs.count; i++){
      s = rowsOrSongs.get(i);
      h = (s && s.h) || (s && s.id ? localHandleForId(s.id) : null);
      if(h) out.push(h);
    }
    return out;
  }
  if(Array.isArray(rowsOrSongs)){
    for(i = 0; i < rowsOrSongs.length; i++){
      s = rowsOrSongs[i];
      if(!s) continue;
      h = s.Path ? s : (s.h || (s.id ? localHandleForId(s.id) : null));
      if(h) out.push(h);
    }
  }
  return out;
}

function localInsertSongsToPlaylist(pi, songs){
  if(isNaN(pi) || pi < 0 || pi >= plman.PlaylistCount || !canEditPl(pi)) return false;
  var handles = localExtractHandles(songs);
  if(!handles.length) return false;
  var hl = fb.CreateHandleList();
  for(var i = 0; i < handles.length; i++) hl.Add(handles[i]);
  try{
    plman.UndoBackup(pi);
    plman.InsertPlaylistItems(pi, plman.PlaylistItemCount(pi), hl, false);
  }catch(e){
    return false;
  }
  invalidateItems();
  repaintAll();
  return true;
}

function localPickRandomIndices(count, avoidRecent){
  var lib = libItems();
  var n = lib ? lib.Count : 0;
  if(!n) return [];
  var take = Math.min(count || 80, n);
  var pool = [];
  var i;
  var avoid = null;
  if(avoidRecent && localRandomIndices.length && n > take){
    avoid = {};
    var tailStart = Math.max(0, localRandomIndices.length - 80);
    for(i = tailStart; i < localRandomIndices.length; i++) avoid[localRandomIndices[i]] = true;
  }
  for(i = 0; i < n; i++){
    if(!avoid || !avoid[i]) pool.push(i);
  }
  if(pool.length < take){
    pool = [];
    for(i = 0; i < n; i++) pool.push(i);
  }
  shuffleArr(pool);
  return pool.slice(0, take);
}

var LOCAL_SOURCE = {
  id: 'local',
  caps: {
    albumTabs: ['recent', 'newest', 'frequent', 'random', 'alphabeticalByName'],
    topSongs: true,
    lovedKinds: ['song'],
    randomMix: true,
    playlistEdit: 'foobar',
    multiServer: false,
    allSongs: true
  },

  ensureLoaded: function(){ localEnsureBuilt(); },
  refresh: function(clearArt){
    invalidateItems();
    invalidateLibrary();
    if(clearArt && typeof coverClearAll === 'function') coverClearAll();
    if(typeof clearBrCardCache === 'function') clearBrCardCache();
    localEnsureBuilt();
    repaintAll();
  },

  playlists: function(){
    var pis = visiblePlaylists();
    var out = [];
    for(var i = 0; i < pis.length; i++){
      var pm = localPlaylistMeta(pis[i]);
      if(pm) out.push(pm);
    }
    return { list: out, loading: false, catalogLoading: false, loaded: true, err: '' };
  },
  playlistById: function(id){ return localPlaylistMeta(parseInt(id, 10)); },
  playlist: function(id){
    var pi = parseInt(id, 10);
    var meta = localPlaylistMeta(pi);
    if(!meta) return { meta: null, songs: [], rows: EMPTY_ROWS, loading: false, err: '' };
    var ready = ensureBuilt('meta' + pi, function(){ return metaReady(pi); }, function(){ return metaSteps(pi); });
    if(!ready) return { meta: meta, songs: [], rows: EMPTY_ROWS, loading: true, err: '' };
    var rows = localPlaylistRows(pi);
    return { meta: localPlaylistMeta(pi), songs: [], rows: rows, loading: false, err: '' };
  },
  fetchPlaylist: function(id, force, cb){
    var pi = parseInt(id, 10);
    if(isNaN(pi) || pi < 0 || pi >= plman.PlaylistCount){ if(cb) cb(null); return; }
    if(force){ delete plMetaMap[pi]; delete localPlRowsCache[pi]; }
    var res = this.playlist(id);
    if(cb) cb(res);
  },

  albumsTab: function(){ return localAlbumsTab || 'recent'; },
  setAlbumsTab: function(tab){ localAlbumsTab = tab || 'recent'; },
  albums: function(tab){
    localEnsureBuilt();
    if(!localIdx) return { list: [], loading: true, err: '', hasMore: false };
    var key = tab || localAlbumsTab || 'recent';
    var full = localSortAlbumTab(key, false);
    var lim = localIdx.albTabLimits[key] || 60;
    return {
      list: full.slice(0, lim),
      loading: false,
      err: '',
      hasMore: lim < full.length
    };
  },
  fetchAlbums: function(tab, append, force, cb){
    localEnsureBuilt();
    if(localIdx){
      var key = tab || localAlbumsTab || 'recent';
      if(force) delete localIdx.albTabLists[key];
      localSortAlbumTab(key, !!force);
      if(append) localIdx.albTabLimits[key] = (localIdx.albTabLimits[key] || 60) + 60;
    }
    if(cb) cb(this.albums(tab));
    else repaintMain();
  },
  loadMoreAlbums: function(tab){
    if(!localIdx) return;
    var key = tab || localAlbumsTab || 'recent';
    localIdx.albTabLimits[key] = (localIdx.albTabLimits[key] || 60) + 60;
    repaintMain();
  },

  album: function(id){
    localEnsureBuilt();
    if(!localIdx) return { meta: null, songs: [], rows: EMPTY_ROWS, loading: true, err: '' };
    var e = localIdx.albumsById[id];
    if(!e) return { meta: null, songs: [], rows: EMPTY_ROWS, loading: false, err: '' };
    if(!e._rows) e._rows = localMakeLibIndexRows(e.trackIndices);
    return { meta: e.meta, songs: [], rows: e._rows, loading: false, err: '' };
  },
  fetchAlbum: function(id, force, cb){
    localEnsureBuilt();
    if(cb) cb(this.album(id));
  },

  artists: function(){
    localEnsureBuilt();
    if(!localIdx) return { list: [], loaded: false, loading: true, err: '' };
    return { list: localIdx.artists, loaded: true, loading: false, err: '' };
  },
  fetchArtists: function(force, cb){
    if(force) localOnLibraryChanged();
    localEnsureBuilt();
    if(cb) cb(this.artists());
  },

  artist: function(id, nameHint){
    localEnsureBuilt();
    if(!localIdx){
      return {
        meta: { id: id, name: nameHint || '', albumCount: 0, coverArt: 'localar:' + (nameHint || id), loved: false },
        albums: [],
        topSongs: [],
        topRows: EMPTY_ROWS,
        loading: true,
        err: ''
      };
    }
    var e = localIdx.artistsById[id] || localIdx.artistsById[nameHint || ''];
    if(!e){
      return {
        meta: { id: id, name: nameHint || id, albumCount: 0, coverArt: '', loved: false },
        albums: [],
        topSongs: [],
        topRows: EMPTY_ROWS,
        loading: false,
        err: ''
      };
    }
    var stVer = (typeof statsVersion === 'number') ? statsVersion : 0;
    if(!e._topRows || e._topStatsVer !== stVer){
      var lib = libItems();
      var played = [];
      for(var i = 0; i < e.trackIndices.length; i++){
        var ti = e.trackIndices[i];
        var cnt = (lib && lib[ti]) ? statsTrackCount(lib[ti]) : 0;
        if(cnt > 0) played.push({ ti: ti, cnt: cnt });
      }
      played.sort(function(a, b){ return b.cnt - a.cnt || (a.ti - b.ti); });
      var topIdx = [];
      for(var j = 0; j < played.length && j < 10; j++) topIdx.push(played[j].ti);
      e._topRows = localMakeLibIndexRows(topIdx);
      e._topStatsVer = stVer;
    }
    return {
      meta: e.meta,
      albums: e.albums,
      topSongs: [],
      topRows: e._topRows,
      loading: false,
      err: ''
    };
  },
  fetchArtist: function(id, nameHint, force, cb){
    localEnsureBuilt();
    if(cb) cb(this.artist(id, nameHint));
  },

  loved: function(){
    localEnsureBuilt();
    if(!localIdx) return { songs: [], rows: EMPTY_ROWS, albums: [], artists: [], loaded: false, loading: true, err: '' };
    lovedEnsureScanned();
    if(localLovedCache.ver !== lovedVersion || localLovedCache.idxVer !== localIdxVer){
      var lib = libItems();
      var out = [];
      if(lib && lib.Count){
        for(var i = 0; i < lib.Count; i++){
          if(lovedIsHandleLoved(lib[i])) out.push(i);
        }
      }
      localLovedCache = { ver: lovedVersion, idxVer: localIdxVer, rows: localMakeLibIndexRows(out) };
    }
    return { songs: [], rows: localLovedCache.rows, albums: [], artists: [], loaded: true, loading: false, err: '' };
  },
  fetchLoved: function(force, cb){
    if(force) lovedInvalidate();
    lovedEnsureScanned();
    if(cb) cb(this.loved());
  },

  random: function(){
    localEnsureBuilt();
    if(!localRandomRowsCache) localRandomRowsCache = localMakeLibIndexRows(localRandomIndices);
    return { songs: [], rows: localRandomRowsCache, loading: false, err: '' };
  },
  fetchRandom: function(count, append, cb){
    localEnsureBuilt();
    var picked = localPickRandomIndices(count || 80, !!append);
    if(append){
      for(var i = 0; i < picked.length; i++) localRandomIndices.push(picked[i]);
    } else {
      localRandomIndices = picked;
    }
    localRandomRowsCache = localMakeLibIndexRows(localRandomIndices);
    var out = [];
    var lib = libItems();
    for(var j = 0; j < picked.length; j++) if(lib && lib[picked[j]]) out.push(lib[picked[j]]);
    if(cb) cb(out);
    repaintMain();
  },
  randomMore: function(count, cb){ this.fetchRandom(count || 40, true, cb); },
  randomRebatch: function(count, cb){ this.fetchRandom(count || 80, false, cb); },

  search: function(query){
    var q = String(query || '').trim();
    if(!q){
      localSearchCache = { q: '', idxVer: localIdxVer, res: { query: '', requested: '', artists: [], albums: [], songs: [], rows: EMPTY_ROWS, loading: false, err: '' } };
      return;
    }
    localEnsureBuilt();
    if(localSearchCache.q === q && localSearchCache.idxVer === localIdxVer && localSearchCache.res) return;
    var ql = q.toLowerCase();
    var arts = [], albs = [], songIndices = [];
    if(localIdx){
      for(var i = 0; i < localIdx.artists.length && arts.length < 24; i++){
        var ar = localIdx.artists[i];
        if(ar.name.toLowerCase().indexOf(ql) >= 0) arts.push(ar);
      }
      for(var j = 0; j < localIdx.albums.length && albs.length < 30; j++){
        var al = localIdx.albums[j];
        if((al.name + ' ' + al.artist).toLowerCase().indexOf(ql) >= 0) albs.push(al);
      }
    }
    var lib = libItems();
    if(lib && lib.Count){
      var t = libTF('title'), a = libTF('artist'), alb = libTF('album');
      for(var k = 0; k < lib.Count && songIndices.length < 150; k++){
        var key = (t[k] + ' ' + a[k] + ' ' + alb[k]).toLowerCase();
        if(key.indexOf(ql) >= 0) songIndices.push(k);
      }
    }
    localSearchCache = {
      q: q,
      idxVer: localIdxVer,
      res: {
        query: q,
        requested: q,
        artists: arts,
        albums: albs,
        songs: [],
        rows: localMakeLibIndexRows(songIndices),
        loading: false,
        err: ''
      }
    };
  },
  searchResults: function(){
    var q = (typeof searchQuery === 'string') ? searchQuery.trim() : '';
    if(!q) return { query: '', requested: '', artists: [], albums: [], songs: [], rows: EMPTY_ROWS, loading: false, err: '' };
    if(localSearchCache.q !== q || localSearchCache.idxVer !== localIdxVer || !localSearchCache.res){
      this.search(q);
    }
    return localSearchCache.res || { query: q, requested: q, artists: [], albums: [], songs: [], rows: EMPTY_ROWS, loading: false, err: '' };
  },
  resetSearch: function(){ localSearchCache = { q: null, idxVer: -1, res: null }; },

  isLoved: function(kind, id, obj){
    if(kind !== 'song') return false;
    return lovedIsIdLoved(id, obj && obj.h);
  },
  toggleLoved: function(kind, id, obj, cb){
    if(kind !== 'song'){ if(cb) cb(false); return; }
    var h = (obj && obj.Path) ? obj : ((obj && obj.h) ? obj.h : localHandleForId(id));
    lovedToggleLocal(h, cb);
  },
  isTrackPlaying: function(song){
    if(!song || (!fb.IsPlaying && !fb.IsPaused) || !NP) return false;
    if(song.h) return sameHandle(song.h, NP);
    return lovedTrackId(NP) === song.id;
  },
  trackId: function(h){ return lovedTrackId(h); },
  trackObj: function(h){
    if(!h) return null;
    return {
      id: lovedTrackId(h),
      title: npTitleStr || TF.title.EvalWithMetadb(h),
      artist: npArtistStr || TF.artist.EvalWithMetadb(h),
      album: TF.album.EvalWithMetadb(h),
      src: 'local',
      h: h
    };
  },

  play: function(rowsOrSongs, startIdx, sourceMeta, forceShuffle){
    var handles = localExtractHandles(rowsOrSongs);
    if(!handles.length) return;
    startIdx = Math.max(0, Math.min(handles.length - 1, startIdx || 0));
    if(forceShuffle !== undefined){
      pbShuffle = !!forceShuffle;
      applyPlaybackOrder();
    }
    var meta = sourceMeta || {};
    var name = meta.name || T('source.local');
    playHandleList(handles, startIdx, name, {
      src: 'local',
      kind: 'local',
      subKind: meta.subKind || 'list',
      id: meta.id || '',
      name: name
    });
    updateNP();
    repaintAll();
  },
  enqueue: function(rowsOrSongs){
    var handles = localExtractHandles(rowsOrSongs);
    for(var i = 0; i < handles.length; i++){
      try{ plman.AddItemToPlaybackQueue(handles[i]); }catch(e){}
    }
    if(handles.length) repaintAll();
  },
  maybeTopUpRandom: function(){
    if(!pbSource || pbSource.subKind !== 'random') return;
    if(pbSource.src !== 'local' && pbSource.kind !== 'local') return;
    var loc = playingLoc();
    if(!loc || !loc.IsValid) return;
    var pi = loc.PlaylistIndex;
    var nm = plName(pi);
    if(nm !== ROUTE && nm !== SHUF) return;
    var rem = plman.PlaylistItemCount(pi) - loc.PlaylistItemIndex - 1;
    if(rem > 5) return;
    this.randomMore(40, function(handles){
      if(handles && handles.length) appendRandomHandlesToRouteShuf(handles);
    });
  },

  servers: function(){ return []; },
  activeServer: function(){ return null; },

  playlistOps: {
    create: function(name, songIds, cb){
      var nm = String(name || '').trim() || newPlaylistName();
      var pi = plman.CreatePlaylist(plman.PlaylistCount, nm);
      if(songIds && songIds.length){
        var hl = fb.CreateHandleList();
        for(var i = 0; i < songIds.length; i++){
          var h = localHandleForId(songIds[i]);
          if(h) hl.Add(h);
        }
        if(hl.Count){
          try{ plman.InsertPlaylistItems(pi, 0, hl, false); }catch(e){}
        }
      }
      invalidateItems();
      if(cb) cb(localPlaylistMeta(pi));
      repaintAll();
    },
    rename: function(id, newName, cb){
      var pi = parseInt(id, 10);
      var nm = String(newName || '').trim();
      if(isNaN(pi) || pi < 0 || pi >= plman.PlaylistCount || !nm || !canEditPl(pi)){
        if(cb) cb(false);
        return;
      }
      plman.RenamePlaylist(pi, nm);
      invalidateItems();
      if(view === 'browse' && brView === 'playlist' && brViewId === String(pi)) brViewTitle = nm;
      if(cb) cb(true);
      repaintAll();
    },
    remove: function(id, cb){
      var pi = parseInt(id, 10);
      if(isNaN(pi) || pi < 0 || pi >= plman.PlaylistCount){
        if(cb) cb(false);
        return;
      }
      var ok = false;
      try{ plman.RemovePlaylist(pi); ok = true; }catch(e){ ok = false; }
      invalidateItems();
      if(cb) cb(ok);
      repaintAll();
    },
    addSongs: function(plId, plName, songs){
      localRequestAddToPlaylist(plId, plName, songs);
    },
    removeSong: function(plId, idx, cb){
      var pi = parseInt(plId, 10);
      removeTrackFromPl(pi, idx);
      if(cb) cb(true);
    }
  }
};

registerSource(LOCAL_SOURCE);
