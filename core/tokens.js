/* verdant/core/tokens.js -- design tokens: colours, metrics, fonts, glyphs, text + icon drawing
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

/* ------------------------- colour helpers ------------------------- */
function RGB(r,g,b){ return (0xff000000|(r<<16)|(g<<8)|b); }
function RGBA(r,g,b,a){ return ((a<<24)|(r<<16)|(g<<8)|b); }

/* ------------------------- tokens -------------------------
   The two knobs worth touching are UISCALE (a panel property now -- see core/props.js) and
   M.navW / M.queueW (sidebar and queue-pane widths). Everything else is derived layout. */
/* Light/dark palettes. COL is filled from one of these by applyTheme() and mutated IN PLACE, so
   every draw call that reads COL.xxx at paint time picks up a mode switch on the next repaint.
   black / white are constant inks (text on the green and red buttons) and never change; canvas is
   the backdrop the panels sit on, which used to be black and is what actually flips. */
var THEME_DARK = {
  black:RGB(0,0,0), white:RGB(255,255,255), canvas:RGB(0,0,0),
  base:RGB(18,18,18), elev:RGB(24,24,24), hover:RGB(42,42,42),
  text:RGB(255,255,255), text2:RGB(179,179,179), text3:RGB(106,106,106),
  green:RGB(30,215,96), greenC:RGB(29,185,84), greenHot:RGB(45,215,110), greenOff:RGB(60,92,74),
  rowHover:RGBA(255,255,255,18), rowActive:RGBA(255,255,255,38),
  line:RGBA(255,255,255,28), seekbg:RGB(77,77,77),
  cardHov:RGB(40,40,40), menu:RGB(43,43,43), modal:RGB(42,42,42), field:RGB(62,62,62),
  btn:RGB(52,52,52), btnHot:RGB(66,66,66), pill:RGBA(0,0,0,90), pillHot:RGBA(255,255,255,44),
  capHover:RGB(48,48,48), menuHover:RGB(40,40,40), skel:RGB(34,34,34), skel2:RGB(30,30,30),
  searchBox:RGB(42,42,42), banner:RGB(34,34,34), danger:RGB(240,96,96), shadow:RGBA(0,0,0,120)
};
var THEME_LIGHT = {
  black:RGB(0,0,0), white:RGB(255,255,255), canvas:RGB(232,232,236),
  base:RGB(255,255,255), elev:RGB(244,244,246), hover:RGB(228,228,232),
  text:RGB(20,20,22), text2:RGB(92,92,98), text3:RGB(150,150,156),
  green:RGB(24,168,76), greenC:RGB(29,185,84), greenHot:RGB(30,190,90), greenOff:RGB(176,214,190),
  rowHover:RGBA(0,0,0,22), rowActive:RGBA(0,0,0,38),
  line:RGBA(0,0,0,26), seekbg:RGB(208,208,212),
  cardHov:RGB(228,229,235), menu:RGB(255,255,255), modal:RGB(255,255,255), field:RGB(238,238,242),
  btn:RGB(232,232,236), btnHot:RGB(218,218,224), pill:RGBA(0,0,0,18), pillHot:RGBA(0,0,0,44),
  capHover:RGB(208,208,214), menuHover:RGB(208,208,214), skel:RGB(236,236,240), skel2:RGB(240,240,243),
  searchBox:RGB(238,238,242), banner:RGB(244,244,246), danger:RGB(208,48,48), shadow:RGBA(0,0,0,40)
};
var COL = {}, IS_LIGHT = false;
function setPalette(light){ var src=light?THEME_LIGHT:THEME_DARK; for(var k in src) COL[k]=src[k]; IS_LIGHT=!!light; }
/* THEME_MODE comes from core/props.js: 0 follows Columns UI (which follows Windows when its mode
   is "Follow system"), 1 forces dark, 2 forces light. window.IsDark is missing on older JSplitter
   builds; treat that as dark, which is how the theme always looked. */
function themeWantsLight(){
  if(THEME_MODE===1) return false;
  if(THEME_MODE===2) return true;
  try{ return window.IsDark===false; }catch(e){ return false; }
}
setPalette(themeWantsLight());
// foreground overlay: white wash on dark, (slightly lighter) black wash on light
function OV(a){ return IS_LIGHT?RGBA(0,0,0,Math.round(a*0.7)):RGBA(255,255,255,a); }
// header gradient strength: how far the album colour is mixed toward the panel base
function headMix(t){ return IS_LIGHT?Math.max(t,0.72):t; }
var M = { pad:8, gap:8, navW:230, queueW:400, barH:96, navTopH:176, rowH:56, radius:10, cpad:24, headH:280, artSz:200 };   // navW/queueW: sidebar + queue widths
var PALETTE=[RGB(83,62,140),RGB(30,120,110),RGB(150,64,92),RGB(43,92,160),RGB(120,92,44),RGB(58,120,64),RGB(140,80,120),RGB(52,100,150),RGB(96,72,52),RGB(70,70,96)];

/* ------------------------- fonts (create once) -------------------------
   Resolve a CJK-complete UI font stack via utils.CheckFont (overridable via Panel
   Properties: 'auto', 'cui', or a font family name) and map 3 semantic weights
   (reg / med / bold) onto true installed weight subfamilies so Latin and CJK glyphs
   share weights and avoid GDI synthetic bolding. */
var UI_FONT_STACK=['HarmonyOS Sans SC','Noto Sans SC','Source Han Sans SC','Source Han Sans SC VF','PingFang SC','Microsoft YaHei UI','Segoe UI'];
var ICON_FONT='Segoe MDL2 Assets';
var FONT_SPEC=null;
function hasFont(name){
  if(!name) return false;
  try{ return !!(typeof utils!=='undefined' && utils && typeof utils.CheckFont==='function' && utils.CheckFont(name)); }
  catch(e){ return false; }
}
function findInstalledFamily(name){
  if(!name) return '';
  if(hasFont(name)) return name;
  if(!/\s+Regular$/i.test(name) && hasFont(name+' Regular')) return name+' Regular';
  return '';
}
function cuiFontFamily(){
  try{
    if(typeof window!=='undefined' && window && typeof window.GetFontCUI==='function'){
      var f=window.GetFontCUI(0);
      if(f && f.Name){
        var found=findInstalledFamily(f.Name);
        if(found) return found;
        return (typeof utils!=='undefined' && utils && typeof utils.CheckFont==='function')?'':f.Name;
      }
    }
  }catch(e){}
  return '';
}
function probeUiBase(){
  if(typeof utils==='undefined' || !utils || typeof utils.CheckFont!=='function') return 'Microsoft YaHei UI';
  for(var i=0;i<UI_FONT_STACK.length;i++){
    var found=findInstalledFamily(UI_FONT_STACK[i]);
    if(found) return found;
  }
  return 'Segoe UI';
}
function resolveFontBase(pref,matchSpec){
  var raw=(pref||'').trim(), low=raw.toLowerCase();
  if(!low || low==='auto') return matchSpec?matchSpec.base:probeUiBase();
  if(low==='cui') return cuiFontFamily()||(matchSpec?matchSpec.base:probeUiBase());
  var custom=findInstalledFamily(raw);
  if(custom) return custom;
  return matchSpec?matchSpec.base:probeUiBase();
}
function buildFontWeights(base){
  var stem=base.replace(/\s+Regular$/i,'');
  var reg={name:base,style:0}, med=null;
  var medCands=[stem+' Medium',stem+' Semibold',stem+' DemiBold'];
  for(var i=0;i<medCands.length;i++){
    if(hasFont(medCands[i])){ med={name:medCands[i],style:0}; break; }
  }
  var bold=hasFont(stem+' Bold')?{name:stem+' Bold',style:0}:{name:base,style:1};
  return {base:base,regular:reg,medium:med||reg,bold:bold};
}
function fontFace(spec,w){
  if(w==='bold'||w===true) return spec.bold;
  if(w==='med') return spec.medium;
  return spec.regular;
}
function gf(name,sz,style){ return gdi.Font(name, Math.max(1,Math.round(sz*UISCALE)), style||0); }
function fw(spec,sz,w){ var d=fontFace(spec,w); return gf(d.name,sz,d.style); }
function F(sz,bold){
  var ui=(FONT_SPEC&&FONT_SPEC.ui)?FONT_SPEC.ui:buildFontWeights(probeUiBase());
  return fw(ui,sz,bold?'bold':'reg');
}
function makeThemeFonts(){
  var uiPref=typeof propStr==='function'?propStr(UI_FONT_PROP,'auto'):'auto';
  var lyPref=typeof propStr==='function'?propStr(LYRIC_FONT_PROP,'auto'):'auto';
  var ui=buildFontWeights(resolveFontBase(uiPref,null));
  var lyLow=lyPref.toLowerCase();
  var ly=(!lyLow||lyLow==='auto')?ui:buildFontWeights(resolveFontBase(lyPref,ui));
  FONT_SPEC={ui:ui,lyric:ly};
  function uiF(sz,w){ return fw(ui,sz,w); }
  function lyF(sz,w){ return fw(ly,sz,w); }
  return {
    lib:uiF(15,'bold'), pl:uiF(13,'bold'), plSub:uiF(11,'reg'),
    eyebrow:uiF(11,'bold'), title:uiF(52,'bold'), meta:uiF(13,'reg'),
    rowTitle:uiF(14,'med'), rowArtist:uiF(12,'reg'), rowNum:uiF(13,'reg'), rowCell:uiF(13,'reg'), head:uiF(12,'bold'),
    tab:uiF(16,'bold'), sect:uiF(15,'bold'), qName:uiF(13,'med'), qArtist:uiF(11,'reg'),
    npTitle:uiF(15,'med'), npArtist:uiF(12,'reg'), time:uiF(12,'reg'),
    icon:gf(ICON_FONT,15), iconBtn:gf(ICON_FONT,18),
    navIco:gf(ICON_FONT,24), cap:gf(ICON_FONT,10),
    menu:uiF(12,'reg'), card:uiF(14,'bold'), sect2:uiF(22,'bold'),
    searchTxt:uiF(16,'med'),
    lyric:lyF(18,'bold'), fsLyric:lyF(30,'bold'),
    qLyric:lyF(15,'bold'), qLyricStatic:lyF(13,'reg'),
    fsSrc:uiF(13,'reg'),
    fsSrcName:uiF(13,'bold')   // bold: the playlist name, vs. the plain-weight fixed caption
  };
}
function refreshFonts(){
  FONT=makeThemeFonts(); LH_F=[]; LH_V=[];
  if(typeof fsFonts!=='undefined') fsFonts={};
  if(typeof invalidateFsMetrics==='function') invalidateFsMetrics();
  return FONT;
}
var FONT=makeThemeFonts();
function chr(c){ return String.fromCharCode(c); }
// MDL2 fallbacks for drawIcon when gdi.LoadSVG is unavailable (keys mirror ICONS), plus caption buttons
var GLYPH = {
  play:chr(0xE768), pause:chr(0xE769), prev:chr(0xE892), next:chr(0xE893),
  shuffle:chr(0xE8B1), repeat:chr(0xE8EE), repeat1:chr(0xE8ED), volume:chr(0xE767),
  search:chr(0xE721), home:chr(0xE80F), add:chr(0xE710), more:chr(0xE712), clock:chr(0xE823),
  heart:chr(0xEB52), heartO:chr(0xEB51), album:chr(0xE93C), artist:chr(0xE77B),
  refresh:chr(0xE72C), back:chr(0xE72B), settings:chr(0xE713),
  sidebar:chr(0xE700), snap:chr(0xE8A9),
  cmin:chr(0xE921), cmax:chr(0xE922), crestore:chr(0xE923), cclose:chr(0xE8BB)
};
var CH_DOT=chr(0xB7), CH_BULL=chr(0x2022);

/* ------------------------- DrawText flags ------------------------- */
var DT_L = 0x4|0x20|0x800|0x8000;        // left + vcenter + singleline + noprefix + end-ellipsis
var DT_R = 0x2|0x4|0x20|0x800;           // right + vcenter + singleline + noprefix
var DT_C = 0x1|0x4|0x20|0x800;           // center + vcenter + singleline + noprefix
var DT_L_CLIP = 0x4|0x20|0x800;          // left + vcenter + singleline + noprefix (hard clip, no ellipsis)
var DT_L_TOP  = 0x20|0x800|0x8000;       // left + top + singleline + noprefix + end-ellipsis
var DT_C_TOP  = 0x1|0x20|0x800|0x8000;   // center + top + singleline + noprefix + end-ellipsis
/* Labels are singleline+vcenter, which CLIPS to the rect: call sites pass hardcoded box heights
   while fonts scale with UISCALE, so descenders get sliced off. fitV() grows a too-short box
   symmetrically to the line height (identity-cached per font). */
var LH_F=[], LH_V=[];
function lineH(gr,f){
  for(var i=0;i<LH_F.length;i++) if(LH_F[i]===f) return LH_V[i];
  var n=0; try{ n=Math.ceil(gr.CalcTextHeight(LANG_METRIC_TEXT,f)); }catch(e){ n=0; }
  LH_F.push(f); LH_V.push(n); return n;
}
var fitY=0, fitH=0;
function fitV(gr,f,y,h){ var n=lineH(gr,f); if(n>h){ fitY=y-((n-h)>>1); fitH=n; } else { fitY=y; fitH=h; } }
function tL(gr,s,f,c,x,y,w,h){ fitV(gr,f,y,h); gr.GdiDrawText(s,f,c,x,fitY,w,fitH,DT_L); }
function tR(gr,s,f,c,x,y,w,h){ fitV(gr,f,y,h); gr.GdiDrawText(s,f,c,x,fitY,w,fitH,DT_R); }
function tC(gr,s,f,c,x,y,w,h){ fitV(gr,f,y,h); gr.GdiDrawText(s,f,c,x,fitY,w,fitH,DT_C); }
function tCE(gr,s,f,c,x,y,w,h){ fitV(gr,f,y,h); gr.GdiDrawText(s,f,c,x,fitY,w,fitH,DT_C|0x8000); }   // centered, ellipsized
function tCard(gr,s,f,col,tx,ty,tw,th,centered,clipL,clipR,clipT,clipB){
  var txt=(s===null||s===undefined)?'':String(s);
  if(!txt || tw<=0 || th<=0) return;
  if(clipL!==undefined && tx+tw<=clipL) return;
  if(clipR!==undefined && tx>=clipR) return;
  fitV(gr,f,ty,th);
  var fy=fitY, fh=fitH, lh=lineH(gr,f)||fh;
  var gy=fy+((fh-lh)>>1);
  if(clipT!==undefined && fy+fh<=clipT) return;
  if(clipB!==undefined && gy>=clipB) return;
  var rightClip=(clipR!==undefined && tx+tw>clipR);
  var botClip=(clipB!==undefined && fy+fh>clipB);
  var drawW=rightClip?Math.min(tw,clipR-tx):tw;
  if(drawW<=0) return;
  var flags;
  if(centered) flags=botClip?(rightClip?(DT_C_TOP&~0x8000):DT_C_TOP):(rightClip?DT_C:(DT_C|0x8000));
  else flags=botClip?(rightClip?(DT_L_TOP&~0x8000):DT_L_TOP):(rightClip?DT_L_CLIP:DT_L);
  gr.GdiDrawText(txt,f,col,tx,botClip?gy:fy,drawW,botClip?(clipB-gy):fh,flags);
}
var SF_L = 0x01301000;   // Near, VCenter, EllipsisCharacter, NoWrap
var SF_C = 0x11301000;   // Center, VCenter, EllipsisCharacter, NoWrap
function tBmp(gr,s,f,c,x,y,w,h,sf){
  var txt=(s===null||s===undefined)?'':String(s);
  if(!txt || w<=0 || h<=0) return;
  fitV(gr,f,y,h);
  gr.SetTextRenderingHint(4);   // AntiAlias grayscale avoids ClearType color fringes on offscreen bitmaps
  try{ gr.DrawString(txt,f,c,x,fitY,w,fitH,sf); }
  finally{ gr.SetTextRenderingHint(0); }
}
function tBmpL(gr,s,f,c,x,y,w,h){ tBmp(gr,s,f,c,x,y,w,h,SF_L); }
function tBmpC(gr,s,f,c,x,y,w,h){ tBmp(gr,s,f,c,x,y,w,h,SF_C); }
var cardTextScratch=null;
function disposeCardTextScratch(){
  if(cardTextScratch){ try{ cardTextScratch.Dispose(); }catch(e){} cardTextScratch=null; }
}
function drawCardTextLeftClipped(gr,x,y,w,title,sub,isArtist,hov,titleW,subW,x0,x1,y0,y1){
  var cs=w-24, stripY=y+cs+14, stripH=48;
  var sx0=Math.max(x0,x+8), sx1=Math.min(x1,x+w-8), sy0=Math.max(y0,stripY), sy1=Math.min(y1,stripY+stripH);
  if(sx1<=sx0 || sy1<=sy0) return;
  var pw=Math.max(1,px(w)), ph=Math.max(1,px(stripH));
  if(!cardTextScratch || cardTextScratch.Width!==pw || cardTextScratch.Height!==ph){
    disposeCardTextScratch();
    cardTextScratch=dpiImage(w,stripH);
  }
  var g=dpiGraphics(cardTextScratch.GetGraphics());
  g.FillSolidRect(0,0,w,stripH,hov?COL.cardHov:COL.elev);
  var tCol=hov?COL.green:COL.text, sCol=hov?COL.text:COL.text2;
  if(isArtist){
    tBmpC(g,title,FONT.card,tCol,12,4,cs,20);
    tBmpC(g,sub,FONT.plSub,sCol,12,26,cs,16);
  }else{
    tBmpL(g,title,FONT.card,tCol,12,4,titleW,20);
    tBmpL(g,sub,FONT.plSub,sCol,12,26,subW,16);
  }
  releaseDpiGraphics(cardTextScratch,g);
  blitCard(gr,cardTextScratch,x,stripY,sx0,sy0,sx1,sy1);
}

/* ------------------------- vector icons (SVG rasterized via gdi.LoadSVG, tinted + cached) ------------------------- */
var ICONS={
 play:"<path d='M8 5v14l11-7z'/>",
 pause:"<rect x='6' y='5' width='4' height='14' rx='1.3'/><rect x='14' y='5' width='4' height='14' rx='1.3'/>",
 prev:"<path d='M6 6h2.2v12H6zm3 6l9 6V6z'/>",
 next:"<path d='M15.8 6H18v12h-2.2zM6 18l9-6-9-6z'/>",
 shuffle:"<path d='M10.59 9.17 5.41 4 4 5.41l5.17 5.17zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04z'/>",
 repeat:"<path d='M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z'/>",
 repeat1:"<path d='M13 15V9h-1l-2 1v1h1.5v4zm4-8v3l4-4-4-4v3H5v6h2V7zm0 10H7v-3l-4 4 4 4v-3h12v-6h-2z'/>",
 volume:"<path d='M3 9v6h4l5 5V4L7 9zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z'/>",
 home:"<path d='M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z'/>",
 search:"<path d='M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.49 4.49 0 0 1 9.5 14z'/>",
 add:"<path d='M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z'/>",
 more:"<path d='M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'/>",
 clock:"<path d='M11.99 2A10 10 0 1 0 22 12 10 10 0 0 0 11.99 2zM12 20a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z'/>",
 expand:"<path d='M7 14H5v5h5v-2H7zm-2-4h2V7h3V5H5zm12 7h-3v2h5v-5h-2zM14 5v2h3v3h2V5z'/>",
 compress:"<path d='M5 16h3v3h2v-5H5zm3-8H5v2h5V5H8zm6 11h2v-3h3v-2h-5zm2-11V5h-2v5h5V8z'/>",
 mic:"<path d='M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11z'/>",
 equalizer:"<path d='M10 20h4V4h-4zm-6 0h4v-8H4zm12-11v11h4V9z'/>",
 chevron:"<path d='M7 10l5 5 5-5z'/>",
 sortAsc:"<path d='M4 12l1.41 1.41L11 7.83V20h2V7.83l5.59 5.58L20 12l-8-8-8 8z'/>",
 sortDesc:"<path d='M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.59-5.58L4 12l8 8 8-8z'/>",
 heart:"<path d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'/>",
 heartO:"<path d='M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z'/>",
 album:"<path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z'/>",
 artist:"<path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/>",
 refresh:"<path d='M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z'/>",
 back:"<path d='M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z'/>",
 sidebar:"<path d='M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z'/>",
 snap:"<path d='M3 4h8v7H3zm10 0h8v7h-8zM3 13h8v7H3zm10 0h8v7h-8z'/>",
 settings:"<path d='M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z'/>"
};
var svgCache={};
// keyed on the numeric colour (alpha stripped -- drawIcon applies that at blit time), so a hit
// costs one concat instead of unpacking the channels into a string on every icon of every frame
function iconImg(name,size,col){
  var key=name+'|'+size+'|'+(col&0xffffff);
  if(svgCache.hasOwnProperty(key)) return svgCache[key];
  var rgb=((col>>16)&0xff)+','+((col>>8)&0xff)+','+(col&0xff);
  var xml="<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='"+size+"' height='"+size+"'><g fill='rgb("+rgb+")'>"+ICONS[name]+"</g></svg>";
  var bmp=null; try{ bmp=gdi.LoadSVG(xml,px(size)); }catch(e){ bmp=null; }
  svgCache[key]=bmp; return bmp;
}
// draw a crisp size-px vector icon centred in [x,y,w,h]; falls back to the MDL2 glyph if LoadSVG is unavailable
function drawIcon(gr,name,col,x,y,w,h,size){
  var s=size||Math.min(w,h), img=iconImg(name,s,col);
  if(img){ var a=(col>>>24)&0xff; if(!a) a=255; gr.DrawImage(img,Math.round(x+(w-s)/2),Math.round(y+(h-s)/2),s,s,0,0,img.Width,img.Height,0,a); return; }
  tC(gr,GLYPH[name]||'?',(s>=26?FONT.navIco:(s>=18?FONT.iconBtn:FONT.icon)),col,x,y,w,h);
}
