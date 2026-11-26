/* verdant/data/lyrics.js -- .lrc / .txt lyrics: load, parse, layout, rolling render
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

/* ------------------------- lyrics (.lrc / .txt beside the track) ------------------------- */
var lyricsFor=null, lyrics=null; // {lines:[{t,text}],synced} | 'none'
var lyScroll=0, lyTarget=0, lyCur=0, lyTimer=null, lySnap=true, lyLay={lyr:null,w:-1};   // pixel roll: lines wrap
var lyStScroll=0, lyStMax=0;   // unsynced lyrics: wheel-driven offset + its clamp, both in pixels
function activeLyricsModel(){
  if(typeof NV==='object' && NV && NV.lyrics && NV.lyrics.lines && NV.lyrics.lines.length) return NV.lyrics;
  if(lyrics && lyrics!=='none' && lyrics.lines && lyrics.lines.length) return lyrics;
  return null;
}
function currentLyricLine(model){
  var m=model||activeLyricsModel();
  if(!m || !m.synced) return 0;
  var pt=fb.PlaybackTime, c=0;
  for(var i=0;i<m.lines.length;i++){ if(m.lines[i].t<=pt) c=i; else break; }
  return c;
}
// wrap each phrase to width+font, precompute cumulative block geometry (cached by width+font)
function lyLayout(gr,maxW,font,model){
  var m=model||activeLyricsModel();
  font=font||FONT.lyric;
  if(lyLay.lyr===m && lyLay.w===maxW && lyLay.font===font) return lyLay;
  var subLh=Math.round(gr.CalcTextHeight(LANG_METRIC_TEXT,font))+4, gap=Math.round(subLh*0.55);
  var subs=[], top=[], cen=[], blockH=[], acc=0;
  for(var i=0;i<m.lines.length;i++){
    var wr=gr.EstimateLineWrap(m.lines[i].text||'',font,maxW), parts=[];
    for(var j=0;j<wr.length;j+=2) parts.push(wr[j]);
    if(!parts.length) parts=[''];
    var bh=parts.length*subLh;
    subs.push(parts); top.push(acc); blockH.push(bh); cen.push(acc+bh/2); acc+=bh+gap;
  }
  lyLay={lyr:m,w:maxW,font:font,subs:subs,top:top,cen:cen,blockH:blockH,subLh:subLh};
  return lyLay;
}
// rolling synced lyrics (queue tab + fullscreen). align: 'c' centred / 'l' left
function drawRollingLyrics(gr,x,top,w,bot,font,curCol,align,model,seekOut){
  var m=model||activeLyricsModel(); if(!m) return;
  var viewMid=Math.round((top+bot)/2), L=lyLayout(gr,w,font,m), subLh=L.subLh, li,s;
  lyCur=currentLyricLine(m);
  lyTarget=L.cen[lyCur]||0;
  if(lySnap){ lyScroll=lyTarget; lySnap=false; } else if(Math.abs(lyTarget-lyScroll)>0.5) startLyAnim();
  for(li=0;li<m.lines.length;li++){
    var bcY=viewMid+(L.cen[li]-lyScroll);
    if(bcY<top-L.blockH[li] || bcY>bot+L.blockH[li]) continue;
    var isCur=(li===lyCur), dist=Math.abs(bcY-viewMid), a=clamp01(1-dist/Math.max(1,viewMid-top));
    var bTop=Math.round(bcY-L.blockH[li]/2);
    var lineHov=!!(seekOut && m.synced && hv(x,Math.max(top,bTop),x+w,Math.min(bot,bTop+L.blockH[li])));
    var col=isCur?curCol:(lineHov?COL.text:(fsMode?RGBA(255,255,255,Math.round(24+120*a)):OV(Math.round(24+120*a))));
    for(s=0;s<L.subs[li].length;s++){
      var sy=bTop+s*subLh;
      if(sy<top || sy+subLh>bot) continue;
      if(align==='l') tL(gr,L.subs[li][s],font,col,x,sy,w,subLh); else tC(gr,L.subs[li][s],font,col,x,sy,w,subLh);
      if(seekOut && m.synced) seekOut.push({x0:x,y0:sy,x1:x+w,y1:sy+subLh,t:m.lines[li].t});
    }
  }
}
/* Unsynced lyrics: a plain top-down block, no roll -- there are no timestamps to roll to. */
function drawStaticLyrics(gr,x,w,top,bot,font,gapMul,model,align){
  var m=model||activeLyricsModel(); if(!m) return;
  stopLyAnim();
  var L=lyLayout(gr,w,font,m), gap=Math.round(L.subLh*(gapMul===undefined?0.45:gapMul)), li, s, h=0;
  for(li=0;li<m.lines.length;li++) h+=L.subs[li].length*L.subLh+gap;
  lyStMax=Math.max(0,Math.round(h-gap-(bot-top)));
  if(lyStScroll>lyStMax) lyStScroll=lyStMax;
  if(lyStScroll<0) lyStScroll=0;
  var y=top-lyStScroll;
  for(li=0;li<m.lines.length && y<bot;li++){
    var p=L.subs[li];
    for(s=0;s<p.length;s++){
      if(y>=top && y+L.subLh<=bot){
        if(align==='l') tL(gr,p[s],font,COL.text2,x,y,w,L.subLh); else tC(gr,p[s],font,COL.text2,x,y,w,L.subLh);
      }
      y+=L.subLh;
    }
    y+=gap;
  }
}
function lyStWheel(step){
  var m=activeLyricsModel();
  if(!m || !m.lines.length || m.synced || lyStMax<=0) return false;
  var v=lyStScroll-Math.round(step*3*(lyLay.subLh||20));
  if(v<0) v=0; else if(v>lyStMax) v=lyStMax;
  if(v===lyStScroll) return false;
  lyStScroll=v; return true;
}
function noLyrics(){ return !activeLyricsModel(); }
var lyLastMs=0, LY_RATE=17.5;
function lyTick(){
  var now=nowMs();
  var dt=lyLastMs?Math.min(0.05,Math.max(0.001,(now-lyLastMs)/1000)):(ANIM_MS/1000);
  lyLastMs=now;
  var d=lyTarget-lyScroll;
  if(Math.abs(d)<0.5){ lyScroll=lyTarget; stopLyAnim(); }
  else lyScroll+=d*(1-Math.exp(-LY_RATE*dt));
  if(fsMode){ stopLyAnim(); return; }
  repaintQueue();
}
function startLyAnim(){ if(!lyTimer){ lyLastMs=nowMs(); lyTimer=window.SetInterval(lyTick,ANIM_MS); } }
function stopLyAnim(){ if(lyTimer){ window.ClearInterval(lyTimer); lyTimer=null; } lyLastMs=0; }
// blinking caret in the Search box / rename dialog
var caretOn=true, caretTimer=null;
function caretTick(){
  if(renameEdit){ caretOn=!caretOn; repaintAll(); return; }              // caret sits in a playlist row/card
  if(view==='search'){ caretOn=!caretOn; markDirty(); dirtySearch=true; var b=searchBoxRect(); repaintRect(b.x,b.y,b.w,b.h); return; }
  stopCaret();
}
function startCaret(){ if(!caretTimer){ caretOn=true; caretTimer=window.SetInterval(caretTick,530); } }
function stopCaret(){ if(caretTimer){ window.ClearInterval(caretTimer); caretTimer=null; } caretOn=true; }
function readFirst(paths){
  for(var i=0;i<paths.length;i++){
    try{ if(utils.IsFile && !utils.IsFile(paths[i])) continue; var t=utils.ReadUTF8(paths[i]); if(t && t.length) return t; }catch(e){}
  }
  return null;
}
function parseLyrics(text){
  var raw=text.split(/\r?\n/), lines=[], synced=false, reAll=/\[(\d+):(\d+(?:\.\d+)?)\]/g, i, j, m;
  for(i=0;i<raw.length;i++){
    var line=raw[i], times=[]; reAll.lastIndex=0;
    while((m=reAll.exec(line))!==null){ times.push(parseInt(m[1],10)*60+parseFloat(m[2])); }
    var txt=line.replace(reAll,'').trim();
    if(times.length){ synced=true; for(j=0;j<times.length;j++) lines.push({t:times[j],text:txt}); }
    else { if(/^\s*\[[a-zA-Z#]+:/.test(line)) continue; lines.push({t:-1,text:txt}); }
  }
  if(synced) lines.sort(function(a,b){ return a.t-b.t; });
  return {lines:lines, synced:synced};
}
function loadLyrics(){
  var key=NP?NP.Path:null;
  if(key===lyricsFor) return;
  lyricsFor=key; lyrics='none'; lyScroll=0; lyTarget=0; lySnap=true; lyLay={lyr:null,w:-1};
  lyStScroll=0; lyStMax=0;   // a new track's lyrics start at the top
  if(!key) return;
  var base=key.replace(/\.[^.\\\/]+$/,'');
  var text=readFirst([base+'.lrc', base+'.txt']);
  if(text) lyrics=parseLyrics(text);
}
