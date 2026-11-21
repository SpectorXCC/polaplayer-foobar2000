/* verdant/data/playlist_edit.js -- playlist + track editing: local & Navidrome context menus, rename, create, delete, add, remove
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

function openNvPlaylistMenu(plObj,x,y){
  if(!plObj) return false;
  var items=[
    {label:T('menu.pl_play'),act:'nv-pl-play',accent:true},
    {label:T('menu.pl_shuf'),act:'nv-pl-shuf'}
  ];
  if(plObj.editable !== false){
    items.push({sep:true});
    items.push({label:T('menu.rename'),act:'nv-pl-rename'});
  } else {
    items.push({sep:true});
  }
  items.push({label:T('menu.delete'),act:'nv-pl-delete',danger:true});
  ctxMenu={kind:'nv-pl', plId:plObj.id, plObj:plObj, name:plObj.name, x:x, y:y, items:items};
  repaintAll(); return true;
}

function openNvAddToPlaylistMenu(songs,x,y){
  if(!songs||!songs.length) return;
  var s0=songs[0];
  var src=(s0&&s0.src&&typeof sourceById==='function'&&sourceById(s0.src))||(typeof activeSource==='function'&&(activeSource()||sourceById('navidrome')))||null;
  var isLocal=!!(src&&src.id==='local');
  var pls=(src&&src.playlists)?src.playlists().list:[];
  var items=[{label:T(isLocal?'menu.add_new_pl':'menu.add_new_nv_pl'),act:'nv-add-newpl',accent:true,songs:songs,srcId:src?src.id:''}];
  var editable=[];
  for(var i=0;i<pls.length;i++) if(pls[i].editable!==false) editable.push(pls[i]);
  if(editable.length) items.push({sep:true});
  for(i=0;i<editable.length;i++){
    var p=editable[i];
    items.push({label:p.name,act:'nv-add-target',plId:p.id,plName:p.name,songs:songs,srcId:src?src.id:''});
  }
  ctxMenu={kind:'nv-addpl', x:x, y:y, items:items};
  repaintAll();
}

function openNvTrackMenu(info,x,y){
  if(!info || !info.song) return false;
  var s=info.song;
  var tSrc=(s&&s.src&&typeof sourceById==='function'&&sourceById(s.src))||(typeof activeSource==='function'&&(activeSource()||sourceById('navidrome')))||null;
  var isLocal=!!(tSrc&&tSrc.id==='local');
  var canLove=!!(tSrc&&typeof sourceCanLove==='function'&&sourceCanLove(tSrc,'song'));
  var starred=!!(canLove&&tSrc.isLoved&&tSrc.isLoved('song',s.id,s));
  var items=[
    {label:T('menu.trk_play'),act:'nv-trk-play',accent:true},
    {label:T('menu.trk_shuf'),act:'nv-trk-shuf'},
    {label:T('menu.trk_queue'),act:'nv-trk-queue'},
    {sep:true}
  ];
  if(canLove) items.push({label:starred?T('menu.trk_unstar'):T('menu.trk_star'),act:'nv-trk-star'});
  items.push({label:T(isLocal?'menu.trk_add_local_pl':'menu.trk_add_pl'),act:'nv-trk-addmenu'});
  if(s.albumId || s.artistId){
    items.push({sep:true});
    if(s.albumId) items.push({label:T('menu.trk_view_album'),act:'nv-trk-album'});
    if(s.artistId) items.push({label:T('menu.trk_view_artist'),act:'nv-trk-artist'});
  }
  if(info.plId !== '' && info.plId !== undefined && info.songIdx>=0){
    var plMeta=(tSrc&&tSrc.playlistById)?tSrc.playlistById(info.plId):null;
    if(!plMeta || plMeta.editable!==false){
      items.push({sep:true},{label:T('menu.trk_remove'),act:'nv-trk-remove',danger:true});
    }
  }
  ctxMenu={kind:'nv-track', info:info, x:x, y:y, items:items};
  repaintAll(); return true;
}

function executeCtxMenuAction(ctx,entry){
  if(!entry) return;
  var act=entry.act;
  if(ctx.kind==='snap'){
    ctxMenu=null;
    if(typeof applySnapPreset==='function') applySnapPreset(act);
    repaintAll();
    return;
  }
  if(ctx.kind==='winmenu'){
    ctxMenu=null;
    if(typeof openMenu==='function') openMenu(act,ctx.mx||8,TBH);
    repaintAll();
    return;
  }
  if(ctx.kind==='nv-pl'){
    var pid=ctx.plId, po=ctx.plObj;
    var pSrc=(po&&po.src&&typeof sourceById==='function'&&sourceById(po.src))||(typeof activeSource==='function'&&(activeSource()||sourceById('navidrome')))||null;
    ctxMenu=null;
    if(act==='nv-pl-play'||act==='nv-pl-shuf'){
      var sh=(act==='nv-pl-shuf')?true:undefined;
      if(!pSrc) return;
      var det=pSrc.playlist(pid);
      var cnt=det.rows?det.rows.count:(det.songs?det.songs.length:0);
      if(!det.loading&&cnt){ pSrc.play(det.rows||det.songs,0,{subKind:'playlist',id:pid,name:po.name},sh); }
      else pSrc.fetchPlaylist(pid,false,function(d){ if(d&&((d.rows&&d.rows.count)||(d.songs&&d.songs.length))) pSrc.play(d.rows||d.songs,0,{subKind:'playlist',id:pid,name:po.name},sh); });
      return;
    }
    if(act==='nv-pl-rename'){ startNvRenamePlaylist(po,pSrc); return; }
    if(act==='nv-pl-delete'){ confirmDel={kind:'nv-pl',id:pid,name:po.name,srcId:pSrc?pSrc.id:''}; repaintAll(); return; }
    return;
  }
  if(ctx.kind==='nv-addpl'){
    var aSrc=(entry.srcId&&typeof sourceById==='function'&&sourceById(entry.srcId))||(typeof activeSource==='function'&&(activeSource()||sourceById('navidrome')))||null;
    ctxMenu=null;
    if(act==='nv-add-newpl'){ startNvCreatePlaylist(entry.songs.map(function(s){return s.id;}), aSrc); return; }
    if(act==='nv-add-target'){ if(aSrc&&aSrc.playlistOps&&aSrc.playlistOps.addSongs) aSrc.playlistOps.addSongs(entry.plId,entry.plName,entry.songs); return; }
    return;
  }
  if(ctx.kind==='nv-track'){
    var info=ctx.info, s=info.song;
    var tSrc=(s&&s.src&&typeof sourceById==='function'&&sourceById(s.src))||(typeof activeSource==='function'&&(activeSource()||sourceById('navidrome')))||null;
    ctxMenu=null;
    if(act==='nv-trk-play'){ if(tSrc&&tSrc.play) tSrc.play(info.list||[s],info.idx||0,info.sourceMeta); repaintAll(); return; }
    if(act==='nv-trk-shuf'){ if(tSrc&&tSrc.play) tSrc.play(info.list||[s],info.idx||0,info.sourceMeta,true); repaintAll(); return; }
    if(act==='nv-trk-queue'){ if(tSrc&&tSrc.enqueue) tSrc.enqueue([s]); return; }
    if(act==='nv-trk-star'){ if(tSrc&&tSrc.toggleLoved) tSrc.toggleLoved('song',s.id,s); return; }
    if(act==='nv-trk-addmenu'){ openNvAddToPlaylistMenu([s],ctx.x,ctx.y); return; }
    if(act==='nv-trk-album'){ brOpenAlbum(s.albumId,s.album); return; }
    if(act==='nv-trk-artist'){ brOpenArtist(s.artistId,s.artist); return; }
    if(act==='nv-trk-remove'){ if(tSrc&&tSrc.playlistOps&&tSrc.playlistOps.removeSong) tSrc.playlistOps.removeSong(info.plId,info.songIdx); return; }
    return;
  }
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
function startNvRenamePlaylist(plObj,src){
  var opSrc=src||(typeof activeSource==='function'&&(activeSource()||sourceById('navidrome')))||null;
  var isLocal=!!(opSrc&&opSrc.id==='local');
  renameEdit={kind:'nv-rename', id:plObj.id, srcId:opSrc?opSrc.id:'', text:plObj.name, title:T(isLocal?'dlg.rename_pl':'dlg.rename_nv_pl'), saveLabel:T('btn.save')};
  ctxMenu=null; caretOn=true; startCaret(); applyKeyMode(); repaintAll();
}
function startNvCreatePlaylist(songIds,src){
  var opSrc=src||(typeof activeSource==='function'&&(activeSource()||sourceById('navidrome')))||null;
  var isLocal=!!(opSrc&&opSrc.id==='local');
  renameEdit={kind:'nv-create', srcId:opSrc?opSrc.id:'', text:'', songIds:songIds||[], title:T(isLocal?'dlg.create_pl':'dlg.create_nv_pl'), saveLabel:T('btn.create')};
  ctxMenu=null; caretOn=true; startCaret(); applyKeyMode(); repaintAll();
}
function commitRename(){
  if(!renameEdit) return;
  var re=renameEdit, t=re.text.replace(/^\s+|\s+$/g,'');
  renameEdit=null; applyKeyMode();
  if(t){
    var opSrc=(re.srcId&&typeof sourceById==='function'&&sourceById(re.srcId))||(typeof activeSource==='function'&&(activeSource()||sourceById('navidrome')))||null;
    if(re.kind==='nv-rename'){ if(opSrc&&opSrc.playlistOps&&opSrc.playlistOps.rename) opSrc.playlistOps.rename(re.id,t); }
    else if(re.kind==='nv-create'){ if(opSrc&&opSrc.playlistOps&&opSrc.playlistOps.create) opSrc.playlistOps.create(t,re.songIds,function(pl){
      if(pl && (!re.songIds || !re.songIds.length)) brOpenPlaylist(pl.id,pl.name);
      repaintAll();
    }); }
  }
  repaintAll();
}
function cancelRename(){ renameEdit=null; applyKeyMode(); repaintAll(); }
function doDeleteNvPlaylist(id,srcId){
  var sid=srcId||(confirmDel&&confirmDel.srcId)||'';
  confirmDel=null;
  var opSrc=(sid&&typeof sourceById==='function'&&sourceById(sid))||(typeof activeSource==='function'&&(activeSource()||sourceById('navidrome')))||null;
  if(opSrc&&opSrc.playlistOps&&opSrc.playlistOps.remove) opSrc.playlistOps.remove(id,function(ok){
    if(ok && view==='browse' && brView==='playlist' && brViewId===id) brOpenHome();
    repaintAll();
  });
}

function newPlaylistName(){ var b=T('nav.default_pl_name'), nm=b, k=1, i; for(;;){ var hit=false; for(i=0;i<plman.PlaylistCount;i++){ if(plman.GetPlaylistName(i)===nm){ hit=true; break; } } if(!hit) return nm; k++; nm=b+' '+k; } }
function createNewPlaylist(){ return plman.CreatePlaylist(plman.PlaylistCount, newPlaylistName()); }
function addFilesToPl(i){ if(i<0 || plman.IsPlaylistLocked(i)) return; plman.ActivePlaylist=i; armDupWatch(i); fb.AddFiles(); }
function addFolderToPl(i){ if(i<0 || plman.IsPlaylistLocked(i)) return; plman.ActivePlaylist=i; armDupWatch(i); fb.AddDirectory(); }
