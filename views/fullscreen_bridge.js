/* verdant/views/fullscreen_bridge.js -- lazy Edge WebView2 AMLL host bridge + cover exporter
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

var FS_BRIDGE_FILE='';
try{
  var _err=new Error();
  FS_BRIDGE_FILE=String(_err.fileName||'');
  if(!FS_BRIDGE_FILE && _err.stack){
    var _sm=String(_err.stack).match(/([A-Za-z]:[\\\/][^\r\n:]+views[\\\/]fullscreen_bridge\.js)/i);
    if(_sm) FS_BRIDGE_FILE=_sm[1];
  }
}catch(e){ FS_BRIDGE_FILE=''; }

var fsBridge={
  inited:false,
  ready:false,
  showing:false,
  lastCoverKey:'',
  lastCoverUrl:'',
  coverGen:Date.now(),
  coverSlot:0,
  trackId:0,
  trackIdentity:null,
  sentTrackId:null,
  readyTimer:null,
  pollTimer:null,
  syncTimer:null
};

function fsWebAppDir(){
  var cands=[];
  if(FS_BRIDGE_FILE){
    var root=FS_BRIDGE_FILE.replace(/[\\\/]views[\\\/]fullscreen_bridge\.js$/i,'');
    if(root && root!==FS_BRIDGE_FILE) cands.push(root+'\\fullscreen-web\\dist');
  }
  try{
    if(typeof fb==='object' && fb && fb.ProfilePath){
      cands.push(fb.ProfilePath+'verdant\\fullscreen-web\\dist');
    }
  }catch(e){}
  for(var i=0;i<cands.length;i++){
    var dir=cands[i].replace(/[\\\/]+$/,'');
    try{
      if(utils.IsFile(dir+'\\index.html')) return dir;
    }catch(e2){}
  }
  return '';
}

function fsWantWebView(){
  if(typeof FS_RENDERER==='string' && FS_RENDERER==='gdi') return false;
  if(typeof VerdantChrome==='undefined' || !VerdantChrome || !chromeAttached) return false;
  try{ return !!VerdantChrome.WebViewAvailable; }catch(e){ return false; }
}

function fsBridgeIsShowing(){
  return !!(fsMode && fsView!=='viz' && fsBridge.showing);
}

function fsBridgeWantsPage(){
  return fsMode?fsView!=='viz':webPreview.active;
}

function fsArtCacheDir(){
  var base=((typeof fb==='object'&&fb&&fb.ProfilePath)?fb.ProfilePath:'')+'verdant-cache\\';
  var dir=base+'fs-art\\';
  try{
    if(!utils.IsDirectory(base)) utils.CreateFolder(base);
    if(!utils.IsDirectory(dir)) utils.CreateFolder(dir);
  }catch(e){}
  return dir;
}

function fsSaveBitmapPng(img,outPath){
  if(!img) return false;
  var tmp=null, src=img;
  try{
    var maxDim=Math.max(img.Width||0,img.Height||0);
    if(maxDim>720){
      var ratio=720/maxDim;
      tmp=img.Resize(Math.max(1,Math.round(img.Width*ratio)),Math.max(1,Math.round(img.Height*ratio)),2);
      if(tmp) src=tmp;
    }
    try{ src.SaveAs(outPath); }
    catch(e){ src.SaveAs(outPath,'image/png'); }
    return !!(utils.IsFile && utils.IsFile(outPath));
  }catch(e2){
    return false;
  }finally{
    if(tmp){ try{ tmp.Dispose(); }catch(e3){} }
  }
}

function fsExportActiveCover(){
  if(!NP){
    fsBridge.lastCoverKey='';
    fsBridge.lastCoverUrl='';
    return '';
  }
  var art=(typeof npResolveArt==='function')?npResolveArt(false):null;
  var key=String(NP.Path)+'|'+(NP.SubSong||0)+'|'+(art?(art.Width+'x'+art.Height):'none');
  if(key===fsBridge.lastCoverKey) return fsBridge.lastCoverUrl;
  fsBridge.lastCoverKey=key;
  if(!art){
    fsBridge.lastCoverUrl='';
    return '';
  }
  var slot=fsBridge.coverSlot?0:1;
  fsBridge.coverSlot=slot;
  fsBridge.coverGen++;
  var dir=fsArtCacheDir();
  var outPath=dir+'cover_'+slot+'.png';
  if(fsSaveBitmapPng(art,outPath)){
    fsBridge.lastCoverUrl='https://cache.verdant.local/cover_'+slot+'.png?v='+fsBridge.coverGen;
  } else {
    fsBridge.lastCoverUrl='';
  }
  return fsBridge.lastCoverUrl;
}

function fsBridgeFontsPayload(){
  return {
    ui:(FONT_SPEC && FONT_SPEC.ui && FONT_SPEC.ui.base)?FONT_SPEC.ui.base:'',
    lyric:(FONT_SPEC && FONT_SPEC.lyric && FONT_SPEC.lyric.base)?FONT_SPEC.lyric.base:''
  };
}

function fsBridgeStringsPayload(){
  return {
    nowPlaying:T('queue.now_playing'),
    nothingPlaying:T('queue.nothing_playing'),
    chooseMusic:T('meta.choose_music'),
    loadingLyrics:T('lyrics.loading'),
    waitingMusic:T('lyrics.waiting_music'),
    noLyrics:T('lyrics.none')
  };
}

function fsBridgeTrackId(newTrack){
  var identity=NP?nowArtKey(NP):'';
  if(newTrack || identity!==fsBridge.trackIdentity){
    fsBridge.trackIdentity=identity;
    fsBridge.trackId++;
  }
  return fsBridge.trackId;
}

function fsBridgeTrackPayload(){
  return {
    key:fsBridgeTrackId(),
    title:npTitleStr||'',
    artist:npArtistStr||'',
    coverUrl:fsExportActiveCover(),
    length:(typeof fb==='object'&&fb)?(Number(fb.PlaybackLength)||0):0
  };
}

function fsBridgeLyricsPayload(){
  var path=NP?String(NP.Path):'';
  var isRemote=!!path && nvIsRemotePath(path);
  var remoteCurrent=!!path && NV.key===path;
  var model=remoteCurrent && NV.lyrics ? NV.lyrics : (path && lyricsFor===path && lyrics!=='none'?lyrics:null);
  var st=remoteCurrent?NV.status:(isRemote?'loading':'none');
  return {
    remote:isRemote,
    heading:isRemote?T('lyrics.heading_nv'):T('lyrics.heading'),
    status:st,
    model:model?{synced:!!model.synced,lines:model.lines.map(function(line){
      return {t:line.t,text:line.text,translatedLyric:line.translatedLyric,romanLyric:line.romanLyric};
    })}:null
  };
}

function fsBridgePlaybackPayload(){
  return {
    playing:!!fb.IsPlaying,
    paused:!!fb.IsPaused,
    time:Number(fb.PlaybackTime)||0,
    length:Number(fb.PlaybackLength)||0,
    volume:clamp01(vol2pos(fb.Volume)),
    shuffle:!!pbShuffle,
    repeat:Number(pbRepeat)||0
  };
}

function fsBridgeSend(obj){
  if(!VerdantChrome || !fsBridge.inited) return false;
  try{ return !!VerdantChrome.WebViewPostMessage(JSON.stringify(obj)); }catch(e){ return false; }
}

function fsBridgeClearReadyTimer(){
  if(fsBridge.readyTimer!==null){
    window.ClearTimeout(fsBridge.readyTimer);
    fsBridge.readyTimer=null;
  }
}

function fsBridgeStopTimers(){
  fsBridgeClearReadyTimer();
  if(fsBridge.pollTimer){ try{ window.ClearInterval(fsBridge.pollTimer); }catch(e){} fsBridge.pollTimer=null; }
  if(fsBridge.syncTimer){ try{ window.ClearInterval(fsBridge.syncTimer); }catch(e){} fsBridge.syncTimer=null; }
}

function fsBridgeStartPoll(){
  if(!fsBridge.pollTimer){
    fsBridge.pollTimer=window.SetInterval(fsBridgePoll,25);
  }
}

function fsBridgeStartSync(){
  if(!fsBridge.syncTimer){
    fsBridge.syncTimer=window.SetInterval(function(){
      if(fsBridgeIsShowing()) fsBridgePushPlayback(false);
      else if(webPreviewIsShowing()) webPreviewSync();
    },500);
  }
}

function fsBridgePushInit(){
  if(!fsBridge.ready) return;
  return fsBridgeSend({
    type:'init',
    view:fsView==='default'?'default':'lyrics',
    visible:true,
    strings:fsBridgeStringsPayload(),
    fonts:fsBridgeFontsPayload(),
    track:fsBridgeTrackPayload(),
    lyrics:fsBridgeLyricsPayload(),
    playback:fsBridgePlaybackPayload()
  });
}

function fsBridgeReveal(){
  if(!fsBridgeWantsPage() || !fsBridge.ready || !fsWantWebView()) return;
  fsBridgeClearReadyTimer();
  if(!(fsMode?fsBridgePushInit():webPreviewInit())){ fsBridgeFallback('initial state could not be sent'); return; }
  var wasShowing=fsBridge.showing;
  if(!wasShowing){
    try{ VerdantChrome.WebViewShow(1); }catch(e){ fsBridgeFallback('could not show WebView2'); return; }
  }
  fsBridge.showing=true;
  fsBridgeStartPoll();
  fsBridgeStartSync();
  if(!fsMode){
    if(!wasShowing) console.log('PolaPlayer preview: WebView2 active');
    return;
  }
  fsBridge.sentTrackId=fsBridgeTrackId();
  if(!wasShowing) console.log('PolaPlayer fullscreen: WebView2 / AMLL active');
  if(typeof stopFsClock==='function') stopFsClock();
  if(typeof stopFsAnim==='function') stopFsAnim();
}

function fsBridgeFallback(reason){
  var wasShowing=fsBridgeIsShowing();
  console.log('PolaPlayer '+(fsMode?'fullscreen':'preview')+': GDI+ ('+reason+')');
  fsBridgeDestroy();
  if(!fsMode && webPreview.active){
    webPreview.active=false;
    try{ fb.ShowPopupMessage(T('preview.start_failed'),webPreviewLabel()); }catch(e){}
    repaintAll();
  }
  if(wasShowing && fsMode && fsView!=='viz'){
    startFsClock();
    repaintAll();
  }
}

function fsBridgeHide(){
  fsBridge.showing=false;
  fsBridgeStopTimers();
  if(fsBridge.ready){
    fsBridgeSend({type:'visible',visible:false});
  }
  if(typeof VerdantChrome!=='undefined' && VerdantChrome){
    try{ VerdantChrome.WebViewShow(0); }catch(e){}
  }
}

function fsBridgeHandleMessage(msg){
  if(!msg || typeof msg!=='object') return;
  var t=msg.type;
  if(t==='ready'){
    fsBridge.ready=true;
    if(fsBridgeWantsPage() && fsWantWebView()) fsBridgeReveal();
    else { try{ VerdantChrome.WebViewShow(0); }catch(e){} }
    return;
  }
  if(webPreviewIsShowing()){
    webPreviewHandle(msg);
    return;
  }
  if(!fsBridgeIsShowing()) return;
  if(t==='key'){
    if(msg.code===27) exitFullscreen();
    else if(msg.code===32){ try{ fb.PlayOrPause(); }catch(e){} }
  } else if(t==='fsAct'){
    if(typeof msg.act==='string') doFsAct(msg.act);
  } else if(t==='ctrl'){
    if(typeof msg.act==='string') doCtrl(msg.act);
  } else if(t==='seek'){
    if(msg.key!==fsBridgeTrackId()) return;
    var sec=Number(msg.time);
    if(isFinite(sec)){
      try{ fb.PlaybackTime=Math.max(0,sec); }catch(e2){}
    }
  } else if(t==='volume'){
    var pos=Number(msg.pos);
    if(isFinite(pos)){
      try{ fb.Volume=pos2vol(clamp01(pos)); }catch(e3){}
    }
  } else if(t==='volumeDelta'){
    var st=Number(msg.step);
    if(isFinite(st)){
      try{ fb.Volume=pos2vol(clamp01(vol2pos(fb.Volume)+st*0.04)); }catch(e4){}
    }
  }
}

function fsBridgePoll(){
  if(!fsBridgeWantsPage() || !fsBridge.inited || !VerdantChrome){
    fsBridgeStopTimers();
    return;
  }
  var raw='';
  try{ raw=VerdantChrome.WebViewPollMessages()||''; }catch(e){ raw=''; }
  if(!raw) return;
  try{
    var list=JSON.parse(raw);
    if(Array.isArray(list)){
      for(var i=0;i<list.length;i++) fsBridgeHandleMessage(list[i]);
    }
  }catch(e2){}
}

function fsBridgeEnter(){
  if(!fsWantWebView() || (fsMode && fsView==='viz')){
    if(!fsMode) webPreview.active=false;
    fsBridge.showing=false;
    console.log('PolaPlayer fullscreen: GDI+ ('+(fsView==='viz'?'FFT visualizer':FS_RENDERER==='gdi'?'renderer preference':'WebView2 unavailable')+')');
    return false;
  }
  if(fsBridge.ready){ fsBridgeReveal(); return fsBridge.showing; }
  if(fsBridge.readyTimer!==null) return true;
  // An empty hint lets the native host locate the bundle relative to its DLL.
  var appDir=fsWebAppDir();
  var cacheDir=((typeof fb==='object'&&fb&&fb.ProfilePath)?fb.ProfilePath:'')+'verdant-cache';
  var dataDir=cacheDir+'\\webview2-data';
  var ok=false;
  try{ ok=!!VerdantChrome.WebViewInit(appDir,fsArtCacheDir(),dataDir); }catch(e){ ok=false; }
  if(!ok){
    fsBridgeFallback('WebView2 initialization declined; check the local bundle and runtime');
    return false;
  }
  fsBridge.inited=true;
  var hostReady=false;
  try{ hostReady=!!VerdantChrome.WebViewReady; }catch(e2){ hostReady=false; }
  if(hostReady) fsBridge.ready=true;
  fsBridgeStartPoll();
  if(fsBridge.ready){
    fsBridgeReveal();
    return true;
  }
  console.log('PolaPlayer fullscreen: GDI+ while WebView2 initializes');
  fsBridge.readyTimer=window.SetTimeout(function(){
    fsBridge.readyTimer=null;
    fsBridgeFallback('WebView2 ready timeout after 8 seconds');
  },8000);
  // WebView2 is still warming up asynchronously; keep GDI+ fullscreen alive until 'ready' arrives.
  fsBridge.showing=false;
  return true;
}

function fsBridgeExit(){
  fsBridgeHide();
}

function fsBridgeSyncView(){
  if(!fsMode) return;
  if(fsView==='viz'){
    fsBridgeHide();
    console.log('PolaPlayer fullscreen: GDI+ (FFT visualizer)');
    return;
  }
  if(!fsWantWebView()){
    if(fsBridge.showing) fsBridgeHide();
    return;
  }
  if(fsBridge.ready){
    fsBridgeReveal();
  } else {
    fsBridgeEnter();
  }
}

function fsBridgePushTrack(){
  if(!fsBridgeIsShowing()) return;
  var track=fsBridgeTrackPayload();
  var changed=track.key!==fsBridge.sentTrackId;
  fsBridgeSend({type:'track',track:track,playback:fsBridgePlaybackPayload()});
  fsBridge.sentTrackId=track.key;
  if(changed) fsBridgePushLyrics();
}

function fsBridgePushCover(){
  if(!fsBridgeIsShowing()) return;
  fsBridge.lastCoverKey='';
  var key=fsBridgeTrackId();
  if(key===fsBridge.sentTrackId) fsBridgeSend({type:'cover',key:key,coverUrl:fsExportActiveCover()});
}

function fsBridgePushLyrics(){
  if(!fsBridgeIsShowing()) return;
  var key=fsBridgeTrackId();
  if(key===fsBridge.sentTrackId) fsBridgeSend({type:'lyrics',key:key,lyrics:fsBridgeLyricsPayload()});
}

function fsBridgePushPlayback(isSeek){
  if(!fsBridgeIsShowing()) return;
  fsBridgeSend({type:'playback',key:fsBridgeTrackId(),playback:fsBridgePlaybackPayload(),seek:!!isSeek});
}

function fsBridgePushFonts(){
  if(!fsBridge.ready) return;
  fsBridgeSend({type:'fonts',fonts:fsBridgeFontsPayload()});
}

function fsBridgeDestroy(){
  fsBridgeHide();
  fsBridge.inited=false;
  fsBridge.ready=false;
  fsBridge.lastCoverKey='';
  fsBridge.lastCoverUrl='';
  if(typeof VerdantChrome!=='undefined' && VerdantChrome){
    try{ VerdantChrome.WebViewDestroy(); }catch(e){}
  }
}
