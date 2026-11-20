/* verdant/views/bar.js -- bottom playback bar
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

function ctrlBtn(gr,name,cx,cyc,active,act,rad,isz){
  rad=rad||18; isz=isz||22;
  var hot=hv(cx-rad,cyc-rad,cx+rad,cyc+rad);
  if(hot) gr.FillEllipse(cx-rad,cyc-rad,rad*2,rad*2,IS_LIGHT?RGBA(0,0,0,26):RGBA(255,255,255,26));
  drawIcon(gr,name,active?(hot?COL.greenHot:COL.green):(hot?COL.text:COL.text2),cx-rad,cyc-rad,rad*2,rad*2,isz);
  HB_CTRL.push({x0:cx-rad,y0:cyc-rad,x1:cx+rad,y1:cyc+rad,act:act});
}
// seek / volume track: filled progress on a dim rail, with a generously padded hitbox
function drawTrackBar(gr,x,y,w,th,trackCol,pos){
  gr.FillSolidRect(x,y,w,th,trackCol);
  if(pos>0) gr.FillSolidRect(x,y,Math.max(1,Math.round(w*pos)),th,COL.text);
  return {x0:x,y0:y-10,x1:x+w,y1:y+10+th,x:x,w:w};
}
function drawBar(gr){
  HB_CTRL=[];
  HB_DRAWER=null;HB_VOL=null;
  var by=R.barY;
  gr.FillSolidRect(0,by,W,M.barH,COL.canvas);
  var playing=fb.IsPlaying&&!fb.IsPaused;
  var leftW=Math.max(100,Math.min(W<1000?190:320,W*0.24));
  var rightW=(W>=1200?220:136)+(R.drawer?40:0);
  var midLeft=leftW+12,midRight=W-rightW-12,midW=Math.max(150,midRight-midLeft);
  var cxC=(midLeft+midRight)/2;
  var cs=W<1000?48:64,cx=12,cy=by+(M.barH-cs)/2;
  if(typeof qDrawArt==='function') qDrawArt(gr,cx,cy,cs,5,NP,'np','np');
  else drawCover(gr,cx,cy,cs,5,NP,'np');
  var nid=(NP&&typeof nvTrackId==='function')?nvTrackId(NP.Path):'';
  var starPad=(nid&&(leftW-(cx+cs+12))>=68)?30:0;
  var tx=cx+cs+12,tw=Math.max(24,leftW-tx-starPad);
  tL(gr,npTitleStr,FONT.npTitle,COL.text,tx,by+26,tw,20);
  tL(gr,npArtistStr,FONT.npArtist,COL.text2,tx,by+50,tw,18);
  if(starPad){
    var starred=(typeof nvIsStarred==='function')&&nvIsStarred('song',nid);
    var sx=leftW-24, sy=Math.round(by+M.barH/2-13), shot=hv(sx-2,sy-2,sx+26,sy+26);
    if(shot) gr.FillEllipse(sx-2,sy-2,28,28,IS_LIGHT?RGBA(0,0,0,26):RGBA(255,255,255,26));
    drawIcon(gr,starred?'heart':'heartO',starred?COL.green:(shot?COL.text:COL.text2),sx,sy,24,24,16);
    HB_CTRL.push({x0:sx-2,y0:sy-2,x1:sx+26,y1:sy+26,act:'nvstar'});
  }
  var pcy=by+30,pb=48,pbx=cxC-pb/2,pby=pcy-pb/2,step=Math.min(58,midW/5);
  if(midW>=240)ctrlBtn(gr,'shuffle',cxC-step*2,pcy,pbShuffle,'shuffle',18,22);
  ctrlBtn(gr,'prev',cxC-step,pcy,false,'prev',20,24);
  var playHot=hv(pbx,pby,pbx+pb,pby+pb), pg=playHot?2:0;
  gr.FillEllipse(pbx-pg,pby-pg,pb+pg*2,pb+pg*2,playHot?(IS_LIGHT?RGB(46,46,52):RGB(232,232,232)):COL.text);
  drawIcon(gr,playing?'pause':'play',COL.base,pbx-pg,pby-pg,pb+pg*2,pb+pg*2,Math.round((pb+pg*2)*0.5));
  HB_CTRL.push({x0:pbx,y0:pby,x1:pbx+pb,y1:pby+pb,act:'play'});
  ctrlBtn(gr,'next',cxC+step,pcy,false,'next',20,24);
  if(midW>=240)ctrlBtn(gr,pbRepeat===2?'repeat1':'repeat',cxC+step*2,pcy,pbRepeat>0,'repeat',18,22);
  var sbW=Math.min(560,Math.max(60,midW-100)),sbX=cxC-sbW/2,sbY=by+74;
  var len=fb.PlaybackLength, pos=(drag==='seek')?dragFrac:(len>0?fb.PlaybackTime/len:0);
  HB_SEEK=drawTrackBar(gr,sbX,sbY,sbW,5,COL.seekbg,pos);
  tR(gr,fmtTime((drag==='seek')?len*dragFrac:fb.PlaybackTime),FONT.time,COL.text2,sbX-54,sbY-7,46,17);
  tL(gr,fmtTime(len),FONT.time,COL.text2,sbX+sbW+10,sbY-7,46,17);
  var gearC=by+M.barH/2;
  ctrlBtn(gr,'expand',W-30,gearC,false,'fullscreen',18,22);
  if(R.drawer){
    ctrlBtn(gr,rightTab==='lyrics'?'mic':'more',W-74,gearC,queueDrawerOpen,'drawer',18,22);
    HB_DRAWER={x0:W-94,y0:gearC-22,x1:W-54,y1:gearC+22};
  }
  if(W>=1200){
    var volX=W-200,volY=gearC-2;
    drawIcon(gr,'volume',COL.text2,volX-32,gearC-13,26,26,22);
    HB_VOL=drawTrackBar(gr,volX,volY,104,5,COL.seekbg,clamp01(vol2pos(fb.Volume)));
  }else{
    ctrlBtn(gr,'volume',W-(R.drawer?118:74),gearC,volumePopupOpen,'volume',18,22);
    if(volumePopupOpen){
      var vx=Math.max(8,W-224),vy=by-62;
      gr.FillRoundRect(vx,vy,208,52,10,10,COL.elev);
      drawIcon(gr,'volume',COL.text2,vx+12,vy+13,26,26,22);
      HB_VOL=drawTrackBar(gr,vx+52,vy+25,136,5,COL.seekbg,clamp01(vol2pos(fb.Volume)));
    }
  }
}
