/* Opt-in WebView2 library preview. Track handles and Navidrome requests stay in the host. */
var webPreview = {
  active: false, source: 'local', selected: null, requested: null,
  rows: null, revision: 0, catalogKey: '', trackKey: '',
  mode: 'playlist', query: '', queueKey: '', queueRows: EMPTY_ROWS,
  settingsKey: '', editing: false, probe: 0
};

function webPreviewLabel(){
  return T('preview.title');
}

function webPreviewOpen(){
  if(fsMode || webPreview.active) return;
  if(!fsWantWebView()){
    try{ fb.ShowPopupMessage(T('preview.requires_webview'),webPreviewLabel()); }catch(e){}
    return;
  }
  webPreview.active=true;
  webPreview.mode='playlist';
  webPreview.query='';
  webPreviewSelectSource(libSource==='navidrome'?'navidrome':'local');
  fsBridgeEnter();
}

function webPreviewClose(){
  webPreview.active=false;
  webPreview.rows=null;
  webPreview.probe++;
  fsBridgeHide();
  repaintAll();
}

function webPreviewIsShowing(){
  return webPreview.active && !fsMode && fsBridge.showing;
}

function webPreviewSelectSource(source){
  webPreview.source=source;
  webPreview.selected=null;
  webPreview.requested=null;
  if(source==='navidrome') nvFetchPlaylists(false);
  if(webPreview.mode==='search') sourceById(source).search(webPreview.query);
}

function webPreviewQueue(){
  var manual=plman.GetPlaybackQueueContents()||[], entries=[], keys=[];
  function add(h,kind,pl,index){
    if(!h) return;
    entries.push({h:h,kind:kind,pl:pl,position:index});
    keys.push([trackKey(h),kind,pl,index]);
  }
  manual.forEach(function(item,i){ add(item.Handle,'manual',-1,i); });
  var loc=playingLoc(), pl=loc&&loc.IsValid?loc.PlaylistIndex:plman.ActivePlaylist;
  var start=loc&&loc.IsValid?loc.PlaylistItemIndex+1:0;
  if(pbRepeat===2 && NP) add(NP,'repeat',-1,0);
  else if(pl>=0 && pl<plman.PlaylistCount){
    var list=getItems(pl);
    for(var i=start;i<Math.min(list.Count,start+100);i++) add(list[i],'next',pl,i);
  }
  var key=JSON.stringify(keys);
  if(key!==webPreview.queueKey){
    webPreview.queueKey=key;
    webPreview.queueRows=makeListRows(entries.map(function(entry){
      var meta=qRowMeta(entry.h);
      entry.title=meta.t; entry.artist=meta.a; entry.duration=Number(entry.h.Length)||0;
      entry.album=T(entry.kind==='manual'?'queue.next_in_queue':entry.kind==='repeat'?'queue.repeating_song':'queue.next_up');
      return entry;
    }));
  }
  return webPreview.queueRows;
}

function webPreviewRefresh(force){
  var src=sourceById(webPreview.source);
  var catalog=src.playlists();
  var list=catalog.list;
  var selected=list.find(function(p){ return p.id===webPreview.selected; });
  if(!selected){
    if(webPreview.source==='local'){
      selected=list.find(function(p){ return p.id===String(plman.ActivePlaylist); });
    }
    selected=selected||list[0]||null;
    webPreview.selected=selected?selected.id:null;
  }

  var detail=null;
  if(selected && webPreview.mode==='playlist'){
    if(webPreview.source==='navidrome' && webPreview.requested!==selected.id){
      webPreview.requested=selected.id;
      src.fetchPlaylist(selected.id,false);
    }
    detail=src.playlist(selected.id);
  }
  var rows=detail && !detail.loading && !detail.err?detail.rows:null;
  var loading=catalog.loading||(detail&&detail.loading);
  var failed=(detail&&detail.err)||(!list.length&&catalog.err);
  var title=selected?(detail&&detail.meta?detail.meta.name:selected.name):T('meta.playlist_sub');
  if(webPreview.mode==='search'){
    var results=src.searchResults(webPreview.query);
    rows=webPreview.query && results.query===webPreview.query && !results.loading && !results.err?results.rows:null;
    title=webPreview.query||T('search.title');
    loading=!!webPreview.query && (results.loading||results.query!==webPreview.query);
    failed=!!results.err;
  } else if(webPreview.mode==='queue'){
    rows=webPreviewQueue();
    title=T('tab.queue');
    loading=failed=false;
  }
  var status=loading?'loading':failed?'error':'ready';
  var state={
    type:'preview-list', source:webPreview.source, selected:webPreview.selected, status:status,
    title:title, mode:webPreview.mode, query:webPreview.query, editable:!!selected && selected.editable!==false,
    count:rows?rows.count:0,
    playlists:list.map(function(p){ return {id:p.id,name:p.name}; })
  };
  var key=JSON.stringify(state);
  if(rows!==webPreview.rows || key!==webPreview.catalogKey){
    webPreview.rows=rows;
    webPreview.catalogKey=key;
    webPreview.revision++;
    force=true;
  }
  if(!force) return true;
  state.revision=webPreview.revision;
  return fsBridgeSend(state);
}

function webPreviewPlayback(force,seek){
  var playback=fsBridgePlaybackPayload();
  var track=fsBridgeTrackPayload();
  var key=JSON.stringify(track);
  var state={type:'preview-playback',playback:playback,seek:!!seek};
  if(force || key!==webPreview.trackKey) state.track=track;
  if(!fsBridgeSend(state)) return false;
  webPreview.trackKey=key;
  return true;
}

function webPreviewInit(){
  return fsBridgeSend({type:'preview-open',language:LANG}) &&
    webPreviewRefresh(true) && webPreviewPlayback(true) && webPreviewSettings(true);
}

function webPreviewSync(){
  webPreviewRefresh(false);
  webPreviewPlayback(false);
  webPreviewSettings(false);
}

function webPreviewSettings(force){
  var state={type:'preview-settings',language:LANG,languageMode:LANGUAGE_MODE,
    theme:THEME_MODE,light:IS_LIGHT,sources:setupMode};
  var key=JSON.stringify(state);
  if(!force && key===webPreview.settingsKey) return true;
  if(!fsBridgeSend(state)) return false;
  webPreview.settingsKey=key;
  return true;
}

function webPreviewApplySettings(msg){
  if([0,1,2].indexOf(msg.theme)<0 || ['auto','zh-CN','en'].indexOf(msg.language)<0 ||
    ['local','both'].indexOf(msg.sources)<0) return;
  setupMode=msg.sources;
  THEME_MODE=msg.theme;
  LANGUAGE_MODE=msg.language;
  window.SetProperty(SETUP_PROP,setupMode);
  window.SetProperty(SETUP_THEME_PROP,THEME_MODE);
  window.SetProperty('Display: language (auto / en / zh-CN)',LANGUAGE_MODE);
  setLang(LANGUAGE_MODE);
  syncTheme();
  if(setupMode==='local'){
    if(libSource!=='local') switchLibrarySource('local');
    if(webPreview.source!=='local') webPreviewSelectSource('local');
  }
  webPreview.queueKey='';
  webPreviewSettings(true);
  webPreviewRefresh(true);
  repaintAll(true);
}

function webPreviewResult(ok,reason){
  if(webPreviewIsShowing()) fsBridgeSend({type:'preview-result',ok:!!ok,reason:reason||''});
}

function webPreviewEdit(msg,index,row){
  if(webPreview.editing) return webPreviewResult(false,'busy');
  var src=sourceById(webPreview.source), ops=src.playlistOps;
  var id=webPreview.selected, selected=id!==null?src.playlistById(id):null;
  if(src.id==='navidrome' && msg.action==='create' && NVData.playlistsLoading) return webPreviewResult(false,'busy');
  var name=typeof msg.name==='string'?msg.name.trim().slice(0,160):'';
  if(msg.action!=='create' && (!selected || selected.editable===false)) return webPreviewResult(false,'locked');
  if((msg.action==='create'||msg.action==='rename') && !name) return webPreviewResult(false,'empty-name');
  webPreview.editing=true;
  function done(ok){
    webPreview.editing=false;
    if(ok && src.id==='navidrome'){
      if(NVData.plDetails[id]) NVData.plDetails[id]._rows=null;
      if(webPreview.source===src.id && webPreview.selected===id) webPreview.requested=null;
    }
    if(webPreviewIsShowing()) webPreviewRefresh(false);
    webPreviewResult(ok);
  }
  try{
    if(msg.action==='create') ops.create(name,[],function(pl){
      if(pl && webPreview.source===src.id) webPreview.selected=pl.id;
      done(!!pl);
    });
    else if(msg.action==='rename') ops.rename(id,name,done);
    else if(msg.action==='delete') ops.remove(id,done);
    else if(msg.action==='remove' && webPreview.mode==='playlist' && row) ops.removeSong(id,index,done);
    else if(msg.action==='add' && row && webPreview.mode==='search'){
      if(src.id==='local'){
        var items=getItems(Number(id)), key=row.h&&trackKey(row.h);
        for(var i=0;key && i<items.Count;i++){
          if(trackKey(items[i])===key){ webPreview.editing=false; return webPreviewResult(false,'duplicate'); }
        }
        done(localInsertSongsToPlaylist(Number(id),[row]));
      } else {
        function add(detail){
          if(!detail || detail.err) return done(false);
          if(detail.songs.some(function(song){ return song.id===row.id; })){
            webPreview.editing=false;
            return webPreviewResult(false,'duplicate');
          }
          nvAddSongsToServerPlaylist(id,[row],done);
        }
        var detail=NVData.plDetails[id];
        if(detail && detail.loading) done(false);
        else nvFetchPlaylistDetail(id,false,add);
      }
    } else done(false);
  }catch(e){ done(false); }
}

function webPreviewHandle(msg){
  if(msg.type==='preview-close'){
    webPreviewClose();
  } else if(msg.type==='key' && msg.code===27){
    fsBridgeSend({type:'preview-escape'});
  } else if(msg.type==='preview-fullscreen'){
    enterFullscreen();
  } else if(msg.type==='preview-source' && (msg.source==='local'||msg.source==='navidrome')){
    if(msg.source!==webPreview.source && (msg.source==='local'||setupMode==='both')) webPreviewSelectSource(msg.source);
    webPreviewRefresh(false);
  } else if(msg.type==='preview-playlist'){
    var catalog=sourceById(webPreview.source).playlists();
    if(catalog.list.some(function(p){ return p.id===msg.id; })){
      webPreview.selected=msg.id;
      webPreviewRefresh(false);
    }
  } else if(msg.type==='preview-view' && ['playlist','search','queue'].indexOf(msg.mode)>=0){
    webPreview.mode=msg.mode;
    if(msg.mode==='search') sourceById(webPreview.source).search(webPreview.query);
    webPreviewRefresh(false);
  } else if(msg.type==='preview-search' && typeof msg.query==='string'){
    webPreview.mode='search';
    webPreview.query=msg.query.trim().slice(0,200);
    sourceById(webPreview.source).search(webPreview.query);
    webPreviewRefresh(false);
  } else if(msg.type==='preview-config'){
    webPreviewApplySettings(msg);
  } else if(msg.type==='preview-prefs'){
    webPreviewClose();
    setupPreferences();
  } else if(msg.type==='preview-test-server'){
    var generation=++webPreview.probe, conn=nvConnection(true,true);
    if(!conn) return fsBridgeSend({type:'preview-connection',status:'unconfigured'});
    fsBridgeSend({type:'preview-connection',status:'testing'});
    nvApiRequest(conn,'ping',{}, {timeoutMs:10000,maxBytes:65536}, function(body){
      if(webPreviewIsShowing() && generation===webPreview.probe) fsBridgeSend({type:'preview-connection',status:body?'connected':'failed'});
    });
  } else if(['preview-page','preview-play','preview-enqueue','preview-remove-queue','preview-edit'].indexOf(msg.type)>=0){
    webPreviewRefresh(false);
    var rows=webPreview.rows;
    var index=msg.index;
    if(msg.revision!==webPreview.revision){
      if(msg.type==='preview-edit'||msg.type==='preview-remove-queue') webPreviewResult(false,'stale');
      return;
    }
    var row=rows && Number.isSafeInteger(index) && index>=0 && index<rows.count?rows.get(index):null;
    if(msg.type==='preview-edit'){
      webPreviewEdit(msg,index,row);
      return;
    }
    if(!row) return;
    if(msg.type==='preview-page'){
      var page=[];
      for(var i=index;i<Math.min(index+100,rows.count);i++){
        var song=rows.get(i);
        if(song) page.push({index:i,title:song.title||T('meta.unknown_title'),artist:song.artist||'',album:song.album||'',duration:song.duration||0,kind:song.kind||''});
      }
      fsBridgeSend({type:'preview-page',revision:webPreview.revision,index:index,rows:page});
    } else if(webPreview.mode==='queue'){
      if(msg.type==='preview-remove-queue' && row.kind==='manual') plman.RemoveItemFromPlaybackQueue(row.position);
      else if(msg.type==='preview-play' && row.kind==='manual') playQueueItem(row.position);
      else if(msg.type==='preview-play' && row.kind==='next') playQueueNext(row.pl,row.position);
      webPreviewRefresh(false);
    } else if(msg.type==='preview-enqueue'){
      sourceById(webPreview.source).enqueue([row]);
      webPreviewResult(true,webPreview.source==='navidrome'?'submitted':'');
    } else if(msg.type!=='preview-play') return;
    else if(webPreview.source==='local' && webPreview.mode==='playlist'){
      nvPlaySeq++;
      playPlaylistItem(Number(webPreview.selected),index);
    } else {
      var src=sourceById(webPreview.source);
      var selected=src.playlistById(webPreview.selected);
      if(webPreview.mode==='search'){
        if(src.id==='local') nvPlaySeq++;
        src.play(rows,index,{subKind:'search',id:'',name:webPreview.query});
      } else if(selected) src.play(rows,index,{subKind:'playlist',id:selected.id,name:selected.name});
    }
  } else if(msg.type==='ctrl' && ['play','prev','next'].indexOf(msg.act)>=0){
    doCtrl(msg.act);
    webPreviewPlayback(false);
  } else if(msg.type==='key' && msg.code===32){
    fsBridgeSend({type:'preview-space'});
  } else if(msg.type==='preview-seek' && msg.key===fsBridgeTrackId() && typeof msg.time==='number' && isFinite(msg.time)){
    var duration=Number(fb.PlaybackLength)||0;
    if(duration>0){
      try{ fb.PlaybackTime=Math.max(0,Math.min(duration,msg.time)); }catch(e){}
      webPreviewPlayback(false,true);
    }
  }
}
