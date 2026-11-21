/* verdant/views/songs.js -- All Songs view using shared browse header, dropdowns, & track rows
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

/* ---- All Songs: shared header + Normalize & Group-by pills + grouped/flat unified rows ---- */
function drawSongs(gr,r){
  HB_BR_BTN=[]; HB_BR_CARDS=[]; HB_BR_TR=[]; HB_BR_STAR=[]; HB_BR_TRDOTS=[];
  HB_SG=null; HB_RGNORM=null;
  var shortH=H<560, compact=r.w<760||H<650;
  var headBase=shortH?138:(compact?246:M.headH);
  var hm=brHeaderMetrics(r,headBase);

  var songsOk=ensureBuilt('songs',songsReady,songsSteps);
  if(!songsOk || !gateReady('songsart',rowHandlesSongs(),0,ROW_GATE_MS)){
    if(songsOk || skelVisible('songs')){ drawViewSkeleton(gr,r); brDrawTopStrip(gr,r,true); }
    return;
  }

  var g=songsGroup, flat=(g==='none'), tind=flat?0:(g==='both'?SG_IND*2:SG_IND);
  var showAlbum=flat&&r.w>=560, showArtist=(g==='album')&&r.w>=560;
  var lx=r.x+M.cpad, rx=hm.rx0;
  var listTop=r.y+hm.headH+8, rowsTop=listTop+34, cropY=r.y+r.h, viewH=Math.max(40,cropY-rowsTop);
  var metaStr=T('meta.songs',fmtNum(songsTracks.length))+(songsTotalSec>0?(' '+CH_DOT+' '+fmtDur(songsTotalSec)):'');

  function drawHeader(){
    gr.FillGradRect(r.x,r.y,r.w,hm.headH,90,blend(coverHue('locallib','__lib__'),COL.base,headMix(0.42)),COL.base,1.0);
    brDrawTopStrip(gr,r,true);
    coverDrawRounded(gr,hm.ax,hm.ay,hm.art,8,'locallib','__lib__');
    if(hm.shortH){
      tL(gr,T('nav.all_songs'),FONT.sect,COL.text,hm.tx,hm.ay,hm.tw,22);
      tL(gr,metaStr,FONT.plSub,COL.text2,hm.tx,hm.ay+22,hm.tw,16);
    } else {
      tL(gr,T('eyebrow.library'),FONT.eyebrow,COL.text,hm.tx,hm.ay+2,hm.tw,18);
      tL(gr,T('nav.all_songs'),hm.compact?FONT.sect2:FONT.title,COL.text,hm.tx,hm.ay+(hm.compact?18:22),hm.tw,hm.compact?36:74);
      tL(gr,metaStr,FONT.meta,COL.text2,hm.tx,hm.ay+(hm.compact?56:100),hm.tw,22);
    }

    var ctrlX=(hm.ay+hm.art<=hm.actY-2)?lx:hm.tx;
    var avail=Math.max(120,hm.rx0-ctrlX), pgap=8;
    var nzLbl=T('btn.normalize'), gpLbl=T('group.prefix',labelOf(SONGS_GROUPS,g,T('group.none')));
    var nzPref=Math.max(150,Math.round(gr.CalcTextWidth(nzLbl,FONT.pl))+68);
    var gpPref=Math.min(232,Math.max(112,Math.round(gr.CalcTextWidth(gpLbl,FONT.pl))+52));
    var nzW, gpW, nx=ctrlX, gx;
    if(nzPref+pgap+gpPref<=avail){
      nzW=nzPref; gpW=gpPref; gx=hm.rx0-gpW;
    } else {
      nzW=Math.max(54,Math.floor((avail-pgap)*(nzPref/(nzPref+gpPref))));
      gpW=Math.max(54,avail-pgap-nzW);
      gx=nx+nzW+pgap;
    }
    HB_RGNORM=drawNormalizePill(gr,nx,hm.actY,nzW,hm.actH);
    HB_SG=drawDropPill(gr,gx,hm.actY,gpW,hm.actH,gpLbl,sgMenuOpen);

    if(!hm.shortH && rgStat && rgStat.total>0){
      var nzCap=rgScanFailed?T('rg.scan_failed')
        :(rgStat.missing.length?T('rg.scanned_progress',fmtNum(rgStat.scanned),fmtNum(rgStat.total))
        :T('rg.scanned_done',CH_DOT,T(rgModeOn()?'rg.on':'rg.off')));
      tL(gr,nzCap,FONT.plSub,rgScanFailed?COL.danger:COL.text3,ctrlX+2,hm.actY+hm.actH+6,hm.rx0-ctrlX-4,18);
    }
  }

  if(!songsRows.length){
    SONGS_MAXPX=0; songsScroll=songsScrollT=0;
    drawHeader();
    tC(gr,T('empty.lib_empty'),FONT.sect,COL.text2,r.x,rowsTop+20,r.w,24);
    tC(gr,T('empty.lib_empty_sub',CH_BULL),FONT.qArtist,COL.text3,r.x,rowsTop+50,r.w,18);
    drawGroupMenu(gr);
    return;
  }

  var contentH=songsContentH, maxPx=Math.max(0,contentH-viewH);
  SONGS_MAXPX=maxPx;
  songsScroll=clampPx(songsScroll,maxPx); songsScrollT=clampPx(songsScrollT,maxPx);
  var j0=songsFirstAt(songsScroll);

  // Nested mode connector rail: runs along each artist banner's indented albums
  if(g==='both' && j0<songsRows.length){
    var q0=(songsRows[j0].g1i!==undefined)?songsRows[j0].g1i:j0;
    for(var q=q0;q<songsRows.length;q++){
      var gq=songsRows[q]; if(gq.k!=='g1') continue;
      var rt=rowsTop+gq.y+gq.h-songsScroll-4, rb=rowsTop+(gq.y1||0)-songsScroll-8;
      if(rt>=cropY) break;
      var t0=Math.max(rt,rowsTop), t1=Math.min(rb,cropY);
      if(t1>t0) gr.FillSolidRect(lx+SG_IND/2-1,t0,2,t1-t0,OV(30));
    }
  }

  var localSrc=(typeof sourceById==='function')?(sourceById('local')||brSrc()):brSrc();
  var listAcc=songsListAccessor(), srcMeta={subKind:'songs',id:'all',name:T('nav.all_songs')};
  var numW=flat?46:36;

  for(var j=j0; j<songsRows.length; j++){
    var row=songsRows[j], ry=rowsTop+row.y-songsScroll, gh=row.h;
    if(ry>=cropY) break;
    var vy0=Math.max(ry,rowsTop), vy1=Math.min(ry+gh,cropY);
    if(vy1<=vy0) continue;
    if(row.k==='t'){
      var song=songsTrackToSong(row.t);
      if(song){
        brDrawTrackRow(gr,r,lx+tind,rx,ry,gh,rowsTop,cropY,row.n,song,listAcc,row.ti,srcMeta,'',-1,{
          showThumb:flat,
          singleLine:!flat,
          showAlbum:showAlbum,
          showArtist:showArtist,
          numW:numW,
          src:localSrc
        });
      }
    } else {
      var nest=(row.k==='g2'), isArt=(row.kind==='artist'), banner=(isArt && g==='both');
      var gap=nest?SG_GAP2:SG_GAP1, acs=nest?SG_ART2:SG_ART1;
      var blockTop=ry+gap, blockH=gh-gap-(nest?SG_PADB2:SG_PADB1);
      var hx=lx+(nest?SG_IND:0), hy=blockTop+(banner?SG_SLABP:0);
      if(j>0 && !nest && ry+2>=rowsTop) gr.DrawLine(lx,ry+2,rx,ry+2,banner?2:1,COL.line);
      var hb0=Math.max(blockTop-(banner?0:4),rowsTop), hb1=vy1;
      var hHov=isArt && hb1>hb0 && hv(lx-8,hb0,rx+8,hb1);
      if(banner) gr.FillRoundRect(lx-8,blockTop,rx-lx+16,blockH,8,8,hHov?COL.hover:COL.banner);
      else if(hHov) gr.FillRoundRect(lx-8,blockTop-4,rx-lx+16,blockH+8,6,6,COL.rowHover);
      if(isArt) drawCircle(gr,hx,hy,acs,rowCover(row),row.label);
      else drawRounded(gr,hx,hy,acs,5,row.handle,row.seed);
      var htx=hx+acs+SG_TGAP, htw=Math.max(40,rx-htx);
      var eyeH=banner?16:0, nameH=nest?22:26, subH=16;
      var ty0=Math.round(hy+acs/2-(eyeH+nameH+subH)/2);
      var sub=banner?(((row.albums||1)===1?T('meta.album_one'):T('meta.album_count',fmtNum(row.albums||1)))+'  '+CH_DOT+'  '+T('meta.songs',fmtNum(row.count)))
        :((row.sub?row.sub+'  '+CH_DOT+'  ':'')+T('meta.songs',fmtNum(row.count)));
      if(banner) tL(gr,T('eyebrow.artist'),FONT.eyebrow,COL.text3,htx,ty0,htw,eyeH);
      tL(gr,row.label,nest?FONT.sect:FONT.sect2,COL.text,htx,ty0+eyeH,htw,nameH);
      tL(gr,sub,FONT.plSub,COL.text2,htx,ty0+eyeH+nameH,htw,subH);
      if(isArt && hb1>hb0) HB_BR_CARDS.push({x0:lx-8,y0:hb0,x1:rx+8,y1:hb1,kind:'artist',id:row.label,title:row.label});
    }
  }

  // Mask partial overflow top & bottom, then paint shared header and sticky column header on top
  gr.FillSolidRect(r.x,cropY,r.w,M.pad+2,COL.canvas);
  gr.FillSolidRect(r.x,r.y+M.radius,r.w,rowsTop-(r.y+M.radius),COL.base);
  drawHeader();
  var colMode=flat?'album':(g==='album'?'artist':false);
  brDrawTrackColsHeader(gr,r,lx,rx,listTop,colMode,{numW:numW,indent:tind});
  drawScrollbar(gr,rx+8,rowsTop,viewH,songsScroll,maxPx,viewH,contentH,hv(r.x,r.y,r.x+r.w,cropY)||drag==='scroll');
  drawGroupMenu(gr);
}
