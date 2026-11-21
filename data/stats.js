/* verdant/data/stats.js -- local album/track play statistics + one-time foo_playcount import
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

var STATS_MIN_MS = 30000;
var STATS_SAVE_DELAY_MS = 5000;
var statsData = null;
var statsDirty = false;
var statsVersion = 0;
var statsPlayTimer = null;
var statsSaveTimer = null;

function statsFilePath(){
  return (fb.ProfilePath || '') + 'verdant-cache\\local-stats.json';
}

function statsEmpty(){
  return { version: 1, importedPlaycount: false, tracks: {}, albums: {} };
}

function statsLoad(){
  if(statsData) return statsData;
  var d = null;
  try{
    var p = statsFilePath();
    if(utils.IsFile(p) || utils.FileTest(p)){
      var raw = utils.ReadTextFile(p);
      if(raw){
        var parsed = JSON.parse(raw);
        if(parsed && typeof parsed === 'object'){
          d = {
            version: 1,
            importedPlaycount: !!parsed.importedPlaycount,
            tracks: (parsed.tracks && typeof parsed.tracks === 'object') ? parsed.tracks : {},
            albums: (parsed.albums && typeof parsed.albums === 'object') ? parsed.albums : {}
          };
        }
      }
    }
  }catch(e){
    d = null;
  }
  statsData = d || statsEmpty();
  return statsData;
}

function statsWriteNow(){
  if(!statsData || !statsDirty) return false;
  try{
    var dir = (fb.ProfilePath || '') + 'verdant-cache';
    if(!utils.IsFolder(dir) && typeof utils.CreateFolder === 'function') utils.CreateFolder(dir);
    utils.WriteTextFile(statsFilePath(), JSON.stringify(statsData));
    statsDirty = false;
    return true;
  }catch(e){
    return false;
  }
}

function statsScheduleSave(){
  if(statsSaveTimer) return;
  statsSaveTimer = window.SetTimeout(function(){
    statsSaveTimer = null;
    statsWriteNow();
  }, STATS_SAVE_DELAY_MS);
}

function statsFlush(){
  if(statsPlayTimer){
    window.ClearTimeout(statsPlayTimer);
    statsPlayTimer = null;
  }
  if(statsSaveTimer){
    window.ClearTimeout(statsSaveTimer);
    statsSaveTimer = null;
  }
  statsWriteNow();
}

function statsParseTimestamp(s){
  s = String(s || '').trim();
  if(!s || s === '?') return 0;
  var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if(m){
    return new Date(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)
    ).getTime() || 0;
  }
  var parsed = Date.parse(s);
  return isNaN(parsed) ? 0 : parsed;
}

function statsTrackKey(hOrPath){
  if(!hOrPath) return '';
  if(typeof hOrPath === 'string') return hOrPath.toLowerCase();
  var id = (typeof lovedTrackId === 'function') ? lovedTrackId(hOrPath) : String(hOrPath.Path || '');
  return id.toLowerCase();
}

function statsIsLocalHandle(h){
  if(!h || !h.Path) return false;
  var p = String(h.Path);
  if(p.indexOf('navidrome://') === 0) return false;
  if(typeof nvIsRemotePath === 'function' && nvIsRemotePath(p)) return false;
  return true;
}

function statsEnsureImported(){
  var st = statsLoad();
  if(st.importedPlaycount) return;
  var lib = (typeof libItems === 'function') ? libItems() : null;
  if(!lib || !lib.Count) return;

  var pcs = [], lps = [], aks = [];
  try{ pcs = TF.playCount.EvalWithMetadbs(lib); }catch(e){ pcs = []; }
  try{ lps = TF.lastPlayed.EvalWithMetadbs(lib); }catch(e2){ lps = []; }
  try{ aks = libTF('albkey'); }catch(e3){ aks = []; }

  var albumAdded = {};
  var changed = false;
  for(var i = 0; i < lib.Count; i++){
    var h = lib[i];
    if(!statsIsLocalHandle(h)) continue;
    var pc = parseInt(pcs[i], 10) || 0;
    var lp = statsParseTimestamp(lps[i]);
    if(pc <= 0 && lp <= 0) continue;
    changed = true;
    var tk = statsTrackKey(h);
    var ak = aks[i] || '';
    var prevT = st.tracks[tk] || { count: 0, lastPlayed: 0 };
    st.tracks[tk] = {
      count: Math.max(prevT.count || 0, pc),
      lastPlayed: Math.max(prevT.lastPlayed || 0, lp)
    };
    if(ak){
      if(!albumAdded[ak]) albumAdded[ak] = { count: 0, lastPlayed: 0 };
      albumAdded[ak].count += pc;
      if(lp > albumAdded[ak].lastPlayed) albumAdded[ak].lastPlayed = lp;
    }
  }
  for(var key in albumAdded){
    if(Object.prototype.hasOwnProperty.call(albumAdded, key)){
      var a = albumAdded[key];
      var prevA = st.albums[key] || { count: 0, lastPlayed: 0 };
      st.albums[key] = {
        count: Math.max(prevA.count || 0, a.count),
        lastPlayed: Math.max(prevA.lastPlayed || 0, a.lastPlayed)
      };
    }
  }
  st.importedPlaycount = true;
  statsDirty = true;
  if(changed) statsVersion++;
  statsScheduleSave();
}

function statsRecordPlay(h, nowMs){
  if(!statsIsLocalHandle(h)) return false;
  var st = statsLoad();
  var ts = nowMs || Date.now();
  var tk = statsTrackKey(h);
  if(!tk) return false;

  var te = st.tracks[tk] || { count: 0, lastPlayed: 0 };
  te.count = (te.count || 0) + 1;
  te.lastPlayed = Math.max(te.lastPlayed || 0, ts);
  st.tracks[tk] = te;

  var ak = '';
  try{ ak = albKey(h); }catch(e){ ak = ''; }
  if(ak){
    var ae = st.albums[ak] || { count: 0, lastPlayed: 0 };
    ae.count = (ae.count || 0) + 1;
    ae.lastPlayed = Math.max(ae.lastPlayed || 0, ts);
    st.albums[ak] = ae;
  }

  statsVersion++;
  statsDirty = true;
  statsScheduleSave();
  return true;
}

function statsOnPlaybackStop(){
  if(statsPlayTimer){
    window.ClearTimeout(statsPlayTimer);
    statsPlayTimer = null;
  }
}

function statsOnNewTrack(){
  statsOnPlaybackStop();
  var tracked = (typeof NP !== 'undefined') ? NP : null;
  if(!statsIsLocalHandle(tracked)) return;
  statsPlayTimer = window.SetTimeout(function(){
    statsPlayTimer = null;
    if(!fb.IsPlaying || fb.IsPaused) return;
    if(!NP || !sameHandle(NP, tracked)) return;
    if(statsRecordPlay(tracked) && typeof view === 'string' && view === 'browse'){
      if(typeof repaintMain === 'function') repaintMain();
    }
  }, STATS_MIN_MS);
}

function statsAlbumInfo(albkey){
  var st = statsLoad();
  return (albkey && st.albums[albkey]) || { count: 0, lastPlayed: 0 };
}

function statsTrackCount(hOrPath){
  var st = statsLoad();
  var tk = statsTrackKey(hOrPath);
  return (tk && st.tracks[tk]) ? (st.tracks[tk].count || 0) : 0;
}

function statsHasAlbumHistory(){
  var st = statsLoad();
  for(var k in st.albums){
    if(Object.prototype.hasOwnProperty.call(st.albums, k) && ((st.albums[k].lastPlayed || 0) > 0 || (st.albums[k].count || 0) > 0)){
      return true;
    }
  }
  return false;
}
