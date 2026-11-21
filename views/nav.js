/* verdant/views/nav.js -- left sidebar: source switcher, nav shortcuts, All Songs (local), playlist list, footer
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

var HB_BR_PL=[], HB_BR_PL_DOTS=[], HB_BR_QUICK=[], HB_BR_REFRESH=null, HB_BR_ADDPL=null;

function drawNavRow(gr,y,h,on,hov,cover,seed,name,sub){
  if(on||hov) gr.FillRoundRect(R.navLib.x+8,y,R.navLib.w-16,h-4,6,6,on?COL.rowActive:COL.rowHover);
  var cs=h<50?34:44, cx=R.navLib.x+16, cy=y+(h-cs)/2;
  coverDrawThumb(gr,cx,cy,cs,4,cover,seed);
  var tx=cx+cs+12, tw=Math.max(20,R.navLib.x+R.navLib.w-16-tx);
  if(h<50){
    tL(gr,name,FONT.pl,on?COL.green:COL.text,tx,y+4,tw,19);
    tL(gr,sub,FONT.plSub,COL.text2,tx,y+24,tw,15);
  } else {
    tL(gr,name,FONT.pl,on?COL.green:COL.text,tx,y+8,tw,20);
    tL(gr,sub,FONT.plSub,COL.text2,tx,y+30,tw,16);
  }
}

function drawNav(gr){
  HB_SOURCE=[]; HB_BR_PL=[]; HB_BR_PL_DOTS=[]; HB_BR_QUICK=[];
  HB_BR_REFRESH=null; HB_BR_ADDPL=null; HB_ALLSONGS=null;
  var curId=(typeof libSource!=='undefined')?libSource:'local';
  var isNav=(curId==='navidrome');
  panelBg(gr,R.navTop,COL.base);
  var sources=[{id:'local',label:T('source.local')},{id:'navidrome',label:T('source.navidrome')}];
  if(setupMode==='local') sources.pop();
  var ultraCompact=R.navTop.h<130;
  var compact=H<620;
  if(ultraCompact){
    var sGap=6, sw2=Math.floor((R.navTop.w-20-sGap*(sources.length-1))/sources.length), sh2=30, sy2=R.navTop.y+8;
    for(var si2=0;si2<sources.length;si2++){
      var src2=sources[si2], bx2=R.navTop.x+10+si2*(sw2+sGap);
      var sel2=(curId===src2.id), hot2=hv(bx2,sy2,bx2+sw2,sy2+sh2);
      if(sel2||hot2) gr.FillRoundRect(bx2,sy2,sw2,sh2,7,7,sel2?COL.rowActive:COL.rowHover);
      tC(gr,src2.label,FONT.plSub,sel2?COL.green:COL.text2,bx2+4,sy2,sw2-8,sh2);
      HB_SOURCE.push({x0:bx2,y0:sy2,x1:bx2+sw2,y1:sy2+sh2,source:src2.id});
    }
    var sepU=R.navTop.y+44;
    gr.DrawLine(R.navTop.x+14,sepU,R.navTop.x+R.navTop.w-14,sepU,1,COL.line);
    var mU=10, gU=8, bhU=Math.max(26,R.navTop.h-58), iyU=sepU+6;
    var bwU=Math.floor((R.navTop.w-2*mU-gU)/2), hxU=R.navTop.x+mU, sxU=hxU+bwU+gU;
    var honU=(view==='browse'&&brView==='home'), hhovU=hv(hxU,iyU,hxU+bwU,iyU+bhU);
    if(honU||hhovU) gr.FillRoundRect(hxU,iyU,bwU,bhU,8,8,honU?COL.rowActive:COL.rowHover);
    drawIcon(gr,'home',honU?COL.text:COL.text2,hxU,iyU,bwU,bhU,20);
    HB_HOME={x0:hxU,y0:iyU,x1:hxU+bwU,y1:iyU+bhU};
    var sonU=(view==='search'), shovU=hv(sxU,iyU,sxU+bwU,iyU+bhU);
    if(sonU||shovU) gr.FillRoundRect(sxU,iyU,bwU,bhU,8,8,sonU?COL.rowActive:COL.rowHover);
    drawIcon(gr,'search',sonU?COL.text:COL.text2,sxU,iyU,bwU,bhU,20);
    HB_SEARCH={x0:sxU,y0:iyU,x1:sxU+bwU,y1:iyU+bhU};
  } else {
    var sourceH=compact?32:40;
    for(var si=0;si<sources.length;si++){
      var source=sources[si],bx=R.navTop.x+12,by=R.navTop.y+12+si*(compact?36:44),sw=R.navTop.w-24;
      var selected=(curId===source.id),hot=hv(bx,by,bx+sw,by+sourceH);
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
    var hon=(view==='browse'&&brView==='home'), hhov=hv(hx,iy,hx+bw,iy+bh);
    if(hon||hhov) gr.FillRoundRect(hx,iy,bw,bh,10,10,hon?COL.rowActive:COL.rowHover);
    drawIcon(gr,'home',hon?COL.text:COL.text2,hx,iy,bw,bh,26);
    HB_HOME={x0:hx,y0:iy,x1:hx+bw,y1:iy+bh};
    var son=(view==='search'), shov=hv(sx2,iy,sx2+bw,iy+bh);
    if(son||shov) gr.FillRoundRect(sx2,iy,bw,bh,10,10,son?COL.rowActive:COL.rowHover);
    drawIcon(gr,'search',son?COL.text:COL.text2,sx2,iy,bw,bh,26);
    HB_SEARCH={x0:sx2,y0:iy,x1:sx2+bw,y1:iy+bh};
  }
  var gapY=R.navTop.y+R.navTop.h;
  gr.FillSolidRect(R.navTop.x,gapY,R.navTop.w,R.navLib.y-gapY,COL.canvas);
  panelBg(gr,R.navLib,COL.base);
  drawLibSidebar(gr,compact,isNav);
}

function drawLibSidebar(gr,compact,isNav){
  var src=(typeof activeSource==='function')?(activeSource()||sourceById('local')||sourceById('navidrome')):null;
  var plSt=src?src.playlists():{list:[],loading:false,catalogLoading:false,err:''};
  var pls=plSt.list||[];
  var hasAllSongs=!!(src && typeof sourceHasCap==='function' && sourceHasCap(src,'allSongs'));
  var shortLib=R.navLib.h<230;
  var footH=shortLib?8:(compact?56:72), footTop=R.navLib.y+R.navLib.h-footH;

  var hdrH=shortLib?36:44;
  var allSongsH=hasAllSongs?(shortLib?38:(compact?48:56)):0;
  var pinY=R.navLib.y+hdrH;
  var qY=pinY+(allSongsH?(allSongsH+6):0);
  var qg=6, qh=shortLib?26:(compact?28:32), qGridH=shortLib?qh:(qh*2+qg);
  var listTop=qY+qGridH+10, rh=shortLib?46:58, cropY=Math.max(listTop,footTop-6), viewH=Math.max(0,cropY-listTop);
  var contentH=pls.length*rh, maxPx=Math.max(0,contentH-viewH);
  NAV_MAX=maxPx; navScroll=clampPx(navScroll,maxPx); navScrollT=clampPx(navScrollT,maxPx);

  if(navRevealPl>=0){
    var targetId=String(navRevealPl), rk=-1;
    navRevealPl=-1;
    for(var ri=0;ri<pls.length;ri++){ if(pls[ri].id===targetId){ rk=ri; break; } }
    if(rk>=0 && viewH>0){
      var rt=rk*rh, want=navScrollT;
      if(rt<want) want=rt;
      else if(rt+rh>want+viewH) want=rt+rh-viewH;
      want=Math.max(0,Math.min(want,maxPx));
      if(want!==navScrollT){ navScrollT=want; startScrollAnim(); }
    }
  }

  if(!pls.length && viewH>=30){
    var msg;
    if(plSt.loading||plSt.catalogLoading) msg=T('nav.syncing_nv');
    else if(plSt.err) msg=T('nav.server_unreachable');
    else msg=T(isNav?'nav.no_server_playlists':'home.no_local_pl_hint');
    tC(gr,msg,FONT.plSub,COL.text3,R.navLib.x+12,listTop+Math.max(8,Math.round(viewH/2-12)),R.navLib.w-24,20);
  }
  if(viewH>0){
    for(var k=Math.floor(navScroll/rh);k<pls.length;k++){
      var ry=listTop+k*rh-navScroll; if(ry>=cropY) break;
      var pl=pls[k], on=(view==='browse'&&brView==='playlist'&&brViewId===pl.id);
      var hy0=Math.max(ry,listTop), hy1=Math.min(ry+rh,cropY);
      var rowHov=(hy1>hy0)&&hv(R.navLib.x,hy0,R.navLib.x+R.navLib.w,hy1);
      var isMenuPl=!!(ctxMenu&&ctxMenu.kind==='nv-pl'&&ctxMenu.plObj&&ctxMenu.plObj.id===pl.id);
      if(on||rowHov||isMenuPl) gr.FillRoundRect(R.navLib.x+8,ry,R.navLib.w-16,rh-4,6,6,(on||isMenuPl)?COL.rowActive:COL.rowHover);
      var cs=shortLib?34:44, cx=R.navLib.x+16, cy=ry+(rh-cs)/2;
      coverDrawThumb(gr,cx,cy,cs,4,pl.coverArt,pl.name);
      var tx=cx+cs+12, tw=Math.max(20,R.navLib.x+R.navLib.w-16-tx-((rowHov&&ry>=listTop)?26:0));
      if(shortLib){
        tL(gr,pl.name,FONT.pl,on?COL.green:COL.text,tx,ry+4,tw,19);
        tL(gr,T('meta.songs',pl.songCount||0),FONT.plSub,COL.text2,tx,ry+24,tw,15);
      } else {
        tL(gr,pl.name,FONT.pl,on?COL.green:COL.text,tx,ry+8,tw,20);
        tL(gr,T('meta.songs',pl.songCount||0),FONT.plSub,COL.text2,tx,ry+30,tw,16);
      }
      if(rowHov&&ry>=listTop){
        var dx=R.navLib.x+R.navLib.w-32, dy=ry+(rh-24)/2;
        if(hv(dx,dy,dx+24,dy+24)) gr.FillEllipse(dx,dy,24,24,OV(IS_LIGHT?36:26));
        drawIcon(gr,'more',COL.text,dx,dy,24,24,18);
        HB_BR_PL_DOTS.push({x0:dx-2,y0:dy-2,x1:dx+26,y1:dy+26,plObj:pl,mx:dx,my:dy+26});
      }
      if(hy1>hy0) HB_BR_PL.push({x0:R.navLib.x,y0:hy0,x1:R.navLib.x+R.navLib.w,y1:hy1,plObj:pl});
    }
  }
  gr.FillSolidRect(R.navLib.x,R.navLib.y+M.radius+2,R.navLib.w,Math.max(0,listTop-R.navLib.y-M.radius-2),COL.base);
  gr.FillSolidRect(R.navLib.x,cropY,R.navLib.w,Math.max(0,R.navLib.y+R.navLib.h-cropY),COL.base);
  tL(gr,T('nav.your_library'),FONT.lib,COL.text2,R.navLib.x+18,R.navLib.y+(shortLib?9:14),R.navLib.w-(shortLib?82:58),24);
  var rx=R.navLib.x+R.navLib.w-(shortLib?64:40), rby=R.navLib.y+(shortLib?8:13), rs=26, rhov=hv(rx,rby,rx+rs,rby+rs);
  if(rhov) gr.FillEllipse(rx,rby,rs,rs,OV(IS_LIGHT?36:26));
  drawIcon(gr,'refresh',plSt.catalogLoading?COL.green:(rhov?COL.text:COL.text2),rx,rby,rs,rs,15);
  HB_BR_REFRESH={x0:rx-2,y0:rby-2,x1:rx+rs+2,y1:rby+rs+2};

  if(hasAllSongs && pinY+allSongsH<=footTop){
    var asHov=hv(R.navLib.x,pinY,R.navLib.x+R.navLib.w,pinY+allSongsH);
    drawNavRow(gr,pinY,allSongsH,view==='songs',asHov,'locallib','__lib__',T('nav.all_songs'),T('meta.songs',fmtNum(libCount())));
    HB_ALLSONGS={x0:R.navLib.x,y0:pinY,x1:R.navLib.x+R.navLib.w,y1:pinY+allSongsH};
  }

  var quicks=[
    {id:'artists',label:T('nav.artists'),icon:'artist',on:view==='browse'&&(brView==='artists'||brView==='artist')},
    {id:'albums',label:T('nav.albums'),icon:'album',on:view==='browse'&&(brView==='albums'||brView==='album')},
    {id:'starred',label:T('nav.loved'),icon:'heart',on:view==='browse'&&brView==='starred'},
    {id:'random',label:T('nav.random'),icon:'shuffle',on:view==='browse'&&brView==='random'}
  ];
  var px0=R.navLib.x+12;
  if(qY+qh<=footTop){
    if(shortLib){
      var qw4=Math.floor((R.navLib.w-24-qg*3)/4);
      for(var qi4=0;qi4<quicks.length;qi4++){
        var q4=quicks[qi4], qx4=px0+qi4*(qw4+qg), qhov4=hv(qx4,qY,qx4+qw4,qY+qh);
        gr.FillRoundRect(qx4,qY,qw4,qh,7,7,q4.on?COL.rowActive:(qhov4?COL.rowHover:OV(8)));
        drawIcon(gr,q4.icon,q4.on?COL.green:(qhov4?COL.text:COL.text2),qx4,qY,qw4,qh,15);
        HB_BR_QUICK.push({x0:qx4,y0:qY,x1:qx4+qw4,y1:qY+qh,id:q4.id});
      }
    } else {
      var qw=Math.floor((R.navLib.w-24-qg)/2);
      for(var qi=0;qi<quicks.length;qi++){
        var q=quicks[qi], col=qi%2, row=(qi/2)|0;
        var qx=px0+col*(qw+qg), qy=qY+row*(qh+qg), qhov=hv(qx,qy,qx+qw,qy+qh);
        if(qy+qh>footTop) continue;
        gr.FillRoundRect(qx,qy,qw,qh,8,8,q.on?COL.rowActive:(qhov?COL.rowHover:OV(8)));
        if(qhov&&!q.on) strokeRound(gr,qx,qy,qw,qh,8,1,COL.line);
        drawIcon(gr,q.icon,q.on?COL.green:(qhov?COL.text:COL.text2),qx+8,qy+(qh-15)/2,15,15,14);
        tL(gr,q.label,FONT.plSub,q.on?COL.green:(qhov?COL.text:COL.text2),qx+27,qy,qw-33,qh);
        HB_BR_QUICK.push({x0:qx,y0:qy,x1:qx+qw,y1:qy+qh,id:q.id});
      }
    }
  }

  if(listTop-4<=footTop) gr.DrawLine(R.navLib.x+16,listTop-4,R.navLib.x+R.navLib.w-16,listTop-4,1,COL.line);
  if(viewH>0) drawScrollbarN(gr,R.navLib.x+R.navLib.w-9,listTop,viewH,navScroll,maxPx,viewH,contentH,hv(R.navLib.x,R.navLib.y,R.navLib.x+R.navLib.w,R.navLib.y+R.navLib.h)||drag==='scrolln');
  if(shortLib){
    var apx2=R.navLib.x+R.navLib.w-36, apy2=R.navLib.y+8, aps2=26, apHot2=hv(apx2,apy2,apx2+aps2,apy2+aps2);
    if(apHot2||(!isNav&&navDropHover)) gr.FillEllipse(apx2,apy2,aps2,aps2,(!isNav&&navDropHover)?RGBA(30,215,96,46):OV(IS_LIGHT?36:26));
    drawIcon(gr,'add',(!isNav&&navDropHover)?COL.green:(apHot2?COL.text:COL.text2),apx2,apy2,aps2,aps2,16);
    HB_BR_ADDPL={x0:apx2-2,y0:apy2-2,x1:apx2+aps2+2,y1:apy2+aps2+2};
  } else {
    var bx=R.navLib.x+12, bw=R.navLib.w-24, by=footTop+6, bh=footH-16, hot=hv(bx,by,bx+bw,by+bh), rad=Math.min(10,bw/2,bh/2);
    var drop=(!isNav && navDropHover);
    if(drop) gr.FillRoundRect(bx,by,bw,bh,rad,rad,RGBA(30,215,96,26));
    else if(hot) gr.FillRoundRect(bx,by,bw,bh,rad,rad,COL.rowHover);
    strokeRound(gr,bx,by,bw,bh,rad,drop?2:1,drop?COL.green:(hot?COL.text3:COL.line));
    var bs=30, ax=bx+13, ay=by+Math.round((bh-bs)/2);
    gr.FillEllipse(ax,ay,bs,bs,drop?RGBA(30,215,96,46):OV(hot?26:16));
    drawIcon(gr,'add',drop?COL.green:(hot?COL.text:COL.text2),ax,ay,bs,bs,18);
    var tx2=ax+bs+12, tw2=bx+bw-12-tx2;
    if(drop){
      tL(gr,T('empty.drop_to_import'),FONT.pl,COL.green,tx2,by+Math.round((bh-20)/2),tw2,20);
    } else {
      var ty=by+Math.round((bh-35)/2);
      tL(gr,T(isNav?'nav.new_server_pl':'nav.new_playlist'),FONT.pl,hot?COL.text:COL.text2,tx2,ty,tw2,19);
      tL(gr,T(isNav?'nav.sync_to_nv':'nav.new_playlist_sub'),FONT.plSub,COL.text3,tx2,ty+19,tw2,16);
    }
    HB_BR_ADDPL={x0:bx,y0:by,x1:bx+bw,y1:by+bh};
  }
}
