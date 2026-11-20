/* verdant/data/playlist_edit.js -- playlist + track editing: local & Navidrome context menus, rename, create, delete, add, remove
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

function openPlaylistMenu(pl,x,y){
  var items=[];
  if(!plman.IsPlaylistLocked(pl)) items.push({label:'Add files...',act:'addfiles'},{label:'Add folder...',act:'addfolder'});
  items.push({label:'Rename',act:'rename'},{label:'Delete',act:'delete',danger:true});
  ctxMenu={kind:'pl', pl:pl, name:plman.GetPlaylistName(pl), x:x, y:y, items:items};
  repaintAll();
}

function openNvPlaylistMenu(plObj,x,y){
  if(!plObj) return false;
  var items=[
    {label:'\u64ad\u653e\u6b4c\u5355',act:'nv-pl-play',accent:true},
    {label:'\u968f\u673a\u64ad\u653e\u6b4c\u5355',act:'nv-pl-shuf'},
    {sep:true},
    {label:'\u91cd\u547d\u540d',act:'nv-pl-rename'},
    {label:'\u5220\u9664\u6b4c\u5355',act:'nv-pl-delete',danger:true}
  ];
  ctxMenu={kind:'nv-pl', plId:plObj.id, plObj:plObj, name:plObj.name, x:x, y:y, items:items};
  repaintAll(); return true;
}

function openNvAddToPlaylistMenu(songs,x,y){
  if(!songs||!songs.length) return;
  var items=[{label:'+ \u65b0\u5efa Navidrome \u6b4c\u5355...',act:'nv-add-newpl',accent:true,songs:songs}];
  if(NVData.playlists.length) items.push({sep:true});
  for(var i=0;i<NVData.playlists.length;i++){
    var p=NVData.playlists[i];
    items.push({label:p.name,act:'nv-add-target',plId:p.id,plName:p.name,songs:songs});
  }
  ctxMenu={kind:'nv-addpl', x:x, y:y, items:items};
  repaintAll();
}

function openNvTrackMenu(info,x,y){
  if(!info || !info.song) return false;
  var s=info.song, starred=nvIsStarred('song',s.id);
  var items=[
    {label:'\u7acb\u5373\u64ad\u653e',act:'nv-trk-play',accent:true},
    {label:'\u4ece\u6b64\u5904\u968f\u673a\u64ad\u653e',act:'nv-trk-shuf'},
    {label:'\u6dfb\u52a0\u5230\u64ad\u653e\u961f\u5217',act:'nv-trk-queue'},
    {sep:true},
    {label:starred?'\u53d6\u6d88\u7ea2\u5fc3\u6536\u85cf':'\u6dfb\u52a0\u5230\u6211\u559c\u6b22\u7684\u97f3\u4e50',act:'nv-trk-star'},
    {label:'\u6dfb\u52a0\u5230 Navidrome \u6b4c\u5355...',act:'nv-trk-addmenu'}
  ];
  if(s.albumId || s.artistId){
    items.push({sep:true});
    if(s.albumId) items.push({label:'\u67e5\u770b\u6240\u5c5e\u4e13\u8f91',act:'nv-trk-album'});
    if(s.artistId) items.push({label:'\u67e5\u770b\u6b4c\u624b',act:'nv-trk-artist'});
  }
  if(info.plId && info.songIdx>=0){
    items.push({sep:true},{label:'\u4ece\u6b64\u6b4c\u5355\u79fb\u9664',act:'nv-trk-remove',danger:true});
  }
  ctxMenu={kind:'nv-track', info:info, x:x, y:y, items:items};
  repaintAll(); return true;
}

// right-click a local playlist row. Locked/auto playlists offer nothing -> fall through to JSplitter's menu
function openTrackMenu(pl,item,x,y){
  if(!canEditPl(pl)) return false;
  ctxMenu={kind:'track', pl:pl, item:item, x:x, y:y,
           items:[{label:'Remove from this playlist',act:'trkremove',danger:true}]};
  repaintAll(); return true;
}

function executeCtxMenuAction(ctx,entry){
  if(!entry) return;
  var act=entry.act;
  if(ctx.kind==='nv-pl'){
    var pid=ctx.plId, po=ctx.plObj;
    ctxMenu=null;
    if(act==='nv-pl-play'||act==='nv-pl-shuf'){
      var sh=(act==='nv-pl-shuf')?true:undefined;
      var det=NVData.plDetails[pid];
      if(det&&!det.loading&&det.songs&&det.songs.length){ nvPlaySongs(det.songs,0,{subKind:'playlist',id:pid,name:po.name},sh); }
      else nvFetchPlaylistDetail(pid,false,function(d){ if(d&&d.songs&&d.songs.length) nvPlaySongs(d.songs,0,{subKind:'playlist',id:pid,name:po.name},sh); });
      return;
    }
    if(act==='nv-pl-rename'){ startNvRenamePlaylist(po); return; }
    if(act==='nv-pl-delete'){ confirmDel={kind:'nv-pl',id:pid,name:po.name}; repaintAll(); return; }
    return;
  }
  if(ctx.kind==='nv-addpl'){
    ctxMenu=null;
    if(act==='nv-add-newpl'){ startNvCreatePlaylist(entry.songs.map(function(s){return s.id;})); return; }
    if(act==='nv-add-target'){ nvRequestAddToPlaylist(entry.plId,entry.plName,entry.songs); return; }
    return;
  }
  if(ctx.kind==='nv-track'){
    var info=ctx.info, s=info.song;
    ctxMenu=null;
    if(act==='nv-trk-play'){ nvPlaySongs(info.list||[s],info.idx||0,info.sourceMeta); repaintAll(); return; }
    if(act==='nv-trk-shuf'){ nvPlaySongs(info.list||[s],info.idx||0,info.sourceMeta,true); repaintAll(); return; }
    if(act==='nv-trk-queue'){ nvEnqueueSongs([s]); repaintAll(); return; }
    if(act==='nv-trk-star'){ nvToggleStar('song',s.id,s); return; }
    if(act==='nv-trk-addmenu'){ openNvAddToPlaylistMenu([s],ctx.x,ctx.y); return; }
    if(act==='nv-trk-album'){ nvOpenAlbum(s.albumId,s.album); return; }
    if(act==='nv-trk-artist'){ nvOpenArtist(s.artistId,s.artist); return; }
    if(act==='nv-trk-remove'){ nvRemoveSongFromServerPlaylist(info.plId,info.songIdx); return; }
    return;
  }
  var pl=ctx.pl, nm=ctx.name, itm=ctx.item;
  if(act==='trkremove'){ ctxMenu=null; removeTrackFromPl(pl,itm); return; }
  if(act==='addfiles'||act==='addfolder'){
    ctxMenu=null; firstRow=firstRowT=0; view='playlist'; repaintAll();
    if(act==='addfiles') addFilesToPl(pl); else addFolderToPl(pl);
  }
  else if(act==='rename'){ startRename(pl); }
  else { confirmDel={pl:pl,name:nm}; ctxMenu=null; repaintAll(); }
}

function canEditPl(pl){
  if(pl<0) return false;
  try{ if(plman.IsPlaylistLocked(pl) || plman.IsAutoPlaylist(pl)) return false; }catch(e){}
  return true;
}
function isRowPlaying(pl,item,h){
  if(!fb.IsPlaying && !fb.IsPaused) return false;
  var loc=playingLoc();
  if(loc && loc.IsValid && loc.PlaylistIndex===pl) return loc.PlaylistItemIndex===item;
  return sameHandle(h,NP);
}
function verifyAdvanced(h){
  window.SetTimeout(function(){
    var np=null; try{ np=fb.GetNowPlaying(); }catch(e){}
    if(!(fb.IsPlaying||fb.IsPaused) || !sameHandle(np,h)) return;
    fb.Next();
    window.SetTimeout(function(){
      var n2=null; try{ n2=fb.GetNowPlaying(); }catch(e2){}
      if((fb.IsPlaying||fb.IsPaused) && sameHandle(n2,h)) fb.Stop();
    },150);
  },60);
}
function dequeueRow(pl,item,h){
  var q=null; try{ q=plman.GetPlaybackQueueContents(); }catch(e){ q=null; }
  if(!q || !q.length) return;
  var kill=[];
  for(var i=0;i<q.length;i++){
    var e=q[i];
    if(e.PlaylistIndex===pl && e.PlaylistItemIndex===item) kill.push(i);
    else if(e.PlaylistIndex<0 && sameHandle(e.Handle,h)) kill.push(i);
  }
  if(kill.length){ try{ plman.RemoveItemsFromPlaybackQueue(kill); }catch(e2){} }
}
function removeFromShuffleCopy(pl,h){
  if(!pbShuffle || !h || pl<0) return;
  if(plman.GetPlaylistName(pl)!==shufSrcName) return;
  var si=playlistOfName(SHUF); if(si<0) return;
  var list=null; try{ list=plman.GetPlaylistItems(si); }catch(e){ return; }
  if(!list || !list.Count) return;
  var kill=[], i;
  for(i=0;i<list.Count;i++) if(sameHandle(list[i],h)) kill.push(i);
  if(!kill.length) return;
  try{
    plman.ClearPlaylistSelection(si);
    for(i=0;i<kill.length;i++) plman.SetPlaylistSelectionSingle(si,kill[i],true);
    plman.RemovePlaylistSelection(si,false);
    plman.ClearPlaylistSelection(si);
  }catch(e){}
}
function removeTrackFromPl(pl,item){
  if(!canEditPl(pl) || item<0 || item>=plman.PlaylistItemCount(pl)) return;
  var items=getItems(pl), h=(items && item<items.Count)?items[item]:null;
  var playing=isRowPlaying(pl,item,h), wasPaused=fb.IsPaused;
  dequeueRow(pl,item,h);
  if(playing){ if(wasPaused) fb.Stop(); else fb.Next(); }
  removeFromShuffleCopy(pl,h);
  try{
    plman.UndoBackup(pl);
    plman.ClearPlaylistSelection(pl);
    plman.SetPlaylistSelectionSingle(pl,item,true);
    plman.RemovePlaylistSelection(pl,false);
    plman.ClearPlaylistSelection(pl);
  }catch(e){}
  if(playing && !wasPaused) verifyAdvanced(h);
  invalidateItems(); updateNP(); repaintAll();
}
function startRename(pl){ renameEdit={kind:'local-pl', pl:pl, text:plman.GetPlaylistName(pl), title:'Rename playlist', saveLabel:'Save'}; ctxMenu=null; caretOn=true; startCaret(); applyKeyMode(); repaintAll(); }
function startNvRenamePlaylist(plObj){ renameEdit={kind:'nv-rename', id:plObj.id, text:plObj.name, title:'\u91cd\u547d\u540d Navidrome \u6b4c\u5355', saveLabel:'\u4fdd\u5b58'}; ctxMenu=null; caretOn=true; startCaret(); applyKeyMode(); repaintAll(); }
function startNvCreatePlaylist(songIds){ renameEdit={kind:'nv-create', text:'', songIds:songIds||[], title:'\u65b0\u5efa Navidrome \u6b4c\u5355', saveLabel:'\u521b\u5efa'}; ctxMenu=null; caretOn=true; startCaret(); applyKeyMode(); repaintAll(); }
function commitRename(){
  if(!renameEdit) return;
  var re=renameEdit, t=re.text.replace(/^\s+|\s+$/g,'');
  renameEdit=null; applyKeyMode();
  if(t){
    if(re.kind==='nv-rename') nvRenameServerPlaylist(re.id,t);
    else if(re.kind==='nv-create') nvCreateServerPlaylist(t,re.songIds,function(pl){
      if(pl && (!re.songIds || !re.songIds.length)) nvOpenPlaylist(pl.id,pl.name);
      repaintAll();
    });
    else plman.RenamePlaylist(re.pl,t);
  }
  repaintAll();
}
function cancelRename(){ renameEdit=null; applyKeyMode(); repaintAll(); }
function doDeletePlaylist(pl){
  var wasShown=(view==='playlist' && pl===plman.ActivePlaylist);
  try{ plman.RemovePlaylist(pl); }catch(e){}
  confirmDel=null; invalidateItems();
  if(wasShown || plman.PlaylistCount===0) view='home';
  repaintAll();
}
function doDeleteNvPlaylist(id){
  confirmDel=null;
  nvDeleteServerPlaylist(id,function(ok){
    if(ok && view==='navidrome' && nvView==='playlist' && nvViewId===id) nvOpenHome();
    repaintAll();
  });
}

function newPlaylistName(){ var b='New Playlist', nm=b, k=1, i; for(;;){ var hit=false; for(i=0;i<plman.PlaylistCount;i++){ if(plman.GetPlaylistName(i)===nm){ hit=true; break; } } if(!hit) return nm; k++; nm=b+' '+k; } }
function createNewPlaylist(){ return plman.CreatePlaylist(plman.PlaylistCount, newPlaylistName()); }
function addFilesToPl(i){ if(i<0 || plman.IsPlaylistLocked(i)) return; plman.ActivePlaylist=i; armDupWatch(i); fb.AddFiles(); }
function addFolderToPl(i){ if(i<0 || plman.IsPlaylistLocked(i)) return; plman.ActivePlaylist=i; armDupWatch(i); fb.AddDirectory(); }
