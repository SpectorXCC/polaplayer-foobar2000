/* verdant/app.js -- panel state, layout, paint dispatch, input, and foobar callbacks
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

/* ------------------------- state ------------------------- */
var W=dip(window.Width), H=dip(window.Height), R={}, NP=null, npTitleStr='', npArtistStr='';
// Repaint scope flags. dirtyAll (sticky) forces a full paint; partial flags accumulate.
// A full window.Repaint() MUST set dirtyAll (use repaintAll) so a paint serviced while a
// partial flag is pending can't blank the rest of the window.
var dirtyAll=true, dirtyBar=false, dirtyQueue=false, dirtySearch=false, dirtyMain=false, dirtyNav=false, dirtyTitle=false, dirtyViz=false, dirtyFsLyrics=false, dirtyFsSeek=false, dirtyFsCtrl=false, dirtyFsTop=false;
function clearDirty(){ dirtyAll=dirtyBar=dirtyQueue=dirtySearch=dirtyMain=dirtyNav=dirtyTitle=dirtyViz=dirtyFsLyrics=dirtyFsSeek=dirtyFsCtrl=dirtyFsTop=false; }
/* When the oldest pending partial flag was raised. A RepaintRect is serviced within a frame or two,
   so a flag still pending long after it went up means its paint was DEFERRED -- the window was
   minimised, and a minimised window gets no WM_PAINT. The paint that finally arrives on restore is
   the OS repainting the whole window onto a fresh surface, not the region we asked for; taking the
   partial path then drew one panel and left the rest a flat grey until something was hovered. The
   1 Hz clock guarantees a pending flag whenever the window is minimised mid-song, and the mouse
   leaving for the taskbar raises one even when paused. Every partial setter calls markDirty() FIRST,
   so the clock records the oldest flag rather than being reset by each new one. */
var dirtySince=0, DIRTY_STALE_MS=250;
function anyDirty(){ return dirtyBar||dirtyQueue||dirtySearch||dirtyMain||dirtyNav||dirtyTitle||dirtyViz||dirtyFsLyrics||dirtyFsSeek||dirtyFsCtrl||dirtyFsTop; }
function markDirty(){ if(!anyDirty()) dirtySince=Date.now(); }
function repaintAll(force){ syncNavidromePanel(); dirtyAll=true; window.Repaint(!!force); }
function hasActiveOverlay(){
  return !!(setupPrompt||renameEdit||ctxMenu||confirmDel||dupPrompt||rgPrompt||(typeof lovedPrompt!=='undefined'&&lovedPrompt)||sgMenuOpen||vizMenuOpen||volumePopupOpen||brAlbTabOpen||brPlSortOpen||brSrvMenuOpen||(R.drawer&&queueDrawerOpen)||(R.navDrawer&&navDrawerOpen));
}
function clearNonFsHitboxes(){
  HB_TABS=[]; HB_Q=[]; HB_HOME=null; HB_CAP=null; HB_MENU=[];
  HB_PLADD_FILES=null; HB_PLADD_FOLDER=null; HB_SOURCE=[]; HB_SEARCH=null;
  SB=null; SBN=null; SBH=null; HB_DRAWER=null; HB_NAVDRAWER=null;
  if(typeof LOVED_HB!=='undefined') LOVED_HB=null;
  if(typeof SG_HB!=='undefined') SG_HB=[];
  if(typeof HB_SG!=='undefined') HB_SG=null;
  if(typeof HB_ALLSONGS!=='undefined') HB_ALLSONGS=null;
  if(typeof HB_RGNORM!=='undefined') HB_RGNORM=null;
  if(typeof HB_BR_PL!=='undefined') HB_BR_PL=[];
  if(typeof HB_BR_PL_DOTS!=='undefined') HB_BR_PL_DOTS=[];
  if(typeof HB_BR_QUICK!=='undefined') HB_BR_QUICK=[];
  if(typeof HB_BR_REFRESH!=='undefined') HB_BR_REFRESH=null;
  if(typeof HB_BR_ADDPL!=='undefined') HB_BR_ADDPL=null;
  if(typeof HB_BR_BTN!=='undefined') HB_BR_BTN=[];
  if(typeof HB_BR_CARDS!=='undefined') HB_BR_CARDS=[];
  if(typeof HB_BR_TR!=='undefined') HB_BR_TR=[];
  if(typeof HB_BR_STAR!=='undefined') HB_BR_STAR=[];
  if(typeof HB_BR_TRDOTS!=='undefined') HB_BR_TRDOTS=[];
  if(typeof HB_BR_PLDOTS!=='undefined') HB_BR_PLDOTS=[];
  if(typeof BR_ALB_DD_HB!=='undefined') BR_ALB_DD_HB=[];
  if(typeof BR_SORT_DD_HB!=='undefined') BR_SORT_DD_HB=[];
  if(typeof BR_SRV_DD_HB!=='undefined') BR_SRV_DD_HB=[];
  if(typeof HB_BR_ALB_DD!=='undefined') HB_BR_ALB_DD=null;
  if(typeof HB_BR_SORT_DD!=='undefined') HB_BR_SORT_DD=null;
  if(typeof HB_BR_SORT_DIR!=='undefined') HB_BR_SORT_DIR=null;
  if(typeof HB_BR_SRV_DD!=='undefined') HB_BR_SRV_DD=null;
  if(typeof HB_QLY!=='undefined') HB_QLY=[];
  if(typeof HB_QLY_RETRY!=='undefined') HB_QLY_RETRY=null;
  if(typeof HB_QLY_REF!=='undefined') HB_QLY_REF=null;
}
function clearNormalOverlays(){
  queueDrawerOpen=false; navDrawerOpen=false; volumePopupOpen=false; drag=null; hoverKey=''; scrollKey='';
  ctxMenu=null; CTX_HB=[]; confirmDel=null; CONF_HB=null;
  dupPrompt=null; DUP_HB=null; rgPrompt=null; RG_HB=null;
  if(typeof lovedPrompt!=='undefined'){ lovedPrompt=null; LOVED_HB=null; }
  if(renameEdit){ renameEdit=null; RENAME_HB=null; stopCaret(); }
  sgMenuOpen=false; vizMenuOpen=false;
  if(typeof brCloseMenus==='function') brCloseMenus();
}
function mainCanBleedBar(){
  return !(view==='browse' && (brView==='home'||brView==='artists'));
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
  if(!R.navLib || (R.navDrawer && !navDrawerOpen)){ return; }
  markDirty(); dirtyNav=true;
  repaintRect(R.navLib.x,R.navLib.y,R.navLib.w,R.navLib.h);
}
// drawNav paints both nav cards, so a hover crossing between them must invalidate their union
function repaintNavAll(){
  if(fsMode||hasActiveOverlay()){ repaintAll(); return; }
  if(!R.navTop||!R.navLib || (R.navDrawer && !navDrawerOpen)){ return; }
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
// the visualizer's own band & fullscreen sub-regions -- see the fullscreen branch of on_paint
function repaintViz(){
  if(!fsMode || fsView!=='viz' || dirtyViz) return;
  var vr=(typeof vizDirtyRect==='function')?vizDirtyRect():{x:0,y:VIZ_TOP,w:W,h:Math.max(0,(H-172)-VIZ_TOP)};
  if(vr.w<=0 || vr.h<=0) return;
  markDirty(); dirtyViz=true;
  repaintRect(vr.x,vr.y,vr.w,vr.h);
}
function repaintFsRegion(r){
  if(r && r.w>0 && r.h>0) repaintRect(r.x,r.y,r.w,r.h);
  else repaintAll();
}
function repaintFsLyrics(){
  if(!fsMode || fsView!=='lyrics' || dirtyFsLyrics) return;
  var m=(typeof fsCachedMetrics==='function')?fsCachedMetrics():null;
  if(!m){ repaintAll(); return; }
  markDirty(); dirtyFsLyrics=true;
  repaintFsRegion(m.lyRect);
}
function repaintFsSeek(){
  if(!fsMode || dirtyFsSeek) return;
  var m=(typeof fsCachedMetrics==='function')?fsCachedMetrics():null;
  if(!m){ repaintAll(); return; }
  markDirty(); dirtyFsSeek=true;
  repaintFsRegion(m.seekRect);
}
function repaintFsCtrl(){
  if(!fsMode || dirtyFsCtrl) return;
  var m=(typeof fsCachedMetrics==='function')?fsCachedMetrics():null;
  if(!m){ repaintAll(); return; }
  markDirty(); dirtyFsCtrl=true;
  repaintFsRegion(m.ctrlRect);
}
function repaintFsTop(){
  if(!fsMode || dirtyFsTop) return;
  var m=(typeof fsCachedMetrics==='function')?fsCachedMetrics():null;
  if(!m){ repaintAll(); return; }
  markDirty(); dirtyFsTop=true;
  repaintFsRegion(m.topRect);
}
function repaintFsHoverOne(sig){
  if(!sig) return;
  if(sig.indexOf('fl')===0) repaintFsLyrics();
  else if(sig.indexOf('ft')===0) repaintFsTop();
  else if(sig.indexOf('fc')===0) repaintFsCtrl();
  else repaintAll();
}
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
  if(TBH>0 && y<TBH) return 'title';
  if(R.barY!==undefined && y>=R.barY) return 'bar';
  if(R.queue && (!R.drawer || queueDrawerOpen) && x>=R.queue.x) return 'queue';
  if(R.navDrawer && navDrawerOpen && R.navTop && x>=R.navTop.x && x<R.navTop.x+R.navTop.w) return 'nav';
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
var hoverKey='', scrollKey='', hoverZoneKey='', mx=-1, my=-1, drag=null, dragFrac=0;   // WHEEL_PX: core/props.js
// eased scrolling: animate each rendered position toward its target with dt-normalized decay
var navScrollT=0, scrollTimer=null, SCROLL_RATE=17.5, scrollLastMs=0;
function scrollTick(){
  var now=nowMs(), dt=scrollLastMs?Math.min(50,Math.max(1,now-scrollLastMs)):ANIM_MS;
  scrollLastMs=now;
  var alpha=1-Math.exp(-SCROLL_RATE*dt/1000);
  var mm=false, nm=false, d2=navScrollT-navScroll, d4=songsScrollT-songsScroll, d5=searchScrollT-searchScroll;
  var d7=(typeof brScrollT!=='undefined')?(brScrollT-brScroll):0;
  var d8=(typeof brShelfScrollT!=='undefined')?(brShelfScrollT-brShelfScroll):0;
  if(Math.abs(d4)>=0.5){ songsScroll+=d4*alpha; mm=true; } else songsScroll=songsScrollT;
  if(Math.abs(d5)>=0.5){ searchScroll+=d5*alpha; mm=true; } else searchScroll=searchScrollT;
  if(typeof brScrollT!=='undefined'){
    if(Math.abs(d7)>=0.5){ brScroll+=d7*alpha; mm=true; } else brScroll=brScrollT;
    if(Math.abs(d8)>=0.5){ brShelfScroll+=d8*alpha; mm=true; } else brShelfScroll=brShelfScrollT;
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
var HB_CTRL=[], HB_TABS=[], HB_SEEK=null, HB_VOL=null, HB_Q=[];
var HB_HOME=null, HB_CAP=null, HB_MENU=[], SB=null, SBH=null;
var navScroll=0, NAV_MAX=0, SBN=null, navDropHover=false;
// deferred "scroll this playlist into view" -- only drawNav knows the row geometry, so it consumes this
var navRevealPl=-1;
function revealPlaylist(i){ navRevealPl=i; }
var plDropHover=false, HB_PLADD_FILES=null, HB_PLADD_FOLDER=null;   // empty-playlist "add songs" zone
// playlist edit: context menu, inline rename, delete confirm
var ctxMenu=null, CTX_HB=[], renameEdit=null, confirmDel=null, CONF_HB=null, RENAME_HB=null;

var rightTab='lyrics';
try{ rightTab=window.GetProperty('Navigation: right pane','lyrics'); }catch(e){}
if(rightTab!=='queue' && rightTab!=='lyrics') rightTab='lyrics';
var view='browse';
var HB_SOURCE=[], browseLayoutKey='', brSearchTimer=null;
var savedLibrarySource='';
try{ savedLibrarySource=window.GetProperty('Navigation: music source',''); }catch(e){}
initSetup(savedLibrarySource);
var libSource=(setupMode==='both'&&savedLibrarySource==='navidrome')?'navidrome':'local';
// Fullscreen "chill" mode + its sub-view (default now-playing / lyrics / visualizer)
var fsMode=false, fsView='default', HB_FS=[], vizTimer=null, vizBars=[];
// Re-asserted every full paint + on_size: JSplitter can reset window.DlgCode on resize/reload.
/* Search and rename need every key, because the user is typing into them. Everywhere else the
   panel still asks for character keys, which is what lets Space reach on_char and act as
   play/pause -- without it the dialog manager swallows Space before the panel ever sees it. */
function applyKeyMode(){ try{ window.DlgCode=(setupPrompt||fsMode||view==='search'||renameEdit)?DLGC_WANTALLKEYS:DLGC_WANTCHARS; }catch(e){} }

var searchQuery='', searchScroll=0, searchScrollT=0, HB_SEARCH=null, SEARCH_MAXPX=0;
function snapBrShelf(px){ var st=(typeof BR_SHELF_STRIDE!=='undefined'&&BR_SHELF_STRIDE)||1; return clampPx(Math.round(px/st)*st,(typeof BR_SHELF_MAX!=='undefined'?BR_SHELF_MAX:0)); }

function switchLibrarySource(source){
  if(source==='navidrome'&&setupMode!=='both') return;
  if(brSearchTimer){ window.ClearTimeout(brSearchTimer); brSearchTimer=null; }
  if(typeof brCloseMenus==='function') brCloseMenus();
  libSource=(source==='navidrome')?'navidrome':'local';
  navScroll=navScrollT=0;
  if(typeof brHistory!=='undefined') brHistory=[];
  if(typeof brScroll!=='undefined') brScroll=brScrollT=0;
  if(typeof brShelfScroll!=='undefined') brShelfScroll=brShelfScrollT=0;
  if(typeof brView!=='undefined'){ brView='home'; brViewId=''; brViewTitle=''; }
  if(libSource==='navidrome' && view==='songs') view='browse';
  if(view!=='search') view='browse';
  try{ window.SetProperty('Navigation: music source',libSource); savedLibrarySource=libSource; }catch(e){}
  var curSrc=activeSource();
  if(libSource==='navidrome'&&setupNavNeedsRefresh){setupNavNeedsRefresh=false;if(curSrc&&curSrc.refresh)curSrc.refresh(false);}
  else if(curSrc && curSrc.ensureLoaded) curSrc.ensureLoaded();
  if(curSrc && curSrc.resetSearch) curSrc.resetSearch();
  if(view==='search' && searchQuery.trim() && curSrc && curSrc.search) curSrc.search(searchQuery);
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
  if(source!==savedLibrarySource){
    try{ window.SetProperty('Navigation: music source',source); savedLibrarySource=source; }catch(e){}
  }
  if(browseLayoutKey==='hidden') return;
  hideNativePanel('Navidrome');
  hideNativePanel('Lyrics');
  browseLayoutKey='hidden';
}


var uiWizInit=false, uiWizLimitScale=-1, uiWizNeutralized=false, chromeRetryTimer=null, chromeStartupTimer=null, chromeInstalling=false;
function applyWindowChrome(force){
  if(chromeInstalling) return;
  if(VerdantChrome){
    if(!chromeAttached || force){
      chromeInstalling=true;
      try{
        if(UIWizard && (!uiWizNeutralized || force)){
          uiWizNeutralized=true;
          try{
            UIWizard.FrameStyle=0;
            UIWizard.MoveStyle=0;
            UIWizard.DisableWindowSizing=false;
            UIWizard.DisableWindowMaximizing=false;
            UIWizard.SetCaptionAreaSize(0,0,0,0);
          }catch(e){}
        }
        try{ chromeAttached=!!VerdantChrome.Attach(); }catch(e){ chromeAttached=false; }
      }finally{ chromeInstalling=false; }
      if(chromeAttached){
        if(chromeRetryTimer){ window.ClearTimeout(chromeRetryTimer); chromeRetryTimer=null; }
        TBH=32;
        capW=-1;
        startChromeHover();
        if(typeof syncChromeTheme==='function') syncChromeTheme(true);
        return;
      }
      if(!chromeRetryTimer){
        chromeRetryTimer=window.SetTimeout(function(){
          chromeRetryTimer=null;
          applyWindowChrome();
          if(chromeAttached){ layout(); repaintAll(true); }
        },50);
      }
      return;
    }
    if(typeof syncChromeTheme==='function') syncChromeTheme(false);
    return;
  }
  if(!UIWizard) return;
  if(!uiWizInit){
    uiWizInit=true;
    try{
      UIWizard.FrameStyle=2;
      UIWizard.MoveStyle=0;
      UIWizard.DisableWindowSizing=false;
      UIWizard.DisableWindowMaximizing=false;
    }catch(e){}
  }
  if(Math.abs(uiWizLimitScale-UISCALE)>0.001){
    uiWizLimitScale=UISCALE;
    var mw=px(WIN_MIN_W), mh=px(WIN_MIN_H);
    try{ UIWizard.SetWindowSizeLimits(mw,mh,0,0); }catch(e){}
    try{ UIWizard.WindowMinWidth=mw; UIWizard.WindowMinHeight=mh; }catch(e){}
  }
}

function scheduleChromeStartupCheck(){
  if(chromeStartupTimer) return;
  chromeStartupTimer=window.SetTimeout(function(){
    chromeStartupTimer=null;
    if(!VerdantChrome) VerdantChrome=createNativeChrome();
    if(!VerdantChrome) return;
    applyWindowChrome(true);
    if(chromeAttached){ layout(); repaintAll(true); }
  },350);
}

function layout(){
  var g=M.gap, top0=TBH+g;   // one uniform gap on every side, incl. below the title bar and above the bar
  M.barH=(H<560)?76:96;
  M.cpad=(W<640)?14:24;
  R.barY=H-M.barH;
  R.top={x:g,y:top0,bottom:R.barY-g};
  R.drawer=W<1120;
  R.navDrawer=W<700;
  R.short=H<560;
  R.narrow=W<560;
  var navDrawerW=Math.min(240,Math.max(180,W-g*2));
  R.navW=R.navDrawer?navDrawerW:(W>=1440?230:(W<900?180:200));
  R.navX=R.navDrawer?(navDrawerOpen?g:-navDrawerW-g):g;
  R.queueW=W>=1440?400:320;
  R.queueX=R.drawer?W+g:W-g-R.queueW;
  R.mainX=R.navDrawer?g:(R.navX+R.navW+g);
  R.mainW=Math.max(1,(R.drawer?W:R.queueX)-g-R.mainX);
  M.headH=(H<520)?118:((H<650)?164:280);
  M.artSz=(H<520)?84:((H<650)?124:200);
  M.navTopH=setupMode==='local'?((H<520)?94:108):((H<520)?116:((H<620)?148:176));
  var topH=Math.max(1,R.top.bottom-R.top.y);
  R.navTop={x:R.navX,y:top0,w:R.navW,h:Math.min(M.navTopH,Math.max(88,topH-120))};
  R.navLib={x:R.navX,y:top0+R.navTop.h+g*2,w:R.navW,h:Math.max(40,topH-R.navTop.h-g*2)};   // wider gap to the library card
  R.main={x:R.mainX,y:top0,w:R.mainW,h:topH};
  R.queue={x:R.queueX,y:top0,w:R.queueW,h:topH};
  if(R.drawer&&queueDrawerOpen){
    var drawerW=Math.min(360,Math.max(120,W-g*2));
    R.queue={x:W-g-drawerW,y:top0,w:drawerW,h:topH};
  }
  if(!R.drawer)queueDrawerOpen=false;
  if(!R.navDrawer)navDrawerOpen=false;
  applyWindowChrome();
  capW=-1; applyCaption();
  applyKeyMode();
  syncNavidromePanel();
}
// bitmaps are keyed by geometry; and the panel's surface is rebuilt, so the next paint must be full
function on_size(w,h){ if(checkDisplay(false))return;W=dip(w);H=dip(h); layout(); if(typeof clearBrCardCache==='function') clearBrCardCache(); skelImgs={}; if(typeof invalidateFsMetrics==='function') invalidateFsMetrics(); if(fsMode){ if(typeof disposeFsBackdrop==='function') disposeFsBackdrop(); if(typeof disposeFsLyBmps==='function') disposeFsLyBmps(); } dirtyAll=true; }
/* Light/dark switching. Everything that reads COL at paint time follows on its own; what has to be
   dropped here is anything that baked a colour into a bitmap: the corner stamps (filled with the
   canvas colour), the pre-rendered playlist/artist cards, and the skeleton placeholders. */
function syncTheme(){
  var light=themeWantsLight();
  if(light===IS_LIGHT) return false;
  setPalette(light);
  CORN=null; if(typeof clearBrCardCache==='function') clearBrCardCache(); skelImgs={};
  if(typeof syncChromeTheme==='function') syncChromeTheme(false);
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
  if(fsMode){
    if(typeof fsBridgeIsShowing==='function' && fsBridgeIsShowing()) return;
    repaintFsSeek();
    return;
  }
  if(hasActiveOverlay()){ repaintAll(); return; }
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
  if(checkDisplay(false))return;
  if(webPreviewIsShowing()){ clearDirty(); return; }
  gr=dpiGraphics(gr);
  visPlCache=null;   // one playlist scan per frame, shared by drawNav and drawHome
  gr.SetSmoothingMode(2);
  gr.SetInterpolationMode(5);   // NearestNeighbor: every DrawImage here is 1:1, so filtering is pure cost
  var stale=anyDirty() && (Date.now()-dirtySince)>DIRTY_STALE_MS;   // see markDirty
  if(fsMode){
    if(typeof fsBridgeIsShowing==='function' && fsBridgeIsShowing()){ clearDirty(); return; }
    /* Fullscreen sub-regions (viz band, lyrics scroll/hover, seek bar, transport controls,
       top mode icons) each paint onto the 1:1 pre-baked backdrop via RepaintRect so ticks
       and hover state changes skip re-compositing the 128px blurred backdrop and left cover. */
    var fsAnyPartial=dirtyViz||dirtyFsLyrics||dirtyFsSeek||dirtyFsCtrl||dirtyFsTop;
    var fsCanPartial=fsAnyPartial && !stale && !dirtyAll && !vizMenuOpen
                     && !dirtyBar && !dirtyMain && !dirtyNav && !dirtyQueue && !dirtySearch && !dirtyTitle;
    var fsLight=IS_LIGHT; if(fsLight) setPalette(false);
    try{
      if(fsCanPartial){
        var dViz=dirtyViz, dLy=dirtyFsLyrics, dSeek=dirtyFsSeek, dCtrl=dirtyFsCtrl, dTop=dirtyFsTop;
        clearDirty();
        if(dViz && fsView==='viz') drawVizBand(gr);
        if(dLy && fsView==='lyrics') drawFsLyricsRegion(gr);
        if(dSeek) drawFsSeekRegion(gr);
        if(dCtrl) drawFsCtrlRegion(gr);
        if(dTop) drawFsTopRegion(gr);
        return;
      }
      clearDirty();
      drawFullscreen(gr); return;
    }finally{ if(fsLight) setPalette(true); }
  }
  var anyPartial=dirtyBar||dirtyQueue||dirtySearch||dirtyMain||dirtyNav||dirtyTitle;
  // A partial paint skips drawOverlays, so a modal's dim backdrop would not be reapplied over the
  // region it redraws (the bar's 1 Hz repaint would flash back to full brightness). While an
  // overlay owns the screen, every paint takes the full path.
  var modal=hasActiveOverlay();
  if(dirtyAll || !anyPartial || modal || stale){ // full paint, or an OS/stale paint we can't scope
    clearDirty();
    syncTheme();   // cheap check; catches a mode switch even if on_colours_changed never fired
    gr.FillSolidRect(0,0,W,H,COL.canvas);   // canvas -> panels read as separated cards (Spotify look)
    drawTitleBar(gr);
    // main before nav: the home shelf's leftmost card is drawn partly outside the panel
    // (continuous scroll), so nav must repaint over that bleed -- same reason queue follows main
    drawMainCounted(gr);
    drawNavLayer(gr);
    drawQueueLayer(gr);
    drawBar(gr);
    drawOverlays(gr);
    return;
  }
  // partial composite: only the regions actually flagged (each drawn over live content)
  if(dirtyTitle){ dirtyTitle=false; drawTitleBar(gr); }
  if(dirtyMain){ dirtyMain=false; drawMainCounted(gr); }
  if(dirtyNav){ dirtyNav=false; drawNavLayer(gr); }
  if(dirtyQueue){ dirtyQueue=false; drawQueueLayer(gr); }
  if(dirtySearch){ dirtySearch=false; if(view==='search') drawSearchBox(gr,R.main); }
  if(dirtyBar){ dirtyBar=false; drawBar(gr); }
}

function drawMain(gr){
  SB=null; SBH=null;   // clear stale click targets from the previous view
  HB_PLADD_FILES=null; HB_PLADD_FOLDER=null;
  if(view!=='songs'){ HB_SG=null; SG_HB=[]; HB_RGNORM=null; }
  if(view!=='browse' && view!=='search'){
    HB_BR_BTN=[]; HB_BR_CARDS=[]; HB_BR_TR=[]; HB_BR_STAR=[]; HB_BR_TRDOTS=[]; HB_BR_PLDOTS=[];
    HB_BR_ALB_DD=null; HB_BR_SORT_DD=null; HB_BR_SORT_DIR=null; HB_BR_SRV_DD=null;
    BR_ALB_DD_HB=[]; BR_SORT_DD_HB=[]; BR_SRV_DD_HB=[];
  }
  applyKeyMode();
  if(view==='search') startCaret(); else stopCaret();
  var r=R.main; panelBg(gr,r,COL.base);
  if(view==='songs'){ drawSongs(gr,r); return; }
  if(view==='search'){ drawSearch(gr,r); return; }
  drawBrowseView(gr,r);
}

/* ------------------------- input ------------------------- */
function seekFrac(x){ return HB_SEEK?clamp01((x-HB_SEEK.x)/HB_SEEK.w):0; }
function applyVol(x){ if(HB_VOL){ fb.Volume=pos2vol(clamp01((x-HB_VOL.x)/HB_VOL.w)); if(fsMode) repaintFsCtrl(); else repaintBar(); } }
function on_mouse_lbtn_down(x,y){
  x=dip(x);y=dip(y);
  chromeExitRequested=false;
  titleDoublePending=false;
  if(setupPrompt) return;
  if(drawerPointer(x,y)){drawerDismissedClick=true;return;}
  if(ctxMenu||confirmDel||renameEdit||sgMenuOpen||vizMenuOpen||dupPrompt||rgPrompt||(typeof lovedPrompt!=='undefined'&&lovedPrompt)||brAlbTabOpen||brPlSortOpen||brSrvMenuOpen) return;   // overlays are modal; dismissal/actions handled on button-up
  if(HB_SEEK && inRect(x,y,HB_SEEK)){ drag='seek'; dragFrac=seekFrac(x); repaintBar(); return; }
  if(HB_VOL && inRect(x,y,HB_VOL)){ drag='vol'; applyVol(x); return; }
  if(SBH && inRect(x,y,SBH)){ drag='scrollh'; setScrollH(x); return; }
  if(SBN && inRect(x,y,SBN)){ drag='scrolln'; setScrollN(y); return; }
  if(SB && inRect(x,y,SB)){ drag='scroll'; setScroll(y); return; }
}
function on_mouse_rbtn_up(x,y){
  x=dip(x);y=dip(y);
  chromeExitRequested=false;
  if(setupPrompt) return true;
  if(fsMode){
    if(vizMenuOpen){ vizMenuOpen=false; repaintAll(); return true; }
    return false;
  }
  if(ctxMenu||confirmDel||renameEdit||dupPrompt||rgPrompt||(typeof lovedPrompt!=='undefined'&&lovedPrompt)||brAlbTabOpen||brPlSortOpen||brSrvMenuOpen) return true;   // a modal is open: swallow
  if(TBH>0 && y<TBH && HB_CAP && x>=HB_CAP.maxX && x<HB_CAP.closeX){
    openSnapMenu(Math.max(8,HB_CAP.maxX-160),TBH);
    return true;
  }
  var i;
  if(view==='browse'||view==='search'||view==='songs'){
    for(i=0;i<HB_BR_TR.length;i++){ if(inRect(x,y,HB_BR_TR[i])){ return openNvTrackMenu(HB_BR_TR[i].info,x,y); } }
  }
  for(i=0;i<HB_BR_PL.length;i++){ if(inRect(x,y,HB_BR_PL[i])){ openNvPlaylistMenu(HB_BR_PL[i].plObj,x,y); return true; } }
  for(i=0;i<HB_BR_CARDS.length;i++){ if(inRect(x,y,HB_BR_CARDS[i]) && HB_BR_CARDS[i].kind==='pl'){ openNvPlaylistMenu(HB_BR_CARDS[i].obj,x,y); return true; } }
  return false;   // elsewhere: let JSplitter's own panel menu through (Reload / Configure / Properties)
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
  else if(act==='navdrawer'){toggleNavDrawer();return;}
  else if(act==='volume'){volumePopupOpen=!volumePopupOpen;repaintAll();return;}
  else if(act==='fullscreen'){ enterFullscreen(); return; }
  else if(act==='nvstar' && NP){
    var ts=sourceForHandle(NP), nid=(ts && ts.trackId)?ts.trackId(NP):'';
    if(nid && ts.toggleLoved) ts.toggleLoved('song',nid,ts.trackObj?ts.trackObj(NP):{id:nid,title:npTitleStr,artist:npArtistStr});
  }
  repaintAll();
}
function on_mouse_lbtn_up(x,y){
  x=dip(x);y=dip(y);
  if(titleDoublePending){
    titleDoublePending=false;
    if(!fsMode && y>=0 && y<TBH && x>=MENU_END && x<CAP_LEFT){ winToggleMaximize(); repaintAll(); }
    return;
  }
  if(setupPrompt){
    if(TBH>0 && y<TBH && HB_CAP){
      if(x>=HB_CAP.closeX) winExit();
      else if(x>=HB_CAP.maxX){winToggleMaximize();repaintAll();}
      else if(x>=HB_CAP.minX) winMinimize();
    } else setupClick(x,y);
    return;
  }
  if(drawerDismissedClick){drawerDismissedClick=false;return;}
  if(drawerPointer(x,y))return;
  if(volumePopupOpen&&drag!=='vol'&&!(HB_VOL&&inRect(x,y,HB_VOL))&&!(hit(HB_CTRL,x,y)||{}).act){volumePopupOpen=false;repaintAll();return;}
  var t;
  // ---- modal overlays first ----
  if(dupPrompt){
    if(DUP_HB && inRect(x,y,DUP_HB.skip)) dupSkip(); else dupKeep();   // "Add anyway"/outside: leave as-is
    return;
  }
  if(typeof lovedPrompt!=='undefined' && lovedPrompt){
    if(typeof LOVED_HB!=='undefined' && LOVED_HB && inRect(x,y,LOVED_HB.confirm)){ if(typeof lovedConfirmWrite==='function') lovedConfirmWrite(); return; }
    if(typeof lovedCancelWrite==='function') lovedCancelWrite(); else { lovedPrompt=null; repaintAll(); }
    return;
  }
  if(rgPrompt){
    if(RG_HB && inRect(x,y,RG_HB.scan)){ rgConfirmScan(); return; }
    rgPrompt=null; repaintAll(); return;      // cancel / click outside
  }
  if(confirmDel){
    if(CONF_HB && inRect(x,y,CONF_HB.del)){
      doDeleteNvPlaylist(confirmDel.id, confirmDel.srcId);
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
  if(drag==='seek'){ if(fb.PlaybackLength>0) fb.PlaybackTime=fb.PlaybackLength*dragFrac; drag=null; if(fsMode) repaintFsSeek(); else repaintAll(); return; }
  if(drag==='vol'){ drag=null; return; }
  if(drag==='scroll'||drag==='scrollh'||drag==='scrolln'){
    var wasH=(drag==='scrollh'); drag=null;
    if(wasH){
      brShelfScrollT=snapBrShelf(brShelfScroll);
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

  if(brAlbTabOpen){
    if((t=hit(BR_ALB_DD_HB,x,y))){ brSelectAlbumsTab(t.v); return; }
    brAlbTabOpen=false; repaintAll(); return;
  }
  if(brPlSortOpen){
    if((t=hit(BR_SORT_DD_HB,x,y))){ brPlSort=t.v; brPlSortOpen=false; brScroll=brScrollT=0; repaintAll(); return; }
    brPlSortOpen=false; repaintAll(); return;
  }
  if(brSrvMenuOpen){
    if((t=hit(BR_SRV_DD_HB,x,y))){ brSrvMenuOpen=false; var srvSrc=activeSource(); if(srvSrc && srvSrc.selectServer) srvSrc.selectServer(t.v); repaintAll(); return; }
    brSrvMenuOpen=false; repaintAll(); return;
  }
  if((t=hit(HB_BR_PL_DOTS,x,y))){ openNvPlaylistMenu(t.plObj,t.mx,t.my); return; }
  if((t=hit(HB_BR_PLDOTS,x,y))){ openNvPlaylistMenu(t.plObj,t.mx,t.my); return; }
  if((t=hit(HB_BR_TRDOTS,x,y))){ openNvTrackMenu(t.info,t.mx,t.my); return; }
  if(HB_SG && inRect(x,y,HB_SG)){ sgMenuOpen=true; repaintAll(); return; }
  if(HB_RGNORM && inRect(x,y,HB_RGNORM)){ rgToggle(); return; }
  if(HB_BR_ALB_DD && inRect(x,y,HB_BR_ALB_DD)){ brAlbTabOpen=true; repaintAll(); return; }
  if(HB_BR_SORT_DD && inRect(x,y,HB_BR_SORT_DD)){ brPlSortOpen=true; repaintAll(); return; }
  if(HB_BR_SORT_DIR && inRect(x,y,HB_BR_SORT_DIR)){ brPlSortDir=(brPlSortDir==='asc')?'desc':'asc'; brScroll=brScrollT=0; repaintAll(); return; }
  if(HB_BR_SRV_DD && inRect(x,y,HB_BR_SRV_DD)){ brSrvMenuOpen=true; repaintAll(); return; }
  if(HB_NAVDRAWER && inRect(x,y,HB_NAVDRAWER)){ toggleNavDrawer(); return; }
  if(TBH>0 && y<TBH){
    if((t=hit(HB_MENU,x,y))){ openMenu(t.root,t.mx,TBH); return; }
    if(HB_CAP){
      if(x>=HB_CAP.closeX){ winExit(); return; }
      if(x>=HB_CAP.maxX){ winToggleMaximize(); repaintAll(); return; }
      if(x>=HB_CAP.minX){ winMinimize(); return; }
      if(HB_CAP.hasSnap && x>=HB_CAP.snapX){ openSnapMenu(Math.max(8,HB_CAP.snapX-140),TBH); return; }
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
  function closeNavDrawer(){ if(R.navDrawer && navDrawerOpen){ navDrawerOpen=false; layout(); } }
  if(HB_HOME && inRect(x,y,HB_HOME)){ closeNavDrawer(); brOpenHome(); return; }
  if(HB_SEARCH && inRect(x,y,HB_SEARCH)){
    closeNavDrawer();
    view='search'; searchScroll=searchScrollT=0;
    var sSrc=activeSource();
    if(searchQuery.trim() && sSrc && sSrc.search) sSrc.search(searchQuery);
    repaintAll(); return;
  }
  if(HB_BR_REFRESH && inRect(x,y,HB_BR_REFRESH)){ var rSrc=activeSource(); if(rSrc && rSrc.refresh) rSrc.refresh(false); return; }
  if(HB_BR_ADDPL && inRect(x,y,HB_BR_ADDPL)){ closeNavDrawer(); startNvCreatePlaylist([], activeSource()); return; }
  if((t=hit(HB_BR_QUICK,x,y))){
    closeNavDrawer();
    if(t.id==='artists') brOpenArtists();
    else if(t.id==='albums') brOpenAlbums();
    else if(t.id==='starred') brOpenStarred();
    else if(t.id==='random') brOpenRandom();
    return;
  }
  if((t=hit(HB_BR_PL,x,y))){ closeNavDrawer(); brOpenPlaylist(t.plObj.id,t.plObj.name); return; }
  if(HB_ALLSONGS && inRect(x,y,HB_ALLSONGS)){ closeNavDrawer(); if(view!=='songs'){ view='songs'; songsScroll=songsScrollT=0; } repaintAll(); return; }
  if(HB_PLADD_FILES && inRect(x,y,HB_PLADD_FILES)){
    var addFilePi=(view==='browse'&&brView==='playlist')?parseInt(brViewId,10):plman.ActivePlaylist;
    if(!isNaN(addFilePi) && addFilePi>=0) addFilesToPl(addFilePi);
    return;
  }
  if(HB_PLADD_FOLDER && inRect(x,y,HB_PLADD_FOLDER)){
    var addDirPi=(view==='browse'&&brView==='playlist')?parseInt(brViewId,10):plman.ActivePlaylist;
    if(!isNaN(addDirPi) && addDirPi>=0) addFolderToPl(addDirPi);
    return;
  }
  if((t=hit(HB_BR_STAR,x,y))){ var stSrc=activeSource(); if(stSrc && stSrc.toggleLoved) stSrc.toggleLoved('song',t.song.id,t.song); return; }
  if((t=hit(HB_BR_BTN,x,y))){ handleBrowseButtonAction(t.act,t.data); return; }
  if((t=hit(HB_BR_CARDS,x,y))){
    if(t.kind==='pl') brOpenPlaylist(t.id,t.title);
    else if(t.kind==='album') brOpenAlbum(t.id,t.title);
    else if(t.kind==='artist') brOpenArtist(t.id,t.title);
    return;
  }
  if((t=hit(HB_Q,x,y))){ if(t.q!==undefined) playQueueItem(t.q); else playQueueNext(t.pl,t.item); repaintAll(); return; }
  if((t=hit(HB_BR_TR,x,y))){
    if(t.pgx1!==undefined && x>=t.pgx0 && x<t.pgx1){ var pSrc=activeSource(); if(pSrc && pSrc.play) pSrc.play(t.info.list,t.info.idx,t.info.sourceMeta); }
    return;
  }
}
// A single click on a list this dense is too easy to fire by accident, and it is the convention
// every desktop player follows -- including the one this theme is modelled on.
var titleDoublePending=false;
function on_mouse_lbtn_dblclk(x,y){
  x=dip(x);y=dip(y);
  if(fsMode) return;
  if(setupPrompt && (y<0||y>=TBH)) return;
  if(ctxMenu||confirmDel||renameEdit||sgMenuOpen||vizMenuOpen||dupPrompt||rgPrompt||(typeof lovedPrompt!=='undefined'&&lovedPrompt)||brAlbTabOpen||brPlSortOpen||brSrvMenuOpen) return;
  if(TBH>0 && y>=0 && y<TBH){
    if((chromeAttached||UIWizard) && x>=MENU_END && x<CAP_LEFT) titleDoublePending=true;
    return;
  }
  var t=hit(HB_BR_TR,x,y);
  if(t){ var pSrc=activeSource(); if(pSrc && pSrc.play) pSrc.play(t.info.list,t.info.idx,t.info.sourceMeta); return; }
}
function hoverSig(x,y){
  var i;
  if(setupPrompt && y>=TBH){ i=hitIdx(SETUP_HB,x,y); return i<0?'setup':('setup'+i); }
  if(fsMode){
    if(vizMenuOpen){ i=hitIdx(VIZ_HB,x,y); return (i<0)?'vz':('vz'+i); }
    if(HB_VIZ && inRect(x,y,HB_VIZ)) return 'vzb';
    if(typeof HB_FS_TOP!=='undefined' && (i=hitIdx(HB_FS_TOP,x,y))>=0) return 'ft'+i;
    if(typeof HB_FS_LY!=='undefined' && (i=hitIdx(HB_FS_LY,x,y))>=0) return 'fl'+i;
    if((i=hitIdx(HB_FS,x,y))>=0) return 'f'+i;      // fullscreen icons fallback
    if((i=hitIdx(HB_CTRL,x,y))>=0) return 'fc'+i;   // fullscreen transport controls
    return '';
  }
  if(dupPrompt){ if(DUP_HB){ if(inRect(x,y,DUP_HB.skip)) return 'dps'; if(inRect(x,y,DUP_HB.keep)) return 'dpk'; } return 'dp'; }
  if(renameEdit){ if(RENAME_HB){ if(inRect(x,y,RENAME_HB.save)) return 'rns'; if(inRect(x,y,RENAME_HB.cancel)) return 'rnc'; } return 'rn'; }
  if(typeof lovedPrompt!=='undefined' && lovedPrompt){ if(typeof LOVED_HB!=='undefined' && LOVED_HB){ if(inRect(x,y,LOVED_HB.confirm)) return 'lvc'; if(inRect(x,y,LOVED_HB.cancel)) return 'lvx'; } return 'lv'; }
  if(rgPrompt){ if(RG_HB){ if(inRect(x,y,RG_HB.scan)) return 'rgs'; if(inRect(x,y,RG_HB.cancel)) return 'rgc'; } return 'rg'; }
  if(confirmDel){ if(CONF_HB && inRect(x,y,CONF_HB.del)) return 'cfd'; if(CONF_HB && inRect(x,y,CONF_HB.cancel)) return 'cfc'; return 'cf'; }
  if(ctxMenu){ i=hitIdx(CTX_HB,x,y); return (i<0)?'cx':('cx'+i); }
  if(sgMenuOpen){ i=hitIdx(SG_HB,x,y); return (i<0)?'sg':('sg'+i); }
  if(brAlbTabOpen){ i=hitIdx(BR_ALB_DD_HB,x,y); return (i<0)?'bra':('bra'+i); }
  if(brPlSortOpen){ i=hitIdx(BR_SORT_DD_HB,x,y); return (i<0)?'brs':('brs'+i); }
  if(brSrvMenuOpen){ i=hitIdx(BR_SRV_DD_HB,x,y); return (i<0)?'brsrv':('brsrv'+i); }
  if((i=hitIdx(HB_BR_PL_DOTS,x,y))>=0) return 'brpd'+i;
  if((i=hitIdx(HB_BR_PLDOTS,x,y))>=0) return 'brd'+i;
  if((i=hitIdx(HB_BR_TRDOTS,x,y))>=0) return 'brtd'+i;
  if((i=hitIdx(HB_BR_STAR,x,y))>=0) return 'brst'+i;
  if(HB_NAVDRAWER && inRect(x,y,HB_NAVDRAWER)) return 'navdrw';
  if(TBH>0 && y<TBH){
    if((i=hitIdx(HB_MENU,x,y))>=0) return 'mnu'+i;
    if(HB_CAP){
      if(HB_CAP.hasSnap && x>=HB_CAP.snapX && x<HB_CAP.minX) return 'capsnap';
      if(x>=HB_CAP.minX) return 'cap'+(((x-HB_CAP.minX)/HB_CAP.bw)|0);
    }
    return '';
  }
  if(SBH && inRect(x,y,SBH)) return 'sbh';
  if(SBN && inRect(x,y,SBN)) return 'sbn';
  if(HB_BR_ADDPL && inRect(x,y,HB_BR_ADDPL)) return 'braddpl';
  if(HB_BR_REFRESH && inRect(x,y,HB_BR_REFRESH)) return 'brref';
  if(HB_PLADD_FILES && inRect(x,y,HB_PLADD_FILES)) return 'pladdf';
  if(HB_PLADD_FOLDER && inRect(x,y,HB_PLADD_FOLDER)) return 'pladdd';
  if(HB_ALLSONGS && inRect(x,y,HB_ALLSONGS)) return 'als';
  if(HB_SG && inRect(x,y,HB_SG)) return 'sgb';
  if(HB_RGNORM && inRect(x,y,HB_RGNORM)) return 'nzb';
  if(HB_BR_ALB_DD && inRect(x,y,HB_BR_ALB_DD)) return 'brab';
  if(HB_BR_SORT_DD && inRect(x,y,HB_BR_SORT_DD)) return 'brsb';
  if(HB_BR_SORT_DIR && inRect(x,y,HB_BR_SORT_DIR)) return 'brsd';
  if(HB_BR_SRV_DD && inRect(x,y,HB_BR_SRV_DD)) return 'brsrvb';
  if(SB && inRect(x,y,SB)) return 'sb';
  if(HB_QLY_RETRY && inRect(x,y,HB_QLY_RETRY)) return 'qlyr';
  if(typeof HB_QLY_REF!=='undefined' && HB_QLY_REF && inRect(x,y,HB_QLY_REF)) return 'qlyf';
  if((i=hitIdx(HB_QLY,x,y))>=0) return 'qly'+i;
  if((i=hitIdx(HB_CTRL,x,y))>=0) return 'c'+i;
  if((i=hitIdx(HB_TABS,x,y))>=0) return 't'+i;
  if((i=hitIdx(HB_SOURCE,x,y))>=0) return 'source'+i;
  if(HB_HOME && inRect(x,y,HB_HOME)) return 'h';
  if(HB_SEARCH && inRect(x,y,HB_SEARCH)) return 's';
  if((i=hitIdx(HB_BR_QUICK,x,y))>=0) return 'brq'+i;
  if((i=hitIdx(HB_BR_BTN,x,y))>=0) return 'brb'+i;
  if((i=hitIdx(HB_BR_PL,x,y))>=0) return 'brp'+i;
  if((i=hitIdx(HB_BR_CARDS,x,y))>=0) return 'brc'+i;
  if((i=hitIdx(HB_BR_TR,x,y))>=0) return 'brr'+i;
  if((i=hitIdx(HB_Q,x,y))>=0) return 'q'+i;
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
    var prevSig=hoverKey;
    hoverKey=sig; scrollKey=sk;
    if(fsMode){
      if(hasActiveOverlay()) repaintAll();
      else { repaintFsHoverOne(prevSig); if(sig!==prevSig) repaintFsHoverOne(sig); }
    } else if(hasActiveOverlay()){
      repaintAll();
    } else {
      repaintZone(hoverZoneKey); if(z!==hoverZoneKey) repaintZone(z);   // clear the old highlight, then draw the new
    }
  }
  hoverZoneKey=z;
}
// which scrollable section the cursor is over (so entering/leaving reveals the hover scrollbar even over gaps)
function scrollSection(x,y){
  if(fsMode) return '';
  if(R.navLib && x>=R.navLib.x && x<R.navLib.x+R.navLib.w && y>=R.navLib.y && y<R.navLib.y+R.navLib.h) return 'nav';
  if(R.main && x>=R.main.x && x<R.main.x+R.main.w+16 && y>=R.main.y && y<R.main.y+R.main.h){
    if(view==='browse') return (brView==='home' && y>=BR_SHELF_Y0 && y<BR_SHELF_Y1+16)?'brshelf':'browse';
    if(view==='songs') return 'songs';
    if(view==='search') return 'srch';
  }
  return '';
}
function on_mouse_leave(){
  mx=-1; my=-1;
  if(hoverKey!==''||scrollKey!==''){
    var prevSig=hoverKey;
    hoverKey=''; scrollKey='';
    if(fsMode){
      if(hasActiveOverlay()) repaintAll();
      else repaintFsHoverOne(prevSig);
    } else if(hasActiveOverlay()){
      repaintAll();
    } else {
      repaintZone(hoverZoneKey);
    }
  }
  hoverZoneKey='';
}
function on_char(code){
  chromeExitRequested=false;
  if(setupPrompt){
    if(code===27) setupAction('skip');
    else if(code===13) setupAction(setupPrompt.step===3?'finish':'next');
    return;
  }
  if(!fsMode&&code===27&&typeof lovedPrompt!=='undefined'&&lovedPrompt){ if(typeof lovedCancelWrite==='function') lovedCancelWrite(); else { lovedPrompt=null; repaintAll(); } return; }
  if(!fsMode&&code===27&&(queueDrawerOpen||navDrawerOpen||volumePopupOpen||brAlbTabOpen||brPlSortOpen||brSrvMenuOpen)){queueDrawerOpen=false;navDrawerOpen=false;volumePopupOpen=false;if(typeof brCloseMenus==='function')brCloseMenus();layout();repaintAll();return;}
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
      if(brSearchTimer){ window.ClearTimeout(brSearchTimer); brSearchTimer=null; }
      var s=activeSource();
      if(s){ if(s.resetSearch) s.resetSearch(); if(s.search) s.search(searchQuery); }
      repaintAll(); return;
    }
    else if(code>=32) searchQuery+=String.fromCharCode(code);
    else return;
    searchScroll=searchScrollT=0; caretOn=true;   // keep caret solid right after a keystroke
    if(brSearchTimer){ window.ClearTimeout(brSearchTimer); brSearchTimer=null; }
    var sq=searchQuery.trim();
    var sCur=activeSource();
    if(!sq){ if(sCur && sCur.search) sCur.search(''); }
    else if(libSource==='navidrome'){
      brSearchTimer=window.SetTimeout(function(){ brSearchTimer=null; var s1=activeSource(); if(s1 && s1.search) s1.search(searchQuery); },280);
    } else if(sCur && sCur.search){
      sCur.search(searchQuery);
    }
    repaintAll();
    return;
  }
  /* Space = play/pause, the way every media player behaves. Deliberately after the two cases
     above: in Search and while renaming a playlist a space is a character the user meant to
     type, not a transport command. A modal owns the keyboard while it is open, so Space must
     not reach playback from underneath one either. */
  if(code===32 && !ctxMenu && !confirmDel && !dupPrompt && !rgPrompt && !(typeof lovedPrompt!=='undefined'&&lovedPrompt) &&
     !sgMenuOpen && !vizMenuOpen && !brAlbTabOpen && !brPlSortOpen && !brSrvMenuOpen){
    try{ fb.PlayOrPause(); }catch(e){}
  }
}
function on_mouse_wheel(step){
  if(setupPrompt) return;
  if(fsMode){
    // lyrics with no timestamps don't roll themselves, so here the wheel scrolls them; with nothing
    // to scroll (synced, short enough to fit, or another view) it stays the volume control
    if(fsLyricsWheel(step)) return;
    fb.Volume=pos2vol(clamp01(vol2pos(fb.Volume)+step*0.04)); repaintFsCtrl(); return;
  }
  if(ctxMenu||confirmDel||renameEdit||dupPrompt||rgPrompt||(typeof lovedPrompt!=='undefined'&&lovedPrompt)||sgMenuOpen||brAlbTabOpen||brPlSortOpen||brSrvMenuOpen) return;
  // right pane: same deal on the Lyrics tab. Consume the wheel either way -- it belongs to this
  // panel, and falling through would scroll the playlist behind the pointer.
  if(R.queue && (!R.drawer || queueDrawerOpen) && mx>=R.queue.x && mx<R.queue.x+R.queue.w && my>=R.queue.y && my<R.queue.y+R.queue.h){
    if(rightTab==='lyrics' && typeof lyStWheel==='function' && lyStWheel(step)) repaintQueue();
    return;
  }
  if(R.navLib && (!R.navDrawer || navDrawerOpen) && mx>=R.navLib.x && mx<R.navLib.x+R.navLib.w && my>=R.navLib.y && my<R.navLib.y+R.navLib.h){
    navScrollT=clampPx(navScrollT-step*WHEEL_PX,NAV_MAX); startScrollAnim(); return;
  }
  if((R.navDrawer && navDrawerOpen) || (R.drawer && queueDrawerOpen)) return;
  if(mx<R.main.x || mx>=R.main.x+R.main.w) return;
  if(view==='browse'){
    if(brView==='home' && my>=BR_SHELF_Y0 && my<BR_SHELF_Y1){ brShelfScrollT=snapBrShelf(brShelfScrollT-step*WHEEL_PX); startScrollAnim(); }
    else { brScrollT=clampPx(brScrollT-step*WHEEL_PX,BR_MAXPX); startScrollAnim(); }
    return;
  }
  else if(view==='songs'){ songsScrollT=clampPx(songsScrollT-step*WHEEL_PX,SONGS_MAXPX); startScrollAnim(); return; }
  else if(view==='search'){ searchScrollT=clampPx(searchScrollT-step*WHEEL_PX,SEARCH_MAXPX); startScrollAnim(); return; }
}
/* ---- drag & drop external files: two targets, the library section (-> new playlist) and the
   playlist view body (-> appends to it); everywhere else denies. We never see the dropped paths
   (DropTargetAction is write-only), so we name a destination and the component does the insert. */
function overLib(x,y){ return (typeof libSource==='undefined'||libSource==='local') && !!R.navLib && x>=R.navLib.x && x<R.navLib.x+R.navLib.w && y>=R.navLib.y && y<R.navLib.y+R.navLib.h; }
// body of the playlist view -> index of the playlist to append to, or -1 if that's not a valid target
function plDropTarget(x,y){
  if(fsMode || (typeof libSource!=='undefined' && libSource!=='local') || view!=='browse' || brView!=='playlist' || !R.main) return -1;
  if(x<R.main.x || x>=R.main.x+R.main.w || y<R.main.y || y>=R.main.y+R.main.h) return -1;
  var i=parseInt(brViewId,10);
  if(isNaN(i) || i<0 || i>=plman.PlaylistCount || plman.IsPlaylistLocked(i)) return -1;   // autoplaylists etc. can't take manual inserts
  return i;
}
function dragUpdate(action,x,y){
  if(setupPrompt){action.Effect=0;setDropHover(false,false);return;}
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
  if(setupPrompt){action.Effect=0;setDropHover(false,false);return;}
  var ext=!action.IsInternal, hit=ext&&(action.Effect&5), pi=hit?plDropTarget(x,y):-1;   // 5 = copy|link
  if(hit && overLib(x,y)){
    var np=createNewPlaylist();
    action.Playlist=np; action.Base=0; action.ToSelect=true;            // component drops the files into it
    action.Effect=(action.Effect&1)?1:4;
    plman.ActivePlaylist=np; revealPlaylist(np); if(typeof brOpenPlaylist==='function') brOpenPlaylist(String(np), plName(np)); else { view='browse'; brView='playlist'; brViewId=String(np); }
  } else if(pi>=0){
    plman.UndoBackup(pi);                                              // so ctrl+Z undoes the import
    armDupWatch(pi);                                                   // snapshot before the component inserts
    action.Playlist=pi; action.Base=plman.PlaylistItemCount(pi); action.ToSelect=true;   // append at end
    action.Effect=(action.Effect&1)?1:4;
  } else action.Effect=0;
  navDropHover=false; plDropHover=false; repaintAll();
}
function on_script_unload(){
  if(chromeRetryTimer){ window.ClearTimeout(chromeRetryTimer); chromeRetryTimer=null; }
  if(chromeStartupTimer){ window.ClearTimeout(chromeStartupTimer); chromeStartupTimer=null; }
  stopChromeHover();
  if(VerdantChrome && chromeAttached){
    try{ if(chromeExitRequested) VerdantChrome.DetachForExit(); else VerdantChrome.Detach(); }
    catch(e){ try{ VerdantChrome.Detach(); }catch(e2){} }
    chromeAttached=false;
    if(typeof chromeThemeKey!=='undefined') chromeThemeKey='';
  }
  stopDisplayWatch();npArtGeneration++;
  if(typeof clearBrCardCache==='function') clearBrCardCache();
  nvCancel(); if(typeof nvCancelHttpTasks==='function') nvCancelHttpTasks(); stopFsClock(); if(typeof stopFsAnim==='function') stopFsAnim();
  if(typeof disposeFsBackdrop==='function') disposeFsBackdrop(); else fsBackdrop=null;
  if(typeof disposeFsLyBmps==='function') disposeFsLyBmps();
  if(typeof fsBridgeDestroy==='function') fsBridgeDestroy();
  if(typeof disposeCardTextScratch==='function') disposeCardTextScratch();
  if(brSearchTimer){ window.ClearTimeout(brSearchTimer); brSearchTimer=null; }
  if(typeof statsFlush==='function') statsFlush();
  hideNativePanel('Navidrome');
  hideNativePanel('Lyrics');
  stopLyAnim(); stopCaret(); stopViz(); stopScrollAnim(); stopShimAnim(); stopMemWatch();
  if(dupWatch && dupWatch.timer) window.ClearTimeout(dupWatch.timer);
}
function invalidateLibrary(){
  artistList=null; artistTracksMap=null; artistCandCache={}; coverPickCache={}; warmed={};
  songsIdx=null; songsRows=null; songsTracks=null; libCovCache=null; libCount_=-1;
  libItems_=null; libTFCache={};   // everything above is derived from these
  rgStat=null; rgScanFailed=false;
  warmJob=null; jobs={};           // anything in flight refers to the old library
  gates={}; rowGate={}; shelfHandles=null; artsGating=false;   // every section re-gates
  if(typeof localOnLibraryChanged==='function') localOnLibraryChanged();
}
function libChanged(){ invalidateLibrary(); if(typeof clearBrCardCache==='function') clearBrCardCache(); repaintAll(); }
function on_library_items_added(){ libChanged(); }
function on_library_items_removed(){ libChanged(); }
function on_library_items_changed(){ libChanged(); }

/* ------------------------- playback callbacks ------------------------- */
function on_playback_new_track(){
  updateNP();
  fsBridgeTrackId(true);
  if(typeof statsOnNewTrack==='function') statsOnNewTrack();
  if(nvShouldLoadLyrics()) nvLoad();
  else if(typeof loadLyrics==='function') loadLyrics();
  var psrc=(typeof sourceForPlayback==='function')?sourceForPlayback():null;
  if(psrc && psrc.maybeTopUpRandom) psrc.maybeTopUpRandom();
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
  if(typeof fsBridgePushTrack==='function') fsBridgePushTrack();
  if(typeof fsBridgeIsShowing==='function' && fsBridgeIsShowing()) return;
  repaintAll();
}
function npChanged(){
  updateNP();
  if(nvShouldLoadLyrics()) nvLoad();
  if(typeof fsBridgePushTrack==='function') fsBridgePushTrack();
  if(typeof fsBridgeIsShowing==='function' && fsBridgeIsShowing()) return;
  repaintAll();
}
function on_playback_dynamic_info_track(){ npChanged(); }
function on_playback_stop(){ if(typeof statsOnPlaybackStop==='function') statsOnPlaybackStop(); npChanged(); }
function on_playback_pause(){ npChanged(); }
function on_playback_time(){
  repaintBar();
  if(nvShouldLoadLyrics() && NV.key!==nvTrackKey()) nvLoad();
}
function on_playback_seek(){
  lySnap=true;
  if(webPreviewIsShowing()) webPreviewPlayback(false,true);
  if(fsMode){
    if(typeof fsBridgeIsShowing==='function' && fsBridgeIsShowing()){ fsBridgePushPlayback(true); return; }
    if(fsView==='lyrics'){ fsLyReset(); repaintFsLyrics(); }
    repaintFsSeek(); return;
  }
  repaintAll();
}
function on_playback_order_changed(){
  syncOrderFromFb();
  if(typeof fsBridgePushPlayback==='function') fsBridgePushPlayback(false);
  if(typeof fsBridgeIsShowing==='function' && fsBridgeIsShowing()) return;
  repaintAll();
}
function on_playback_queue_changed(){ repaintAll(); }
function on_volume_change(){
  if(fsMode){
    if(typeof fsBridgeIsShowing==='function' && fsBridgeIsShowing()){ fsBridgePushPlayback(false); return; }
    repaintFsCtrl();
  } else repaintBar();
}
// ReplayGain can also be switched from foobar's own Playback menu -- keep the pill honest
function on_replaygain_mode_changed(){ repaintMain(); }
// rgStat included: a ReplayGain scan lands as a tag write, so this is how the pill learns it finished
function on_metadb_changed(handles,fromhook){
  if(fromhook) return;
  if(typeof lovedOnMetadbChanged==='function' && lovedOnMetadbChanged(handles)){ updateNP(); repaintAll(); return; }
  invalidateItems(); albKeyCache={}; hueCache={}; artistCandCache={}; coverPickCache={}; songsIdx=null; songsRows=null; songsTracks=null; rgStat=null;
  if(typeof localOnLibraryChanged==='function') localOnLibraryChanged();
  if(typeof clearBrCardCache==='function') clearBrCardCache();
  updateNP(); repaintAll();
}
/* A switch changes which playlist is ACTIVE, not what any playlist contains -- and every cache
   invalidateItems() drops is keyed by playlist index, so none of them went stale here. Dropping
   them meant each switch re-derived covers and re-ran the art gates against an artCache that had
   since evicted those albums: the view fell back to its skeleton and the artwork reloaded. The
   caches that genuinely depend on playlist CONTENT are still cleared by the callbacks that mean
   content changed (items added/removed/reordered, playlists changed). */
function on_playlist_switch(){ if(typeof libSource==='string'&&libSource==='local'&&view==='browse'&&brView==='playlist') brScroll=brScrollT=0; repaintAll(); }
function on_playlists_changed(){ invalidateItems(); if(typeof localOnPlaylistsChanged==='function') localOnPlaylistsChanged(); repaintAll(); }
function on_playlist_items_added(pl){ invalidateItems(); if(dupWatch && dupWatch.pl===pl) scheduleDupScan(); repaintAll(); }
function on_playlist_items_removed(){ invalidateItems(); repaintAll(); }
function on_playlist_items_reordered(){ invalidateItems(); repaintAll(); }
function on_item_focus_change(){ repaintAll(); }

checkDisplay(true);
scheduleChromeStartupCheck();
startDisplayWatch();
updateNP();
syncOrderFromFb(); applyPlaybackOrder();   // normalize native order (we manage shuffle ourselves)
capVolume();       // pull a remembered volume back under the slider's ceiling
startMemWatch();   // caches grow into the component's spare memory and back off as it fills
drpSync();         // make foo_verdant agree with the Discord property before anything plays
if(setupNeedsWelcome) openSetup(true);
var _initSrc=(typeof activeSource==='function')?activeSource():null;
if(_initSrc && _initSrc.ensureLoaded) _initSrc.ensureLoaded();
if(NP && (rightTab==='lyrics' || fsMode)){
  if(typeof nvShouldLoadLyrics==='function' && nvShouldLoadLyrics()) nvLoad();
  else if(typeof loadLyrics==='function') loadLyrics();
}

function on_font_changed(){ if(!checkDisplay(false)){ refreshFonts(); if(typeof fsBridgePushFonts==='function') fsBridgePushFonts(); repaintAll(true); } }
function on_http_request_done(id,success,response,status){ if(typeof nvHttpDispatch==='function') nvHttpDispatch(id,success,response,status); }
function on_download_file_done(path,success){ if(typeof nvOnDownloadDone==='function') nvOnDownloadDone(path,success); }
function on_load_image_done(cookie,image){ if(typeof nvOnLoadImageDone==='function') nvOnLoadImageDone(cookie,image); }
function on_locations_added(task_id,handles){ if(typeof nvOnLocationsAdded==='function') nvOnLocationsAdded(task_id,handles); }
