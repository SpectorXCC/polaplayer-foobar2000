/* verdant/ui/chrome.js -- window chrome + shared widgets: title bar, scrollbars, panels, overlays, menus
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

/* Custom window title bar via Verdant.Chrome (Win11 Snap Layouts) or UI Wizard fallback */
function createNativeChrome(){
  try{ return new ActiveXObject('Verdant.Chrome'); }catch(e){ return null; }
}
var VerdantChrome=createNativeChrome();
var chromeAttached=false;
var chromeExitRequested=false;
var chromeThemeKey='';
var chromeMaxHot=null, chromeHoverTimer=null;
function checkChromeHover(){
  var hot=null;
  if(VerdantChrome && chromeAttached && !fsMode){
    try{ var state=VerdantChrome.MaxButtonHot; if(state!==undefined && state!==null) hot=!!state; }catch(e){}
  }
  if(hot===chromeMaxHot) return;
  chromeMaxHot=hot;
  if(!fsMode && TBH>0) repaintTitle();
}
function startChromeHover(){
  if(!chromeHoverTimer) chromeHoverTimer=window.SetInterval(checkChromeHover,50);
  checkChromeHover();
}
function stopChromeHover(){
  if(chromeHoverTimer){ window.ClearInterval(chromeHoverTimer); chromeHoverTimer=null; }
  chromeMaxHot=null;
}
function argbToColorRef(col){
  var r=(col>>16)&0xff, g=(col>>8)&0xff, b=col&0xff;
  return (((b<<16)|(g<<8)|r)>>>0);
}
function syncChromeTheme(force){
  if(!VerdantChrome || !chromeAttached) return;
  var isDark=!IS_LIGHT;
  var canvasRef=argbToColorRef(COL.canvas);
  var borderRef=argbToColorRef(IS_LIGHT?RGB(200,200,206):RGB(42,42,42));
  var key=(isDark?1:0)+'|'+canvasRef+'|'+borderRef;
  if(!force && key===chromeThemeKey) return;
  chromeThemeKey=key;
  try{ VerdantChrome.SetTheme(isDark?1:0, canvasRef, borderRef); }catch(e){}
}
var UIWizard=null; try{ UIWizard=new ActiveXObject('UIWizard'); }catch(e){ UIWizard=null; }
var TBH=32, CAPBW=46, SNAPBW=34, WIN_MIN_W=360, WIN_MIN_H=320;
var MENUS=[];
onLangChange(function(){
  MENUS=[[T('menu.file'),'file'],[T('menu.library'),'library'],[T('menu.settings'),'setup'],[T('menu.help'),'help']];
});
var MENU_END=0, CAP_LEFT=0, capW=-1, capEnd=-1, capLeftSaved=-1;
function applyCaption(){
  if(typeof chromeInstalling!=='undefined' && chromeInstalling) return;
  var state=W+'|'+!!fsMode+'|'+UISCALE+'|'+TBH+'|'+(chromeAttached?1:0);
  if(capW===state && capEnd===MENU_END && capLeftSaved===CAP_LEFT) return;
  capW=state; capEnd=MENU_END; capLeftSaved=CAP_LEFT;
  var tbH=(fsMode||TBH<=0)?0:px(TBH);
  var cw=Math.max(0,(CAP_LEFT>0?CAP_LEFT:W-CAPBW*3)-MENU_END);
  if(VerdantChrome && chromeAttached){
    var cap=physicalRect({x:MENU_END,y:0,w:cw,h:TBH}), max=physicalRect({x:W-CAPBW*2,y:0,w:CAPBW,h:TBH});
    var mw=px(WIN_MIN_W), mh=px(WIN_MIN_H);
    try{ VerdantChrome.SetFullscreen(fsMode?1:0); }catch(e){}
    try{ VerdantChrome.SetChromeMetrics(cap.x,0,cap.w,tbH,max.x,0,max.w,tbH,mw,mh); }catch(e){}
    return;
  }
  if(!UIWizard) return;
  try{ UIWizard.SetCaptionAreaSize(px(MENU_END),0,px(cw),tbH); }catch(e){}
}
function openMenu(root,x,y){
  if(root==='setup'){ openSetup(false); return; }
  if(root==='compact'){
    ctxMenu={kind:'winmenu', mx:x, x:x, y:y, items:[
      {label:T('menu.file'),act:'file'},
      {label:T('menu.library'),act:'library'},
      {label:T('menu.settings'),act:'setup'},
      {label:T('menu.help'),act:'help'}
    ]};
    repaintAll();
    return;
  }
  try{ var mm=fb.CreateMainMenuManager(); mm.Init(root); var m=window.CreatePopupMenu(); mm.BuildMenu(m,1,600); var id=m.TrackPopupMenu(px(x),px(y)); if(id>0) mm.ExecuteByID(id-1); }catch(e){}
}

// Rounded outline. GDI+ rejects an arc bigger than half the side and centres a stroke on the
// path, so inset by the line width first, then clamp the radius to what's left.
function strokeRound(gr,x,y,w,h,rad,lw,col){
  var i=lw/2, sw=w-lw, sh=h-lw;
  if(sw<=0 || sh<=0) return;
  var a=Math.min(rad,sw/2,sh/2);
  gr.DrawRoundRect(x+i,y+i,sw,sh,a,a,lw,col);
}
/* Draggable pixel scrollbar, hidden until its section is hovered. Thumb size comes from
   viewport vs content height, position from scrollPx/maxPx. Each scrollable view calls this
   at the end of its draw; the matching set*() maps a drag/click back to a scroll offset. */
var SB_MAIN={sw:6,min:36,track:20,on:175,off:95,key:'scroll'};
var SB_NAV ={sw:5,min:30,track:16,on:150,off:80,key:'scrolln'};
function drawSBV(gr,sx,top,h,scrollPx,maxPx,viewH,contentH,show,s){
  if(contentH<=viewH || h<=6 || !show) return null;
  gr.FillSolidRect(sx,top,s.sw,h,OV(s.track));
  var thumbH=Math.max(s.min,Math.round(h*viewH/contentH)); if(thumbH>h) thumbH=h;
  var ty=top+(maxPx>0?Math.round((h-thumbH)*scrollPx/maxPx):0);
  var on=(drag===s.key)||hv(sx-6,top,sx+s.sw+6,top+h);
  gr.FillSolidRect(sx,ty,s.sw,thumbH,OV(on?s.on:s.off));
  return {x0:sx-6,y0:top,x1:sx+s.sw+6,y1:top+h,top:top,h:h,thumbH:thumbH,maxPx:maxPx};
}
function drawScrollbar(gr,sx,top,h,sp,mp,vh,ch,show){ SB=drawSBV(gr,sx,top,h,sp,mp,vh,ch,show,SB_MAIN); }
function drawScrollbarN(gr,sx,top,h,sp,mp,vh,ch,show){ SBN=drawSBV(gr,sx,top,h,sp,mp,vh,ch,show,SB_NAV); }
function sbFrac(v,start,size,thumb){ return clamp01((v-start-thumb/2)/Math.max(1,size-thumb)); }
// scroll + target are set together so the easing animation doesn't fight the drag
function setScroll(y){
  if(!SB) return;
  var px=Math.round(sbFrac(y,SB.top,SB.h,SB.thumbH)*SB.maxPx);
  if(view==='songs') songsScroll=songsScrollT=px;
  else if(view==='search') searchScroll=searchScrollT=px;
  else if(view==='browse' && typeof brScroll!=='undefined'){ brScroll=brScrollT=px; }
  repaintMain();
}
function setScrollN(y){ if(!SBN) return; navScroll=navScrollT=Math.round(sbFrac(y,SBN.top,SBN.h,SBN.thumbH)*SBN.maxPx); repaintNav(); }

function drawScrollbarH(gr,sx,top,w,scrollX,maxX,viewW,contentW,show){
  if(contentW<=viewW || w<=6 || !show){ SBH=null; return; }   // hidden until the section is hovered
  var sh=5;
  gr.FillSolidRect(sx,top,w,sh,OV(20));
  var thumbW=Math.max(40,Math.round(w*viewW/contentW)); if(thumbW>w) thumbW=w;
  var tx=sx+(maxX>0?Math.round((w-thumbW)*scrollX/maxX):0);
  var on=(drag==='scrollh')||hv(sx,top-6,sx+w,top+sh+6);
  gr.FillSolidRect(tx,top,thumbW,sh,OV(on?175:95));
  SBH={x0:sx,y0:top-6,x1:sx+w,y1:top+sh+6,left:sx,w:w,thumbW:thumbW,maxPx:maxX};
}
function setScrollH(x){   // free pixel scrolling; target set with it so the easing doesn't fight the drag
  if(!SBH) return;
  var px=Math.round(sbFrac(x,SBH.left,SBH.w,SBH.thumbW)*SBH.maxPx);
  if(view==='browse' && typeof brShelfScroll!=='undefined'){ brShelfScroll=brShelfScrollT=px; }
  repaintMain();
}

/* ------------------------- paint ------------------------- */
/* FillRoundRect rasterises an antialiased path over the panel's whole area -- ~1.7Mpx for the
   main panel, on every repaint of every panel, and it showed up as ~8ms of each frame that no
   content loop accounted for. A flat fill plus the four pre-rendered corner stamps buildCorners
   already makes is visually identical (straight edges have nothing to antialias) and far cheaper.
   The stamps are black, which is correct because every panel sits on the black canvas. */
function panelBg(gr,r,c){
  var rad=M.radius; if(!CORN) CORN=buildCorners(rad);
  gr.FillSolidRect(r.x,r.y,r.w,r.h,c);
  gr.DrawImage(CORN.tl,r.x,r.y,rad,rad,0,0,px(rad),px(rad));
  gr.DrawImage(CORN.tr,r.x+r.w-rad,r.y,rad,rad,0,0,px(rad),px(rad));
  gr.DrawImage(CORN.bl,r.x,r.y+r.h-rad,rad,rad,0,0,px(rad),px(rad));
  gr.DrawImage(CORN.br,r.x+r.w-rad,r.y+r.h-rad,rad,rad,0,0,px(rad),px(rad));
}
// carve rounded corners over already-drawn square content: blit black corner masks (no clip API)
var CORN=null;
function buildCorners(rad){
  var specs={tl:[0,0],tr:[-rad,0],bl:[0,-rad],br:[-rad,-rad]}, q={}, key;
  for(key in specs){
    var im=dpiImage(rad,rad), g=dpiGraphics(im.GetGraphics()); g.FillSolidRect(0,0,rad,rad,COL.canvas); releaseDpiGraphics(im,g);
    var mk=dpiImage(rad,rad), mg=dpiGraphics(mk.GetGraphics());
    mg.FillSolidRect(0,0,rad,rad,RGB(0,0,0)); mg.SetSmoothingMode(2); mg.FillEllipse(specs[key][0],specs[key][1],rad*2,rad*2,RGB(255,255,255));
    releaseDpiGraphics(mk,mg); im.ApplyMask(mk); q[key]=im;
  }
  return q;
}
// carve only the top corners, where a square gradient/band overrides panelBg's rounding
function roundTop(gr,x,y,w){
  var rad=M.radius; if(!CORN) CORN=buildCorners(rad);
  gr.DrawImage(CORN.tl,x,y,rad,rad,0,0,px(rad),px(rad),0,255);
  gr.DrawImage(CORN.tr,x+w-rad,y,rad,rad,0,0,px(rad),px(rad),0,255);
}

/* ---- modal dialogs: dim backdrop + drop-shadowed rounded panel, and a capsule button ---- */
function modalPanel(gr,cw,ch,cy){
  gr.FillSolidRect(0,0,W,H,RGBA(0,0,0,IS_LIGHT?70:150));
  var cx=Math.round((W-cw)/2);
  gr.FillSolidRect(cx+4,cy+6,cw,ch,COL.shadow);
  gr.FillRoundRect(cx,cy,cw,ch,12,12,COL.modal);
  return cx;
}
var PILL_H=42;
function pillW(gr,label){ return Math.max(140,gr.CalcTextWidth(label,FONT.pl)+48); }
function drawPill(gr,x,y,w,label,primary){
  var hb={x0:x-3,y0:y-3,x1:x+w+3,y1:y+PILL_H+3};
  var g=hv(hb.x0,hb.y0,hb.x1,hb.y1)?2:0;
  var bx=x-g, by=y-g, bw=w+g*2, bh=PILL_H+g*2, rad=bh/2;
  if(primary) gr.FillRoundRect(bx,by,bw,bh,rad,rad,COL.text);
  else strokeRound(gr,bx,by,bw,bh,rad,g?2:1,g?COL.text:COL.text2);
  tC(gr,label,FONT.pl,primary?COL.base:COL.text,bx,by,bw,bh);
  return hb;
}
function dlgBtn(gr,x,y,w,h,label,col,hcol,txt){
  gr.FillRoundRect(x,y,w,h,20,20,hv(x,y,x+w,y+h)?hcol:col);
  tC(gr,label,FONT.pl,txt,x,y,w,h);
  return {x0:x,y0:y,x1:x+w,y1:y+h};
}
function drawToastPill(gr,msg){
  var mw=Math.min(Math.max(220,W-48),Math.round(gr.CalcTextWidth(msg,FONT.pl))+40), mh=36;
  var mx0=Math.round((W-mw)/2), my0=Math.max(TBH+10, (R.barY||H)-mh-14);
  gr.FillSolidRect(mx0+2,my0+3,mw,mh,COL.shadow);
  gr.FillRoundRect(mx0,my0,mw,mh,mh/2,mh/2,COL.modal);
  if(typeof strokeRound==='function') strokeRound(gr,mx0,my0,mw,mh,mh/2,1,COL.line);
  tC(gr,msg,FONT.pl,COL.danger,mx0+16,my0,mw-32,mh);
}
// themed context menu + modal overlays, painted on top of everything
function drawOverlays(gr){
  CTX_HB=[]; CONF_HB=null; RENAME_HB=null; RG_HB=null;
  if(typeof LOVED_HB!=='undefined') LOVED_HB=null;
  if(setupPrompt){ drawSetup(gr); return; }
  if(renameEdit){
    var rw=Math.min(420,W-40), rhh=196, ry0=Math.round((H-rhh)/2), rx0=modalPanel(gr,rw,rhh,ry0);
    tL(gr,renameEdit.title||T('dlg.rename_pl'),FONT.sect,COL.text,rx0+28,ry0+22,rw-56,26);
    var ix=rx0+28, iyf=ry0+64, iw=rw-56, ih=46;
    gr.FillRoundRect(ix,iyf,iw,ih,6,6,COL.field);
    var tw3=gr.CalcTextWidth(renameEdit.text,FONT.pl);
    tL(gr,renameEdit.text,FONT.pl,COL.text,ix+14,iyf,iw-28,ih);
    if(caretOn){ var cxr=ix+14+Math.min(iw-30,tw3)+2; gr.FillSolidRect(cxr,iyf+Math.round((ih-20)/2),2,20,COL.text); }
    var canSave=renameEdit.text.replace(/^\s+|\s+$/g,'').length>0;
    var bw=118, bh=40, by=ry0+rhh-bh-22, dx=rx0+rw-28-bw, ccx=dx-14-bw;
    RENAME_HB={
      panel:{x0:rx0,y0:ry0,x1:rx0+rw,y1:ry0+rhh},
      cancel:dlgBtn(gr,ccx,by,bw,bh,T('btn.cancel'),COL.btn,COL.btnHot,COL.text),
      save:dlgBtn(gr,dx,by,bw,bh,renameEdit.saveLabel||T('btn.save'),canSave?COL.green:COL.greenOff,canSave?COL.greenHot:COL.greenOff,canSave?COL.black:COL.text3),
      canSave:canSave
    };
  }
  if(ctxMenu){
    var ih=40, pad=6, i, it, iw=200;
    for(i=0;i<ctxMenu.items.length;i++){
      if(ctxMenu.items[i].sep) continue;
      iw=Math.max(iw,Math.round(gr.CalcTextWidth(ctxMenu.items[i].label,FONT.pl))+40);
    }
    iw=Math.min(iw,Math.max(140,W-20));
    var sepCnt=0, rowCnt=0;
    for(i=0;i<ctxMenu.items.length;i++){ if(ctxMenu.items[i].sep) sepCnt++; else rowCnt++; }
    var h=pad*2+sepCnt*9+rowCnt*ih;
    var maxH=Math.max(120,H-20);
    if(h>maxH && rowCnt>0){
      ih=Math.max(24,Math.floor((maxH-pad*2-sepCnt*9)/rowCnt));
      h=Math.min(maxH,pad*2+sepCnt*9+rowCnt*ih);
    }
    var mnx=Math.max(10,Math.min(ctxMenu.x,W-iw-10)), mny=Math.max(10,Math.min(ctxMenu.y,H-h-10));
    gr.FillSolidRect(mnx+3,mny+4,iw,h,COL.shadow);
    gr.FillRoundRect(mnx,mny,iw,h,8,8,COL.menu);
    var cy2=mny+pad, botM=mny+h-pad;
    for(i=0;i<ctxMenu.items.length;i++){
      it=ctxMenu.items[i];
      if(it.sep){
        if(cy2+9<=botM) gr.DrawLine(mnx+12,cy2+4,mnx+iw-12,cy2+4,1,COL.line);
        cy2+=9; continue;
      }
      if(cy2+ih>botM) break;
      if(hv(mnx,cy2,mnx+iw,cy2+ih)) gr.FillRoundRect(mnx+4,cy2,iw-8,ih,5,5,IS_LIGHT?RGBA(0,0,0,24):RGBA(255,255,255,24));
      tL(gr,it.label,FONT.pl,it.danger?COL.danger:(it.accent?COL.green:COL.text),mnx+16,cy2,iw-24,ih);
      CTX_HB.push({x0:mnx,y0:cy2,x1:mnx+iw,y1:cy2+ih,act:it.act,item:it});
      cy2+=ih;
    }
  }
  if(confirmDel){
    var isSrvDel=(confirmDel.kind==='nv-pl' && confirmDel.srcId!=='local');
    var cw=Math.min(400,Math.max(240,W-24)), ch=Math.min(184,Math.max(148,H-24)), cy=Math.round((H-ch)/2), cx=modalPanel(gr,cw,ch,cy);
    tL(gr,isSrvDel?T('dlg.del_nv_pl_title'):T('dlg.del_pl_title'),FONT.sect,COL.text,cx+24,cy+22,cw-48,26);
    var delMsg=isSrvDel?T('dlg.del_nv_pl_msg',confirmDel.name):T('dlg.del_pl_msg',confirmDel.name);
    tL(gr,delMsg,FONT.pl,COL.text2,cx+24,cy+54,cw-48,40);
    var cbw=Math.min(118,Math.floor((cw-62)/2)), cbh=38, cby=cy+ch-cbh-20, cdx=cx+cw-24-cbw, cccx=cdx-14-cbw;
    CONF_HB={
      cancel:dlgBtn(gr,cccx,cby,cbw,cbh,T('btn.cancel'),COL.btn,COL.btnHot,COL.text),
      del:dlgBtn(gr,cdx,cby,cbw,cbh,T('btn.delete'),RGB(224,72,72),RGB(240,96,96),COL.white)
    };
  }
  if(dupPrompt) drawDupPrompt(gr);
  if(rgPrompt) drawRgPrompt(gr);
  if(typeof lovedPrompt!=='undefined' && lovedPrompt && typeof drawLovedPrompt==='function') drawLovedPrompt(gr);
  if(typeof lovedToast==='string' && lovedToast) drawToastPill(gr,lovedToast);
}
// wrapped paragraph; returns the y just past the last line drawn
function tPara(gr,s,f,c,x,y,w,lh){
  var wr=gr.EstimateLineWrap(s,f,w);
  for(var i=0;i<wr.length;i+=2){ tL(gr,wr[i],f,c,x,y,w,lh); y+=lh; }
  return y;
}

function winMaxed(){
  if(VerdantChrome && chromeAttached){ try{ return VerdantChrome.WindowState===1; }catch(e){} }
  if(!UIWizard) return false;
  try{ return UIWizard.WindowState===1; }catch(e){ return false; }
}
function winToggleMaximize(){
  if(VerdantChrome && chromeAttached){ try{ VerdantChrome.ToggleMaximize(); return; }catch(e){} }
  if(UIWizard){ try{ UIWizard.ToggleMaximize(); }catch(e){} }
}
function winMinimize(){
  if(VerdantChrome && chromeAttached){ try{ VerdantChrome.WindowMinimize(); return; }catch(e){} }
  if(UIWizard){ try{ UIWizard.WindowMinimize(); }catch(e){} }
}
function winExit(){
  chromeExitRequested=true;
  try{ fb.Exit(); }catch(e){ chromeExitRequested=false; throw e; }
}
function winExitMaximize(){
  if(VerdantChrome && chromeAttached){ try{ VerdantChrome.ExitMaximize(); return; }catch(e){} }
  if(UIWizard){ try{ if(UIWizard.WindowState===1) UIWizard.ToggleMaximize(); }catch(e){} }
}
var _workAreaCache=null;
function getScreenWorkArea(){
  if(_workAreaCache) return _workAreaCache;
  var x=0, y=0, w=0, h=0;
  try{
    var hf=new ActiveXObject('htmlfile');
    var scr=hf&&hf.parentWindow&&hf.parentWindow.screen;
    if(scr && scr.availWidth>0 && scr.availHeight>0){
      w=Math.round(scr.availWidth); h=Math.round(scr.availHeight);
      if(typeof scr.availLeft==='number') x=Math.round(scr.availLeft);
      if(typeof scr.availTop==='number') y=Math.round(scr.availTop);
    }
  }catch(e){}
  if((!w || !h) && UIWizard){
    try{
      var m=/(\d+)\D+(\d+)/.exec(String(UIWizard.DisplayResolution||''));
      if(m){ w=Number(m[1]); h=Math.max(200,Number(m[2])-Math.round(48*UISCALE)); }
    }catch(e){}
  }
  if(!w || !h){ w=Math.max(640,px(W)); h=Math.max(480,px(H)); }
  _workAreaCache={x:x,y:y,w:w,h:h};
  return _workAreaCache;
}
var SNAP_PRESETS={
  'snap:h-l':[0,0,0.5,1],   'snap:h-r':[0.5,0,0.5,1],
  'snap:t-l':[0,0,1/3,1],   'snap:t-m':[1/3,0,1/3,1], 'snap:t-r':[2/3,0,1/3,1],
  'snap:q-tl':[0,0,0.5,0.5],'snap:q-tr':[0.5,0,0.5,0.5],
  'snap:q-bl':[0,0.5,0.5,0.5],'snap:q-br':[0.5,0.5,0.5,0.5]
};
function applySnapPreset(act){
  if(!chromeAttached && !UIWizard) return;
  if(act==='snap:max'){ winToggleMaximize(); return; }
  if(!UIWizard) return;
  var spec=SNAP_PRESETS[act]; if(!spec) return;
  _workAreaCache=null;
  var wa=getScreenWorkArea();
  var wx=wa.x+Math.round(wa.w*spec[0]), wy=wa.y+Math.round(wa.h*spec[1]);
  var ww=Math.max(px(WIN_MIN_W),Math.round(wa.w*(spec[0]+spec[2]))-(wx-wa.x));
  var wh=Math.max(px(WIN_MIN_H),Math.round(wa.h*(spec[1]+spec[3]))-(wy-wa.y));
  winExitMaximize();
  try{ UIWizard.SetWindowPosition(wx,wy); }catch(e){}
  try{ UIWizard.SetWindowSize(ww,wh); }catch(e){}
}
function openSnapMenu(x,y){
  if(!chromeAttached && !UIWizard) return;
  var items=[
    {label:T('snap.half_left'),act:'snap:h-l'},
    {label:T('snap.half_right'),act:'snap:h-r'},
    {sep:true},
    {label:T('snap.third_left'),act:'snap:t-l'},
    {label:T('snap.third_mid'),act:'snap:t-m'},
    {label:T('snap.third_right'),act:'snap:t-r'},
    {sep:true},
    {label:T('snap.q_tl'),act:'snap:q-tl'},
    {label:T('snap.q_tr'),act:'snap:q-tr'},
    {label:T('snap.q_bl'),act:'snap:q-bl'},
    {label:T('snap.q_br'),act:'snap:q-br'},
    {sep:true},
    {label:T('snap.maximize'),act:'snap:max',accent:true}
  ];
  ctxMenu={kind:'snap', x:x, y:y, items:items};
  repaintAll();
}
function drawCapBtn(gr,glyph,x,w,isClose,hot){
  var hover=(typeof hot==='boolean')?hot:hv(x,0,x+w,TBH);
  if(hover) gr.FillSolidRect(x,0,w,TBH,isClose?RGB(232,17,35):COL.capHover);
  tC(gr,glyph,FONT.cap,hover?(isClose?COL.white:COL.text):COL.text2,x,0,w,TBH);
}
function drawTitleBar(gr){
  if(TBH<=0){ HB_MENU=[]; HB_CAP=null; HB_NAVDRAWER=null; return; }
  gr.FillSolidRect(0,0,W,TBH,COL.canvas);
  HB_NAVDRAWER=null; HB_MENU=[];
  var closeX=W-CAPBW, maxX=W-CAPBW*2, minX=W-CAPBW*3;
  var hasWinCtrl=!!(chromeAttached || UIWizard);
  var showSnap=!!(!chromeAttached && UIWizard && W>=340);
  var snapX=showSnap?(minX-SNAPBW):minX;
  var capLeft=hasWinCtrl?snapX:W;
  var mx0=8;
  if(R.navDrawer){
    var nhot=navDrawerOpen||hv(mx0,2,mx0+30,TBH-2);
    if(nhot) gr.FillRoundRect(mx0,3,30,TBH-6,6,6,navDrawerOpen?COL.rowActive:COL.menuHover);
    drawIcon(gr,'sidebar',navDrawerOpen?COL.green:(nhot?COL.text:COL.text2),mx0,0,30,TBH,15);
    HB_NAVDRAWER={x0:mx0,y0:0,x1:mx0+30,y1:TBH};
    mx0+=34;
  } else {
    mx0=12;
  }
  var totalMenuW=0, mi;
  for(mi=0;mi<MENUS.length;mi++) totalMenuW+=gr.CalcTextWidth(MENUS[mi][0],FONT.menu)+24;
  if(mx0+totalMenuW<=capLeft-8){
    for(mi=0;mi<MENUS.length;mi++){
      var lbl=MENUS[mi][0], mw=gr.CalcTextWidth(lbl,FONT.menu)+24, mhover=hv(mx0,0,mx0+mw,TBH);
      if(mhover) gr.FillSolidRect(mx0,0,mw,TBH,COL.menuHover);
      tC(gr,lbl,FONT.menu,mhover?COL.text:COL.text2,mx0,0,mw,TBH);
      HB_MENU.push({x0:mx0,y0:0,x1:mx0+mw,y1:TBH,root:MENUS[mi][1],mx:mx0});
      mx0+=mw;
    }
  } else {
    var clbl=T('menu.more'), cmw=Math.min(Math.max(44,capLeft-mx0-8),gr.CalcTextWidth(clbl,FONT.menu)+24);
    if(cmw>=32){
      var chov=hv(mx0,0,mx0+cmw,TBH);
      if(chov) gr.FillSolidRect(mx0,0,cmw,TBH,COL.menuHover);
      tC(gr,clbl,FONT.menu,chov?COL.text:COL.text2,mx0,0,cmw,TBH);
      HB_MENU.push({x0:mx0,y0:0,x1:mx0+cmw,y1:TBH,root:'compact',mx:mx0});
      mx0+=cmw;
    }
  }
  if(mx0!==MENU_END || capLeft!==CAP_LEFT){ MENU_END=mx0; CAP_LEFT=capLeft; applyCaption(); }
  if(showSnap){
    var shot=hv(snapX,0,snapX+SNAPBW,TBH);
    if(shot) gr.FillSolidRect(snapX,0,SNAPBW,TBH,COL.capHover);
    drawIcon(gr,'snap',shot?COL.text:COL.text2,snapX,0,SNAPBW,TBH,13);
  }
  drawCapBtn(gr,GLYPH.cmin,minX,CAPBW,false);
  drawCapBtn(gr,winMaxed()?GLYPH.crestore:GLYPH.cmax,maxX,CAPBW,false,chromeAttached?chromeMaxHot:null);
  drawCapBtn(gr,GLYPH.cclose,closeX,CAPBW,true);
  HB_CAP={snapX:snapX,minX:minX,maxX:maxX,closeX:closeX,bw:CAPBW,hasSnap:showSnap};
}

/* ---- Header dropdowns: a pill that opens a floating menu. Shared by the playlist sort-by and
   the All Songs group-by; items are [label,value] pairs and the menu is drawn last so it
   floats over the track list. ---- */
function drawDropPill(gr,x,y,w,h,label,open){
  var hot=open||hv(x,y,x+w,y+h);
  gr.FillRoundRect(x,y,w,h,h/2,h/2,hot?COL.pillHot:COL.pill);
  strokeRound(gr,x,y,w,h,h/2,1,hot?COL.text2:COL.line);
  tL(gr,label,FONT.pl,COL.text,x+18,y,w-46,h);
  drawIcon(gr,'chevron',hot?COL.text:COL.text2,x+w-32,y+(h-20)/2,20,20,18);
  return {x0:x,y0:y,x1:x+w,y1:y+h};
}
function drawDropMenu(gr,anchor,items,cur,minW){
  var out=[];
  if(!anchor) return out;
  var bw=Math.max(minW,anchor.x1-anchor.x0), ih=40, bx=anchor.x1-bw, iy=anchor.y1+6, bh=items.length*ih+10;
  gr.FillSolidRect(bx+3,iy+4,bw,bh,COL.shadow);
  gr.FillRoundRect(bx,iy,bw,bh,8,8,COL.menu);
  for(var i=0;i<items.length;i++){
    var ry=iy+5+i*ih;
    if(hv(bx,ry,bx+bw,ry+ih)) gr.FillRoundRect(bx+4,ry,bw-8,ih,5,5,IS_LIGHT?RGBA(0,0,0,24):RGBA(255,255,255,24));
    tL(gr,items[i][0],FONT.pl,(items[i][1]===cur)?COL.green:COL.text,bx+18,ry,bw-30,ih);
    out.push({x0:bx,y0:ry,x1:bx+bw,y1:ry+ih,v:items[i][1]});
  }
  return out;
}

function drawGroupMenu(gr){ SG_HB=sgMenuOpen?drawDropMenu(gr,HB_SG,SONGS_GROUPS,songsGroup,216):[]; }
