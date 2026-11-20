/* verdant/ui/chrome.js -- window chrome + shared widgets: title bar, scrollbars, panels, overlays, menus
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

/* Custom window title bar via UI Wizard (foo_ui_wizard) - frameless + our own controls */
var TBH=32,CAPBW=46;
var UIWizard=null; try{ UIWizard=new ActiveXObject('UIWizard'); }catch(e){ UIWizard=null; }
var MENUS=[['File','file'],['Library','library'],['Help','help']];
var MENU_END=0, capW=-1, capEnd=-1;
function applyCaption(){ if(!UIWizard) return; var state=W+'|'+!!fsMode+'|'+UISCALE;if(capW===state&&capEnd===MENU_END)return;capW=state;capEnd=MENU_END;try{ UIWizard.SetCaptionAreaSize(px(MENU_END),0,px(Math.max(0,W-CAPBW*3-MENU_END)),fsMode?0:px(TBH)); }catch(e){} }
function openMenu(root,x,y){ try{ var mm=fb.CreateMainMenuManager(); mm.Init(root); var m=window.CreatePopupMenu(); mm.BuildMenu(m,1,600); var id=m.TrackPopupMenu(px(x),px(y)); if(id>0) mm.ExecuteByID(id-1); }catch(e){} }

// small hover "..." button; records a hit target in out (or HB_DOTS) that opens the menu just below it
function drawDots(gr,cx,cy,pl,out){
  if(hv(cx,cy,cx+24,cy+24)) gr.FillEllipse(cx,cy,24,24,OV(IS_LIGHT?36:26));
  drawIcon(gr,'more',COL.text,cx,cy,24,24,18);
  (out||HB_DOTS).push({x0:cx-2,y0:cy-2,x1:cx+26,y1:cy+26,pl:pl,mx:cx,my:cy+26});
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
  if(view==='playlist') firstRow=firstRowT=px;
  else if(view==='home') homeScroll=homeScrollT=px;
  else if(view==='songs') songsScroll=songsScrollT=px;
  else if(view==='search') searchScroll=searchScrollT=px;
  else if(view==='navidrome' && typeof nvScroll!=='undefined'){ nvScroll=nvScrollT=px; }
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
  if(view==='navidrome' && typeof nvShelfScroll!=='undefined'){ nvShelfScroll=nvShelfScrollT=px; }
  else { plScroll=plScrollT=px; }
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
function dlgBtn(gr,x,y,w,h,label,col,hcol,txt){
  gr.FillRoundRect(x,y,w,h,20,20,hv(x,y,x+w,y+h)?hcol:col);
  tC(gr,label,FONT.pl,txt,x,y,w,h);
  return {x0:x,y0:y,x1:x+w,y1:y+h};
}
// themed context menu + modal overlays, painted on top of everything
function drawOverlays(gr){
  CTX_HB=[]; CONF_HB=null; RENAME_HB=null; RG_HB=null;
  if(renameEdit){
    var rw=Math.min(420,W-40), rhh=196, ry0=Math.round((H-rhh)/2), rx0=modalPanel(gr,rw,rhh,ry0);
    tL(gr,renameEdit.title||'Rename playlist',FONT.sect,COL.text,rx0+28,ry0+22,rw-56,26);
    var ix=rx0+28, iyf=ry0+64, iw=rw-56, ih=46;
    gr.FillRoundRect(ix,iyf,iw,ih,6,6,COL.field);
    var tw3=gr.CalcTextWidth(renameEdit.text,FONT.pl);
    tL(gr,renameEdit.text,FONT.pl,COL.text,ix+14,iyf,iw-28,ih);
    if(caretOn){ var cxr=ix+14+Math.min(iw-30,tw3)+2; gr.FillSolidRect(cxr,iyf+Math.round((ih-20)/2),2,20,COL.text); }
    var canSave=renameEdit.text.replace(/^\s+|\s+$/g,'').length>0;
    var bw=118, bh=40, by=ry0+rhh-bh-22, dx=rx0+rw-28-bw, ccx=dx-14-bw;
    RENAME_HB={
      panel:{x0:rx0,y0:ry0,x1:rx0+rw,y1:ry0+rhh},
      cancel:dlgBtn(gr,ccx,by,bw,bh,'Cancel',COL.btn,COL.btnHot,COL.text),
      save:dlgBtn(gr,dx,by,bw,bh,renameEdit.saveLabel||'Save',canSave?COL.green:COL.greenOff,canSave?COL.greenHot:COL.greenOff,canSave?COL.black:COL.text3),
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
    var h=pad*2;
    for(i=0;i<ctxMenu.items.length;i++) h+=ctxMenu.items[i].sep?9:ih;
    var maxH=Math.max(120,H-20);
    if(h>maxH) h=maxH;
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
    var cw=400, ch=184, cy=Math.round((H-ch)/2), cx=modalPanel(gr,cw,ch,cy);
    tL(gr,confirmDel.kind==='nv-pl'?'\u5220\u9664 Navidrome \u6b4c\u5355\uff1f':'Delete playlist?',FONT.sect,COL.text,cx+28,cy+24,cw-56,26);
    var delMsg=confirmDel.kind==='nv-pl'?('\u8fd9\u5c06\u4ece\u670d\u52a1\u5668\u6c38\u4e45\u5220\u9664\u6b4c\u5355 "'+confirmDel.name+'"\u3002'):('This removes "'+confirmDel.name+'" from your library.');
    tL(gr,delMsg,FONT.pl,COL.text2,cx+28,cy+58,cw-56,42);
    var cbw=118, cbh=40, cby=cy+ch-cbh-22, cdx=cx+cw-28-cbw, cccx=cdx-14-cbw;
    CONF_HB={
      cancel:dlgBtn(gr,cccx,cby,cbw,cbh,'Cancel',COL.btn,COL.btnHot,COL.text),
      del:dlgBtn(gr,cdx,cby,cbw,cbh,'Delete',RGB(224,72,72),RGB(240,96,96),COL.white)
    };
  }
  if(dupPrompt) drawDupPrompt(gr);
  if(rgPrompt) drawRgPrompt(gr);
}
// wrapped paragraph; returns the y just past the last line drawn
function tPara(gr,s,f,c,x,y,w,lh){
  var wr=gr.EstimateLineWrap(s,f,w);
  for(var i=0;i<wr.length;i+=2){ tL(gr,wr[i],f,c,x,y,w,lh); y+=lh; }
  return y;
}

function winMaxed(){ if(!UIWizard) return false; try{ return UIWizard.WindowState===1; }catch(e){ return false; } }
function drawCapBtn(gr,glyph,x,w,isClose){
  var hover=hv(x,0,x+w,TBH);
  if(hover) gr.FillSolidRect(x,0,w,TBH,isClose?RGB(232,17,35):COL.capHover);
  tC(gr,glyph,FONT.cap,hover?(isClose?COL.white:COL.text):COL.text2,x,0,w,TBH);
}
function drawTitleBar(gr){
  gr.FillSolidRect(0,0,W,TBH,COL.canvas);
  // menu bar (left): real foobar File / Edit / View / Playback / Library / Help
  HB_MENU=[]; var mx0=12;
  for(var mi=0;mi<MENUS.length;mi++){
    var lbl=MENUS[mi][0], mw=gr.CalcTextWidth(lbl,FONT.menu)+24, mhover=hv(mx0,0,mx0+mw,TBH);
    if(mhover) gr.FillSolidRect(mx0,0,mw,TBH,COL.menuHover);
    tC(gr,lbl,FONT.menu,mhover?COL.text:COL.text2,mx0,0,mw,TBH);
    HB_MENU.push({x0:mx0,y0:0,x1:mx0+mw,y1:TBH,root:MENUS[mi][1],mx:mx0});
    mx0+=mw;
  }
  if(mx0!==MENU_END){ MENU_END=mx0; applyCaption(); }
  // window controls (right)
  var closeX=W-CAPBW, maxX=W-CAPBW*2, minX=W-CAPBW*3;
  drawCapBtn(gr,GLYPH.cmin,minX,CAPBW,false);
  drawCapBtn(gr,winMaxed()?GLYPH.crestore:GLYPH.cmax,maxX,CAPBW,false);
  drawCapBtn(gr,GLYPH.cclose,closeX,CAPBW,true);
  HB_CAP={minX:minX,maxX:maxX,closeX:closeX,bw:CAPBW};
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

function drawSortDirBtn(gr,x,y,w,h){
  var hot=hv(x,y,x+w,y+h);
  gr.FillRoundRect(x,y,w,h,h/2,h/2,hot?COL.pillHot:COL.pill);
  strokeRound(gr,x,y,w,h,h/2,1,hot?COL.text2:COL.line);
  drawIcon(gr,plSortDir==='asc'?'sortAsc':'sortDesc',COL.text,x,y,w,h,18);
  HB_PLSORTDIR={x0:x,y0:y,x1:x+w,y1:y+h};
}
function drawSortMenu(gr){ PL_SORT_HB=plSortMenuOpen?drawDropMenu(gr,HB_PLSORT,PL_SORTS,plSort,180):[]; }
function drawGroupMenu(gr){ SG_HB=sgMenuOpen?drawDropMenu(gr,HB_SG,SONGS_GROUPS,songsGroup,216):[]; }
