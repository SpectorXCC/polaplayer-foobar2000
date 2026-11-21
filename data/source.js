/* verdant/data/source.js -- MusicSource registry, active adapter lookup & row accessors
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

var SOURCES = {};

function registerSource(adapter){
  if(adapter && adapter.id) SOURCES[adapter.id] = adapter;
  return adapter;
}

function sourceById(id){
  return (id && Object.prototype.hasOwnProperty.call(SOURCES, id)) ? SOURCES[id] : null;
}

function activeSource(){
  return (typeof libSource === 'string') ? sourceById(libSource) : null;
}

function sourceForHandle(h){
  if(!h) return null;
  if(typeof nvIsRemotePath === 'function' && nvIsRemotePath(h.Path)) return sourceById('navidrome');
  if(String(h.Path || '').indexOf('navidrome://') === 0) return sourceById('navidrome');
  return sourceById('local');
}

function sourceForPlayback(){
  if(typeof pbSource === 'object' && pbSource){
    if(pbSource.src){
      var bySrc = sourceById(pbSource.src);
      if(bySrc) return bySrc;
    }
    if(pbSource.kind === 'nav') return sourceById('navidrome');
    if(pbSource.kind === 'local') return sourceById('local');
  }
  return sourceForHandle(typeof NP !== 'undefined' ? NP : null);
}

var EMPTY_ROWS = {
  count: 0,
  get: function(){ return null; },
  all: function(){ return []; }
};

function makeListRows(arr){
  var list = Array.isArray(arr) ? arr : [];
  if(!list.length) return EMPTY_ROWS;
  return {
    count: list.length,
    get: function(i){ return (i >= 0 && i < list.length) ? list[i] : null; },
    all: function(){ return list; }
  };
}

function sourceHasCap(src, key){
  return !!(src && src.caps && src.caps[key]);
}

function sourceCanLove(src, kind){
  var ks = (src && src.caps && src.caps.lovedKinds) ? src.caps.lovedKinds : [];
  for(var i = 0; i < ks.length; i++) if(ks[i] === kind) return true;
  return false;
}

function sourceAlbumTabs(src){
  return (src && src.caps && Array.isArray(src.caps.albumTabs)) ? src.caps.albumTabs : [];
}
