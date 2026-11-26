/* All layouts use 96-DPI design units. At the drawing/input/native-window
   boundaries they are converted exactly once to physical pixels. Text is drawn
   with physical-sized fonts; the window is never stretched as a bitmap. */
var displayTimer=null, displayChecking=false;
var queueDrawerOpen=false, volumePopupOpen=false, HB_DRAWER=null,drawerDismissedClick=false;
var navDrawerOpen=false, HB_NAVDRAWER=null, navDrawerDismissedClick=false;
function px(v){return Math.round(v*UISCALE);}
function dip(v){return v/UISCALE;}
function physicalRect(r){
  var x=px(r.x),y=px(r.y);
  return {x:x,y:y,w:Math.max(0,px(r.x+r.w)-x),h:Math.max(0,px(r.y+r.h)-y)};
}
function repaintRect(x,y,w,h){var r=physicalRect({x:x,y:y,w:w,h:h});window.RepaintRect(r.x,r.y,r.w,r.h);}
function dpiImage(w,h){return gdi.CreateImage(Math.max(1,px(w)),Math.max(1,px(h)));}
function dpiResize(im,w,h,mode){return im.Resize(Math.max(1,px(w)),Math.max(1,px(h)),mode===undefined?2:mode);}
function releaseDpiGraphics(im,g){im.ReleaseGraphics(g._native||g);}
function blitCard(gr,img,x,y,x0,y0,x1,y1){
  if(!img) return;
  var dx=px(x0), dy=px(y0), dx1=px(x1), dy1=px(y1);
  var sx=Math.max(0,px(x0-x)), sy=Math.max(0,px(y0-y));
  if(sx>=img.Width || sy>=img.Height) return;
  var sw=Math.min(img.Width-sx, dx1-dx), sh=Math.min(img.Height-sy, dy1-dy);
  if(sw<=0 || sh<=0) return;
  if(gr._native){ gr._native.DrawImage(img,dx,dy,sw,sh,sx,sy,sw,sh); return; }
  gr.DrawImage(img,x0,y0,x1-x0,y1-y0,sx,sy,sw,sh);
}
function dpiGraphics(g){
  if(g._dpi)return g;
  var s=UISCALE,o={_native:g,_dpi:true};
  function scaled(name,indices){o[name]=function(){
    var args=Array.prototype.slice.call(arguments);
    for(var i=0;i<indices.length;i++)args[indices[i]]*=s;
    return g[name].apply(g,args);
  };}
  function forward(name){o[name]=function(){return g[name].apply(g,arguments);};}
  var rects=['FillSolidRect','FillEllipse','FillGradRect','FillGradRectV','FillGradRectV2','PushClip'];
  for(var i=0;i<rects.length;i++)scaled(rects[i],[0,1,2,3]);
  scaled('FillRoundRect',[0,1,2,3,4,5]);
  scaled('DrawRoundRect',[0,1,2,3,4,5,6]);
  scaled('DrawRect',[0,1,2,3,4]);scaled('DrawEllipse',[0,1,2,3,4]);
  scaled('DrawLine',[0,1,2,3,4]);scaled('Rotate',[1,2]);
  scaled('DrawImage',[1,2,3,4]);
  scaled('GdiDrawText',[3,4,5,6]);scaled('DrawString',[3,4,5,6]);
  o.CalcTextWidth=function(text,font){return g.CalcTextWidth(text,font)/s;};
  o.CalcTextHeight=function(text,font){return g.CalcTextHeight(text,font)/s;};
  o.EstimateLineWrap=function(text,font,width){
    var a=g.EstimateLineWrap(text,font,Math.max(1,width*s));
    for(var j=1;j<a.length;j+=2)a[j]/=s;
    return a;
  };
  o.FillPolygon=function(col,mode,points){
    var p=[];for(var j=0;j<points.length;j++)p.push(points[j]*s);
    return g.FillPolygon(col,mode,p);
  };
  ['SetSmoothingMode','SetInterpolationMode','SetTextRenderingHint','PushTransform','PopTransform','PopClip'].forEach(forward);
  return o;
}
function displayScale(){
  var manual=propNum('Display: UI scale (0 = auto)',0),dpi=96;
  try{dpi=Number(window.DPI)||96;}catch(e){}
  return Math.max(0.75,Math.min(3,manual>0?manual:dpi/96));
}
function clearDisplayCaches(){
  refreshFonts();CORN=null;
  svgCache={};thumbCache={};thumbOrder=[];maskCache={};rectMaskCache={};rectMaskOrder=[];cArtCache={};cArtOrder=[];
  mosaicCache={};skelImgs={};
  npArtRendered={};npArtRenderedOrder=[];
  if(typeof disposeFsBackdrop==='function') disposeFsBackdrop();
  else{ fsBackdrop=null;fsBackdropArt=null;fsBackdropKey=''; }
  if(typeof invalidateFsMetrics==='function') invalidateFsMetrics();
  if(typeof disposeFsLyBmps==='function') disposeFsLyBmps();
  lyLay={lyr:null,w:-1};fsLyReset();
  browseLayoutKey='';capW=-1;capEnd=-1;
  if(typeof nvClearArtDerivCaches==='function') nvClearArtDerivCaches();
  if(typeof clearBrCardCache==='function') clearBrCardCache();
  if(typeof disposeCardTextScratch==='function') disposeCardTextScratch();
  // Bitmap derivatives grow by scale squared; retain roughly the same byte budget.
  var area=Math.max(1,UISCALE*UISCALE);
  THUMB_CAP=Math.max(100,Math.floor(1200/area));CART_CAP=Math.max(64,Math.floor(600/area));
  ART_CARD_CAP=Math.max(40,Math.floor(400/area));
  CAP_MIN.thumb=Math.max(80,Math.floor(400/area));CAP_MAX.thumb=Math.max(160,Math.floor(2500/area));
  CAP_MIN.cart=Math.max(40,Math.floor(300/area));CAP_MAX.cart=Math.max(100,Math.floor(1200/area));
  CAP_MIN.card=Math.max(30,Math.floor(200/area));CAP_MAX.card=Math.max(60,Math.floor(600/area));
}
function checkDisplay(force){
  if(displayChecking)return false;
  var next=displayScale();if(!force&&Math.abs(next-UISCALE)<0.001)return false;
  displayChecking=true;
  try{
    UISCALE=next;W=dip(window.Width);H=dip(window.Height);drag=null;
    clearDisplayCaches();layout();dirtyAll=true;window.Repaint();
  }finally{displayChecking=false;}
  return true;
}
function startDisplayWatch(){if(!displayTimer)displayTimer=window.SetInterval(function(){checkDisplay(false);},500);}
function stopDisplayWatch(){if(displayTimer){window.ClearInterval(displayTimer);displayTimer=null;}}
function toggleQueueDrawer(){queueDrawerOpen=!queueDrawerOpen;if(queueDrawerOpen)navDrawerOpen=false;volumePopupOpen=false;layout();repaintAll();}
function dismissQueueDrawer(){if(!queueDrawerOpen)return;queueDrawerOpen=false;layout();repaintAll();}
function toggleNavDrawer(){navDrawerOpen=!navDrawerOpen;if(navDrawerOpen)queueDrawerOpen=false;volumePopupOpen=false;layout();repaintAll();}
function dismissNavDrawer(){if(!navDrawerOpen)return;navDrawerOpen=false;layout();repaintAll();}
function drawerPointer(x,y){
  if(fsMode)return false;
  if(R.drawer&&queueDrawerOpen){
    if(HB_DRAWER&&inRect(x,y,HB_DRAWER))return false;
    if(x<R.queue.x||y<R.queue.y||y>=R.queue.y+R.queue.h){dismissQueueDrawer();return true;}
  }
  if(R.navDrawer&&navDrawerOpen){
    if(HB_NAVDRAWER&&inRect(x,y,HB_NAVDRAWER))return false;
    var ny1=R.navLib?(R.navLib.y+R.navLib.h):(R.navTop.y+R.navTop.h);
    if(x<R.navTop.x||x>=R.navTop.x+R.navTop.w||y<R.navTop.y||y>=ny1){dismissNavDrawer();return true;}
  }
  return false;
}
function drawNavLayer(gr){
  if(R.navDrawer){
    if(!navDrawerOpen) return;
    gr.FillSolidRect(0,TBH,W,Math.max(0,R.barY-TBH),RGBA(0,0,0,120));
  }
  drawNav(gr);
}
function drawQueueLayer(gr){
  if(R.drawer){
    if(!queueDrawerOpen){HB_TABS=[];HB_Q=[];return;}
    gr.FillSolidRect(0,TBH,W,Math.max(0,R.barY-TBH),RGBA(0,0,0,120));
  }
  drawQueue(gr);
}
