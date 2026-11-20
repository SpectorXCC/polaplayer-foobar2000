/* verdant/app.js -- panel state, layout, paint dispatch, input, and foobar callbacks
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

/* ------------------------- state ------------------------- */
var W=dip(window.Width), H=dip(window.Height), R={}, NP=null, npTitleStr='', npArtistStr='';
// Repaint scope flags. dirtyAll (sticky) forces a full paint; partial flags accumulate.
// A full window.Repaint() MUST set dirtyAll (use repaintAll) so a paint serviced while a
// partial flag is pending can't blank the rest of the window.
var dirtyAll=true, dirtyBar=false, dirtyQueue=false, dirtySearch=false, dirtyMain=false, dirtyNav=false, dirtyTitle=false, dirtyViz=false;
function clearDirty(){ dirtyAll=dirtyBar=dirtyQueue=dirtySearch=dirtyMain=dirtyNav=dirtyTitle=dirtyViz=false; }
/* When the oldest pending partial flag was raised. A RepaintRect is serviced within a frame or two,
   so a flag still pending long after it went up means its paint was DEFERRED -- the window was
   minimised, and a minimised window gets no WM_PAINT. The paint that finally arrives on restore is
   the OS repainting the whole window onto a fresh surface, not the region we asked for; taking the
   partial path then drew one panel and left the rest a flat grey until something was hovered. The
   1 Hz clock guarantees a pending flag whenever the window is minimised mid-song, and the mouse
   leaving for the taskbar raises one even when paused. Every partial setter calls markDirty() FIRST,
   so the clock records the oldest flag rather than being reset by each new one. */
var dirtySince=0, DIRTY_STALE_MS=250;
function anyDirty(){ return dirtyBar||dirtyQueue||dirtySearch||dirtyMain||dirtyNav||dirtyTitle||dirtyViz; }
function markDirty(){ if(!anyDirty()) dirtySince=Date.now(); }
function repaintAll(force){ syncNavidromePanel(); dirtyAll=true; window.Repaint(!!force); }
function hasActiveOverlay(){
  return !!(renameEdit||ctxMenu||confirmDel||dupPrompt||rgPrompt||sgMenuOpen||plSortMenuOpen||vizMenuOpen||volumePopupOpen||nvAlbTabOpen||nvPlSortOpen||nvSrvMenuOpen||(R.drawer&&queueDrawerOpen));
}
function clearNonFsHitboxes(){
  HB_PL=[]; HB_TR=[]; HB_TABS=[]; HB_Q=[]; HB_CARD=[]; HB_HOME=null; HB_CAP=null; HB_MENU=[];
  HB_ADDPL=null; HB_PLADD_FILES=null; HB_PLADD_FOLDER=null; HB_DOTS=[]; HB_SOURCE=[]; HB_SEARCH=null;
  SB=null; SBN=null; SBH=null; HB_DRAWER=null;
  if(typeof HB_NAV_DOTS!=='undefined') HB_NAV_DOTS=[];
  if(typeof SG_HB!=='undefined') SG_HB=[];
  if(typeof HB_SG!=='undefined') HB_SG=null;
  if(typeof HB_ALLSONGS!=='undefined') HB_ALLSONGS=null;
  if(typeof HB_RGNORM!=='undefined') HB_RGNORM=null;
  if(typeof PL_SORT_HB!=='undefined') PL_SORT_HB=[];
  if(typeof HB_PLSORT!=='undefined') HB_PLSORT=null;
  if(typeof HB_PLSORTDIR!=='undefined') HB_PLSORTDIR=null;
  if(typeof HB_NV_PL!=='undefined') HB_NV_PL=[];
  if(typeof HB_NV_PL_DOTS!=='undefined') HB_NV_PL_DOTS=[];
  if(typeof HB_NV_QUICK!=='undefined') HB_NV_QUICK=[];
  if(typeof HB_NV_REFRESH!=='undefined') HB_NV_REFRESH=null;
  if(typeof HB_NV_ADDPL!=='undefined') HB_NV_ADDPL=null;
  if(typeof HB_NV_BTN!=='undefined') HB_NV_BTN=[];
  if(typeof HB_NV_CARDS!=='undefined') HB_NV_CARDS=[];
  if(typeof HB_NV_TR!=='undefined') HB_NV_TR=[];
  if(typeof HB_NV_STAR!=='undefined') HB_NV_STAR=[];
  if(typeof HB_NV_TRDOTS!=='undefined') HB_NV_TRDOTS=[];
  if(typeof HB_NV_PLDOTS!=='undefined') HB_NV_PLDOTS=[];
  if(typeof NV_ALB_DD_HB!=='undefined') NV_ALB_DD_HB=[];
  if(typeof NV_SORT_DD_HB!=='undefined') NV_SORT_DD_HB=[];
  if(typeof NV_SRV_DD_HB!=='undefined') NV_SRV_DD_HB=[];
  if(typeof HB_NV_ALB_DD!=='undefined') HB_NV_ALB_DD=null;
  if(typeof HB_NV_SORT_DD!=='undefined') HB_NV_SORT_DD=null;
  if(typeof HB_NV_SORT_DIR!=='undefined') HB_NV_SORT_DIR=null;
  if(typeof HB_NV_SRV_DD!=='undefined') HB_NV_SRV_DD=null;
  if(typeof HB_QLY!=='undefined') HB_QLY=[];
  if(typeof HB_QLY_RETRY!=='undefined') HB_QLY_RETRY=null;
  if(typeof HB_QLY_REF!=='undefined') HB_QLY_REF=null;
}
function clearNormalOverlays(){
  queueDrawerOpen=false; volumePopupOpen=false; drag=null; hoverKey=''; scrollKey='';
  ctxMenu=null; CTX_HB=[]; confirmDel=null; CONF_HB=null;
  dupPrompt=null; DUP_HB=null; rgPrompt=null; RG_HB=null;
  if(renameEdit){ renameEdit=null; RENAME_HB=null; stopCaret(); }
  sgMenuOpen=false; plSortMenuOpen=false; vizMenuOpen=false;
  if(typeof nvCloseNvMenus==='function') nvCloseNvMenus();
}
function mainCanBleedBar(){
  return !(view==='home' || (view==='navidrome' && (nvView==='home'||nvView==='artists')));
}
/* Main's views draw the row/card straddling their crop line at full height and mask only the
   10px gutter below it (see the FillSolidRect(r.x,cropY,...) in each), so the remainder lands on
   the player bar. drawBar runs after main in the partial path, so pairing them covers it -- and
   it is far cheaper than the full-window repaint that used to hide this. */
function repaintMain(){
  if(fsMode||hasActiveOverlay()){ repaintAll(); return; }
  if(!R.main){ repaintAll(); return; }
  markDirty(); dirtyMain=true;
  repaintRect(R.main.x,R.main.y,R.main.w,R.main.h);
  if(mainCanBleedBar() && R.barY!==undefined){
    dirtyBar=true;
    repaintRect(0,R.barY,W,M.barH);
  }
}
function repaintNav(){
  if(fsMode||hasActiveOverlay()){ repaintAll(); return; }
  if(!R.navLib){ repaintAll(); return; }
  markDirty(); dirtyNav=true;
  repaintRect(R.navLib.x,R.navLib.y,R.navLib.w,R.navLib.h);
}
// drawNav paints both nav cards, so a hover crossing between them must invalidate their union
function repaintNavAll(){
  if(fsMode||hasActiveOverlay()){ repaintAll(); return; }
  if(!R.navTop||!R.navLib){ repaintAll(); return; }
  markDirty(); dirtyNav=true;
  var y0=R.navTop.y, y1=R.navLib.y+R.navLib.h;
  repaintRect(R.navTop.x,y0,R.navTop.w,Math.max(0,y1-y0));
}
function repaintQueue(){
  if(fsMode||hasActiveOverlay()){ repaintAll(); return; }
  if(!R.queue || R.drawer) return;
  markDirty(); dirtyQueue=true;
  repaintRect(R.queue.x,R.queue.y,R.queue.w,R.queue.h);
}
// the visualizer's own band -- see the fullscreen branch of on_paint
function repaintViz(){ markDirty(); dirtyViz=true; repaintRect(0,VIZ_TOP,W,Math.max(0,(H-172)-VIZ_TOP)); }
function repaintTitle(){
  if(fsMode||hasActiveOverlay()){ repaintAll(); return; }
  markDirty(); dirtyTitle=true;
  repaintRect(0,0,W,TBH);
}
/* A hover only changes one panel's appearance, so repaint that panel rather than the whole
   window. Hitbox ownership is cleanly panel-aligned (HB_PL/HB_HOME/SBN -> nav, HB_CARD/HB_TR/
   SB/SBH -> main, HB_Q/HB_TABS -> queue, HB_CTRL -> bar, HB_MENU/HB_CAP -> title), so the
   cursor position alone picks the right one. */
function hoverZone(x,y){
  if(y<TBH) return 'title';
  if(R.barY!==undefined && y>=R.barY) return 'bar';
  if(R.queue && x>=R.queue.x) return 'queue';
  if(R.main && x>=R.main.x) return 'main';
  return 'nav';
}
function repaintZone(z){
  if(z==='main') repaintMain();
  else if(z==='nav') repaintNavAll();
  else if(z==='queue') repaintQueue();
  else if(z==='bar') repaintBar();
  else if(z==='title') repaintTitle();
}
var firstRow=0, hoverKey='', scrollKey='', hoverZoneKey='', mx=-1, my=-1, drag=null, dragFrac=0;   // WHEEL_PX: core/props.js
// eased scrolling: animate each rendered position toward its target with dt-normalized decay
var firstRowT=0, navScrollT=0, homeScrollT=0, PL_MAXPX=0, scrollTimer=null, SCROLL_RATE=17.5, scrollLastMs=0;
function scrollTick(){
  var now=nowMs(), dt=scrollLastMs?Math.min(50,Math.max(1,now-scrollLastMs)):ANIM_MS;
  scrollLastMs=now;
  var alpha=1-Math.exp(-SCROLL_RATE*dt/1000);
  var mm=false, nm=false, d1=firstRowT-firstRow, d2=navScrollT-navScroll, d3=homeScrollT-homeScroll, d4=songsScrollT-songsScroll, d5=searchScrollT-searchScroll, d6=plScrollT-plScroll;
  var d7=(typeof nvScrollT!=='undefined')?(nvScrollT-nvScroll):0;
  var d8=(typeof nvShelfScrollT!=='undefined')?(nvShelfScrollT-nvShelfScroll):0;
  if(Math.abs(d1)>=0.5){ firstRow+=d1*alpha; mm=true; } else firstRow=firstRowT;
  if(Math.abs(d3)>=0.5){ homeScroll+=d3*alpha; mm=true; } else homeScroll=homeScrollT;
  if(Math.abs(d4)>=0.5){ songsScroll+=d4*alpha; mm=true; } else songsScroll=songsScrollT;
  if(Math.abs(d5)>=0.5){ searchScroll+=d5*alpha; mm=true; } else searchScroll=searchScrollT;
  if(Math.abs(d6)>=0.5){ plScroll+=d6*alpha; mm=true; } else plScroll=plScrollT;
  if(typeof nvScrollT!=='undefined'){
    if(Math.abs(d7)>=0.5){ nvScroll+=d7*alpha; mm=true; } else nvScroll=nvScrollT;
    if(Math.abs(d8)>=0.5){ nvShelfScroll+=d8*alpha; mm=true; } else nvShelfScroll=nvShelfScrollT;
  }
  if(Math.abs(d2)>=0.5){ navScroll+=d2*alpha; nm=true; } else navScroll=navScrollT;
  if(mm) repaintMain();
  if(nm) repaintNav();
  // one more frame after the scroll settles, so shimSettle can restart the sweep it suppressed
  if(!mm && !nm){ stopScrollAnim(); if(shimCount>0) repaintMain(); }
}
function startScrollAnim(){ if(!scrollTimer){ scrollLastMs=nowMs(); scrollTimer=window.SetInterval(scrollTick,ANIM_MS); } }
function stopScrollAnim(){ if(scrollTimer){ window.ClearInterval(scrollTimer); scrollTimer=null; } scrollLastMs=0; }

function hv(x0,y0,x1,y1){ return mx>=x0 && mx<x1 && my>=y0 && my<y1; }
var HB_PL=[], HB_TR=[], HB_CTRL=[], HB_TABS=[], HB_SEEK=null, HB_VOL=null, HB_Q=[];
var HB_CARD=[], HB_HOME=null, HB_CAP=null, HB_MENU=[], SB=null;
var navScroll=0, NAV_MAX=0, SBN=null, HB_ADDPL=null, navDropHover=false;
// deferred "scroll this playlist into view" -- only drawNav knows the row geometry, so it consumes this
var navRevealPl=-1;
function revealPlaylist(i){ navRevealPl=i; }
var plDropHover=false, HB_PLADD_FILES=null, HB_PLADD_FOLDER=null;   // empty-playlist "add songs" zone
// playlist edit: context menu, inline rename, delete confirm
var HB_DOTS=[], ctxMenu=null, CTX_HB=[], renameEdit=null, confirmDel=null, CONF_HB=null, RENAME_HB=null;

var rightTab='lyrics';
try{ rightTab=window.GetProperty('Navigation: right pane','lyrics'); }catch(e){}
if(rightTab!=='queue' && rightTab!=='lyrics') rightTab='lyrics';
var view='home', viewArtist='', artistAlbums=[], homeScroll=0, artScroll=0;
var localView='home', HB_SOURCE=[], navidromeLayoutKey='', nvSearchTimer=null;
var savedLibrarySource='local';
try{ savedLibrarySource=window.GetProperty('Navigation: music source','local'); }catch(e){}
var libSource=(savedLibrarySource==='navidrome')?'navidrome':'local';
if(libSource==='navidrome') view='navidrome';
// Fullscreen "chill" mode + its sub-view (default now-playing / lyrics / visualizer)
var fsMode=false, fsView='default', HB_FS=[], vizTimer=null, vizBars=[];
// Re-asserted every full paint + on_size: JSplitter can reset window.DlgCode on resize/reload.
/* Search and rename need every key, because the user is typing into them. Everywhere else the
   panel still asks for character keys, which is what lets Space reach on_char and act as
   play/pause -- without it the dialog manager swallows Space before the panel ever sees it. */
function applyKeyMode(){ try{ window.DlgCode=(fsMode||view==='search'||renameEdit)?DLGC_WANTALLKEYS:DLGC_WANTCHARS; }catch(e){} }

var searchQuery='', searchScroll=0, searchScrollT=0, searchIdx=null, searchQ2=null, searchArts=[], searchTrks=[], HB_SEARCH=null;
var HOME_MAXROW=0, ART_MAXBLOCK=0, SEARCH_MAXPX=0;
// Home "Your Playlists" horizontal shelf: pixel scroll offset + eased target, max, wheel hit-band, h-scrollbar.
var plScroll=0, plScrollT=0, HOME_PLMAX=0, HOME_SHELF_Y0=0, HOME_SHELF_Y1=0, SBH=null;
// The shelf glides freely but always *targets* a card boundary, so the leftmost card keeps its
// rounded edge instead of being cut mid-body (COL.elev against COL.base reads as a seam).
// HOME_STRIDE is published by drawHome, which is the only place the card pitch is known.
var HOME_STRIDE=0;
function snapShelf(px){ var st=HOME_STRIDE||1; return clampPx(Math.round(px/st)*st,HOME_PLMAX); }
function snapNvShelf(px){ var st=(typeof NV_SHELF_STRIDE!=='undefined'&&NV_SHELF_STRIDE)||1; return clampPx(Math.round(px/st)*st,(typeof NV_SHELF_MAX!=='undefined'?NV_SHELF_MAX:0)); }

function switchLibrarySource(source){
  if(nvSearchTimer){ window.ClearTimeout(nvSearchTimer); nvSearchTimer=null; }
  if(typeof nvCloseNvMenus==='function') nvCloseNvMenus();
  if(source==='navidrome'){
    if(view!=='navidrome' && view!=='search') localView=view;
    libSource='navidrome';
    view='navidrome';
    navScroll=navScrollT=0;
    if(typeof nvEnsureLoaded==='function') nvEnsureLoaded();
  } else {
    libSource='local';
    if(view==='navidrome' || view==='search') view=localView||'home';
    navScroll=navScrollT=0;
  }
  try{ window.SetProperty('Navigation: music source',libSource); savedLibrarySource=libSource; }catch(e){}
  searchQ2=null;
  if(typeof NVData==='object'&&NVData.search) NVData.search.requested='';
  hoverKey=''; scrollKey='';
  repaintAll();
}
// Native CUI Navidrome & Lyrics panels stay hidden: foo_navidrome remains headless for playback/cache/scrobble.
function hideNativePanel(name){
  try{
    var panel=window.GetPanel(name);
    panel.ShowCaption=false;
    panel.Locked=true;
    panel.Show(false);
  }catch(e){}
}
function syncNavidromePanel(){
  if(!R.main) return;
  var source=(typeof libSource!=='undefined'&&libSource==='navidrome')?'navidrome':'local';
  if(view!=='navidrome' && view!=='search') localView=view;
  if(source!==savedLibrarySource){
    try{ window.SetProperty('Navigation: music source',source); savedLibrarySource=source; }catch(e){}
  }
  if(navidromeLayoutKey==='hidden') return;
  hideNativePanel('Navidrome');
  hideNativePanel('Lyrics');
  navidromeLayoutKey='hidden';
}


function layout(){
  var g=M.gap, top0=TBH+g;   // one uniform gap on every side, incl. below the title bar and above the bar
  R.barY=H-M.barH;
  R.top={x:g,y:top0,bottom:R.barY-g};
  R.drawer=W<1120;
  R.navX=g;R.navW=W>=1440?230:(W<720?160:200);
  R.queueW=W>=1440?400:320;
  R.queueX=R.drawer?W+g:W-g-R.queueW;
  R.mainX=R.navX+R.navW+g;R.mainW=Math.max(1,(R.drawer?W:R.queueX)-g-R.mainX);
  M.headH=H<650?164:280;M.artSz=H<650?124:200;M.navTopH=H<620?148:176;
  var topH=R.top.bottom-R.top.y;
  R.navTop={x:R.navX,y:top0,w:R.navW,h:M.navTopH};
  R.navLib={x:R.navX,y:top0+M.navTopH+g*2,w:R.navW,h:topH-M.navTopH-g*2};   // wider gap to the library card
  R.main={x:R.mainX,y:top0,w:R.mainW,h:topH};
  R.queue={x:R.queueX,y:top0,w:R.queueW,h:topH};
  if(R.drawer&&queueDrawerOpen){
    var drawerW=Math.min(360,Math.max(120,W-R.mainX-g*2));
    R.queue={x:W-g-drawerW,y:top0,w:drawerW,h:topH};
  }
  if(!R.drawer)queueDrawerOpen=false;
  // frameless; the title-bar strip minus our 3 buttons becomes an OS caption (drag/dbl-click)
  if(UIWizard){ try{ UIWizard.FrameStyle=3; UIWizard.MoveStyle=0; UIWizard.DisableWindowSizing=false; UIWizard.DisableWindowMaximizing=false; }catch(e){} }
  capW=-1; applyCaption();
  applyKeyMode();
  syncNavidromePanel();
}
// bitmaps are keyed by geometry; and the panel's surface is rebuilt, so the next paint must be full
function on_size(w,h){ if(checkDisplay(false))return;W=dip(w);H=dip(h); layout(); plCardCache={}; artCardCache={}; artCardN=0; if(typeof clearNvCardCache==='function') clearNvCardCache(); skelImgs={}; dirtyAll=true; }
/* Light/dark switching. Everything that reads COL at paint time follows on its own; what has to be
   dropped here is anything that baked a colour into a bitmap: the corner stamps (filled with the
   canvas colour), the pre-rendered playlist/artist cards, and the skeleton placeholders. */
function syncTheme(){
  var light=themeWantsLight();
  if(light===IS_LIGHT) return false;
  setPalette(light);
  CORN=null; plCardCache={}; artCardCache={}; artCardN=0; if(typeof clearNvCardCache==='function') clearNvCardCache(); skelImgs={};
  return true;
}
// Columns UI fires this when its colours change, including a dark/light mode switch
function on_colours_changed(){ if(syncTheme()) repaintAll(true); }

// name/count come from the per-playlist caches, not fresh interop: this runs on every paint of the playlist view
function activePl(){ var i=plman.ActivePlaylist; return {i:i, name:i>=0?plName(i):'', count:i>=0?plCount(i):0}; }
function updateNP(){
  var m=(fb.IsPlaying||fb.IsPaused)?fb.GetNowPlaying():null;
  NP=m;
  npTitleStr=m?TF.npTitle.EvalWithMetadb(m):'';
  npArtistStr=m?TF.npArtist.EvalWithMetadb(m):'';
}
function repaintBar(){
  if(fsMode||hasActiveOverlay()){ repaintAll(); return; }
  if(R.barY===undefined){ repaintAll(); return; }
  markDirty(); dirtyBar=true;
  repaintRect(0,R.barY,W,M.barH);
}

/* Only frames that actually redraw main may settle the shimmer -- a bar-only repaint (the 1Hz
   clock) would otherwise count zero skeletons and stop the animation while one is on screen. */
function drawMainCounted(gr){
  shimCount=0; gateWaiting=0;
  drawMain(gr); roundTop(gr,R.main.x,R.main.y,R.main.w);
  shimSettle();
}
function on_paint(gr){
  if(checkDisplay(false))return;gr=dpiGraphics(gr);
  visPlCache=null;   // one playlist scan per frame, shared by drawNav and drawHome
  gr.SetSmoothingMode(2);
  gr.SetInterpolationMode(5);   // NearestNeighbor: every DrawImage here is 1:1, so filtering is pure cost
  var stale=anyDirty() && (Date.now()-dirtySince)>DIRTY_STALE_MS;   // see markDirty
  if(fsMode){
    /* A visualizer frame changes only the bars. Redrawing the cover, the title, the seek bar and
       the whole transport underneath them 30 times a second was most of the frame's cost, so a
       frame flagged ONLY by the viz repaints just that band. Any other flag (or a paint we did not
       ask for) still takes the full path, so nothing can be left stale behind the bars. */
    var vizOnly=dirtyViz && !stale && fsView==='viz' && !vizMenuOpen && !dirtyAll && !dirtyBar && !dirtyMain
                && !dirtyNav && !dirtyQueue && !dirtySearch && !dirtyTitle;
    clearDirty();
    // Fullscreen is drawn over the (darkened) album art, so it keeps the dark palette in every
    // mode -- swap it in for this frame only and put the user's palette back afterwards.
    var fsLight=IS_LIGHT; if(fsLight) setPalette(false);
    try{
      if(vizOnly){ drawVizBand(gr); return; }
      HB_DOTS=[]; drawFullscreen(gr); return;
    }finally{ if(fsLight) setPalette(true); }
  }
  var anyPartial=dirtyBar||dirtyQueue||dirtySearch||dirtyMain||dirtyNav||dirtyTitle;
  // A partial paint skips drawOverlays, so a modal's dim backdrop would not be reapplied over the
  // region it redraws (the bar's 1 Hz repaint would flash back to full brightness). While an
  // overlay owns the screen, every paint takes the full path.
  var modal=hasActiveOverlay();
  if(dirtyAll || !anyPartial || modal || stale){ // full paint, or an OS/stale paint we can't scope
    clearDirty();
    HB_DOTS=[];
    syncTheme();   // cheap check; catches a mode switch even if on_colours_changed never fired
    gr.FillSolidRect(0,0,W,H,COL.canvas);   // canvas -> panels read as separated cards (Spotify look)
    drawTitleBar(gr);
    // main before nav: the home shelf's leftmost card is drawn partly outside the panel
    // (continuous scroll), so nav must repaint over that bleed -- same reason queue follows main
    drawMainCounted(gr);
    drawNav(gr);
    drawQueueLayer(gr);
    drawBar(gr);
    drawOverlays(gr);
    return;
  }
  // partial composite: only the regions actually flagged (each drawn over live content)
  if(dirtyTitle){ dirtyTitle=false; drawTitleBar(gr); }
  if(dirtyMain) HB_DOTS=[];   // main panel dots; nav owns HB_NAV_DOTS inside drawNav
  if(dirtyMain){ dirtyMain=false; drawMainCounted(gr); }
  if(dirtyNav){ dirtyNav=false; drawNav(gr); }
  if(dirtyQueue){ dirtyQueue=false; drawQueueLayer(gr); }
  if(dirtySearch){ dirtySearch=false; if(view==='search') drawSearchBox(gr,R.main); }
  if(dirtyBar){ dirtyBar=false; drawBar(gr); }
}

function drawMain(gr){
  HB_CARD=[]; HB_TR=[]; SB=null; SBH=null;   // clear stale click targets from the previous view
  HB_PLADD_FILES=null; HB_PLADD_FOLDER=null;
  if(view!=='songs'){ HB_SG=null; SG_HB=[]; HB_RGNORM=null; }
  if(view!=='playlist'){ HB_PLSORT=null; HB_PLSORTDIR=null; PL_SORT_HB=[]; }
  if(view!=='navidrome' && view!=='search'){
    HB_NV_BTN=[]; HB_NV_CARDS=[]; HB_NV_TR=[]; HB_NV_STAR=[]; HB_NV_TRDOTS=[]; HB_NV_PLDOTS=[];
    HB_NV_ALB_DD=null; HB_NV_SORT_DD=null; HB_NV_SORT_DIR=null; HB_NV_SRV_DD=null;
    NV_ALB_DD_HB=[]; NV_SORT_DD_HB=[]; NV_SRV_DD_HB=[];
  }
  applyKeyMode();
  if(view==='search') startCaret(); else stopCaret();
  var r=R.main; panelBg(gr,r,COL.base);
  if(view==='navidrome'){ drawNavidromeView(gr,r); return; }
  if(view==='home'){ drawHome(gr,r); return; }
  if(view==='search'){ drawSearch(gr,r); return; }
  if(view==='artist'){ drawArtist(gr,r); return; }
  if(view==='songs'){ drawSongs(gr,r); return; }
  drawPlaylist(gr,r);
}

/* ------------------------- input ------------------------- */
function seekFrac(x){ return HB_SEEK?clamp01((x-HB_SEEK.x)/HB_SEEK.w):0; }
function applyVol(x){ if(HB_VOL){ fb.Volume=pos2vol(clamp01((x-HB_VOL.x)/HB_VOL.w)); repaintBar(); } }
function on_mouse_lbtn_down(x,y){
  x=dip(x);y=dip(y);
  if(drawerPointer(x,y)){drawerDismissedClick=true;return;}
  if(ctxMenu||confirmDel||renameEdit||sgMenuOpen||plSortMenuOpen||vizMenuOpen||dupPrompt||rgPrompt||nvAlbTabOpen||nvPlSortOpen||nvSrvMenuOpen) return;   // overlays are modal; dismissal/actions handled on button-up
  if(HB_SEEK && inRect(x,y,HB_SEEK)){ drag='seek'; dragFrac=seekFrac(x); repaintBar(); return; }
  if(HB_VOL && inRect(x,y,HB_VOL)){ drag='vol'; applyVol(x); return; }
  if(SBH && inRect(x,y,SBH)){ drag='scrollh'; setScrollH(x); return; }
  if(SBN && inRect(x,y,SBN)){ drag='scrolln'; setScrollN(y); return; }
  if(SB && inRect(x,y,SB)){ drag='scroll'; setScroll(y); return; }
}
function on_mouse_rbtn_up(x,y){
  x=dip(x);y=dip(y);
  if(fsMode){
    if(vizMenuOpen){ vizMenuOpen=false; repaintAll(); return true; }
    return false;
  }
  if(ctxMenu||confirmDel||renameEdit||dupPrompt||rgPrompt||nvAlbTabOpen||nvPlSortOpen||nvSrvMenuOpen) return true;   // a modal is open: swallow
  var i;
  if(view==='playlist'){ for(i=0;i<HB_TR.length;i++){ if(HB_TR[i].pl!==undefined && inRect(x,y,HB_TR[i])){ return openTrackMenu(HB_TR[i].pl,HB_TR[i].item,x,y); } } }
  if(view==='navidrome'||view==='search'){
    for(i=0;i<HB_NV_TR.length;i++){ if(inRect(x,y,HB_NV_TR[i])){ return openNvTrackMenu(HB_NV_TR[i].info,x,y); } }
  }
  for(i=0;i<HB_NV_PL.length;i++){ if(inRect(x,y,HB_NV_PL[i])){ openNvPlaylistMenu(HB_NV_PL[i].plObj,x,y); return true; } }
  for(i=0;i<HB_NV_CARDS.length;i++){ if(inRect(x,y,HB_NV_CARDS[i]) && HB_NV_CARDS[i].kind==='pl'){ openNvPlaylistMenu(HB_NV_CARDS[i].obj,x,y); return true; } }
  for(i=0;i<HB_PL.length;i++){ if(inRect(x,y,HB_PL[i])){ openPlaylistMenu(HB_PL[i].i,x,y); return true; } }
  for(i=0;i<HB_CARD.length;i++){ if(inRect(x,y,HB_CARD[i]) && HB_CARD[i].kind==='pl'){ openPlaylistMenu(HB_CARD[i].id,x,y); return true; } }
  return false;   // elsewhere: let JSplitter's own panel menu through (Reload / Configure / Properties)
}
function playArtistTrack(block,idx){
  var al=artistAlbums[block]; if(!al) return;
  var hs=[]; for(var i=0;i<al.tracks.length;i++) hs.push(al.tracks[i].handle);
  playHandleList(hs,idx,viewArtist||'Artist',{kind:'local',name:viewArtist||'Artist'});
}
function getSearchIdx(){
  if(searchIdx) return searchIdx;
  var lib=libItems();
  var out=[];
  if(lib && lib.Count){
    var t=libTF('title'), a=libTF('artist'), al=libTF('album'), l=libTF('len');
    for(var i=0;i<t.length;i++) out.push({h:lib[i],title:t[i],artist:a[i],album:al[i],len:l[i],key:(t[i]+' '+a[i]+' '+al[i]).toLowerCase()});
  }
  searchIdx=out; return out;
}
function computeSearch(){
  var q=searchQuery.trim().toLowerCase();
  if(q===searchQ2) return;
  searchQ2=q; searchArts=[]; searchTrks=[];
  if(!q) return;
  var arts=getArtistList(), i;
  for(i=0;i<arts.length && searchArts.length<24;i++){ if(arts[i].name.toLowerCase().indexOf(q)>=0) searchArts.push(arts[i]); }
  var idx=getSearchIdx(), cnt=0;
  for(i=0;i<idx.length && cnt<150;i++){ if(idx[i].key.indexOf(q)>=0){ searchTrks.push(idx[i]); cnt++; } }
}
/* The back button restarts the current track once it is past the first moment of it, and only
   steps back when pressed at the very start -- the rule every streaming player uses, because a
   mis-hit mid-song should not lose your place in the queue. Paused counts too: it rewinds and
   stays paused. Stopped has no position to rewind, so it steps back.
   NOTE: media keys and foobar's own menu call fb.Prev() directly and cannot be intercepted from
   a panel, so those still always step back. */
var PREV_RESTART_SEC=1;
function doPrev(){
  var t=0; try{ t=fb.PlaybackTime; }catch(e){ t=0; }
  if((fb.IsPlaying||fb.IsPaused) && t>PREV_RESTART_SEC){ try{ fb.PlaybackTime=0; return; }catch(e){} }
  fb.Prev();
}
function doCtrl(act){
  if(act==='play') fb.PlayOrPause();
  else if(act==='next') fb.Next();
  else if(act==='prev') doPrev();
  else if(act==='shuffle') toggleShuffle();
  else if(act==='repeat') cycleRepeat();
  else if(act==='drawer'){toggleQueueDrawer();return;}
  else if(act==='volume'){volumePopupOpen=!volumePopupOpen;repaintAll();return;}
  else if(act==='fullscreen'){ enterFullscreen(); return; }
  else if(act==='nvstar' && NP){ var nid=nvTrackId(NP.Path); if(nid) nvToggleStar('song',nid,{id:nid,title:npTitleStr,artist:npArtistStr}); }
  repaintAll();
}
function on_mouse_lbtn_up(x,y){
  x=dip(x);y=dip(y);
  if(drawerDismissedClick){drawerDismissedClick=false;return;}
  if(drawerPointer(x,y))return;
  if(volumePopupOpen&&drag!=='vol'&&!(HB_VOL&&inRect(x,y,HB_VOL))&&!(hit(HB_CTRL,x,y)||{}).act){volumePopupOpen=false;repaintAll();return;}
  var t;
  // ---- modal overlays first ----
  if(dupPrompt){
    if(DUP_HB && inRect(x,y,DUP_HB.skip)) dupSkip(); else dupKeep();   // "Add anyway"/outside: leave as-is
    return;
  }
  if(rgPrompt){
    if(RG_HB && inRect(x,y,RG_HB.scan)){ rgConfirmScan(); return; }
    rgPrompt=null; repaintAll(); return;      // cancel / click outside
  }
  if(confirmDel){
    if(CONF_HB && inRect(x,y,CONF_HB.del)){
      if(confirmDel.kind==='nv-pl') doDeleteNvPlaylist(confirmDel.id);
      else doDeletePlaylist(confirmDel.pl);
      return;
    }
    confirmDel=null; repaintAll(); return;   // cancel / click outside
  }
  if(ctxMenu){
    t=hit(CTX_HB,x,y);
    if(t){
      if(!t.item.sep) executeCtxMenuAction(ctxMenu,t.item);
      return;
    }
    ctxMenu=null; repaintAll(); return;      // click outside menu -> close
  }
  if(renameEdit){
    if(RENAME_HB){
      if(inRect(x,y,RENAME_HB.save)){ if(RENAME_HB.canSave) commitRename(); return; }
      if(inRect(x,y,RENAME_HB.cancel)){ cancelRename(); return; }
      if(inRect(x,y,RENAME_HB.panel)) return;     // click inside the dialog: keep it open
    }
    cancelRename(); return;                        // click on backdrop: dismiss
  }
  if(drag==='seek'){ if(fb.PlaybackLength>0) fb.PlaybackTime=fb.PlaybackLength*dragFrac; drag=null; repaintAll(); return; }
  if(drag==='vol'){ drag=null; return; }
  if(drag==='scroll'||drag==='scrollh'||drag==='scrolln'){
    var wasH=(drag==='scrollh'); drag=null;
    if(wasH){
      if(view==='navidrome') nvShelfScrollT=snapNvShelf(nvShelfScroll);
      else plScrollT=snapShelf(plScroll);
      startScrollAnim();
    }
    repaintAll(); return;
  }
  if(fsMode){
    if(vizMenuOpen){                                  // the style list is modal while it is open
      if((t=hit(VIZ_HB,x,y))){ setVizStyle(t.v); return; }
      vizMenuOpen=false; repaintAll(); return;
    }
    if(HB_VIZ && fsView==='viz' && inRect(x,y,HB_VIZ)){ vizMenuOpen=true; repaintAll(); return; }
    if((t=hit(HB_FS,x,y))){ doFsAct(t.act); return; }
    if((t=hit(HB_CTRL,x,y))){ doCtrl(t.act); return; }
    return;
  }
  // an open dropdown is modal-ish: any click either picks an item or closes it
  if(sgMenuOpen){
    if((t=hit(SG_HB,x,y))){ setSongsGroup(t.v); return; }
    sgMenuOpen=false; repaintAll(); return;
  }
  if(plSortMenuOpen){
    if((t=hit(PL_SORT_HB,x,y))){ setPlSort(t.v); return; }
    plSortMenuOpen=false; repaintAll(); return;
  }
  if(nvAlbTabOpen){
    if((t=hit(NV_ALB_DD_HB,x,y))){ nvSelectAlbumsTab(t.v); return; }
    nvAlbTabOpen=false; repaintAll(); return;
  }
  if(nvPlSortOpen){
    if((t=hit(NV_SORT_DD_HB,x,y))){ nvPlSort=t.v; nvPlSortOpen=false; nvScroll=nvScrollT=0; repaintAll(); return; }
    nvPlSortOpen=false; repaintAll(); return;
  }
  if(nvSrvMenuOpen){
    if((t=hit(NV_SRV_DD_HB,x,y))){ nvSrvMenuOpen=false; nvSelectServer(t.v); repaintAll(); return; }
    nvSrvMenuOpen=false; repaintAll(); return;
  }
  if((t=hit(HB_DOTS,x,y)) || (typeof HB_NAV_DOTS!=='undefined' && (t=hit(HB_NAV_DOTS,x,y)))){ openPlaylistMenu(t.pl,t.mx,t.my); return; }
  if((t=hit(HB_NV_PL_DOTS,x,y))){ openNvPlaylistMenu(t.plObj,t.mx,t.my); return; }
  if((t=hit(HB_NV_PLDOTS,x,y))){ openNvPlaylistMenu(t.plObj,t.mx,t.my); return; }
  if((t=hit(HB_NV_TRDOTS,x,y))){ openNvTrackMenu(t.info,t.mx,t.my); return; }
  if(HB_SG && inRect(x,y,HB_SG)){ sgMenuOpen=true; repaintAll(); return; }
  if(HB_RGNORM && inRect(x,y,HB_RGNORM)){ rgToggle(); return; }
  if(HB_PLSORT && inRect(x,y,HB_PLSORT)){ plSortMenuOpen=true; repaintAll(); return; }
  if(HB_PLSORTDIR && inRect(x,y,HB_PLSORTDIR)){ togglePlSortDir(); return; }
  if(HB_NV_ALB_DD && inRect(x,y,HB_NV_ALB_DD)){ nvAlbTabOpen=true; repaintAll(); return; }
  if(HB_NV_SORT_DD && inRect(x,y,HB_NV_SORT_DD)){ nvPlSortOpen=true; repaintAll(); return; }
  if(HB_NV_SORT_DIR && inRect(x,y,HB_NV_SORT_DIR)){ nvPlSortDir=(nvPlSortDir==='asc')?'desc':'asc'; nvScroll=nvScrollT=0; repaintAll(); return; }
  if(HB_NV_SRV_DD && inRect(x,y,HB_NV_SRV_DD)){ nvSrvMenuOpen=true; repaintAll(); return; }
  if(y<TBH){
    if((t=hit(HB_MENU,x,y))){ openMenu(t.root,t.mx,TBH); return; }
    if(HB_CAP){
      if(x>=HB_CAP.closeX){ fb.Exit(); return; }
      if(x>=HB_CAP.maxX){ if(UIWizard){ try{ UIWizard.ToggleMaximize(); }catch(e){} } repaintAll(); return; }
      if(x>=HB_CAP.minX){ if(UIWizard){ try{ UIWizard.WindowMinimize(); }catch(e){} } return; }
    }
    return;
  }
  if((t=hit(HB_TABS,x,y))){
    rightTab=t.tab;
    try{ window.SetProperty('Navigation: right pane',rightTab); }catch(e){}
    if(rightTab==='lyrics'){
      if(nvShouldLoadLyrics()) nvLoad();
      else if(typeof loadLyrics==='function') loadLyrics();
    }
    stopLyAnim(); repaintAll(); return;
  }
  if((HB_QLY_RETRY && inRect(x,y,HB_QLY_RETRY)) || (typeof HB_QLY_REF!=='undefined' && HB_QLY_REF && inRect(x,y,HB_QLY_REF))){
    if(nvShouldLoadLyrics()) nvLoad(true);
    else if(typeof loadLyrics==='function'){ lyricsFor=null; loadLyrics(); repaintQueue(); }
    return;
  }
  if((t=hit(HB_QLY,x,y))){ try{ fb.PlaybackTime=t.t; }catch(e){} repaintAll(); return; }
  if((t=hit(HB_CTRL,x,y))){ doCtrl(t.act); return; }
  if((t=hit(HB_SOURCE,x,y))){ switchLibrarySource(t.source); return; }
  if(HB_HOME && inRect(x,y,HB_HOME)){ if(libSource==='navidrome') nvOpenHome(); else { view='home'; repaintAll(); } return; }
  if(HB_SEARCH && inRect(x,y,HB_SEARCH)){
    view='search'; searchScroll=searchScrollT=0;
    if(libSource==='navidrome' && searchQuery.trim()) nvRunSearch(searchQuery);
    repaintAll(); return;
  }
  if(HB_NV_REFRESH && inRect(x,y,HB_NV_REFRESH)){ nvRefreshAll(false); return; }
  if(HB_NV_ADDPL && inRect(x,y,HB_NV_ADDPL)){ startNvCreatePlaylist([]); return; }
  if((t=hit(HB_NV_QUICK,x,y))){
    if(t.id==='artists') nvOpenArtists();
    else if(t.id==='albums') nvOpenAlbums();
    else if(t.id==='starred') nvOpenStarred();
    else if(t.id==='random') nvOpenRandom();
    return;
  }
  if((t=hit(HB_NV_PL,x,y))){ nvOpenPlaylist(t.plObj.id,t.plObj.name); return; }
  if(HB_ALLSONGS && inRect(x,y,HB_ALLSONGS)){ if(view!=='songs'){ view='songs'; songsScroll=songsScrollT=0; } repaintAll(); return; }
  if(HB_ADDPL && inRect(x,y,HB_ADDPL)){ var np=createNewPlaylist(); plman.ActivePlaylist=np; revealPlaylist(np); firstRow=firstRowT=0; view='playlist'; repaintAll(); return; }
  if(HB_PLADD_FILES && inRect(x,y,HB_PLADD_FILES)){ addFilesToPl(plman.ActivePlaylist); return; }
  if(HB_PLADD_FOLDER && inRect(x,y,HB_PLADD_FOLDER)){ addFolderToPl(plman.ActivePlaylist); return; }
  if((t=hit(HB_NV_STAR,x,y))){ nvToggleStar('song',t.song.id,t.song); return; }
  if((t=hit(HB_NV_BTN,x,y))){ handleNvButtonAction(t.act,t.data); return; }
  if((t=hit(HB_NV_CARDS,x,y))){
    if(t.kind==='pl') nvOpenPlaylist(t.id,t.title);
    else if(t.kind==='album') nvOpenAlbum(t.id,t.title);
    else if(t.kind==='artist') nvOpenArtist(t.id,t.title);
    return;
  }
  if((t=hit(HB_CARD,x,y))){
    if(t.kind==='pl'){ plman.ActivePlaylist=t.id; firstRow=firstRowT=0; view='playlist'; }
    else { loadArtist(t.id); view='artist'; }
    repaintAll(); return;
  }
  if((t=hit(HB_PL,x,y))){ plman.ActivePlaylist=t.i; firstRow=firstRowT=0; view='playlist'; repaintAll(); return; }
  if((t=hit(HB_Q,x,y))){ if(t.q!==undefined) playQueueItem(t.q); else playQueueNext(t.pl,t.item); repaintAll(); return; }
  if((t=hit(HB_NV_TR,x,y))){
    if(t.pgx1!==undefined && x>=t.pgx0 && x<t.pgx1) nvPlaySongs(t.info.list,t.info.idx,t.info.sourceMeta);
    return;
  }
  /* Rows play on DOUBLE click -- see on_mouse_lbtn_dblclk. The exception is the play glyph that
     replaces the track number on the hovered row: that is a button, and a button takes one click.
     Rows that draw no glyph (search results, the artist page) carry no pg band and so ignore this. */
  if((t=hit(HB_TR,x,y))){
    if(t.pgx1!==undefined && x>=t.pgx0 && x<t.pgx1) playRow(t);
    return;
  }
}
function playRow(t){
  if(t.srch){ var hs=[], m; for(m=0;m<searchTrks.length;m++) hs.push(searchTrks[m].h); playHandleList(hs,t.idx,'Search',{kind:'local',name:'Search'}); }
  else if(t.songs) playSongsRow(t.ti);
  else if(t.lib) playArtistTrack(t.block,t.idx);
  else playPlaylistItem(t.pl,t.item);
  repaintAll();
}
// A single click on a list this dense is too easy to fire by accident, and it is the convention
// every desktop player follows -- including the one this theme is modelled on.
function on_mouse_lbtn_dblclk(x,y){
  x=dip(x);y=dip(y);
  if(fsMode) return;
  if(ctxMenu||confirmDel||renameEdit||sgMenuOpen||plSortMenuOpen||vizMenuOpen||dupPrompt||rgPrompt||nvAlbTabOpen||nvPlSortOpen||nvSrvMenuOpen) return;
  var t=hit(HB_NV_TR,x,y);
  if(t){ nvPlaySongs(t.info.list,t.info.idx,t.info.sourceMeta); return; }
  t=hit(HB_TR,x,y);
  if(t) playRow(t);
}
function hoverSig(x,y){
  var i;
  if(fsMode){
    if(vizMenuOpen){ i=hitIdx(VIZ_HB,x,y); return (i<0)?'vz':('vz'+i); }
    if(HB_VIZ && inRect(x,y,HB_VIZ)) return 'vzb';
    if((i=hitIdx(HB_FS,x,y))>=0) return 'f'+i;      // fullscreen icons: hover feedback, same as anywhere
    if((i=hitIdx(HB_CTRL,x,y))>=0) return 'fc'+i;   // fullscreen transport controls
    return '';
  }
  if(dupPrompt){ if(DUP_HB){ if(inRect(x,y,DUP_HB.skip)) return 'dps'; if(inRect(x,y,DUP_HB.keep)) return 'dpk'; } return 'dp'; }
  if(renameEdit){ if(RENAME_HB){ if(inRect(x,y,RENAME_HB.save)) return 'rns'; if(inRect(x,y,RENAME_HB.cancel)) return 'rnc'; } return 'rn'; }
  if(rgPrompt){ if(RG_HB){ if(inRect(x,y,RG_HB.scan)) return 'rgs'; if(inRect(x,y,RG_HB.cancel)) return 'rgc'; } return 'rg'; }
  if(confirmDel){ if(CONF_HB && inRect(x,y,CONF_HB.del)) return 'cfd'; if(CONF_HB && inRect(x,y,CONF_HB.cancel)) return 'cfc'; return 'cf'; }
  if(ctxMenu){ i=hitIdx(CTX_HB,x,y); return (i<0)?'cx':('cx'+i); }
  if(sgMenuOpen){ i=hitIdx(SG_HB,x,y); return (i<0)?'sg':('sg'+i); }
  if(plSortMenuOpen){ i=hitIdx(PL_SORT_HB,x,y); return (i<0)?'ps':('ps'+i); }
  if(nvAlbTabOpen){ i=hitIdx(NV_ALB_DD_HB,x,y); return (i<0)?'nva':('nva'+i); }
  if(nvPlSortOpen){ i=hitIdx(NV_SORT_DD_HB,x,y); return (i<0)?'nvs':('nvs'+i); }
  if(nvSrvMenuOpen){ i=hitIdx(NV_SRV_DD_HB,x,y); return (i<0)?'nvsrv':('nvsrv'+i); }
  if((i=hitIdx(HB_DOTS,x,y))>=0) return 'd'+i;
  if(typeof HB_NAV_DOTS!=='undefined' && (i=hitIdx(HB_NAV_DOTS,x,y))>=0) return 'nd'+i;
  if((i=hitIdx(HB_NV_PL_DOTS,x,y))>=0) return 'nvpd'+i;
  if((i=hitIdx(HB_NV_PLDOTS,x,y))>=0) return 'nvd'+i;
  if((i=hitIdx(HB_NV_TRDOTS,x,y))>=0) return 'nvtd'+i;
  if((i=hitIdx(HB_NV_STAR,x,y))>=0) return 'nvst'+i;
  if(y<TBH){
    if((i=hitIdx(HB_MENU,x,y))>=0) return 'mnu'+i;
    if(HB_CAP && x>=HB_CAP.minX) return 'cap'+(((x-HB_CAP.minX)/HB_CAP.bw)|0);
    return '';
  }
  if(SBH && inRect(x,y,SBH)) return 'sbh';
  if(SBN && inRect(x,y,SBN)) return 'sbn';
  if(HB_ADDPL && inRect(x,y,HB_ADDPL)) return 'addpl';
  if(HB_NV_ADDPL && inRect(x,y,HB_NV_ADDPL)) return 'nvaddpl';
  if(HB_NV_REFRESH && inRect(x,y,HB_NV_REFRESH)) return 'nvref';
  if(HB_PLADD_FILES && inRect(x,y,HB_PLADD_FILES)) return 'pladdf';
  if(HB_PLADD_FOLDER && inRect(x,y,HB_PLADD_FOLDER)) return 'pladdd';
  if(HB_ALLSONGS && inRect(x,y,HB_ALLSONGS)) return 'als';
  if(HB_SG && inRect(x,y,HB_SG)) return 'sgb';
  if(HB_RGNORM && inRect(x,y,HB_RGNORM)) return 'nzb';
  if(HB_PLSORT && inRect(x,y,HB_PLSORT)) return 'psb';
  if(HB_PLSORTDIR && inRect(x,y,HB_PLSORTDIR)) return 'psd';
  if(HB_NV_ALB_DD && inRect(x,y,HB_NV_ALB_DD)) return 'nvab';
  if(HB_NV_SORT_DD && inRect(x,y,HB_NV_SORT_DD)) return 'nvsb';
  if(HB_NV_SORT_DIR && inRect(x,y,HB_NV_SORT_DIR)) return 'nvsd';
  if(HB_NV_SRV_DD && inRect(x,y,HB_NV_SRV_DD)) return 'nvsrvb';
  if(SB && inRect(x,y,SB)) return 'sb';
  if(HB_QLY_RETRY && inRect(x,y,HB_QLY_RETRY)) return 'qlyr';
  if(typeof HB_QLY_REF!=='undefined' && HB_QLY_REF && inRect(x,y,HB_QLY_REF)) return 'qlyf';
  if((i=hitIdx(HB_QLY,x,y))>=0) return 'qly'+i;
  if((i=hitIdx(HB_CTRL,x,y))>=0) return 'c'+i;
  if((i=hitIdx(HB_TABS,x,y))>=0) return 't'+i;
  if((i=hitIdx(HB_SOURCE,x,y))>=0) return 'source'+i;
  if(HB_HOME && inRect(x,y,HB_HOME)) return 'h';
  if(HB_SEARCH && inRect(x,y,HB_SEARCH)) return 's';
  if((i=hitIdx(HB_NV_QUICK,x,y))>=0) return 'nvq'+i;
  if((i=hitIdx(HB_NV_BTN,x,y))>=0) return 'nvb'+i;
  if((i=hitIdx(HB_NV_PL,x,y))>=0) return 'nvp'+i;
  if((i=hitIdx(HB_NV_CARDS,x,y))>=0) return 'nvc'+i;
  if((i=hitIdx(HB_NV_TR,x,y))>=0) return 'nvr'+i;
  if((i=hitIdx(HB_CARD,x,y))>=0) return 'k'+i;
  if((i=hitIdx(HB_PL,x,y))>=0) return 'p'+HB_PL[i].i;
  if((i=hitIdx(HB_Q,x,y))>=0) return 'q'+i;
  if((i=hitIdx(HB_TR,x,y))>=0) return 'r'+i;
  return '';
}
function on_mouse_move(x,y){
  x=dip(x);y=dip(y);
  mx=x; my=y;
  if(drag==='seek'){ dragFrac=seekFrac(x); repaintBar(); return; }
  if(drag==='vol'){ applyVol(x); return; }
  if(drag==='scroll'){ setScroll(y); return; }
  if(drag==='scrollh'){ setScrollH(x); return; }
  if(drag==='scrolln'){ setScrollN(y); return; }
  var sig=hoverSig(x,y), sk=scrollSection(x,y), z=hoverZone(x,y);
  if(sig!==hoverKey || sk!==scrollKey){   // sk change reveals/hides the section scrollbar
    hoverKey=sig; scrollKey=sk;
    // an overlay owns the whole screen and on_paint forces a full paint while one is open
    if(hasActiveOverlay()) repaintAll();
    else { repaintZone(hoverZoneKey); if(z!==hoverZoneKey) repaintZone(z); }   // clear the old highlight, then draw the new
  }
  hoverZoneKey=z;
}
// which scrollable section the cursor is over (so entering/leaving reveals the hover scrollbar even over gaps)
function scrollSection(x,y){
  if(fsMode) return '';
  if(R.navLib && x>=R.navLib.x && x<R.navLib.x+R.navLib.w && y>=R.navLib.y && y<R.navLib.y+R.navLib.h) return 'nav';
  if(R.main && x>=R.main.x && x<R.main.x+R.main.w+16 && y>=R.main.y && y<R.main.y+R.main.h){
    if(view==='home') return (y>=HOME_SHELF_Y0 && y<HOME_SHELF_Y1+16)?'shelf':'arts';
    if(view==='navidrome') return (nvView==='home' && y>=NV_SHELF_Y0 && y<NV_SHELF_Y1+16)?'nvshelf':'navidrome';
    if(view==='playlist') return 'pl';
    if(view==='songs') return 'songs';
    if(view==='search') return 'srch';
  }
  return '';
}
function on_mouse_leave(){
  mx=-1; my=-1;
  if(hoverKey!==''||scrollKey!==''){
    hoverKey=''; scrollKey='';
    if(hasActiveOverlay()) repaintAll();
    else repaintZone(hoverZoneKey);
  }
  hoverZoneKey='';
}
function on_char(code){
  if(!fsMode&&code===27&&(queueDrawerOpen||volumePopupOpen||nvAlbTabOpen||nvPlSortOpen||nvSrvMenuOpen)){queueDrawerOpen=false;volumePopupOpen=false;if(typeof nvCloseNvMenus==='function')nvCloseNvMenus();layout();repaintAll();return;}
  if(fsMode){
    if(code===27){exitFullscreen();return;}
    if(code===32){fb.PlayOrPause();return;}
    return;
  }
  if(renameEdit){
    if(code===8) renameEdit.text=renameEdit.text.slice(0,-1);
    else if(code===27){ cancelRename(); return; }              // Esc = cancel
    else if(code===13){ commitRename(); return; }              // Enter = commit
    else if(code>=32) renameEdit.text+=String.fromCharCode(code);
    caretOn=true; repaintAll(); return;
  }
  if(view==='search'){
    if(code===8) searchQuery=searchQuery.slice(0,-1);
    else if(code===27) searchQuery='';
    else if(code===13){
      if(libSource==='navidrome'){
        if(nvSearchTimer){ window.ClearTimeout(nvSearchTimer); nvSearchTimer=null; }
        if(typeof NVData==='object'&&NVData.search) NVData.search.requested='';
        nvRunSearch(searchQuery);
      }
      repaintAll(); return;
    }
    else if(code>=32) searchQuery+=String.fromCharCode(code);
    else return;
    searchScroll=searchScrollT=0; caretOn=true;   // keep caret solid right after a keystroke
    if(libSource==='navidrome'){
      if(nvSearchTimer){ window.ClearTimeout(nvSearchTimer); nvSearchTimer=null; }
      var sq=searchQuery.trim();
      if(!sq) nvRunSearch('');
      else nvSearchTimer=window.SetTimeout(function(){ nvSearchTimer=null; nvRunSearch(searchQuery); },280);
    }
    repaintAll();
    return;
  }
  /* Space = play/pause, the way every media player behaves. Deliberately after the two cases
     above: in Search and while renaming a playlist a space is a character the user meant to
     type, not a transport command. A modal owns the keyboard while it is open, so Space must
     not reach playback from underneath one either. */
  if(code===32 && !ctxMenu && !confirmDel && !dupPrompt && !rgPrompt &&
     !sgMenuOpen && !plSortMenuOpen && !vizMenuOpen && !nvAlbTabOpen && !nvPlSortOpen && !nvSrvMenuOpen){
    try{ fb.PlayOrPause(); }catch(e){}
  }
}
function on_mouse_wheel(step){
  if(fsMode){
    // lyrics with no timestamps don't roll themselves, so here the wheel scrolls them; with nothing
    // to scroll (synced, short enough to fit, or another view) it stays the volume control
    if(fsLyricsWheel(step)) return;
    fb.Volume=pos2vol(clamp01(vol2pos(fb.Volume)+step*0.04)); repaintAll(); return;
  }
  if(ctxMenu||confirmDel||renameEdit||dupPrompt||rgPrompt||sgMenuOpen||plSortMenuOpen||nvAlbTabOpen||nvPlSortOpen||nvSrvMenuOpen) return;
  // right pane: same deal on the Lyrics tab. Consume the wheel either way -- it belongs to this
  // panel, and falling through would scroll the playlist behind the pointer.
  if(R.queue && rightTab==='lyrics' && mx>=R.queue.x && mx<R.queue.x+R.queue.w && my>=R.queue.y && my<R.queue.y+R.queue.h){
    if(typeof lyStWheel==='function' && lyStWheel(step)) repaintQueue();
    return;
  }
  if(R.navLib && mx>=R.navLib.x && mx<R.navLib.x+R.navLib.w && my>=R.navLib.y && my<R.navLib.y+R.navLib.h){
    navScrollT=clampPx(navScrollT-step*WHEEL_PX,NAV_MAX); startScrollAnim(); return;
  }
  if(mx<R.main.x || mx>=R.main.x+R.main.w) return;
  if(view==='home'){
    if(my>=HOME_SHELF_Y0 && my<HOME_SHELF_Y1){ plScrollT=snapShelf(plScrollT-step*WHEEL_PX); startScrollAnim(); }   // shelf: eased glide onto a card boundary
    else { homeScrollT=clampPx(homeScrollT-step*Math.round(WHEEL_PX*1.7),HOME_MAXROW); startScrollAnim(); }   // artists: bigger step, tall cards
    return;
  }
  else if(view==='navidrome'){
    if(nvView==='home' && my>=NV_SHELF_Y0 && my<NV_SHELF_Y1){ nvShelfScrollT=snapNvShelf(nvShelfScrollT-step*WHEEL_PX); startScrollAnim(); }
    else { nvScrollT=clampPx(nvScrollT-step*WHEEL_PX,NV_MAXPX); startScrollAnim(); }
    return;
  }
  else if(view==='songs'){ songsScrollT=clampPx(songsScrollT-step*WHEEL_PX,SONGS_MAXPX); startScrollAnim(); return; }
  else if(view==='search'){ searchScrollT=clampPx(searchScrollT-step*WHEEL_PX,SEARCH_MAXPX); startScrollAnim(); return; }
  else if(view==='artist'){ artScroll=clampPx(artScroll-step,ART_MAXBLOCK); repaintMain(); return; }
  firstRowT=clampPx(firstRowT-step*WHEEL_PX,PL_MAXPX); startScrollAnim();
}
/* ---- drag & drop external files: two targets, the library section (-> new playlist) and the
   playlist view body (-> appends to it); everywhere else denies. We never see the dropped paths
   (DropTargetAction is write-only), so we name a destination and the component does the insert. */
function overLib(x,y){ return !!R.navLib && x>=R.navLib.x && x<R.navLib.x+R.navLib.w && y>=R.navLib.y && y<R.navLib.y+R.navLib.h; }
// body of the playlist view -> index of the playlist to append to, or -1 if that's not a valid target
function plDropTarget(x,y){
  if(fsMode || view!=='playlist' || !R.main) return -1;
  if(x<R.main.x || x>=R.main.x+R.main.w || y<R.main.y || y>=R.main.y+R.main.h) return -1;
  var i=plman.ActivePlaylist;
  if(i<0 || plman.IsPlaylistLocked(i)) return -1;   // autoplaylists etc. can't take manual inserts
  return i;
}
function dragUpdate(action,x,y){
  var ext=!action.IsInternal;                        // ignore drags started inside the skin
  var onLib=ext && overLib(x,y), onPl=!onLib && ext && plDropTarget(x,y)>=0;
  if(onLib||onPl) action.Effect=(action.Effect&1)?1:((action.Effect&4)?4:0);  // prefer copy, else link
  else action.Effect=0;                                                        // deny elsewhere
  setDropHover(onLib,onPl);
}
// repaint only the section whose cue changed -- drag-over fires on every mouse move
function setDropHover(onLib,onPl){
  if(onLib!==navDropHover){ navDropHover=onLib; repaintNav(); }
  if(onPl!==plDropHover){ plDropHover=onPl; repaintMain(); }
}
function on_drag_enter(action,x,y,mask){x=dip(x);y=dip(y); dragUpdate(action,x,y); }
function on_drag_over(action,x,y,mask){x=dip(x);y=dip(y); dragUpdate(action,x,y); }
function on_drag_leave(){ setDropHover(false,false); }
function on_drag_drop(action,x,y,mask){x=dip(x);y=dip(y);
  var ext=!action.IsInternal, hit=ext&&(action.Effect&5), pi=hit?plDropTarget(x,y):-1;   // 5 = copy|link
  if(hit && overLib(x,y)){
    var np=createNewPlaylist();
    action.Playlist=np; action.Base=0; action.ToSelect=true;            // component drops the files into it
    action.Effect=(action.Effect&1)?1:4;
    plman.ActivePlaylist=np; revealPlaylist(np); firstRow=firstRowT=0; view='playlist';
  } else if(pi>=0){
    plman.UndoBackup(pi);                                              // so ctrl+Z undoes the import
    armDupWatch(pi);                                                   // snapshot before the component inserts
    action.Playlist=pi; action.Base=plman.PlaylistItemCount(pi); action.ToSelect=true;   // append at end
    action.Effect=(action.Effect&1)?1:4;
  } else action.Effect=0;
  navDropHover=false; plDropHover=false; repaintAll();
}
function on_script_unload(){
  stopDisplayWatch();npArtGeneration++;
  if(typeof clearNvCardCache==='function') clearNvCardCache();
  nvCancel(); if(typeof nvCancelHttpTasks==='function') nvCancelHttpTasks(); stopFsClock();
  if(typeof disposeFsBackdrop==='function') disposeFsBackdrop(); else fsBackdrop=null;
  if(typeof disposeCardTextScratch==='function') disposeCardTextScratch();
  if(nvSearchTimer){ window.ClearTimeout(nvSearchTimer); nvSearchTimer=null; }
  hideNativePanel('Navidrome');
  hideNativePanel('Lyrics');
  stopLyAnim(); stopCaret(); stopViz(); stopScrollAnim(); stopShimAnim(); stopMemWatch();
  if(dupWatch && dupWatch.timer) window.ClearTimeout(dupWatch.timer);
}
function invalidateLibrary(){
  artistList=null; artistTracksMap=null; artistCandCache={}; coverPickCache={}; warmed={}; searchIdx=null; searchQ2=null;
  songsIdx=null; songsRows=null; songsTracks=null; libCovCache=null; libCount_=-1;
  libItems_=null; libTFCache={};   // everything above is derived from these
  rgStat=null; rgScanFailed=false;
  warmJob=null; jobs={};           // anything in flight refers to the old library
  gates={}; rowGate={}; shelfHandles=null; artsGating=false;   // every section re-gates
}
function libChanged(){ invalidateLibrary(); artCardCache={}; artCardN=0; repaintAll(); }
function on_library_items_added(){ libChanged(); }
function on_library_items_removed(){ libChanged(); }
function on_library_items_changed(){ libChanged(); }

/* ------------------------- playback callbacks ------------------------- */
function on_playback_new_track(){
  updateNP();
  if(nvShouldLoadLyrics()) nvLoad();
  else if(typeof loadLyrics==='function') loadLyrics();
  if(typeof nvMaybeTopUpRandomMix==='function') nvMaybeTopUpRandomMix();
  // shuffle + loop-all: on wrapping from the last shuffled track back to the first, reshuffle the rest
  if(pbShuffle){
    var loc=playingLoc();
    var sp=playlistOfName(SHUF), idx=(loc&&loc.IsValid&&loc.PlaylistIndex===sp)?loc.PlaylistItemIndex:-1;
    if(sp>=0 && idx>=0){
      var cnt=plman.PlaylistItemCount(sp);
      if(pbRepeat===1 && lastShufIdx===cnt-1 && idx===0) reshuffleTail(sp);
      lastShufIdx=idx;
    } else lastShufIdx=-1;
  } else lastShufIdx=-1;
  repaintAll();
}
function npChanged(){
  updateNP();
  if(nvShouldLoadLyrics()) nvLoad();
  repaintAll();
}
function on_playback_dynamic_info_track(){ npChanged(); }
function on_playback_stop(){ npChanged(); }
function on_playback_pause(){ npChanged(); }
function on_playback_time(){
  repaintBar();
  if(nvShouldLoadLyrics() && NV.key!==nvTrackKey()) nvLoad();
}
function on_playback_seek(){ lySnap=true; if(fsMode) fsLyReset(); repaintAll(); }
function on_playback_order_changed(){ syncOrderFromFb(); repaintAll(); }
function on_playback_queue_changed(){ repaintAll(); }
function on_volume_change(){ repaintBar(); }
// ReplayGain can also be switched from foobar's own Playback menu -- keep the pill honest
function on_replaygain_mode_changed(){ repaintMain(); }
// rgStat included: a ReplayGain scan lands as a tag write, so this is how the pill learns it finished
function on_metadb_changed(handles,fromhook){ if(fromhook) return; invalidateItems(); albKeyCache={}; hueCache={}; artistCandCache={}; coverPickCache={}; songsIdx=null; songsRows=null; songsTracks=null; rgStat=null; updateNP(); repaintAll(); }
/* A switch changes which playlist is ACTIVE, not what any playlist contains -- and every cache
   invalidateItems() drops is keyed by playlist index, so none of them went stale here. Dropping
   them meant each switch re-derived covers and re-ran the art gates against an artCache that had
   since evicted those albums: the view fell back to its skeleton and the artwork reloaded. The
   caches that genuinely depend on playlist CONTENT are still cleared by the callbacks that mean
   content changed (items added/removed/reordered, playlists changed). */
function on_playlist_switch(){ firstRow=firstRowT=0; repaintAll(); }
function on_playlists_changed(){ invalidateItems(); repaintAll(); }
function on_playlist_items_added(pl){ invalidateItems(); if(dupWatch && dupWatch.pl===pl) scheduleDupScan(); repaintAll(); }
function on_playlist_items_removed(){ invalidateItems(); repaintAll(); }
function on_playlist_items_reordered(){ invalidateItems(); repaintAll(); }
function on_item_focus_change(){ repaintAll(); }

checkDisplay(true);
startDisplayWatch();
updateNP();
syncOrderFromFb(); applyPlaybackOrder();   // normalize native order (we manage shuffle ourselves)
capVolume();       // pull a remembered volume back under the slider's ceiling
startMemWatch();   // caches grow into the component's spare memory and back off as it fills
drpSync();         // make foo_verdant agree with the Discord property before anything plays
if(libSource==='navidrome' && typeof nvEnsureLoaded==='function') nvEnsureLoaded();
if(NP && (rightTab==='lyrics' || fsMode)){
  if(typeof nvShouldLoadLyrics==='function' && nvShouldLoadLyrics()) nvLoad();
  else if(typeof loadLyrics==='function') loadLyrics();
}

function on_font_changed(){ if(!checkDisplay(false)){ refreshFonts(); repaintAll(true); } }
function on_http_request_done(id,success,response,status){ if(typeof nvHttpDispatch==='function') nvHttpDispatch(id,success,response,status); }
function on_download_file_done(path,success){ if(typeof nvOnDownloadDone==='function') nvOnDownloadDone(path,success); }
function on_load_image_done(cookie,image){ if(typeof nvOnLoadImageDone==='function') nvOnLoadImageDone(cookie,image); }
function on_locations_added(task_id,handles){ if(typeof nvOnLocationsAdded==='function') nvOnLocationsAdded(task_id,handles); }
