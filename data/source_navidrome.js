/* verdant/data/source_navidrome.js -- Navidrome / Subsonic MusicSource adapter
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

function nvRowsArray(rowsOrSongs){
  if(Array.isArray(rowsOrSongs)) return rowsOrSongs;
  if(rowsOrSongs && typeof rowsOrSongs.all === 'function') return rowsOrSongs.all();
  return [];
}

function nvMemoRows(holder, arrKey, rowsKey){
  var arr = (holder && holder[arrKey]) ? holder[arrKey] : [];
  if(!holder[rowsKey] || holder[rowsKey + '_ref'] !== arr){
    holder[rowsKey] = makeListRows(arr);
    holder[rowsKey + '_ref'] = arr;
  }
  return holder[rowsKey];
}

var NAVIDROME_SOURCE = {
  id: 'navidrome',
  caps: {
    albumTabs: ['recent', 'newest', 'frequent', 'random', 'alphabeticalByName'],
    topSongs: true,
    lovedKinds: ['song', 'album', 'artist'],
    randomMix: true,
    playlistEdit: 'server',
    multiServer: true,
    allSongs: false
  },

  ensureLoaded: function(){ nvEnsureLoaded(); },
  refresh: function(clearArt){ nvRefreshAll(!!clearArt); },

  playlists: function(){
    return {
      list: NVData.playlists || [],
      loading: !!NVData.playlistsLoading,
      catalogLoading: !!NVData.loadingCatalog,
      loaded: !!NVData.playlistsLoaded,
      err: String(NVData.error || '')
    };
  },
  playlistById: function(id){ return nvPlaylistById(id); },
  playlist: function(id){
    var d = NVData.plDetails[id];
    if(!d){
      return {
        meta: nvPlaylistById(id),
        songs: [],
        rows: EMPTY_ROWS,
        loading: true,
        err: ''
      };
    }
    return {
      meta: d.meta,
      songs: d.songs || [],
      rows: nvMemoRows(d, 'songs', '_rows'),
      loading: !!d.loading,
      err: String(d.err || '')
    };
  },
  fetchPlaylist: function(id, force, cb){ nvFetchPlaylistDetail(id, !!force, cb); },

  albumsTab: function(){ return NVData.albumsTab || 'recent'; },
  setAlbumsTab: function(tab){ NVData.albumsTab = tab || 'recent'; },
  albums: function(tab){
    var key = tab || NVData.albumsTab || 'recent';
    var slot = NVData.albumsByTab[key];
    if(!slot) return { list: [], loading: true, err: '', hasMore: false };
    return {
      list: slot.list || [],
      loading: !!slot.loading,
      err: String(slot.err || ''),
      hasMore: !!slot.hasMore
    };
  },
  fetchAlbums: function(tab, append, force, cb){ nvFetchAlbums(tab, !!append, !!force, cb); },
  loadMoreAlbums: function(tab){ nvFetchAlbums(tab || NVData.albumsTab || 'recent', true, false); },

  album: function(id){
    var d = NVData.albumDetails[id];
    if(!d) return { meta: null, songs: [], rows: EMPTY_ROWS, loading: true, err: '' };
    return {
      meta: d.meta,
      songs: d.songs || [],
      rows: nvMemoRows(d, 'songs', '_rows'),
      loading: !!d.loading,
      err: String(d.err || '')
    };
  },
  fetchAlbum: function(id, force, cb){ nvFetchAlbumDetail(id, !!force, cb); },

  artists: function(){
    return {
      list: NVData.artists || [],
      loaded: NVData.artists !== null,
      loading: !!NVData.artistsLoading,
      err: String(NVData.artistsErr || '')
    };
  },
  fetchArtists: function(force, cb){ nvFetchArtists(!!force, cb); },

  artist: function(id, nameHint){
    var d = NVData.artistDetails[id];
    if(!d){
      return {
        meta: { id: id, name: nameHint || '', albumCount: 0, coverArt: '' },
        albums: [],
        topSongs: [],
        topRows: EMPTY_ROWS,
        loading: true,
        err: ''
      };
    }
    return {
      meta: d.meta,
      albums: d.albums || [],
      topSongs: d.topSongs || [],
      topRows: nvMemoRows(d, 'topSongs', '_topRows'),
      loading: !!d.loading,
      err: String(d.err || '')
    };
  },
  fetchArtist: function(id, nameHint, force, cb){ nvFetchArtistDetail(id, nameHint, !!force, cb); },

  loved: function(){
    var st = NVData.starred;
    return {
      songs: st.songs || [],
      rows: nvMemoRows(st, 'songs', '_rows'),
      albums: st.albums || [],
      artists: st.artists || [],
      loaded: !!st.loaded,
      loading: !!st.loading,
      err: String(st.err || '')
    };
  },
  fetchLoved: function(force, cb){ nvFetchStarred(!!force, cb); },

  random: function(){
    var rm = NVData.randomMix;
    return {
      songs: rm.songs || [],
      rows: nvMemoRows(rm, 'songs', '_rows'),
      loading: !!rm.loading,
      err: String(rm.err || '')
    };
  },
  fetchRandom: function(count, append, cb){ nvFetchRandomSongs(count || 80, !!append, cb); },
  randomMore: function(count, cb){ nvFetchRandomSongs(count || 40, true, cb); },
  randomRebatch: function(count, cb){ nvFetchRandomSongs(count || 80, false, cb); },

  search: function(query){ nvRunSearch(query); },
  searchResults: function(){
    var s = NVData.search;
    return {
      query: s.query || '',
      requested: s.requested || '',
      artists: s.artists || [],
      albums: s.albums || [],
      songs: s.songs || [],
      rows: nvMemoRows(s, 'songs', '_rows'),
      loading: !!s.loading,
      err: String(s.err || '')
    };
  },
  resetSearch: function(){ if(NVData.search) NVData.search.requested = ''; },

  isLoved: function(kind, id){ return nvIsStarred(kind, id); },
  toggleLoved: function(kind, id, obj, cb){ return nvToggleStar(kind, id, obj, cb); },
  isTrackPlaying: function(song){ return !!(song && song.id && nvIsSongPlaying(song.id)); },
  trackId: function(h){ return h ? nvTrackId(h.Path) : ''; },
  trackObj: function(h){
    var id = h ? nvTrackId(h.Path) : '';
    if(!id) return null;
    return { id: id, title: npTitleStr || '', artist: npArtistStr || '' };
  },

  play: function(rowsOrSongs, startIdx, sourceMeta, shuffle){
    nvPlaySongs(nvRowsArray(rowsOrSongs), startIdx, sourceMeta, shuffle);
  },
  enqueue: function(rowsOrSongs){
    nvEnqueueSongs(nvRowsArray(rowsOrSongs));
  },
  maybeTopUpRandom: function(){ nvMaybeTopUpRandomMix(); },

  servers: function(){ return NVApi.servers || []; },
  activeServer: function(){ return nvConnection(); },
  selectServer: function(name){ nvSelectServer(name); },

  playlistOps: {
    create: function(name, songIds, cb){ nvCreateServerPlaylist(name, songIds, cb); },
    rename: function(id, newName, cb){ nvRenameServerPlaylist(id, newName, cb); },
    remove: function(id, cb){ nvDeleteServerPlaylist(id, cb); },
    addSongs: function(plId, plName, songs){ nvRequestAddToPlaylist(plId, plName, songs); },
    removeSong: function(plId, idx, cb){ nvRemoveSongFromServerPlaylist(plId, idx, cb); }
  }
};

registerSource(NAVIDROME_SOURCE);
