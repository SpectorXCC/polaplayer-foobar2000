/* verdant/views/fullscreen.js -- fullscreen chill mode and the spectrum visualizer
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

/* ------------------------- fullscreen "chill" mode ------------------------- */
var fsRestoreWindow=false;
function disposeFsBackdrop(){
  if(fsBackdrop){ try{ fsBackdrop.Dispose(); }catch(e){} fsBackdrop=null; }
  fsBackdropArt=null; fsBackdropKey='';
}
function enterFullscreen(){
  var wasFs=fsMode;
  fsMode=true;
  if(typeof clearNormalOverlays==='function') clearNormalOverlays();
  if(typeof clearNonFsHitboxes==='function') clearNonFsHitboxes();
  capW=-1; applyCaption(); applyKeyMode();
  fsView='lyrics'; stopLyAnim(); fsLyReset(); nvLoad(); syncNavidromePanel();
  try{
    if(UIWizard){
      if(!wasFs) fsRestoreWindow=(UIWizard.WindowState!==1);
      if(UIWizard.WindowState!==1) UIWizard.ToggleMaximize();
    }
  }catch(e){ fsRestoreWindow=false; }
  startFsClock(); repaintAll();
}
function exitFullscreen(){
  fsMode=false; capW=-1; applyCaption(); applyKeyMode();
  syncNavidromePanel(); vizMenuOpen=false; stopViz(); stopFsClock(); stopLyAnim();
  disposeFsBackdrop();
  try{
    if(fsRestoreWindow && UIWizard && UIWizard.WindowState===1) UIWizard.ToggleMaximize();
  }catch(e){}
  fsRestoreWindow=false;
  repaintAll();
}
// the style list belongs to the viz view: leaving it (or fullscreen) must not leave a menu armed
function setFsView(v){ fsView=v; vizMenuOpen=false; if(v==='viz') startViz(); else stopViz(); if(v==='lyrics') nvLoad(); fsLyReset(); repaintAll(); }
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
/* The dB window mapped onto 0..1, and the main tuning knob here. A pure full-scale sine lands one
   bin at -6 dB, and the tilt adds up to +14 on top, so a window ending at -8 pinned ordinary music
   against the ceiling with every bar at maximum. Ending at 0 leaves the top of the range for what
   is actually a peak. Raise the floor to make quiet passages calmer, lower it to make them busier. */
var VIZ_DB_FLOOR=-52, VIZ_DB_CEIL=0;
var VIZ_TILT_HZ=250, VIZ_TILT=0.42;          // treble lift, as an exponent on (f/VIZ_TILT_HZ)
var VIZ_F0=32;                               // lowest band edge; the top edge follows the rate
var vizRe=null, vizIm=null, vizWin=null, vizBand=null;

function vizBuffers(){ if(!vizRe){ vizRe=new Float64Array(VIZ_FFT); vizIm=new Float64Array(VIZ_FFT); } }
// Hann window, built once per size: 2048 cosines every frame is pure waste
function vizWindow(n){
  if(vizWin && vizWin.n===n) return vizWin.w;
  var w=new Float64Array(n);
  for(var i=0;i<n;i++) w[i]=0.5-0.5*Math.cos(2*Math.PI*i/(n-1));
  vizWin={n:n,w:w}; return w;
}
/* Band edges in Hz -> bin ranges, plus each band's tilt gain. Cached per (rate, size), both of
   which only change when the output format does. The lowest bands can land on the same bin --
   2048 points at 44.1k is ~21 Hz -- and that is fine: neighbouring bass bars moving together is
   what bass actually looks like. */
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
/* Oscilloscope trace, captured from the same chunk as the spectrum. Three details do the work:
   buckets are AVERAGED rather than point-sampled, so the trace is anti-aliased instead of aliased;
   it starts at a rising zero crossing, so a steady tone stands still instead of sliding across the
   screen frame after frame; and the level is tracked, so a quiet passage still draws a wave rather
   than a flat line. */
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
function fftMag(re,im,n){
  var i,j=0,k,l,t; for(i=1;i<n;i++){ var bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit; if(i<j){ t=re[i];re[i]=re[j];re[j]=t; t=im[i];im[i]=im[j];im[j]=t; } }
  for(l=2;l<=n;l<<=1){ var ang=-2*Math.PI/l, wr=Math.cos(ang), wi=Math.sin(ang); for(i=0;i<n;i+=l){ var cr=1,ci=0; for(k=0;k<l/2;k++){ var pr=re[i+k], pi=im[i+k], qr=cr*re[i+k+l/2]-ci*im[i+k+l/2], qi=cr*im[i+k+l/2]+ci*re[i+k+l/2]; re[i+k]=pr+qr; im[i+k]=pi+qi; re[i+k+l/2]=pr-qr; im[i+k+l/2]=pi-qi; var ncr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=ncr; } } }
}
function startViz(){ if(!vizTimer){ vizLastMs=nowMs(); vizTimer=window.SetInterval(vizUpdate,VIZ_MS); } }
function stopViz(){ if(vizTimer){ window.ClearInterval(vizTimer); vizTimer=null; } vizLastMs=0; }
function fsIcon(gr,name,col,x,y,sz,act){
  var hot=hv(x-8,y-8,x+sz+8,y+sz+8);
  if(hot) gr.FillEllipse(x-8,y-8,sz+16,sz+16,RGBA(255,255,255,34));
  drawIcon(gr,name,hot?COL.text:col,x,y,sz,sz,sz);
  HB_FS.push({x0:x-8,y0:y-8,x1:x+sz+8,y1:y+sz+8,act:act});
}
// name of the real playlist driving playback, or null (e.g. playing from library/search/artist)
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
    var lbl='PLAYING FROM PLAYLIST  ';
    tL(gr,lbl,FONT.fsSrc,COL.text3,64,20,srcMaxW,20);
    var lw=gr.CalcTextWidth(lbl,FONT.fsSrc);
    tL(gr,src,FONT.fsSrcName,COL.text,64+lw,20,Math.max(0,srcMaxW-lw),20);   // bold: the playlist name
  }
  if(typeof qDrawArt==='function') qDrawArt(gr,64,78,s,6,NP,'np','np');
  else drawCover(gr,64,78,s,6,NP,'np');
  tL(gr,npTitleStr||'Nothing playing',FONT.sect2,COL.text,tx,84,npMaxW,26);
  tL(gr,npArtistStr,FONT.qName,COL.text2,tx,116,npMaxW,20);
}
// cover + title + artist, centred between the header and the transport bar
function vizAlpha(c,a){ return RGBA((c>>16)&255,(c>>8)&255,c&255,a); }
/* One colour ramp, shared by every style: Verdant green, brightening toward white as a band gets
   louder. Shared rather than repeated, because two call sites matching each other by eye is how
   they drift apart in the first place -- change this and every visualizer changes with it.
   (An earlier version tinted the bars with the cover's dominant colour. It is gone: the styles now
   read as part of the theme rather than as a per-track accent.) */
var VIZ_PEAK=blend(THEME_DARK.green,THEME_DARK.text,0.22);
function vizCol(v){ return blend(THEME_DARK.greenC,VIZ_PEAK,clamp01(v*1.3)); }
/* ---- proportions -------------------------------------------------------------
   Two rules, one borrowed and one the theme's own.
   Borrowed, from Stephen Few's "Bar Widths and the Spaces in Between": the gap between bars should
   be 50-75% of a bar's width -- wider than that and it reads as exaggerated, wasting space without
   adding anything -- and the longest bar wants a length-to-width ratio of at least about 10:1,
   below which bars look stubby and their width distracts from the one dimension that carries the
   meaning. The bars were at the loose end of the first rule; the radial spokes broke the spirit of
   the second in the other direction, running to 140% of the inner radius, so the ring was longer
   than the disc it was supposed to wrap.
   The theme's own: everything else in fullscreen -- the seek bar, the mini now-playing block, the
   transport row -- lives in a 72px margin column. The visualizer used its own 150px inset, which is
   why it read as a strip floating in the middle of the screen rather than as part of the page.
   Each style now shares that column, and none of them uses the full height of the band: leaving air
   above and below is what stops a visualizer looking like a test pattern. */
var VIZ_MARGIN=72;                 // the fullscreen content column, shared with the seek bar
var VIZ_GAPR=0.55;                 // gap as a fraction of bar width (Few's preferred end)
var VIZ_SWING=0.62;                // share of the band's half-height the loudest bar may use
/* Radial is measured from the OUTER radius inwards, because that is the edge the eye reads first:
   the ring takes VIZ_R_FILL of the band's half-height, the cover disc gets VIZ_R_INNER of that, and
   the spokes get everything left over. Sizing it the other way round -- cover first, spokes as
   whatever fitted -- is what produced a 418px disc wearing a 119px fringe, an assembly using two
   thirds of the band with the rest of the screen empty around it. */
var VIZ_R_FILL=0.96;               // ring outer radius as a share of the band's half-height
var VIZ_R_INNER=0.44;              // inner radius as a share of the outer; spokes get the other 56%
var VIZ_ART_GAP=26;                // clearance between the cover and where the spokes start
var VIZ_SPOKE=0.645;               // spoke width as a share of its slot, so the gap lands at ~55%
/* Spokes per half-circle, and deliberately fewer than the linear style's bands. A circle gives
   every bar the same slice of a much smaller perimeter, so matching Bars one-for-one would leave
   6px hairs; folding the analysis down to a coarser count buys the width back. The bands that
   share a spoke are combined by max, so nothing quietly disappears -- a peak in either still
   shows. VIZ_N stays a multiple of this. */
var VIZ_RN=36;
var VIZ_WAVE_AMP=0.42;             // waveform: share of the half-height at full scale
var VIZ_AXIS=RGBA(255,255,255,14); // the hairline the mirrored halves meet on

// ---- style 1: mirrored pill bars, Verdant green (the original, on the rebuilt analysis) ----
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
/* ---- style 2: radial ring ----
   The spectrum wrapped around the cover, which is the form modern players reach for and the one
   that suits a fullscreen layout with artwork already in it. Mirrored left and right rather than
   run once around the circle: a continuous sweep puts a visible seam where the top band meets the
   bottom one, while a mirrored ring is symmetric wherever you look at it. Bass sits at the top,
   treble meets at the bottom. */
// the ring's coarser bands: the loudest of the analysis bands folded into each spoke
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
  /* Each spoke is the SAME primitive as a bar in the linear style -- a fully rounded FillRoundRect
     pill -- drawn straight up at twelve o'clock and then rotated into its slot. Rotate() takes an
     explicit centre, so the pill lands on the ring without any trigonometry of its own, and the
     rounded ends come for free instead of the flat caps a DrawLine leaves. Width is sized from the
     slot so the gap between spokes stays in the 50-75% range the bars use. */
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
/* ---- style 3: waveform ----
   The raw wave rather than the spectrum, so it moves with the sound instead of with the beat --
   the one style here that is not an FFT. A translucent body under the trace stops it reading as a
   bare hairline on a big screen. */
function drawVizWave(gr,top,bot){
  var cy=Math.round((top+bot)/2), x0=VIZ_MARGIN, w=W-VIZ_MARGIN*2, i;
  var hh=Math.round((bot-top)/2*VIZ_WAVE_AMP);
  var g=0.92/Math.max(0.06,vizWaveEnv); if(g>9) g=9;
  var body=vizCol(0.9), fill=vizAlpha(body,54);
  var px=[], py=[], poly=[x0,cy];
  for(i=0;i<VIZ_WAVE_N;i++){
    var v=(vizWave[i]||0)*g; if(v>1) v=1; else if(v<-1) v=-1;
    px.push(Math.round(x0+w*i/(VIZ_WAVE_N-1))); py.push(Math.round(cy-v*hh));
    poly.push(px[i],py[i]);
  }
  poly.push(x0+w,cy);
  try{ gr.FillPolygon(fill,0,poly); }catch(e){}
  gr.DrawLine(x0,cy,x0+w,cy,1,VIZ_AXIS);
  for(i=1;i<VIZ_WAVE_N;i++) gr.DrawLine(px[i-1],py[i-1],px[i],py[i],3,body);
}
// ---- style dispatch + the picker ----
/* The waveform is parked, not deleted: it is off the picker on request, and its capture is gated
   on the style below so it costs nothing while it is out. Putting it back is this one line. */
var VIZ_STYLES=[['Bars','bars'],['Radial ring','radial']];
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
  var pw=196, ph=36, px=W-72-pw, py=114;
  HB_VIZ=drawDropPill(gr,px,py,pw,ph,labelOf(VIZ_STYLES,vizStyle,'Bars'),vizMenuOpen);
  VIZ_HB=vizMenuOpen?drawDropMenu(gr,HB_VIZ,VIZ_STYLES,vizStyle,pw):[];
}
/* A viz frame repaints only the band the visual lives in: at 30fps nothing else on screen has
   moved. The picker is deliberately NOT drawn here -- its menu hangs into the top of the band, so
   while it is open on_paint takes the full path instead (see the fullscreen branch there). */
function drawVizBand(gr){
  var bot=H-172;
  gr.FillSolidRect(0,VIZ_TOP,W,Math.max(0,bot-VIZ_TOP),COL.base);
  drawVizBody(gr,VIZ_TOP,bot);
}
/* Apple Music inspired now-playing canvas. Artwork and blur are cached; only
   lyric positions animate. The native component remains a connection fallback. */
var fsBackdrop=null, fsBackdropArt=null, fsBackdropKey='', fsFonts={}, fsClock=null, fsTickTime=0, fsLastPaintMs=0, fsLastCurLine=-2;
var fsLy={model:null,w:0,font:null,rows:[],scroll:0,target:0,snap:true,manualUntil:0,max:0};
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
function fsLyReset(){fsLy.model=null;fsLy.snap=true;fsLy.manualUntil=0;fsLy.scroll=0;fsLy.target=0;fsLastCurLine=-2;fsLastPaintMs=0;}
function fsSyncedLineIndex(){
  var m=(fsView==='lyrics')?activeLyricsModel():null;
  if(!m||!m.synced) return -2;
  var t=0; try{ t=fb.PlaybackTime; }catch(e){ t=0; }
  var cur=-1;
  for(var i=0;i<m.lines.length;i++){ if(m.lines[i].t<=t) cur=i; else break; }
  return cur;
}
function startFsClock(){
  if(fsClock) return;
  fsTickTime=nowMs();
  fsLastPaintMs=fsTickTime;
  fsLastCurLine=-2;
  fsClock=window.SetInterval(function(){
    if(!fsMode){stopFsClock();return;}
    if(fsView==='viz') return;
    var now=nowMs(), dt=Math.min(0.05,Math.max(0.001,(now-fsTickTime)/1000));
    fsTickTime=now;
    var moving=Math.abs(fsLy.target-fsLy.scroll)>0.2;
    if(moving) fsLy.scroll+=(fsLy.target-fsLy.scroll)*(1-Math.exp(-12*dt));
    else fsLy.scroll=fsLy.target;
    var wallNow=Date.now(), resume=!!(fsLy.manualUntil&&wallNow>fsLy.manualUntil);
    if(resume) fsLy.manualUntil=0;
    var curLine=fsSyncedLineIndex(), lineChanged=(curLine!==fsLastCurLine);
    var playTick=(fb.IsPlaying&&!fb.IsPaused)&&(now-fsLastPaintMs>=250);
    if(moving||resume||lineChanged||NV.key!==nvTrackKey()||playTick){
      fsLastCurLine=curLine;
      fsLastPaintMs=now;
      repaintAll();
    }
  },ANIM_MS);
}
function stopFsClock(){if(fsClock){window.ClearInterval(fsClock);fsClock=null;} fsLastCurLine=-2; fsLastPaintMs=0;}
function fsDrawBackdrop(gr){
  var art=npResolveArt(true);
  var key=W+'x'+H;
  if(art!==fsBackdropArt||fsBackdropKey!==key||!fsBackdrop){
    disposeFsBackdrop();
    fsBackdropArt=art;fsBackdropKey=key;
    if(art){
      var bw=W>=H?128:Math.max(1,Math.round(128*W/Math.max(1,H)));
      var bh=H>=W?128:Math.max(1,Math.round(128*H/Math.max(1,W)));
      try{fsBackdrop=artResizeCoverBitmap(art,bw,bh);if(fsBackdrop)fsBackdrop.StackBlur(30);}catch(e){fsBackdrop=null;}
    }
  }
  gr.FillSolidRect(0,0,W,H,RGB(30,32,39));
  if(fsBackdrop) gr.DrawImage(fsBackdrop,0,0,W,H,0,0,fsBackdrop.Width,fsBackdrop.Height,0,255);
  gr.FillSolidRect(0,0,W,H,RGBA(9,10,15,150));
  // Subtle vertical shading retains album colour while keeping the controls readable.
  for(var i=0;i<16;i++) gr.FillSolidRect(0,Math.round(H*i/16),W,Math.ceil(H/16),RGBA(0,0,0,Math.round(i*2.2)));
}
function fsTransport(gr,name,x,y,size,act,active){
  var over=hv(x-26,y-26,x+26,y+26), c=active?RGB(255,130,150):RGBA(255,255,255,over?255:205);
  if(over) gr.FillEllipse(x-26,y-26,52,52,RGBA(255,255,255,26));
  drawIcon(gr,name,c,x-26,y-26,52,52,size);
  HB_CTRL.push({x0:x-26,y0:y-26,x1:x+26,y1:y+26,act:act});
}
function fsArtworkControls(gr,a){
  if(a.compact){fsCompactControls(gr,a);return;}
  var x=a.x,y=a.y,s=a.art, cx=x+s/2;
  var cb=npCoverBox(x,y,s);
  gr.FillRoundRect(cb.x+4,cb.y+14,cb.w,cb.h,16,16,RGBA(0,0,0,48));
  drawNowPlayingCover(gr,x,y,s,14);
  var titleY=y+s+22, titleSize=Math.max(19,Math.min(30,s/18));
  var titleFont=fsFont(titleSize,true), artistFont=fsFont(Math.max(15,titleSize*0.71),false);
  var titleH=Math.max(42,Math.ceil(gr.CalcTextHeight('Ag\u6b4c',titleFont))+4);
  var artistH=Math.max(32,Math.ceil(gr.CalcTextHeight('Ag\u6b4c',artistFont))+4);
  tL(gr,npTitleStr||'\u6682\u65e0\u64ad\u653e',titleFont,COL.text,x,titleY,s,titleH);
  tL(gr,npArtistStr||'\u9009\u62e9\u4e00\u9996\u97f3\u4e50',artistFont,RGB(204,204,210),x,titleY+titleH,s,artistH);
  var seekY=titleY+titleH+artistH+20, len=fb.PlaybackLength, time=drag==='seek'?len*dragFrac:fb.PlaybackTime;
  HB_SEEK=drawTrackBar(gr,x,seekY,s,4,RGBA(255,255,255,48),len>0?clamp01(time/len):0);
  tL(gr,fmtTime(time),fsFont(12,false),RGBA(255,255,255,135),x,seekY+9,s/2,20);
  tR(gr,'\u2212'+fmtTime(Math.max(0,len-time)),fsFont(12,false),RGBA(255,255,255,135),cx,seekY+9,s/2,20);
  var cy=seekY+69, step=Math.min(104,s*0.22), outer=Math.min(190,s*0.43);
  fsTransport(gr,'shuffle',cx-outer,cy,21,'shuffle',pbShuffle);
  fsTransport(gr,'prev',cx-step,cy,36,'prev',false);
  fsTransport(gr,fb.IsPlaying&&!fb.IsPaused?'pause':'play',cx,cy,51,'play',false);
  fsTransport(gr,'next',cx+step,cy,36,'next',false);
  fsTransport(gr,pbRepeat===2?'repeat1':'repeat',cx+outer,cy,21,'repeat',pbRepeat>0);
  var vw=Math.min(196,s*0.55), vx=cx-vw/2, vy=cy+72;
  drawIcon(gr,'volume',RGBA(255,255,255,125),vx-32,vy-11,22,22,18);
  HB_VOL=drawTrackBar(gr,vx,vy,vw,4,RGBA(255,255,255,45),clamp01(vol2pos(fb.Volume)));
}
function fsCompactControls(gr,a){
  drawNowPlayingCover(gr,a.x,a.y,a.art,8);
  var tx=a.x+a.art+18,tw=Math.max(80,W-a.pad-tx);
  tL(gr,npTitleStr||'\u6682\u65e0\u64ad\u653e',fsFont(22,true),COL.text,tx,a.y+4,tw,34);
  tL(gr,npArtistStr,fsFont(15,false),RGB(204,204,210),tx,a.y+42,tw,24);
  var len=fb.PlaybackLength,time=drag==='seek'?len*dragFrac:fb.PlaybackTime;
  var sy=H-128,cx=W/2,cy=H-60;
  HB_SEEK=drawTrackBar(gr,a.pad,sy,W-a.pad*2,4,RGBA(255,255,255,48),len>0?clamp01(time/len):0);
  tL(gr,fmtTime(time),fsFont(12,false),COL.text2,a.pad,sy+8,70,20);
  tR(gr,'\u2212'+fmtTime(Math.max(0,len-time)),fsFont(12,false),COL.text2,W-a.pad-70,sy+8,70,20);
  fsTransport(gr,'shuffle',cx-116,cy,20,'shuffle',pbShuffle);
  fsTransport(gr,'prev',cx-58,cy,32,'prev',false);
  fsTransport(gr,fb.IsPlaying&&!fb.IsPaused?'pause':'play',cx,cy,44,'play',false);
  fsTransport(gr,'next',cx+58,cy,32,'next',false);
  fsTransport(gr,pbRepeat===2?'repeat1':'repeat',cx+116,cy,20,'repeat',pbRepeat>0);
  if(W>=640){
    var vx=W-a.pad-96;
    HB_VOL=drawTrackBar(gr,vx,cy,96,4,RGBA(255,255,255,48),clamp01(vol2pos(fb.Volume)));
  }
}
function fsLyLayout(gr,model,w,font){
  if(fsLy.model===model&&fsLy.w===w&&fsLy.font===font) return;
  var lh=Math.ceil(gr.CalcTextHeight('Ag\u6b4c',font)*1.14), gap=Math.round(lh*0.65), rows=[],acc=0;
  for(var i=0;i<model.lines.length;i++){
    var parts=[], paras=model.lines[i].text.split('\n');
    for(var k=0;k<paras.length;k++){
      var wr=gr.EstimateLineWrap(paras[k],font,w);
      for(var j=0;j<wr.length;j+=2) parts.push(wr[j]);
    }
    if(!parts.length)parts=[''];
    var h=parts.length*lh; rows.push({parts:parts,top:acc,center:acc+h/2,h:h});acc+=h+gap;
  }
  fsLy.model=model;fsLy.w=w;fsLy.font=font;fsLy.rows=rows;fsLy.lh=lh;fsLy.total=acc-gap;fsLy.snap=true;
}
function fsDrawLyrics(gr,a){
  var isRemote=(typeof nvShouldLoadLyrics==='function'&&nvShouldLoadLyrics());
  if(isRemote) nvLoad(); else if(typeof loadLyrics==='function') loadLyrics();
  var col=RGBA(255,255,255,130), label=isRemote?'NAVIDROME LYRICS':'LYRICS';
  tL(gr,label,fsFont(12,true),col,a.rx,a.ry-44,a.rw,24);
  var model=activeLyricsModel();
  if(!model){
    var st=isRemote?NV.status:(lyrics==='none'?'none':'loading');
    var text=st==='loading'?'\u6b63\u5728\u8bfb\u53d6\u6b4c\u8bcd\u2026':(isRemote&&NV.status==='idle')?'\u97f3\u4e50\u54cd\u8d77\uff0c\u6b4c\u8bcd\u5373\u523b\u5448\u73b0':'\u8fd9\u9996\u6b4c\u6682\u65e0\u6b4c\u8bcd';
    tL(gr,text,fsFont(Math.max(22,Math.min(36,a.rw/18)),'bold','lyric'),col,a.rx,a.ry+a.rh*0.43,a.rw,80);return;
  }
  var font=fsFont(Math.max(24,Math.min(46,a.rw/17)),'bold','lyric');
  fsLyLayout(gr,model,a.rw,font);
  var rows=fsLy.rows, cur=-1, time=fb.PlaybackTime, i,j;
  if(model.synced) for(i=0;i<model.lines.length;i++){if(model.lines[i].t<=time)cur=i;else break;}
  var anchor=a.ry+a.rh*0.44;
  if(model.synced&&Date.now()>fsLy.manualUntil) fsLy.target=rows[Math.max(0,cur)].center;
  else if(!model.synced) anchor=a.ry;
  fsLy.max=Math.max(0,model.synced?(fsLy.total-a.rh*0.45):(fsLy.total-a.rh));
  if(!model.synced){
    if(fsLy.target>fsLy.max) fsLy.target=fsLy.max;
    if(fsLy.scroll>fsLy.max) fsLy.scroll=fsLy.max;
  }
  if(fsLy.snap){fsLy.scroll=fsLy.target;fsLy.snap=false;}
  try{
    gr.SetTextRenderingHint(4);   // AntiAlias avoids ClearType edge fringes on alpha text over blurred art
    for(i=0;i<rows.length;i++){
      var row=rows[i], top=Math.round(anchor+row.top-fsLy.scroll);
      var distance=Math.abs(top+row.h/2-anchor), edge=Math.min(top-a.ry,a.ry+a.rh-top-row.h);
      var alpha=i===cur?255:Math.round(130-Math.min(65,distance/8));
      alpha=Math.round(alpha*clamp01((edge+fsLy.lh)/(fsLy.lh*2)));
      for(j=0;j<row.parts.length;j++){
        var sy=top+j*fsLy.lh;
        if(sy<a.ry||sy+fsLy.lh>a.ry+a.rh)continue;
        var hover=hv(a.rx,sy,a.rx+a.rw,sy+fsLy.lh);
        // GDI text ignores alpha; GDI+ preserves the current-line emphasis and edge fade.
        gr.DrawString(row.parts[j],font,RGBA(255,255,255,hover?255:alpha),a.rx,sy,a.rw,fsLy.lh,0x1000);
        if(model.synced)HB_FS.push({x0:a.rx,y0:sy,x1:a.rx+a.rw,y1:sy+fsLy.lh,act:'seek:'+model.lines[i].t});
      }
    }
  }finally{
    gr.SetTextRenderingHint(0);
  }
  if(model.synced&&Date.now()<fsLy.manualUntil){
    tL(gr,'\u7a0d\u540e\u81ea\u52a8\u8ddf\u968f\u64ad\u653e',fsFont(12,false),col,a.rx,a.ry+a.rh+15,a.rw,22);
  }
}
function fsLyricsWheel(step){
  var a=fsGeometry();
  if(fsView!=='lyrics'||mx<a.rx||mx>a.rx+a.rw||!activeLyricsModel()) return false;
  if(fsLy.max<=0) return false;
  fsLy.manualUntil=Date.now()+4500;
  fsLy.target=Math.max(0,Math.min(fsLy.max,fsLy.target-step*(fsLy.lh||40)*2));
  repaintAll();return true;
}
function drawFsBar(gr){
  // Visualizer retains its wide transport bar and dedicated repaint band.
  var cy=H-76,cx=W/2,len=fb.PlaybackLength,time=drag==='seek'?len*dragFrac:fb.PlaybackTime;
  HB_SEEK=drawTrackBar(gr,72,H-132,W-144,4,RGBA(255,255,255,50),len>0?clamp01(time/len):0);
  fsTransport(gr,'prev',cx-88,cy,30,'prev',false);
  fsTransport(gr,fb.IsPlaying&&!fb.IsPaused?'pause':'play',cx,cy,44,'play',false);
  fsTransport(gr,'next',cx+88,cy,30,'next',false);
}
function drawFullscreen(gr){
  applyKeyMode();
  HB_CTRL=[];HB_FS=[];HB_SEEK=null;HB_VOL=null;HB_VIZ=null;
  if(typeof clearNonFsHitboxes==='function') clearNonFsHitboxes();
  if(fsView==='viz'){
    gr.FillSolidRect(0,0,W,H,COL.base);drawFsViz(gr,H-172);drawFsBar(gr);
  }else{
    fsDrawBackdrop(gr);
    var a=fsGeometry();
    if(fsView==='default'&&!a.compact){a.x=Math.round((W-a.art)/2);}
    fsArtworkControls(gr,a);
    if(fsView==='lyrics') fsDrawLyrics(gr,a);
  }
  var pad=fsGeometry().pad;
  // Keep the buttons below UI Wizard's native title-drag strip.
  if(fsView!=='viz')tL(gr,'\u6b63\u5728\u64ad\u653e',fsFont(13,true),RGBA(255,255,255,160),pad,60,Math.max(40,W-pad*2-146),28);
  fsIcon(gr,'equalizer',fsView==='viz'?COL.text:RGBA(255,255,255,130),W-pad-130,64,24,'viz');
  fsIcon(gr,'mic',fsView==='lyrics'?COL.text:RGBA(255,255,255,130),W-pad-76,64,24,'lyrics');
  fsIcon(gr,'compress',COL.text,W-pad-22,64,24,'exit');
}
