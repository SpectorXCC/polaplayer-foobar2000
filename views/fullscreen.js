/* verdant/views/fullscreen.js -- fullscreen chill mode and the spectrum visualizer
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

/* ------------------------- fullscreen "chill" mode ------------------------- */
var fsRestoreWindow=false;
var fsLyBmpQueue=[], FS_LY_BMP_CAP=64;
var HB_FS_TOP=[], HB_FS_LY=[];
var fsMetricsCache=null;
function invalidateFsMetrics(){ fsMetricsCache=null; }
function fsMetricsKey(){
  return W+'x'+H+':'+UISCALE+':'+fsView+':'+(FONT_SPEC&&FONT_SPEC.ui?FONT_SPEC.ui.reg:'')+':'+(FONT_SPEC&&FONT_SPEC.lyric?FONT_SPEC.lyric.reg:'');
}
function fsCachedMetrics(){
  return (fsMetricsCache && fsMetricsCache.key===fsMetricsKey())?fsMetricsCache.m:null;
}

function disposeFsBackdrop(){
  if(fsBackdrop){ try{ fsBackdrop.Dispose(); }catch(e){} fsBackdrop=null; }
  fsBackdropArt=null; fsBackdropKey='';
}
function disposeFsLyBmps(){
  var i, j, rows=(typeof fsLy==='object'&&fsLy)?fsLy.rows:null;
  if(rows){
    for(i=0;i<rows.length;i++){
      if(rows[i]&&rows[i].bmps){
        for(j=0;j<rows[i].bmps.length;j++){
          var b=rows[i].bmps[j];
          if(b&&b.img){ try{ b.img.Dispose(); }catch(e){} b.img=null; }
        }
        rows[i].bmps=null;
      }
    }
  }
  for(i=0;i<fsLyBmpQueue.length;i++){
    var q=fsLyBmpQueue[i];
    if(q&&q.img){ try{ q.img.Dispose(); }catch(e2){} q.img=null; }
  }
  fsLyBmpQueue=[];
}
function fsClampRect(x,y,w,h){
  var x0=Math.max(0,Math.floor(x)), y0=Math.max(0,Math.floor(y));
  var x1=Math.min(W,Math.ceil(x+w)), y1=Math.min(H,Math.ceil(y+h));
  return {x:x0,y:y0,w:Math.max(0,x1-x0),h:Math.max(0,y1-y0)};
}
function fsSyncHitboxes(){
  HB_FS=HB_FS_TOP.concat(HB_FS_LY);
}
function enterFullscreen(){
  var wasFs=fsMode;
  fsMode=true;
  if(typeof clearNormalOverlays==='function') clearNormalOverlays();
  if(typeof clearNonFsHitboxes==='function') clearNonFsHitboxes();
  capW=-1; applyCaption(); applyKeyMode();
  invalidateFsMetrics();
  fsView='lyrics'; stopLyAnim(); stopFsAnim(); fsLyReset(); nvLoad(); syncNavidromePanel();
  try{
    if(chromeAttached || UIWizard){
      if(!wasFs) fsRestoreWindow=!winMaxed();
      if(!winMaxed()) winToggleMaximize();
    }
  }catch(e){ fsRestoreWindow=false; }
  if(typeof fsBridgeEnter==='function') fsBridgeEnter();
  if(!(typeof fsBridgeIsShowing==='function' && fsBridgeIsShowing())){
    startFsClock(); repaintAll();
  }
}
function exitFullscreen(){
  if(typeof fsBridgeExit==='function') fsBridgeExit();
  fsMode=false; capW=-1; applyCaption(); applyKeyMode();
  syncNavidromePanel(); vizMenuOpen=false; stopViz(); stopFsClock(); stopFsAnim(); stopLyAnim();
  disposeFsLyBmps(); disposeFsBackdrop(); invalidateFsMetrics();
  HB_FS=[]; HB_FS_TOP=[]; HB_FS_LY=[];
  try{
    if(fsRestoreWindow && winMaxed()) winToggleMaximize();
  }catch(e){}
  fsRestoreWindow=false;
  if(webPreview.active) fsBridgeEnter();
  repaintAll();
}
// the style list belongs to the viz view: leaving it (or fullscreen) must not leave a menu armed
function setFsView(v){
  fsView=v; vizMenuOpen=false;
  invalidateFsMetrics();
  stopFsAnim();
  if(v==='viz') startViz(); else stopViz();
  if(v==='lyrics') nvLoad();
  fsLyReset();
  if(typeof fsBridgeSyncView==='function') fsBridgeSyncView();
  if(typeof fsBridgeIsShowing==='function' && fsBridgeIsShowing()){
    stopFsClock(); stopFsAnim();
    return;
  }
  repaintAll();
}
function doFsAct(act){
  if(act==='exit') exitFullscreen();
  else if(act==='lyrics') setFsView(fsView==='lyrics'?'default':'lyrics');
  else if(act==='viz') setFsView(fsView==='viz'?'default':'viz');
  else if(act==='retry') nvLoad(true);
  else if(act.indexOf('seek:')===0){ fb.PlaybackTime=Number(act.slice(5)); fsLyReset(); repaintAll(); }
}

/* ---- audio spectrum visualizer: real PCM via fb.GetAudioChunk -> FFT bars ----
   Three things separate a spectrum that looks designed from one that merely twitches, and all
   three live here rather than in the drawing:
     - bands spaced in HERTZ, not in FFT bin index. The chunk carries its own SampleRate, so band
       edges are derived from it once per rate and cached. Spacing by index quietly put the bands
       in the wrong place on anything that was not 44.1k.
     - a treble tilt. Music is bass-heavy, so an untilted spectrum is a wall on the left and a flat
       line on the right. Everything above VIZ_TILT_HZ is lifted and everything below it trimmed.
     - dB, mapped from a floor to a ceiling. Loudness is logarithmic; the old log(1+m*8)/3.5 was a
       curve chosen to look plausible rather than to mean anything.
   Dynamics are asymmetric on top of that: a transient has to arrive instantly and leave slowly. */
var VIZ_N=72, VIZ_FFT=2048, VIZ_MS=Math.max(10,ANIM_MS), VIZ_TOP=200;
var VIZ_ATK_RATE=29.0, VIZ_REL_RATE=4.5;      // per-second rates: instant attack, slow release (equiv 0.62/0.14 @ 30fps)
var VIZ_WAVE_RATE=24.0, VIZ_WAVE_ENV_ATK=20.8, VIZ_WAVE_ENV_REL=0.91, VIZ_WAVE_DECAY=6.7, VIZ_WAVE_ENV_DECAY=1.54;
var vizLastMs=0;
var VIZ_DB_FLOOR=-52, VIZ_DB_CEIL=0;
var VIZ_TILT_HZ=250, VIZ_TILT=0.42;          // treble lift, as an exponent on (f/VIZ_TILT_HZ)
var VIZ_F0=32;                               // lowest band edge; the top edge follows the rate
var vizRe=null, vizIm=null, vizWin=null, vizBand=null, vizTwiddle={};

function vizBuffers(){ if(!vizRe){ vizRe=new Float64Array(VIZ_FFT); vizIm=new Float64Array(VIZ_FFT); } }
// Hann window, built once per size: 2048 cosines every frame is pure waste
function vizWindow(n){
  if(vizWin && vizWin.n===n) return vizWin.w;
  var w=new Float64Array(n);
  for(var i=0;i<n;i++) w[i]=0.5-0.5*Math.cos(2*Math.PI*i/(n-1));
  vizWin={n:n,w:w}; return w;
}
function vizBands(sr,n){
  if(vizBand && vizBand.sr===sr && vizBand.n===n) return vizBand;
  var half=n>>1, hz=sr/n, top=Math.min(16000,sr*0.45), i;
  var lo=[], hi=[], tilt=[];
  for(i=0;i<VIZ_N;i++){
    var fa=VIZ_F0*Math.pow(top/VIZ_F0,i/VIZ_N), fz=VIZ_F0*Math.pow(top/VIZ_F0,(i+1)/VIZ_N);
    var b0=Math.max(1,Math.round(fa/hz)), b1=Math.max(b0+1,Math.round(fz/hz));
    if(b0>=half) b0=half-1;
    if(b1>half) b1=half;
    var g=Math.pow(Math.sqrt(fa*fz)/VIZ_TILT_HZ,VIZ_TILT);
    lo.push(b0); hi.push(b1); tilt.push(g<0.45?0.45:(g>5?5:g));
  }
  vizBand={sr:sr,n:n,lo:lo,hi:hi,tilt:tilt}; return vizBand;
}
// one band's envelope: instant rise, slow fall (dt-normalized across refresh rates)
function vizStep(i,val,dt){
  var cur=vizBars[i]||0;
  var a=1-Math.exp(-((val>cur)?VIZ_ATK_RATE:VIZ_REL_RATE)*dt);
  cur+=(val-cur)*a;
  if(cur<0.0008) cur=0;
  vizBars[i]=cur;
}
function vizDecay(dt){ for(var i=0;i<VIZ_N;i++) vizStep(i,0,dt); }
var VIZ_WAVE_N=260, vizWave=[], vizWaveEnv=0.15;
function vizCapture(d,cc,sc,dt){
  var span=Math.min(sc,2048), base=(sc-span)*cc, i, k, c, v;
  var scan=Math.floor(span/3), t=0, prev=0;
  for(i=0;i<scan;i++){                            // trigger: first rising zero crossing
    v=d[base+i*cc]||0;
    if(prev<0 && v>=0){ t=i; break; }
    prev=v;
  }
  var step=(span-t)/VIZ_WAVE_N, peak=0, acc, cnt, s, e, mono, wa=1-Math.exp(-VIZ_WAVE_RATE*dt);
  for(i=0;i<VIZ_WAVE_N;i++){
    s=t+Math.floor(i*step); e=t+Math.floor((i+1)*step); if(e<=s) e=s+1;
    acc=0; cnt=0;
    for(k=s;k<e && k<span;k++){
      mono=0;
      for(c=0;c<cc;c++) mono+=d[base+k*cc+c]||0;
      acc+=mono/cc; cnt++;
    }
    v=cnt?acc/cnt:0;
    if(v>peak) peak=v; else if(-v>peak) peak=-v;
    vizWave[i]=(vizWave[i]||0)+(v-(vizWave[i]||0))*wa;
  }
  var ea=1-Math.exp(-((peak>vizWaveEnv)?VIZ_WAVE_ENV_ATK:VIZ_WAVE_ENV_REL)*dt);
  vizWaveEnv+=(peak-vizWaveEnv)*ea;
}
function vizWaveDecay(dt){
  var mul=Math.exp(-VIZ_WAVE_DECAY*dt), em=1-Math.exp(-VIZ_WAVE_ENV_DECAY*dt);
  for(var i=0;i<VIZ_WAVE_N;i++) vizWave[i]=(vizWave[i]||0)*mul;
  vizWaveEnv+=(0.15-vizWaveEnv)*em;
}
function vizAnalyse(ch,dt){
  var d=ch.Data, cc=ch.ChannelCount||2, sc=ch.SampleCount, sr=ch.SampleRate||44100;
  if(!d || !sc) return false;
  var n=VIZ_FFT; while(n>256 && n>sc) n>>=1;      // a short chunk gets a smaller transform, not none
  if(n<256) return false;
  if(vizStyle==='wave') vizCapture(d,cc,sc,dt);   // before the FFT: it destroys the input buffer
  vizBuffers();
  var re=vizRe, im=vizIm, w=vizWindow(n), i, c;
  var start=(sc-n)*cc; if(start<0) start=0;       // the MOST RECENT n samples, not a decimated scan
  for(i=0;i<n;i++){
    var si=start+i*cc, v=0;
    for(c=0;c<cc;c++) v+=d[si+c]||0;
    re[i]=(v/cc)*w[i]; im[i]=0;
  }
  fftMag(re,im,n);
  var B=vizBands(sr,n), half=n>>1, scale=2/n, k, m, pw;
  for(i=0;i<VIZ_N;i++){
    m=0;
    for(k=B.lo[i];k<B.hi[i] && k<half;k++){ pw=re[k]*re[k]+im[k]*im[k]; if(pw>m) m=pw; }
    m=Math.sqrt(m)*scale*B.tilt[i];
    var db=20*Math.log(m+1e-9)/Math.LN10;
    vizStep(i,clamp01((db-VIZ_DB_FLOOR)/(VIZ_DB_CEIL-VIZ_DB_FLOOR)),dt);
  }
  return true;
}
function vizIdle(){
  for(var i=0;i<VIZ_N;i++) if((vizBars[i]||0)>0) return false;
  if(vizStyle==='wave') for(i=0;i<VIZ_WAVE_N;i++) if(Math.abs(vizWave[i]||0)>0.0005) return false;
  return true;
}
var vizWasIdle=false;
function vizUpdate(){
  if(!fsMode || fsView!=='viz'){ stopViz(); return; }
  var now=nowMs(), dt=vizLastMs?Math.min(0.05,Math.max(0.001,(now-vizLastMs)/1000)):(VIZ_MS/1000);
  vizLastMs=now;
  var ch=null, ok=false;
  try{ ch=fb.GetAudioChunk(0.06); }catch(e){ ch=null; }
  if(ch && ch.SampleCount>0){ try{ ok=vizAnalyse(ch,dt); }catch(e){ ok=false; } }
  if(ok) vizWasIdle=false;
  else {
    vizDecay(dt);                                  // paused, stopped, or no visualisation stream
    if(vizStyle==='wave') vizWaveDecay(dt);
    // once everything has decayed to nothing there is no reason to keep repainting an empty band
    var idle=vizIdle();
    if(idle && vizWasIdle) return;
    vizWasIdle=idle;
  }
  repaintViz();
}
function vizTwiddleFor(n){
  if(vizTwiddle[n]) return vizTwiddle[n];
  var stages=[], l, k;
  for(l=2;l<=n;l<<=1){
    var half=l>>1, wr=new Float64Array(half), wi=new Float64Array(half);
    for(k=0;k<half;k++){
      var ang=-2*Math.PI*k/l;
      wr[k]=Math.cos(ang); wi[k]=Math.sin(ang);
    }
    stages.push({l:l,half:half,wr:wr,wi:wi});
  }
  vizTwiddle[n]=stages;
  return stages;
}
function fftMag(re,im,n){
  var i,j=0,k,s,t;
  for(i=1;i<n;i++){ var bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit; if(i<j){ t=re[i];re[i]=re[j];re[j]=t; t=im[i];im[i]=im[j];im[j]=t; } }
  var stages=vizTwiddleFor(n);
  for(s=0;s<stages.length;s++){
    var st=stages[s], l=st.l, half=st.half, wr=st.wr, wi=st.wi;
    for(i=0;i<n;i+=l){
      for(k=0;k<half;k++){
        var idx1=i+k, idx2=idx1+half;
        var cr=wr[k], ci=wi[k];
        var pr=re[idx1], pi=im[idx1], qr=cr*re[idx2]-ci*im[idx2], qi=cr*im[idx2]+ci*re[idx2];
        re[idx1]=pr+qr; im[idx1]=pi+qi; re[idx2]=pr-qr; im[idx2]=pi-qi;
      }
    }
  }
}
function startViz(){ if(!vizTimer){ vizLastMs=nowMs(); vizTimer=window.SetInterval(vizUpdate,VIZ_MS); } }
function stopViz(){ if(vizTimer){ window.ClearInterval(vizTimer); vizTimer=null; } vizLastMs=0; }
function fsIcon(gr,name,col,x,y,sz,act,hbOut){
  var hot=hv(x-8,y-8,x+sz+8,y+sz+8);
  if(hot) gr.FillEllipse(x-8,y-8,sz+16,sz+16,RGBA(255,255,255,34));
  drawIcon(gr,name,hot?COL.text:col,x,y,sz,sz,sz);
  (hbOut||HB_FS_TOP).push({x0:x-8,y0:y-8,x1:x+sz+8,y1:y+sz+8,act:act});
}
function npPlaylistSrc(){
  var loc=playingLoc(), pli=(loc&&loc.IsValid)?loc.PlaylistIndex:-1;
  if(pli<0) return null;
  var rnm=plName(pli);
  if(rnm===SHUF) return shufSrcName||null;
  if(rnm && !isHiddenPl(rnm)) return rnm;
  return null;
}
function fsMiniNP(gr){   // small cover + title + artist, top-left (lyrics/viz views)
  var s=64, src=npPlaylistSrc(), srcMaxW=Math.max(40,W-128);
  var tx=64+s+18, vizLeft=W-VIZ_MARGIN-196, npMaxW=Math.max(40,vizLeft-16-tx);
  if(src){
    var lbl=T('eyebrow.playing_from_playlist');
    tL(gr,lbl,FONT.fsSrc,COL.text3,64,20,srcMaxW,20);
    var lw=gr.CalcTextWidth(lbl,FONT.fsSrc);
    tL(gr,src,FONT.fsSrcName,COL.text,64+lw,20,Math.max(0,srcMaxW-lw),20);   // bold: the playlist name
  }
  if(typeof qDrawArt==='function') qDrawArt(gr,64,78,s,6,NP,'np','np');
  else drawCover(gr,64,78,s,6,NP,'np');
  tL(gr,npTitleStr||T('queue.nothing_playing'),FONT.sect2,COL.text,tx,84,npMaxW,26);
  tL(gr,npArtistStr,FONT.qName,COL.text2,tx,116,npMaxW,20);
}
function vizAlpha(c,a){ return RGBA((c>>16)&255,(c>>8)&255,c&255,a); }
var VIZ_PEAK=blend(THEME_DARK.green,THEME_DARK.text,0.22);
function vizCol(v){ return blend(THEME_DARK.greenC,VIZ_PEAK,clamp01(v*1.3)); }
var VIZ_MARGIN=72;                 // the fullscreen content column, shared with the seek bar
var VIZ_GAPR=0.55;                 // gap as a fraction of bar width (Few's preferred end)
var VIZ_SWING=0.62;                // share of the band's half-height the loudest bar may use
var VIZ_R_FILL=0.96;               // ring outer radius as a share of the band's half-height
var VIZ_R_INNER=0.44;              // inner radius as a share of the outer; spokes get the other 56%
var VIZ_ART_GAP=26;                // clearance between the cover and where the spokes start
var VIZ_SPOKE=0.645;               // spoke width as a share of its slot, so the gap lands at ~55%
var VIZ_RN=36;
var VIZ_WAVE_AMP=0.42;             // waveform: share of the half-height at full scale
var VIZ_AXIS=RGBA(255,255,255,14); // the hairline the mirrored halves meet on

function drawVizBars(gr,top,bot){
  var cy=Math.round((top+bot)/2), n=VIZ_N, i;
  var w=W-VIZ_MARGIN*2, cell=w/n, bw=Math.max(3,Math.round(cell/(1+VIZ_GAPR)));
  var x0=Math.round(VIZ_MARGIN+(cell-bw)/2);
  var hh=Math.round((bot-top)/2*VIZ_SWING);
  gr.DrawLine(VIZ_MARGIN,cy,W-VIZ_MARGIN,cy,1,VIZ_AXIS);
  for(i=0;i<n;i++){
    var v=vizBars[i]||0, bh=Math.max(2,Math.round(v*hh)), bx=Math.round(x0+i*cell);
    var rad=Math.min(bw>>1,bh);   // GDI+ needs 2*rad <= both width and height, so floor -- never round
    gr.FillRoundRect(bx,cy-bh,bw,bh*2,rad,rad,vizCol(v));
  }
}
function vizRadialLevel(i){
  var per=VIZ_N/VIZ_RN, k=Math.floor(i*per), e=Math.floor((i+1)*per), m=0, v;
  if(e<=k) e=k+1;
  for(;k<e && k<VIZ_N;k++){ v=vizBars[k]||0; if(v>m) m=v; }
  return m;
}
function drawVizRadial(gr,top,bot){
  var cx=Math.round(W/2), cy=Math.round((top+bot)/2);
  var half=Math.min((bot-top)/2,(W-VIZ_MARGIN*2)/2);
  var R=Math.round(half*VIZ_R_FILL);
  if(R<90) return;
  var r0=Math.round(R*VIZ_R_INNER), len=R-r0, art=Math.max(40,(r0-VIZ_ART_GAP)*2);
  drawCircle(gr,Math.round(cx-art/2),Math.round(cy-art/2),art,NP,npTitleStr||'np');
  var wgt=Math.max(3,Math.round(Math.PI*r0/VIZ_RN*VIZ_SPOKE)), i, s;
  for(i=0;i<VIZ_RN;i++){
    var v=vizRadialLevel(i), L=Math.max(wgt,Math.round(v*len));   // never shorter than round: a dot
    var col=vizCol(v), rad=Math.min(wgt>>1,L>>1), deg=(i+0.5)*180/VIZ_RN;
    for(s=-1;s<=1;s+=2){
      gr.PushTransform();
      gr.Rotate(s*deg,cx,cy);
      gr.FillRoundRect(cx-wgt/2,cy-r0-L,wgt,L,rad,rad,col);
      gr.PopTransform();
    }
  }
}
function drawVizWave(gr,top,bot){
  var cy=Math.round((top+bot)/2), x0=VIZ_MARGIN, w=W-VIZ_MARGIN*2, i;
  var hh=Math.round((bot-top)/2*VIZ_WAVE_AMP);
  var g=0.92/Math.max(0.06,vizWaveEnv); if(g>9) g=9;
  var body=vizCol(0.9), fill=vizAlpha(body,54);
  var pxa=[], pya=[], poly=[x0,cy];
  for(i=0;i<VIZ_WAVE_N;i++){
    var v=(vizWave[i]||0)*g; if(v>1) v=1; else if(v<-1) v=-1;
    pxa.push(Math.round(x0+w*i/(VIZ_WAVE_N-1))); pya.push(Math.round(cy-v*hh));
    poly.push(pxa[i],pya[i]);
  }
  poly.push(x0+w,cy);
  try{ gr.FillPolygon(fill,0,poly); }catch(e){}
  gr.DrawLine(x0,cy,x0+w,cy,1,VIZ_AXIS);
  for(i=1;i<VIZ_WAVE_N;i++) gr.DrawLine(pxa[i-1],pya[i-1],pxa[i],pya[i],3,body);
}
var VIZ_STYLES=[];
onLangChange(function(){
  VIZ_STYLES=[[T('viz.bars'),'bars'],[T('viz.radial'),'radial']];
});
var vizMenuOpen=false, HB_VIZ=null, VIZ_HB=[];
function setVizStyle(v){
  vizStyle=v; vizMenuOpen=false;
  repaintAll();
}
function drawVizBody(gr,top,bot){
  if(vizStyle==='radial') drawVizRadial(gr,top,bot);
  else if(vizStyle==='wave') drawVizWave(gr,top,bot);
  else drawVizBars(gr,top,bot);              // also the landing place for an unknown property value
}
function drawFsViz(gr,bot){
  fsMiniNP(gr);
  drawVizBody(gr,VIZ_TOP,bot);
  var pw=196, ph=36, pxx=W-72-pw, py=114;
  HB_VIZ=drawDropPill(gr,pxx,py,pw,ph,labelOf(VIZ_STYLES,vizStyle,T('viz.bars')),vizMenuOpen);
  VIZ_HB=vizMenuOpen?drawDropMenu(gr,HB_VIZ,VIZ_STYLES,vizStyle,pw):[];
}
function vizDirtyRect(){
  var top=VIZ_TOP, bot=Math.max(top+1,H-172), cy=Math.round((top+bot)/2);
  if(vizStyle==='radial'){
    var half=Math.min((bot-top)/2,Math.max(0,(W-VIZ_MARGIN*2)/2));
    var R=Math.round(half*VIZ_R_FILL);
    if(R<90) return {x:0,y:top,w:0,h:0};
    var ry0=Math.max(top,cy-R-8), ry1=Math.min(bot,cy+R+8);
    return fsClampRect(Math.round(W/2)-R-8,ry0,(R+8)*2,Math.max(0,ry1-ry0));
  }
  var hh=Math.round((bot-top)/2*(vizStyle==='wave'?VIZ_WAVE_AMP:VIZ_SWING))+6;
  var by0=Math.max(top,cy-hh), by1=Math.min(bot,cy+hh);
  return fsClampRect(VIZ_MARGIN-4,by0,W-VIZ_MARGIN*2+8,Math.max(0,by1-by0));
}
// clears and repaints only the tight bounding rect of the active visualizer inside the band
function drawVizBand(gr){
  var vr=vizDirtyRect();
  if(vr.w<=0 || vr.h<=0) return;
  var pr=physicalRect(vr);
  if(gr._native) gr._native.FillSolidRect(pr.x,pr.y,pr.w,pr.h,COL.base);
  else gr.FillSolidRect(vr.x,vr.y,vr.w,vr.h,COL.base);
  drawVizBody(gr,VIZ_TOP,H-172);
}

/* Apple Music inspired now-playing canvas. Backdrop & glyph rows are pre-baked; partial regions
   blit 1:1 from fsBackdrop and paint only the changing seek/controls/icons/lyrics band. */
var fsBackdrop=null, fsBackdropArt=null, fsBackdropKey='', fsFonts={}, fsClock=null, fsAnimTimer=null, fsAnimLastMs=0, fsTickTime=0, fsLastPaintMs=0, fsLastCurLine=-2;
var FS_CLOCK_MS=100;
var fsLy={model:null,w:0,font:null,rows:[],scroll:0,target:0,snap:true,manualUntil:0,max:0,lh:0,total:0};
function fsFont(size,w,kind){
  size=Math.max(1,Math.round(size*UISCALE));
  var role=(kind==='lyric')?'lyric':'ui';
  var wt=(w==='bold'||w===true)?'bold':(w==='med'?'med':'reg');
  var key=role+':'+size+':'+wt;
  if(!fsFonts[key]){
    var spec=(FONT_SPEC && FONT_SPEC[role])?FONT_SPEC[role]:buildFontWeights(probeUiBase());
    var d=fontFace(spec,wt);
    fsFonts[key]=gdi.Font(d.name,size,d.style);
  }
  return fsFonts[key];
}
function fsGeometry(){
  var pad=Math.round(Math.max(28,Math.min(100,W*0.055))), gap=Math.round(Math.max(36,Math.min(180,W*0.075)));
  if(W<1000||H<560){
    pad=24;var cs=H<560?64:96,ly=100+cs+68;
    return {compact:true,x:pad,y:100,art:cs,w:cs,pad:pad,rx:pad,ry:ly,rw:Math.max(100,W-pad*2),rh:Math.max(32,H-ly-148)};
  }
  var art=Math.round(Math.max(120,Math.min(720,(W-pad*2-gap)*0.45,H-388)));
  var x=Math.round(pad+Math.max(0,((W-pad*2-gap)*0.45-art)/2));
  var blockH=art+284, y=Math.max(96,Math.round((H-blockH)/2));
  var rx=Math.round(pad+(W-pad*2-gap)*0.45+gap);
  var rw=Math.max(100,W-pad-rx), ry=112, rh=Math.max(120,H-216);
  return {x:x,y:y,art:art,w:art,pad:pad,rx:rx,ry:ry,rw:rw,rh:rh};
}
function fsNativeRect(){var a=fsGeometry();return {x:a.rx,y:a.ry,w:a.rw,h:a.rh};}
function fsLyReset(){
  stopFsAnim();
  disposeFsLyBmps();
  fsLy.model=null;fsLy.w=0;fsLy.font=null;fsLy.rows=[];
  fsLy.snap=true;fsLy.manualUntil=0;fsLy.scroll=0;fsLy.target=0;
  fsLastCurLine=-2;fsLastPaintMs=0;
}
function fsSyncedLineIndex(){
  var m=(fsView==='lyrics')?activeLyricsModel():null;
  if(!m||!m.synced||!m.lines||!m.lines.length) return -2;
  var t=0; try{ t=fb.PlaybackTime; }catch(e){ t=0; }
  var arr=m.lines, lo=0, hi=arr.length-1, cur=-1;
  while(lo<=hi){
    var mid=(lo+hi)>>1;
    if(arr[mid].t<=t){ cur=mid; lo=mid+1; }
    else hi=mid-1;
  }
  return cur;
}
function fsLayoutMetrics(gr,a){
  var key=null;
  if(!a){
    key=fsMetricsKey();
    if(fsMetricsCache && fsMetricsCache.key===key) return fsMetricsCache.m;
    a=fsGeometry();
    if(fsView==='default'&&!a.compact) a.x=Math.round((W-a.art)/2);
  }
  var topRect=fsClampRect(W-a.pad-144,50,158,50);
  var seekRect, ctrlRect, lyRect, m;
  if(fsView==='viz'){
    var vcx=W/2, vcy=H-76;
    seekRect=fsClampRect(64,H-144,Math.max(10,W-128),28);
    ctrlRect=fsClampRect(vcx-120,vcy-30,240,60);
    lyRect={x:0,y:0,w:0,h:0};
    m={a:a,topRect:topRect,seekRect:seekRect,ctrlRect:ctrlRect,lyRect:lyRect};
  } else if(a.compact){
    var sy=H-128, cxC=W/2, cyC=H-60;
    seekRect=fsClampRect(a.pad-6,sy-12,Math.max(10,W-a.pad*2+12),42);
    var cl=Math.min(cxC-146,a.pad-6), cr=(W>=640)?(W-a.pad+6):(cxC+146);
    ctrlRect=fsClampRect(cl,cyC-30,Math.max(10,cr-cl),60);
    var lyTopC=a.ry-44, lyBotC=Math.min(a.ry+a.rh+2,Math.max(lyTopC,seekRect.y-2));
    lyRect=fsClampRect(a.rx-4,lyTopC,a.rw+8,Math.max(0,lyBotC-lyTopC));
    m={a:a,topRect:topRect,seekRect:seekRect,ctrlRect:ctrlRect,lyRect:lyRect,compact:true,cx:cxC,sy:sy,cy:cyC};
  } else {
    var x=a.x, y=a.y, s=a.art, cx=x+s/2;
    var titleSize=Math.max(19,Math.min(30,s/18));
    var titleFont=fsFont(titleSize,true), artistFont=fsFont(Math.max(15,titleSize*0.71),false);
    var titleH=gr?Math.max(42,(lineH(gr,titleFont)||0)+4):Math.max(42,Math.round(titleSize*1.35)+4);
    var artistH=gr?Math.max(32,(lineH(gr,artistFont)||0)+4):Math.max(32,Math.round(titleSize*0.71*1.35)+4);
    var titleY=y+s+22, seekY=titleY+titleH+artistH+20;
    var cy=seekY+69, outer=Math.min(190,s*0.43), vw=Math.min(196,s*0.55), vx=cx-vw/2, vy=cy+72;
    seekRect=fsClampRect(x-6,seekY-12,s+12,46);
    var ctrlL=Math.min(x-4,cx-outer-30,vx-36), ctrlR=Math.max(x+s+4,cx+outer+30,vx+vw+8);
    ctrlRect=fsClampRect(ctrlL,cy-28,ctrlR-ctrlL,(vy+14)-(cy-28));
    lyRect=fsClampRect(a.rx-4,a.ry-2,a.rw+8,a.rh+44);
    m={
      a:a,topRect:topRect,seekRect:seekRect,ctrlRect:ctrlRect,lyRect:lyRect,
      compact:false,x:x,y:y,s:s,cx:cx,titleY:titleY,titleFont:titleFont,artistFont:artistFont,
      titleH:titleH,artistH:artistH,seekY:seekY,cy:cy,outer:outer,step:Math.min(104,s*0.22),vw:vw,vx:vx,vy:vy
    };
  }
  if(gr && key) fsMetricsCache={key:key,m:m};
  return m;
}
function fsClearRegion(gr,r){
  if(!r||r.w<=0||r.h<=0) return;
  if(fsView==='viz'){
    var pr=physicalRect(r);
    if(gr._native) gr._native.FillSolidRect(pr.x,pr.y,pr.w,pr.h,COL.base);
    else gr.FillSolidRect(r.x,r.y,r.w,r.h,COL.base);
  } else fsBlitBackdropRect(gr,r.x,r.y,r.w,r.h);
}
function fsAnimTick(){
  if(!fsMode || fsView!=='lyrics'){ stopFsAnim(); return; }
  var now=nowMs(), dt=fsAnimLastMs?Math.min(0.05,Math.max(0.001,(now-fsAnimLastMs)/1000)):(ANIM_MS/1000);
  fsAnimLastMs=now;
  var prevR=Math.round(fsLy.scroll);
  var diff=fsLy.target-fsLy.scroll;
  if(Math.abs(diff)<0.5){
    fsLy.scroll=fsLy.target;
    stopFsAnim();
    repaintFsLyrics();
    return;
  }
  fsLy.scroll+=diff*(1-Math.exp(-12*dt));
  if(Math.abs(fsLy.target-fsLy.scroll)<0.5){
    fsLy.scroll=fsLy.target;
    stopFsAnim();
    repaintFsLyrics();
    return;
  }
  if(Math.round(fsLy.scroll)!==prevR) repaintFsLyrics();
}
function startFsAnim(){
  if(!fsAnimTimer){ fsAnimLastMs=nowMs(); fsAnimTimer=window.SetInterval(fsAnimTick,ANIM_MS); }
}
function stopFsAnim(){
  if(fsAnimTimer){ window.ClearInterval(fsAnimTimer); fsAnimTimer=null; }
  fsAnimLastMs=0;
}
function fsClockTick(){
  if(!fsMode){ stopFsClock(); stopFsAnim(); return; }
  if(fsView==='viz') return;
  var now=nowMs(), wallNow=Date.now();
  if(typeof NV==='object' && NV && NV.key!==nvTrackKey()){
    fsLastPaintMs=now;
    repaintAll();
    return;
  }
  var resume=!!(fsLy.manualUntil && wallNow>fsLy.manualUntil);
  if(resume) fsLy.manualUntil=0;
  var curLine=fsSyncedLineIndex(), lineChanged=(curLine!==fsLastCurLine);
  if(lineChanged || resume){
    fsLastCurLine=curLine;
    if(fsView==='lyrics'){
      var m=activeLyricsModel();
      if(m && m.synced && fsLy.model===m && fsLy.rows.length && wallNow>=fsLy.manualUntil){
        fsLy.target=fsLy.rows[Math.max(0,curLine)].center;
      }
      if(Math.abs(fsLy.target-fsLy.scroll)>=0.5) startFsAnim();
      repaintFsLyrics();
    }
  }
  if(fb.IsPlaying && !fb.IsPaused && (now-fsLastPaintMs>=250)){
    fsLastPaintMs=now;
    repaintFsSeek();
  }
}
function startFsClock(){
  if(fsClock) return;
  fsTickTime=nowMs();
  fsLastPaintMs=fsTickTime;
  fsLastCurLine=-2;
  fsClock=window.SetInterval(fsClockTick,FS_CLOCK_MS);
}
function stopFsClock(){
  if(fsClock){ window.ClearInterval(fsClock); fsClock=null; }
  stopFsAnim();
  fsLastCurLine=-2; fsLastPaintMs=0;
}
function ensureFsBackdrop(){
  var art=npResolveArt(true);
  var key=px(W)+'x'+px(H);
  if(art===fsBackdropArt && fsBackdropKey===key && fsBackdrop && !fsBackdrop._disposed) return fsBackdrop;
  disposeFsBackdrop();
  fsBackdropArt=art; fsBackdropKey=key;
  var blur=null, dst=null, g=null;
  try{
    if(art){
      var bw=W>=H?128:Math.max(1,Math.round(128*W/Math.max(1,H)));
      var bh=H>=W?128:Math.max(1,Math.round(128*H/Math.max(1,W)));
      blur=artResizeCoverBitmap(art,bw,bh);
      if(blur) blur.StackBlur(30);
    }
    dst=dpiImage(Math.max(1,W),Math.max(1,H));
    if(dst){
      g=dst.GetGraphics();
      var dw=dst.Width, dh=dst.Height;
      g.FillSolidRect(0,0,dw,dh,RGB(30,32,39));
      if(blur){
        g.SetInterpolationMode(7);   // HighQualityBicubic once at bake time instead of per-frame
        // Overscan by 3 source pixels on every edge so GDI+ bicubic taps stay strictly inside
        // the blurred bitmap and never blend transparent outside-edge pixels into a border halo.
        var padX=(blur.Width>8)?Math.ceil(dw/blur.Width)*3:0;
        var padY=(blur.Height>8)?Math.ceil(dh/blur.Height)*3:0;
        g.DrawImage(blur,-padX,-padY,dw+padX*2,dh+padY*2,0,0,blur.Width,blur.Height,0,255);
      }
      g.FillSolidRect(0,0,dw,dh,RGBA(9,10,15,150));
      // Smooth single gradient replaces 16 per-frame alpha-blended slices
      g.FillGradRect(0,0,dw,dh,90,RGBA(0,0,0,0),RGBA(0,0,0,35),1.0);
      dst.ReleaseGraphics(g); g=null;
      fsBackdrop=dst; dst=null;
    }
  }catch(e){
    if(g && dst){ try{ dst.ReleaseGraphics(g); }catch(e2){} }
    if(dst){ try{ dst.Dispose(); }catch(e3){} }
    fsBackdrop=null;
  }
  if(blur){ try{ blur.Dispose(); }catch(e4){} }
  return fsBackdrop;
}
function fsBlitBackdropRect(gr,x,y,w,h){
  var c=fsClampRect(x,y,w,h);
  if(c.w<=0 || c.h<=0) return;
  var bd=ensureFsBackdrop();
  if(bd){
    blitCard(gr,bd,0,0,c.x,c.y,c.x+c.w,c.y+c.h);
  } else {
    var pr=physicalRect(c);
    if(gr._native) gr._native.FillSolidRect(pr.x,pr.y,pr.w,pr.h,RGB(30,32,39));
    else gr.FillSolidRect(c.x,c.y,c.w,c.h,RGB(30,32,39));
  }
}
function fsDrawBackdrop(gr){
  fsBlitBackdropRect(gr,0,0,W,H);
}
function fsTransport(gr,name,x,y,size,act,active){
  var over=hv(x-26,y-26,x+26,y+26), c=active?RGB(255,130,150):RGBA(255,255,255,over?255:205);
  if(over) gr.FillEllipse(x-26,y-26,52,52,RGBA(255,255,255,26));
  drawIcon(gr,name,c,x-26,y-26,52,52,size);
  HB_CTRL.push({x0:x-26,y0:y-26,x1:x+26,y1:y+26,act:act});
}
function fsDrawSeekOnly(gr,m){
  var len=fb.PlaybackLength, time=drag==='seek'?len*dragFrac:fb.PlaybackTime;
  if(fsView==='viz'){
    HB_SEEK=drawTrackBar(gr,72,H-132,W-144,4,RGBA(255,255,255,50),len>0?clamp01(time/len):0);
    return;
  }
  if(m.compact){
    var a=m.a, sy=m.sy;
    HB_SEEK=drawTrackBar(gr,a.pad,sy,W-a.pad*2,4,RGBA(255,255,255,48),len>0?clamp01(time/len):0);
    tL(gr,fmtTime(time),fsFont(12,false),COL.text2,a.pad,sy+8,70,20);
    tR(gr,'\u2212'+fmtTime(Math.max(0,len-time)),fsFont(12,false),COL.text2,W-a.pad-70,sy+8,70,20);
    return;
  }
  HB_SEEK=drawTrackBar(gr,m.x,m.seekY,m.s,4,RGBA(255,255,255,48),len>0?clamp01(time/len):0);
  tL(gr,fmtTime(time),fsFont(12,false),RGBA(255,255,255,135),m.x,m.seekY+9,m.s/2,20);
  tR(gr,'\u2212'+fmtTime(Math.max(0,len-time)),fsFont(12,false),RGBA(255,255,255,135),m.cx,m.seekY+9,m.s/2,20);
}
function fsDrawCtrlOnly(gr,m){
  HB_CTRL=[]; HB_VOL=null;
  if(fsView==='viz'){
    var vcy=H-76, vcx=W/2;
    fsTransport(gr,'prev',vcx-88,vcy,30,'prev',false);
    fsTransport(gr,fb.IsPlaying&&!fb.IsPaused?'pause':'play',vcx,vcy,44,'play',false);
    fsTransport(gr,'next',vcx+88,vcy,30,'next',false);
    return;
  }
  if(m.compact){
    var a=m.a, cxC=m.cx, cyC=m.cy;
    fsTransport(gr,'shuffle',cxC-116,cyC,20,'shuffle',pbShuffle);
    fsTransport(gr,'prev',cxC-58,cyC,32,'prev',false);
    fsTransport(gr,fb.IsPlaying&&!fb.IsPaused?'pause':'play',cxC,cyC,44,'play',false);
    fsTransport(gr,'next',cxC+58,cyC,32,'next',false);
    fsTransport(gr,pbRepeat===2?'repeat1':'repeat',cxC+116,cyC,20,'repeat',pbRepeat>0);
    if(W>=640){
      var vxC=W-a.pad-96;
      HB_VOL=drawTrackBar(gr,vxC,cyC,96,4,RGBA(255,255,255,48),clamp01(vol2pos(fb.Volume)));
    }
    return;
  }
  var cx=m.cx, cy=m.cy, step=m.step, outer=m.outer, vx=m.vx, vy=m.vy;
  fsTransport(gr,'shuffle',cx-outer,cy,21,'shuffle',pbShuffle);
  fsTransport(gr,'prev',cx-step,cy,36,'prev',false);
  fsTransport(gr,fb.IsPlaying&&!fb.IsPaused?'pause':'play',cx,cy,51,'play',false);
  fsTransport(gr,'next',cx+step,cy,36,'next',false);
  fsTransport(gr,pbRepeat===2?'repeat1':'repeat',cx+outer,cy,21,'repeat',pbRepeat>0);
  drawIcon(gr,'volume',RGBA(255,255,255,125),vx-32,vy-11,22,22,18);
  HB_VOL=drawTrackBar(gr,vx,vy,m.vw,4,RGBA(255,255,255,45),clamp01(vol2pos(fb.Volume)));
}
function fsDrawTopOnly(gr,pad){
  HB_FS_TOP=[];
  fsIcon(gr,'equalizer',fsView==='viz'?COL.text:RGBA(255,255,255,130),W-pad-130,64,24,'viz',HB_FS_TOP);
  fsIcon(gr,'mic',fsView==='lyrics'?COL.text:RGBA(255,255,255,130),W-pad-76,64,24,'lyrics',HB_FS_TOP);
  fsIcon(gr,'compress',COL.text,W-pad-22,64,24,'exit',HB_FS_TOP);
  fsSyncHitboxes();
}
function fsArtworkControls(gr,m){
  var a=m.a;
  if(a.compact){
    drawNowPlayingCover(gr,a.x,a.y,a.art,8);
    var tx=a.x+a.art+18, tw=Math.max(80,W-a.pad-tx);
    tL(gr,npTitleStr||T('queue.nothing_playing'),fsFont(22,true),COL.text,tx,a.y+4,tw,34);
    tL(gr,npArtistStr,fsFont(15,false),RGB(204,204,210),tx,a.y+42,tw,24);
  } else {
    var x=m.x, y=m.y, s=m.s;
    var cb=npCoverBox(x,y,s);
    gr.FillRoundRect(cb.x+4,cb.y+14,cb.w,cb.h,16,16,RGBA(0,0,0,48));
    drawNowPlayingCover(gr,x,y,s,14);
    tL(gr,npTitleStr||T('meta.now_playing'),m.titleFont,COL.text,x,m.titleY,s,m.titleH);
    tL(gr,npArtistStr||T('meta.choose_music'),m.artistFont,RGB(204,204,210),x,m.titleY+m.titleH,s,m.artistH);
  }
  fsDrawSeekOnly(gr,m);
  fsDrawCtrlOnly(gr,m);
}
function fsLyLayout(gr,model,w,font){
  if(fsLy.model===model&&fsLy.w===w&&fsLy.font===font) return;
  disposeFsLyBmps();
  var lh=Math.ceil((lineH(gr,font)||0)*1.14), gap=Math.round(lh*0.65), rows=[], acc=0;
  for(var i=0;i<model.lines.length;i++){
    var parts=[], paras=model.lines[i].text.split('\n');
    for(var k=0;k<paras.length;k++){
      var wr=gr.EstimateLineWrap(paras[k],font,w);
      for(var j=0;j<wr.length;j+=2) parts.push(wr[j]);
    }
    if(!parts.length)parts=[''];
    var h=parts.length*lh; rows.push({parts:parts,bmps:[],top:acc,center:acc+h/2,h:h}); acc+=h+gap;
  }
  fsLy.model=model;fsLy.w=w;fsLy.font=font;fsLy.rows=rows;fsLy.lh=lh;fsLy.total=Math.max(0,acc-gap);fsLy.snap=true;
}
function fsLyPartBmp(gr,row,j,maxW,lh,font){
  if(!row.bmps) row.bmps=[];
  var ent=row.bmps[j];
  if(ent!==undefined){
    if(ent && ent.img && !ent.img._disposed) return ent;
    if(ent===null) return null;
  }
  var txt=row.parts[j]||'';
  if(!txt){ row.bmps[j]=null; return null; }
  var bw=Math.min(maxW,Math.max(1,Math.ceil(gr.CalcTextWidth(txt,font))+12));
  var im=null, g=null;
  try{
    im=dpiImage(bw,lh);
    if(im){
      g=dpiGraphics(im.GetGraphics());
      g.SetTextRenderingHint(4);   // AntiAlias grayscale once into transparent white glyph bitmap
      try{
        g.DrawString(txt,font,RGB(255,255,255),0,0,bw,lh,0x1000);
      }finally{
        g.SetTextRenderingHint(0);
      }
      releaseDpiGraphics(im,g); g=null;
      while(fsLyBmpQueue.length>=FS_LY_BMP_CAP){
        var old=fsLyBmpQueue.shift();
        if(old){
          if(old.img){ try{ old.img.Dispose(); }catch(e2){} old.img=null; }
          if(old.row && old.row.bmps) old.row.bmps[old.idx]=undefined;
        }
      }
      ent={img:im,w:bw,h:lh,row:row,idx:j};
      row.bmps[j]=ent;
      fsLyBmpQueue.push(ent);
      im=null;
      return ent;
    }
  }catch(e){
    if(g && im){ try{ releaseDpiGraphics(im,g); }catch(e3){} }
    if(im){ try{ im.Dispose(); }catch(e4){} }
  }
  return null;
}
function fsDrawLyrics(gr,a,partial){
  HB_FS_LY=[];
  var isRemote=(typeof nvShouldLoadLyrics==='function'&&nvShouldLoadLyrics());
  if(isRemote) nvLoad(); else if(typeof loadLyrics==='function') loadLyrics();
  var col=RGBA(255,255,255,130), label=isRemote?T('lyrics.heading_nv'):T('lyrics.heading');
  var lblW=a.compact?a.rw:Math.min(a.rw,Math.max(40,(W-a.pad-146)-a.rx));
  if(!partial || a.compact) tL(gr,label,fsFont(12,true),col,a.rx,a.ry-44,lblW,24);
  var model=activeLyricsModel();
  if(!model){
    var st=isRemote?NV.status:(lyrics==='none'?'none':'loading');
    var text=st==='loading'?T('lyrics.loading'):(isRemote&&NV.status==='idle')?T('lyrics.waiting_music'):T('lyrics.none');
    tL(gr,text,fsFont(Math.max(22,Math.min(36,a.rw/18)),'bold','lyric'),col,a.rx,a.ry+a.rh*0.43,a.rw,80);
    fsSyncHitboxes();
    return;
  }
  var font=fsFont(Math.max(24,Math.min(46,a.rw/17)),'bold','lyric');
  fsLyLayout(gr,model,a.rw,font);
  var rows=fsLy.rows, cur=-1, time=0;
  try{ time=fb.PlaybackTime; }catch(e){ time=0; }
  if(model.synced){
    var arr=model.lines, lo=0, hi=arr.length-1;
    while(lo<=hi){
      var mid=(lo+hi)>>1;
      if(arr[mid].t<=time){ cur=mid; lo=mid+1; }
      else hi=mid-1;
    }
  }
  var anchor=a.ry+a.rh*0.44;
  if(model.synced && Date.now()>fsLy.manualUntil && rows.length) fsLy.target=rows[Math.max(0,cur)].center;
  else if(!model.synced) anchor=a.ry;
  fsLy.max=Math.max(0,model.synced?(fsLy.total-a.rh*0.45):(fsLy.total-a.rh));
  if(!model.synced){
    if(fsLy.target>fsLy.max) fsLy.target=fsLy.max;
    if(fsLy.scroll>fsLy.max) fsLy.scroll=fsLy.max;
  }
  if(fsLy.snap){ fsLy.scroll=fsLy.target; fsLy.snap=false; }
  fsLastCurLine=cur;
  if(Math.abs(fsLy.target-fsLy.scroll)>=0.5) startFsAnim();
  var i, j, lyTop=a.ry, lyBot=a.ry+a.rh, lh=fsLy.lh;
  for(i=0;i<rows.length;i++){
    var row=rows[i], top=Math.round(anchor+row.top-fsLy.scroll);
    if(top+row.h<lyTop) continue;
    if(top>lyBot) break;
    var distance=Math.abs(top+row.h/2-anchor), edge=Math.min(top-lyTop,lyBot-top-row.h);
    var baseAlpha=i===cur?255:Math.round(130-Math.min(65,distance/8));
    baseAlpha=Math.round(baseAlpha*clamp01((edge+lh)/(lh*2)));
    for(j=0;j<row.parts.length;j++){
      var sy=top+j*lh;
      if(sy<lyTop || sy+lh>lyBot) continue;
      var hover=hv(a.rx,sy,a.rx+a.rw,sy+lh);
      var aVal=hover?255:baseAlpha;
      if(aVal>0){
        var ent=fsLyPartBmp(gr,row,j,a.rw,lh,font);
        if(ent && ent.img){
          if(gr._native) gr._native.DrawImage(ent.img,px(a.rx),px(sy),ent.img.Width,ent.img.Height,0,0,ent.img.Width,ent.img.Height,0,aVal);
          else gr.DrawImage(ent.img,a.rx,sy,ent.w,ent.h,0,0,ent.img.Width,ent.img.Height,0,aVal);
        } else if(row.parts[j]){
          gr.SetTextRenderingHint(4);
          try{ gr.DrawString(row.parts[j],font,RGBA(255,255,255,aVal),a.rx,sy,a.rw,lh,0x1000); }
          finally{ gr.SetTextRenderingHint(0); }
        }
      }
      if(model.synced) HB_FS_LY.push({x0:a.rx,y0:sy,x1:a.rx+a.rw,y1:sy+lh,act:'seek:'+model.lines[i].t});
    }
  }
  fsSyncHitboxes();
  if(model.synced && Date.now()<fsLy.manualUntil){
    if(a.compact) tR(gr,T('lyrics.auto_scroll_soon'),fsFont(12,false),col,a.rx,a.ry-44,a.rw,24);
    else tL(gr,T('lyrics.auto_scroll_soon'),fsFont(12,false),col,a.rx,a.ry+a.rh+15,a.rw,22);
  }
}
function fsLyricsWheel(step){
  var a=fsGeometry();
  if(fsView!=='lyrics'||mx<a.rx||mx>a.rx+a.rw||!activeLyricsModel()) return false;
  if(fsLy.max<=0) return false;
  fsLy.manualUntil=Date.now()+4500;
  fsLy.target=Math.max(0,Math.min(fsLy.max,fsLy.target-step*(fsLy.lh||40)*2));
  startFsAnim();
  repaintFsLyrics();
  return true;
}
function drawFsBar(gr){
  var m=fsLayoutMetrics(gr);
  fsDrawSeekOnly(gr,m);
  fsDrawCtrlOnly(gr,m);
}
function drawFsSeekRegion(gr){
  var m=fsLayoutMetrics(gr);
  fsClearRegion(gr,m.seekRect);
  fsDrawSeekOnly(gr,m);
}
function drawFsCtrlRegion(gr){
  var m=fsLayoutMetrics(gr);
  fsClearRegion(gr,m.ctrlRect);
  fsDrawCtrlOnly(gr,m);
}
function drawFsTopRegion(gr){
  var m=fsLayoutMetrics(gr);
  fsClearRegion(gr,m.topRect);
  fsDrawTopOnly(gr,m.a.pad);
}
function drawFsLyricsRegion(gr){
  if(fsView!=='lyrics') return;
  var m=fsLayoutMetrics(gr);
  fsClearRegion(gr,m.lyRect);
  fsDrawLyrics(gr,m.a,true);
}
function drawFullscreen(gr){
  applyKeyMode();
  HB_CTRL=[]; HB_FS=[]; HB_FS_TOP=[]; HB_FS_LY=[]; HB_SEEK=null; HB_VOL=null; HB_VIZ=null;
  if(typeof clearNonFsHitboxes==='function') clearNonFsHitboxes();
  var m=fsLayoutMetrics(gr);
  if(fsView==='viz'){
    gr.FillSolidRect(0,0,W,H,COL.base);
    drawFsViz(gr,H-172);
    drawFsBar(gr);
  } else {
    fsDrawBackdrop(gr);
    fsArtworkControls(gr,m);
    if(fsView==='lyrics') fsDrawLyrics(gr,m.a,false);
  }
  var pad=m.a.pad;
  // Keep the buttons below UI Wizard's native title-drag strip.
  if(fsView!=='viz') tL(gr,T('queue.now_playing'),fsFont(13,true),RGBA(255,255,255,160),pad,60,Math.max(40,W-pad*2-146),28);
  fsDrawTopOnly(gr,pad);
}
