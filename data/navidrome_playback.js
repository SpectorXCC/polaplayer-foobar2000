/* verdant/data/navidrome_playback.js -- async location resolving, unified play/shuffle & random mix
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

var nvPlaySeq = 0;
var nvPendingLocations = {};
var nvRandomToppingUp = false;

function nvMatchHandlesToSongs(songs, handleList){
  var map = {}, n = handleList ? handleList.Count : 0, i, ordered = [];
  for(i = 0; i < n; i++){
    var h = handleList[i];
    if(!h) continue;
    var sid = nvTrackId(h.Path);
    if(sid && !map[sid]) map[sid] = h;
  }
  for(i = 0; i < songs.length; i++){
    var s = songs[i], found = (s && map[s.id]) || (i < n ? handleList[i] : null);
    if(found) ordered.push(found);
  }
  return ordered;
}

function nvPlaySongs(songs, startIdx, sourceMeta, forceShuffle){
  var list = [], i;
  for(i = 0; i < (songs ? songs.length : 0); i++){
    if(songs[i] && songs[i].id) list.push(songs[i]);
  }
  if(!list.length) return;
  startIdx = Math.max(0, Math.min(list.length - 1, startIdx || 0));
  if(forceShuffle !== undefined){
    pbShuffle = !!forceShuffle;
    applyPlaybackOrder();
  }

  nvPlaySeq++;
  var seq = nvPlaySeq;
  var uris = [];
  for(i = 0; i < list.length; i++) uris.push(nvBuildTrackUri(list[i]));

  try{
    var tid = fb.AddLocationsAsync(uris);
    nvPendingLocations[tid] = {
      mode: 'play',
      seq: seq,
      songs: list,
      startIdx: startIdx,
      startId: list[startIdx].id,
      shuffle: pbShuffle,
      sourceMeta: sourceMeta || { subKind: 'list', id: '', name: T('source.navidrome') }
    };
  }catch(e){
    NVData.error = T('err.pb_dispatch_failed', String(e.message || e));
    repaintAll();
  }
}

function nvEnqueueSongs(songs){
  var list = [], uris = [], i;
  for(i = 0; i < (songs ? songs.length : 0); i++){
    if(songs[i] && songs[i].id){ list.push(songs[i]); uris.push(nvBuildTrackUri(songs[i])); }
  }
  if(!list.length) return;
  try{
    var tid = fb.AddLocationsAsync(uris);
    nvPendingLocations[tid] = { mode: 'queue', songs: list };
  }catch(e){}
}

function nvMaybeTopUpRandomMix(){
  if(nvRandomToppingUp || !pbSource || pbSource.subKind !== 'random') return;
  if(pbSource.src !== 'navidrome' && pbSource.kind !== 'nav') return;
  var loc = playingLoc();
  if(!loc || !loc.IsValid) return;
  var pi = loc.PlaylistIndex;
  var nm = plName(pi);
  if(nm !== ROUTE && nm !== SHUF) return;
  var rem = plman.PlaylistItemCount(pi) - loc.PlaylistItemIndex - 1;
  if(rem > 5) return;

  nvRandomToppingUp = true;
  nvFetchRandomSongs(40, true, function(batch){
    if(!batch || !batch.length){ nvRandomToppingUp = false; return; }
    var uris = [], i;
    for(i = 0; i < batch.length; i++) uris.push(nvBuildTrackUri(batch[i]));
    try{
      var tid = fb.AddLocationsAsync(uris);
      nvPendingLocations[tid] = { mode: 'append-random', songs: batch, expectedSeq: nvPlaySeq };
    }catch(e){
      nvRandomToppingUp = false;
    }
  });
}

function nvOnLocationsAdded(taskId, handles){
  var job = nvPendingLocations[taskId];
  if(!job) return false;
  delete nvPendingLocations[taskId];

  var ordered = nvMatchHandlesToSongs(job.songs, handles);
  if(job.mode === 'append-random'){
    nvRandomToppingUp = false;
    if(job.expectedSeq !== nvPlaySeq || !ordered.length) return true;
    appendRandomHandlesToRouteShuf(ordered);
    return true;
  }

  if(job.mode === 'queue'){
    for(var qi = 0; qi < ordered.length; qi++){
      try{ plman.AddItemToPlaybackQueue(ordered[qi]); }catch(e3){}
    }
    repaintAll();
    return true;
  }

  if(job.mode === 'play'){
    if(job.seq !== nvPlaySeq) return true;   // superseded by a newer click
    if(!ordered.length){
      NVData.error = T('err.pb_resolve_failed');
      repaintAll();
      return true;
    }
    var idx = 0;
    for(var k = 0; k < ordered.length; k++){
      if(nvTrackId(ordered[k].Path) === job.startId){ idx = k; break; }
    }
    var prevShuffle = pbShuffle;
    pbShuffle = !!job.shuffle;
    if(prevShuffle !== pbShuffle) applyPlaybackOrder();
    playHandleList(ordered, idx, job.sourceMeta.name, {
      src: 'navidrome',
      kind: 'nav',
      subKind: job.sourceMeta.subKind || 'list',
      id: job.sourceMeta.id || '',
      name: job.sourceMeta.name || T('source.navidrome'),
      songs: job.songs
    });
    updateNP();
    repaintAll();
    return true;
  }
  return true;
}

function nvIsSongPlaying(songId){
  if(!songId || (!fb.IsPlaying && !fb.IsPaused) || !NP) return false;
  return nvTrackId(NP.Path) === songId;
}
