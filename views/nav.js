/* verdant/views/nav.js -- left sidebar: nav rows, playlist list, add-playlist footer
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

var HB_NV_PL=[], HB_NV_PL_DOTS=[], HB_NV_QUICK=[], HB_NV_REFRESH=null, HB_NV_ADDPL=null, HB_NAV_DOTS=[];

// one sidebar row: cover + name + subtitle. pi<0 draws the library mosaic instead of a playlist cover.
function drawNavRow(gr,y,h,on,hov,pi,name,sub){
  if(on||hov) gr.FillRoundRect(R.navLib.x+8,y,R.navLib.w-16,h-4,6,6,on?COL.rowActive:COL.rowHover);
  var cs=44, cx=R.navLib.x+16, cy=y+(h-cs)/2;
  if(pi>=0) drawPlCover(gr,cx,cy,cs,4,pi,name); else drawLibCover(gr,cx,cy,cs,4);
  var tx=cx+cs+12, tw=R.navLib.x+R.navLib.w-16-tx-((hov&&pi>=0)?26:0);   // leave room for the "..." button
  tL(gr,name,FONT.pl,on?COL.green:COL.text,tx,y+8,tw,20);
  tL(gr,sub,FONT.plSub,COL.text2,tx,y+30,tw,16);
}
function drawNav(gr){
  HB_PL=[]; HB_NAV_DOTS=[]; HB_SOURCE=[]; HB_NV_PL=[]; HB_NV_PL_DOTS=[]; HB_NV_QUICK=[];
  HB_NV_REFRESH=null; HB_NV_ADDPL=null; HB_ALLSONGS=null; HB_ADDPL=null;
  var isNav=(typeof libSource!=='undefined' ? libSource==='navidrome' : view==='navidrome');
  // Music sources stay visible above the existing Home and Search shortcuts.
  panelBg(gr,R.navTop,COL.base);
  var sources=[{id:'local',label:'\u672c\u5730\u97f3\u4e50'},{id:'navidrome',label:'Navidrome'}];
  var compact=M.navTopH<176,sourceH=compact?32:40;
  for(var si=0;si<sources.length;si++){
    var source=sources[si],bx=R.navTop.x+12,by=R.navTop.y+12+si*(compact?36:44),sw=R.navTop.w-24;
    var selected=isNav===(source.id==='navidrome'),hot=hv(bx,by,bx+sw,by+sourceH);
    if(selected||hot)gr.FillRoundRect(bx,by,sw,sourceH,8,8,selected?COL.rowActive:COL.rowHover);
    tL(gr,source.label,FONT.pl,selected?COL.green:COL.text2,bx+12,by+(compact?5:9),sw-40,22);
    if(selected)gr.FillEllipse(bx+sw-20,by+(compact?13:17),6,6,COL.green);
    HB_SOURCE.push({x0:bx,y0:by,x1:bx+sw,y1:by+sourceH,source:source.id});
  }
  var separator=R.navTop.y+(compact?92:108);
  gr.DrawLine(R.navTop.x+16,separator,R.navTop.x+R.navTop.w-16,separator,1,COL.line);
  var m=16,g=12,bh=compact?32:44,iy=R.navTop.y+(compact?104:120);
  var bw=Math.floor((R.navTop.w-2*m-g)/2);
  var hx=R.navTop.x+m, sx2=hx+bw+g;
  var hon=isNav ? (view==='navidrome'&&nvView==='home') : (view==='home'), hhov=hv(hx,iy,hx+bw,iy+bh);
  if(hon||hhov) gr.FillRoundRect(hx,iy,bw,bh,10,10,hon?COL.rowActive:COL.rowHover);
  drawIcon(gr,'home',hon?COL.text:COL.text2,hx,iy,bw,bh,26);
  HB_HOME={x0:hx,y0:iy,x1:hx+bw,y1:iy+bh};
  var son=(view==='search'), shov=hv(sx2,iy,sx2+bw,iy+bh);
  if(son||shov) gr.FillRoundRect(sx2,iy,bw,bh,10,10,son?COL.rowActive:COL.rowHover);
  drawIcon(gr,'search',son?COL.text:COL.text2,sx2,iy,bw,bh,26);
  HB_SEARCH={x0:sx2,y0:iy,x1:sx2+bw,y1:iy+bh};
  // The canvas gap between the two cards is inside the region repaintNavAll invalidates but is
  // painted by neither of them -- it used to survive only because a full paint cleared the whole
  // window first, so drawNav has to own it now.
  var gapY=R.navTop.y+R.navTop.h;
  gr.FillSolidRect(R.navTop.x,gapY,R.navTop.w,R.navLib.y-gapY,COL.canvas);
  // library card
  panelBg(gr,R.navLib,COL.base);
  if(isNav){ drawNvLibSidebar(gr,compact); return; }
  tL(gr,'Your Library',FONT.lib,COL.text2,R.navLib.x+18,R.navLib.y+14,R.navLib.w-56,26);
  var active=plman.ActivePlaylist, pls=visiblePlaylists();
  var footH=compact?56:72,footTop=R.navLib.y+R.navLib.h-footH;
  var pinY=R.navLib.y+48, pinH=58;                     // pinned "All Songs" row, drawn after the crop below
  // scrollable playlist list (continuous pixel scroll), cropped just above the footer
  var listTop=pinY+pinH+10, rh=58, cropY=footTop-6, viewH=cropY-listTop;
  var contentH=pls.length*rh, maxPx=Math.max(0,contentH-viewH);
  NAV_MAX=maxPx;
  navScroll=clampPx(navScroll,maxPx); navScrollT=clampPx(navScrollT,maxPx);
  // honour a pending "scroll this playlist into view" request now that the row geometry is known
  if(navRevealPl>=0){
    var rk=-1, ri; for(ri=0;ri<pls.length;ri++){ if(pls[ri]===navRevealPl){ rk=ri; break; } }
    navRevealPl=-1;
    if(rk>=0){
      var rt=rk*rh, want=navScrollT;
      if(rt<want) want=rt;                                 // above the viewport: bring it to the top edge
      else if(rt+rh>want+viewH) want=rt+rh-viewH;          // below it: bring it to the bottom edge
      want=Math.max(0,Math.min(want,maxPx));
      if(want!==navScrollT){ navScrollT=want; startScrollAnim(); }   // eased, same as wheel scrolling
    }
  }
  for(var k=Math.floor(navScroll/rh); k<pls.length; k++){
    var ry=listTop+k*rh-navScroll; if(ry>=cropY) break;
    var i2=pls[k], nm=plName(i2);
    // clamp hover + click targets to the visible band: a row scrolled under the pinned
    // "All Songs" header is painted over, so it must not answer the mouse there either
    var hy0=Math.max(ry,listTop), hy1=Math.min(ry+rh,cropY);
    var rowHov=(hy1>hy0) && hv(R.navLib.x,hy0,R.navLib.x+R.navLib.w,hy1);
    drawNavRow(gr,ry,rh,view==='playlist'&&i2===active,rowHov,i2,nm,plCount(i2)+' songs');
    if(rowHov && ry>=listTop) drawDots(gr,R.navLib.x+R.navLib.w-32,ry+(rh-24)/2,i2,HB_NAV_DOTS);
    if(hy1>hy0) HB_PL.push({x0:R.navLib.x,y0:hy0,x1:R.navLib.x+R.navLib.w,y1:hy1,i:i2});
  }
  // crop partial rows top & bottom, redraw the sticky header block (title + All Songs), then the scrollbar
  // (clear starts below the panel's rounded corners so a square fill can't square them off)
  gr.FillSolidRect(R.navLib.x,R.navLib.y+M.radius+2,R.navLib.w,listTop-R.navLib.y-M.radius-2,COL.base);
  gr.FillSolidRect(R.navLib.x,cropY,R.navLib.w,R.navLib.y+R.navLib.h-cropY,COL.base);
  tL(gr,'Your Library',FONT.lib,COL.text2,R.navLib.x+18,R.navLib.y+14,R.navLib.w-56,26);
  drawNavRow(gr,pinY,pinH,view==='songs',hv(R.navLib.x,pinY,R.navLib.x+R.navLib.w,pinY+pinH),-1,'All Songs',fmtNum(libCount())+' songs');
  HB_ALLSONGS={x0:R.navLib.x,y0:pinY,x1:R.navLib.x+R.navLib.w,y1:pinY+pinH};
  gr.DrawLine(R.navLib.x+16,listTop-6,R.navLib.x+R.navLib.w-16,listTop-6,1,COL.line);
  drawScrollbarN(gr,R.navLib.x+R.navLib.w-9,listTop,viewH,navScroll,maxPx,viewH,contentH,hv(R.navLib.x,R.navLib.y,R.navLib.x+R.navLib.w,R.navLib.y+R.navLib.h)||drag==='scrolln');
  drawAddPlaylist(gr,footTop,footH);
}
// pinned sidebar footer: click to create a blank playlist, or drop files on it to import
function drawAddPlaylist(gr,footTop,footH){
  var bx=R.navLib.x+12, bw=R.navLib.w-24, by=footTop+6, bh=footH-16;
  var hot=hv(bx,by,bx+bw,by+bh), drop=navDropHover;
  var rad=Math.min(10,bw/2,bh/2);
  if(drop)      gr.FillRoundRect(bx,by,bw,bh,rad,rad,RGBA(30,215,96,26));
  else if(hot)  gr.FillRoundRect(bx,by,bw,bh,rad,rad,COL.rowHover);
  strokeRound(gr,bx,by,bw,bh,rad,drop?2:1,drop?COL.green:(hot?COL.text3:COL.line));
  // circular badge, echoing the empty-playlist state in the main panel
  var bs=30, ax=bx+13, ay=by+Math.round((bh-bs)/2);
  gr.FillEllipse(ax,ay,bs,bs,drop?RGBA(30,215,96,46):OV(hot?26:16));
  drawIcon(gr,'add',drop?COL.green:(hot?COL.text:COL.text2),ax,ay,bs,bs,18);
  var tx=ax+bs+12, tw=bx+bw-12-tx;
  if(drop){ tL(gr,'Drop to import',FONT.pl,COL.green,tx,by+Math.round((bh-20)/2),tw,20); }
  else {
    var ty=by+Math.round((bh-35)/2);          // two-line block, optically centred
    tL(gr,'New playlist',FONT.pl,hot?COL.text:COL.text2,tx,ty,tw,19);
    tL(gr,'drag a file or click',FONT.plSub,COL.text3,tx,ty+19,tw,16);
  }
  HB_ADDPL={x0:bx,y0:by,x1:bx+bw,y1:by+bh};
}
function drawNvLibSidebar(gr,compact){
  var pls=(typeof NVData==='object'&&NVData.playlists)?NVData.playlists:[];
  var footH=compact?56:72, footTop=R.navLib.y+R.navLib.h-footH;
  var pinY=R.navLib.y+46, qg=6, qh=compact?28:32, qGridH=qh*2+qg;
  var listTop=pinY+qGridH+12, rh=58, cropY=footTop-6, viewH=Math.max(0,cropY-listTop);
  var contentH=pls.length*rh, maxPx=Math.max(0,contentH-viewH);
  NAV_MAX=maxPx; navScroll=clampPx(navScroll,maxPx); navScrollT=clampPx(navScrollT,maxPx);
  if(!pls.length && viewH>=30){
    var msg=(typeof NVData==='object'&&NVData.loadingCatalog)?'\u6b63\u5728\u540c\u6b65 Navidrome...':((typeof NVData==='object'&&NVData.error)?'\u65e0\u6cd5\u8fde\u63a5\u670d\u52a1\u5668':'\u6682\u65e0\u4e91\u7aef\u6b4c\u5355');
    tC(gr,msg,FONT.plSub,COL.text3,R.navLib.x+12,listTop+Math.max(8,Math.round(viewH/2-12)),R.navLib.w-24,20);
  }
  for(var k=Math.floor(navScroll/rh);k<pls.length;k++){
    var ry=listTop+k*rh-navScroll; if(ry>=cropY) break;
    var pl=pls[k], on=(view==='navidrome'&&nvView==='playlist'&&nvViewId===pl.id);
    var hy0=Math.max(ry,listTop), hy1=Math.min(ry+rh,cropY);
    var rowHov=(hy1>hy0)&&hv(R.navLib.x,hy0,R.navLib.x+R.navLib.w,hy1);
    var isMenuPl=!!(ctxMenu&&ctxMenu.kind==='nv-pl'&&ctxMenu.plObj&&ctxMenu.plObj.id===pl.id);
    if(on||rowHov||isMenuPl) gr.FillRoundRect(R.navLib.x+8,ry,R.navLib.w-16,rh-4,6,6,(on||isMenuPl)?COL.rowActive:COL.rowHover);
    var cs=44, cx=R.navLib.x+16, cy=ry+(rh-cs)/2;
    nvDrawThumb(gr,cx,cy,cs,4,pl.coverArt,pl.name);
    var tx=cx+cs+12, tw=R.navLib.x+R.navLib.w-16-tx-((rowHov&&ry>=listTop)?26:0);
    tL(gr,pl.name,FONT.pl,on?COL.green:COL.text,tx,ry+8,tw,20);
    tL(gr,(pl.songCount||0)+' songs',FONT.plSub,COL.text2,tx,ry+30,tw,16);
    if(rowHov&&ry>=listTop){
      var dx=R.navLib.x+R.navLib.w-32, dy=ry+(rh-24)/2;
      if(hv(dx,dy,dx+24,dy+24)) gr.FillEllipse(dx,dy,24,24,OV(IS_LIGHT?36:26));
      drawIcon(gr,'more',COL.text,dx,dy,24,24,18);
      HB_NV_PL_DOTS.push({x0:dx-2,y0:dy-2,x1:dx+26,y1:dy+26,plObj:pl,mx:dx,my:dy+26});
    }
    if(hy1>hy0) HB_NV_PL.push({x0:R.navLib.x,y0:hy0,x1:R.navLib.x+R.navLib.w,y1:hy1,plObj:pl});
  }
  gr.FillSolidRect(R.navLib.x,R.navLib.y+M.radius+2,R.navLib.w,listTop-R.navLib.y-M.radius-2,COL.base);
  gr.FillSolidRect(R.navLib.x,cropY,R.navLib.w,R.navLib.y+R.navLib.h-cropY,COL.base);
  tL(gr,'Your Library',FONT.lib,COL.text2,R.navLib.x+18,R.navLib.y+14,R.navLib.w-58,26);
  var rx=R.navLib.x+R.navLib.w-40, rby=R.navLib.y+13, rs=26, rhov=hv(rx,rby,rx+rs,rby+rs);
  if(rhov) gr.FillEllipse(rx,rby,rs,rs,OV(IS_LIGHT?36:26));
  drawIcon(gr,'refresh',(typeof NVData==='object'&&NVData.loadingCatalog)?COL.green:(rhov?COL.text:COL.text2),rx,rby,rs,rs,15);
  HB_NV_REFRESH={x0:rx-2,y0:rby-2,x1:rx+rs+2,y1:rby+rs+2};
  var quicks=[
    {id:'artists',label:'\u6b4c\u624b',icon:'artist',on:view==='navidrome'&&(nvView==='artists'||nvView==='artist')},
    {id:'albums',label:'\u4e13\u8f91',icon:'album',on:view==='navidrome'&&(nvView==='albums'||nvView==='album')},
    {id:'starred',label:'\u6211\u559c\u6b22',icon:'heart',on:view==='navidrome'&&nvView==='starred'},
    {id:'random',label:'\u6f2b\u6e38',icon:'shuffle',on:view==='navidrome'&&nvView==='random'}
  ];
  var px0=R.navLib.x+12, qw=Math.floor((R.navLib.w-24-qg)/2);
  for(var qi=0;qi<quicks.length;qi++){
    var q=quicks[qi], col=qi%2, row=(qi/2)|0;
    var qx=px0+col*(qw+qg), qy=pinY+row*(qh+qg), qhov=hv(qx,qy,qx+qw,qy+qh);
    gr.FillRoundRect(qx,qy,qw,qh,8,8,q.on?COL.rowActive:(qhov?COL.rowHover:OV(8)));
    if(qhov&&!q.on) strokeRound(gr,qx,qy,qw,qh,8,1,COL.line);
    drawIcon(gr,q.icon,q.on?COL.green:(qhov?COL.text:COL.text2),qx+8,qy+(qh-15)/2,15,15,14);
    tL(gr,q.label,FONT.plSub,q.on?COL.green:(qhov?COL.text:COL.text2),qx+27,qy,qw-33,qh);
    HB_NV_QUICK.push({x0:qx,y0:qy,x1:qx+qw,y1:qy+qh,id:q.id});
  }
  gr.DrawLine(R.navLib.x+16,listTop-6,R.navLib.x+R.navLib.w-16,listTop-6,1,COL.line);
  drawScrollbarN(gr,R.navLib.x+R.navLib.w-9,listTop,viewH,navScroll,maxPx,viewH,contentH,hv(R.navLib.x,R.navLib.y,R.navLib.x+R.navLib.w,R.navLib.y+R.navLib.h)||drag==='scrolln');
  var bx=R.navLib.x+12, bw=R.navLib.w-24, by=footTop+6, bh=footH-16, hot=hv(bx,by,bx+bw,by+bh), rad=Math.min(10,bw/2,bh/2);
  if(hot) gr.FillRoundRect(bx,by,bw,bh,rad,rad,COL.rowHover);
  strokeRound(gr,bx,by,bw,bh,rad,1,hot?COL.text3:COL.line);
  var bs=30, ax=bx+13, ay=by+Math.round((bh-bs)/2);
  gr.FillEllipse(ax,ay,bs,bs,OV(hot?26:16));
  drawIcon(gr,'add',hot?COL.text:COL.text2,ax,ay,bs,bs,18);
  var tx2=ax+bs+12, tw2=bx+bw-12-tx2, ty=by+Math.round((bh-35)/2);
  tL(gr,'New server playlist',FONT.pl,hot?COL.text:COL.text2,tx2,ty,tw2,19);
  tL(gr,'\u540c\u6b65\u5230 Navidrome',FONT.plSub,COL.text3,tx2,ty+19,tw2,16);
  HB_NV_ADDPL={x0:bx,y0:by,x1:bx+bw,y1:by+bh};
}
