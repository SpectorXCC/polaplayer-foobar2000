/* verdant/data/art.js -- album art: async fetch queue, masks, covers, mosaics, card bitmaps
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

/* ---- album art: async cache keyed by album. A miss draws the placeholder and requests the
   art off the paint thread; arrival caches it and repaints (coalesced). warmArt() pre-requests. */
var artCache={}, albKeyCache={}, thumbCache={}, artPending={}, artRepaintPending=false;

function albKey(h){ if(!h) return ''; var p=h.Path; if(albKeyCache.hasOwnProperty(p)) return albKeyCache[p]; var k=TF.albkey.EvalWithMetadb(h); albKeyCache[p]=k; return k; }
/* Art arrival used to trigger a full repaintAll every 60ms. With cold caches a full paint costs
   30-90ms, so one queued every 60ms leaves the single script thread with nothing spare -- the app
   drew its content and then sat unresponsive until the art finished. Two changes: repaint only
   the panels art can affect (never the title bar, and skipping the full-window canvas clear), and
   back the interval right off while a bulk warm is still draining. */
function artWarmRepaint(){
  if(artRepaintPending) return;
  artRepaintPending=true;
  var busy=(artGateQueue.length+artQueue.length+artWarmQueue.length+artInFlight)>16;
  window.SetTimeout(function(){
    artRepaintPending=false;
    if(!R.main||!R.navTop||!R.queue){ repaintAll(); return; }   // art can resolve before layout() has run
    repaintMain(); repaintNavAll(); repaintQueue();             // repaintMain also covers the bar
  },busy?260:60);
}
/* Requests are queued rather than all fired at once. Each resolution resizes a full-size cover on
   the script thread, so hundreds landing together serialise into one long stall. On-demand
   requests (a card being drawn now) jump the queue ahead of bulk warm-up work, so what's on
   screen fills in first instead of behind several hundred off-screen covers. */
/* ART_DOWNSCALE is the quality mode for the on-arrival downscale. It was 2 (HighQuality), which on
   a 3000px cover costs tens of milliseconds -- and that runs inside the promise callback, which
   cannot yield. Across a few hundred artists it is seconds of solid thread time with nothing able
   to paint: the "drawn, then frozen" freeze. Mode 1 is several times cheaper and the result is
   downscaled again to card size before it is ever shown, so the difference is not visible.
   Fewer in flight also means fewer callbacks landing back to back. */
/* Background (warm-up) requests live in a queue of their own and only reach the drive when it is
   otherwise IDLE, one at a time. They used to share the on-screen queue, merely placed at the back
   of it -- which kept the order right but not the contention: Home queued every artist and opening
   a playlist queued every album in it, so the in-flight slots stayed full of reads nobody was
   looking at, and on a spinning disk each of those slows every other read. Measured on a 4,144-track
   library on a USB hard drive: 832 covers dispatched in the first minute, typically 147 ms each,
   with a playlist view waiting 14 s for the 24 covers it actually showed. */
/* Three tiers, served strictly in order:
     gate   -- a section holding its reveal back behind a skeleton. Nothing in it is usable until
               these arrive, so they go before anything else. Without this tier a gated section lost
               to ungated content drawn after it: the newest request goes first, and the artist grid
               paints its cards after the shelf gate asks, so the shelf's 12 covers waited behind a
               hundred others (revealed at 6.0 s against 1.1 s).
     demand -- on screen and already interactive, drawn with a placeholder meanwhile. Newest first,
               so what was just scrolled to beats what was scrolled past.
     warm   -- background pre-loading, only on an idle drive (above). */
var artGateQueue=[], artQueue=[], artWarmQueue=[], artInFlight=0, ART_MAX_INFLIGHT=3, ART_DOWNSCALE=1, ART_MAXPX=500;
var ART_TIER={warm:0, demand:1, gate:2};
function artTierQueue(t){ return t==='gate'?artGateQueue:(t==='warm'?artWarmQueue:artQueue); }
// while a section is holding back its reveal there is nothing interactive inside it, so it is
// worth fetching harder; normal browsing drops back to ART_MAX_INFLIGHT
var ART_GATE_INFLIGHT=6, artsGating=false;
// gated sections fetch harder, because nothing in them is interactive until they reveal
function artInflightCap(){ return artsGating?ART_GATE_INFLIGHT:ART_MAX_INFLIGHT; }
/* tier: 'gate', 'demand' (the default) or 'warm'; `true` still means warm, for the existing callers.
   artPending[key] records the tier an entry is queued at, so it can be told apart and promoted. */
function requestArt(h,key,tier){
  if(tier===true) tier='warm'; else if(!tier) tier='demand';
  if(!h || artCache.hasOwnProperty(key)) return;
  var p=artPending[key];
  if(p){
    // wanted more urgently than it was queued: move it up a tier, or it would wait behind work that
    // matters less. If it is not in its queue it is already in flight -- leave it be, since
    // re-queueing would fetch it twice.
    if(ART_TIER[tier]>ART_TIER[p]){
      var q=artTierQueue(p);
      for(var i=0;i<q.length;i++){
        if(q[i][1]===key){ q.splice(i,1); artPending[key]=tier; artTierQueue(tier).unshift([h,key]); pumpArt(); break; }
      }
    }
    return;
  }
  artPending[key]=tier;
  if(tier==='warm') artWarmQueue.push([h,key]); else artTierQueue(tier).unshift([h,key]);
  pumpArt();
}
function pumpArt(){
  while(artInFlight<artInflightCap() && (artGateQueue.length || artQueue.length)){
    var it=artGateQueue.length?artGateQueue.shift():artQueue.shift();
    artInFlight++;
    startArt(it[0],it[1]);
  }
  // background work only on an idle drive, and never more than one read of it at a time
  if(artInFlight===0 && !artGateQueue.length && !artQueue.length && artWarmQueue.length){
    var w=artWarmQueue.shift();
    artInFlight++;
    startArt(w[0],w[1]);
  }
}

function artDone(key,img){
  capPut(artCache,artOrder,ART_CAP,key,img||null);
  delete artPending[key];
  artInFlight--; pumpArt();
}
function artIsNearSquare(w,h){
  if(!w || !h) return true;
  return Math.abs(w/h-1)<=0.01;
}
function artFitContain(srcW,srcH,maxW,maxH){
  var mw=Math.max(1,maxW||1), mh=Math.max(1,maxH||1);
  if(!srcW || !srcH || (Math.abs(mw-mh)<0.5 && artIsNearSquare(srcW,srcH))) return {w:mw,h:mh,x:0,y:0};
  var scale=Math.min(mw/srcW,mh/srcH);
  var w=Math.max(1,Math.min(Math.round(mw),Math.round(srcW*scale)));
  var h=Math.max(1,Math.min(Math.round(mh),Math.round(srcH*scale)));
  return {w:w,h:h,x:Math.round((mw-w)/2),y:Math.round((mh-h)/2)};
}
function artCoverCrop(srcW,srcH,dstW,dstH){
  srcW=Math.max(1,srcW||1); srcH=Math.max(1,srcH||1);
  dstW=Math.max(1,dstW||1); dstH=Math.max(1,dstH||1);
  var srcR=srcW/srcH, dstR=dstW/dstH;
  if(Math.abs(srcR-dstR)<=0.01) return {sx:0,sy:0,sw:srcW,sh:srcH};
  if(srcR>dstR){
    var sw=Math.max(1,Math.min(srcW,Math.round(srcH*dstR)));
    return {sx:Math.floor((srcW-sw)/2),sy:0,sw:sw,sh:srcH};
  }
  var sh=Math.max(1,Math.min(srcH,Math.round(srcW/dstR)));
  return {sx:0,sy:Math.floor((srcH-sh)/2),sw:srcW,sh:sh};
}
function artResizeCoverBitmap(src,dstWpx,dstHpx){
  if(!src) return null;
  dstWpx=Math.max(1,Math.round(dstWpx));
  dstHpx=Math.max(1,Math.round(dstHpx));
  var crop=artCoverCrop(src.Width,src.Height,dstWpx,dstHpx);
  if(crop.sx===0 && crop.sy===0 && crop.sw===src.Width && crop.sh===src.Height){
    return src.Resize(dstWpx,dstHpx,2);
  }
  var im=gdi.CreateImage(dstWpx,dstHpx), g=im.GetGraphics();
  g.SetInterpolationMode(7);
  g.DrawImage(src,0,0,dstWpx,dstHpx,crop.sx,crop.sy,crop.sw,crop.sh,0,255);
  im.ReleaseGraphics(g);
  return im;
}
function startArt(h,key){
  try{
    utils.GetAlbumArtAsyncV2(0,h,0,false,false,false).then(function(res){
      var img=res?res.image:null;
      if(img && Math.max(img.Width,img.Height)>ART_MAXPX){
        var ratio=ART_MAXPX/Math.max(img.Width,img.Height);
        try{ img=img.Resize(Math.max(1,Math.round(img.Width*ratio)),Math.max(1,Math.round(img.Height*ratio)),ART_DOWNSCALE); }catch(e){}
      }
      artDone(key,img); artWarmRepaint();
    }, function(){ artDone(key,null); });
  }catch(e){ artDone(key,null); }
}
function getArtK(h,key){                        // cached image, or null (not-loaded -> request async)
  if(!h) return null;
  if(artCache.hasOwnProperty(key)) return artCache[key];
  requestArt(h,key);
  return null;
}
function artLoaded(key){ return artCache.hasOwnProperty(key); }   // vs. still-loading (don't cache derivatives yet)
function getArt(h){ return h?getArtK(h,albKey(h)):null; }
/* Keep original-resolution art only for the now-playing view, with two albums
   retained. Ordinary library requests continue to use the 500px source cache. */
var npArtCache={},npArtOrder=[],npArtRendered={},npArtRenderedOrder=[],npArtPending=false,npArtGeneration=0;
function nowArtKey(h){return h?String(h.Path)+'|'+String(h.SubSong||0):'';}
function getNowPlayingArt(){
  var h=NP,key=nowArtKey(h);if(!key)return null;
  if(Object.prototype.hasOwnProperty.call(npArtCache,key))return npArtCache[key];
  if(npArtPending)return null;
  npArtPending=true;var generation=npArtGeneration;
  function finish(image){
    npArtPending=false;if(generation!==npArtGeneration)return;
    if(nowArtKey(NP)===key){
      if(image&&Math.max(image.Width,image.Height)>2048){
        var ratio=2048/Math.max(image.Width,image.Height);
        try{image=image.Resize(Math.max(1,Math.round(image.Width*ratio)),Math.max(1,Math.round(image.Height*ratio)),2);}catch(e){image=null;}
      }
      npArtCache[key]=image||null;npArtOrder.push(key);
      while(npArtOrder.length>2){
        var old=npArtOrder.shift();delete npArtCache[old];
        for(var rk in npArtRendered)if(npArtRendered[rk].track===old)delete npArtRendered[rk];
        npArtRenderedOrder=npArtRenderedOrder.filter(function(k){return !!npArtRendered[k];});
      }
      repaintAll();
    }else if(NP)getNowPlayingArt();
  }
  try{utils.GetAlbumArtAsyncV2(0,h,0,false,false,false).then(function(res){finish(res&&res.image);},function(){finish(null);});}
  catch(e){finish(null);}
  return null;
}
function npResolveArt(preferThumb){
  if(!NP) return null;
  var art=preferThumb?(getArt(NP)||getNowPlayingArt()):(getNowPlayingArt()||getArt(NP));
  if(!art && typeof nvCoverIdFromPath==='function' && typeof nvGetArt==='function'){
    var cid=nvCoverIdFromPath(NP.Path);
    if(cid) art=nvGetArt(cid);
  }
  return art;
}
function npCoverBox(x,y,size){
  var art=npResolveArt(false);
  if(!art) return {x:x,y:y,w:size,h:size};
  var fit=artFitContain(art.Width,art.Height,size,size);
  return {x:Math.round(x+fit.x),y:Math.round(y+fit.y),w:fit.w,h:fit.h};
}
function drawNowPlayingCover(gr,x,y,size,rad){
  var art=npResolveArt(false);
  if(!art){drawRounded(gr,x,y,size,rad,NP,'np');return;}
  var fit=artFitContain(art.Width,art.Height,size,size);
  var isHi=!!(NP && npArtCache[nowArtKey(NP)]===art);
  var key=nowArtKey(NP)+'|'+px(size)+'|'+px(rad)+'|'+art.Width+'x'+art.Height+'|'+(isHi?'H':'L'),entry=npArtRendered[key];
  if(!entry){
    var im=null;
    try{
      im=dpiResize(art,fit.w,fit.h,2);
      if(rad>0) im.ApplyMask(roundMaskRect(fit.w,fit.h,rad));
    }catch(e){im=null;}
    entry={track:nowArtKey(NP),image:im,w:fit.w,h:fit.h};npArtRendered[key]=entry;npArtRenderedOrder.push(key);
    while(npArtRenderedOrder.length>2)delete npArtRendered[npArtRenderedOrder.shift()];
  }
  if(entry.image){
    var dx=(entry.w===size)?x:Math.round(x+(size-entry.w)/2);
    var dy=(entry.h===size)?y:Math.round(y+(size-entry.h)/2);
    gr.DrawImage(entry.image,dx,dy,entry.w,entry.h,0,0,entry.image.Width,entry.image.Height);
  }else drawRounded(gr,x,y,size,rad,NP,'np');
}
var warmed={};   // guards one-time warm passes per view; reset when items change
// bulk warm-up is low priority: it must not push what's currently on screen to the back of the queue
function warmArt(handles){ if(!handles) return; var n=(handles.length!==undefined)?handles.length:handles.Count; for(var i=0;i<n;i++){ var h=handles[i]; if(h) requestArt(h,albKey(h),true); } }
function warmOnce(tag,handles){ if(warmed[tag]) return; warmed[tag]=1; warmArt(handles); }
/* The home warm pass used to touch every artist and every playlist in a single go, inside a paint
   -- and plCovers() materialises a playlist's whole item list, so it scaled with the library, not
   the screen. It now runs in slices on timer ticks. Requests are queued low-priority, so nothing
   here can delay art for what is actually on screen. */
var warmJob=null, WARM_SLICE=25;
function startWarmHome(arts,pls){ warmJob={arts:arts,pls:pls,ai:0,pi:0}; warmStep(); }
function warmStep(){
  if(!warmJob) return;
  var j=warmJob, n=0, h;
  while(n<WARM_SLICE && j.ai<j.arts.length){
    h=artistFirst(j.arts[j.ai].name,j.arts[j.ai].handle);   // NOT artistCover: choosing a cover is
    if(h) requestArt(h,albKey(h),true);                     // on-demand work at on-screen priority
    j.ai++; n++;
  }
  while(n<WARM_SLICE && j.pi<j.pls.length){
    h=plCovers(j.pls[j.pi]).single;
    if(h) requestArt(h,albKey(h),true);
    j.pi++; n++;
  }
  if(j.ai>=j.arts.length && j.pi>=j.pls.length){ warmJob=null; return; }
  window.SetTimeout(warmStep,30);
}
/* ---- cover choice: the first candidate that actually HAS art ----------------
   An artist's or a playlist's cover used to be simply its first track, so one untagged opener left
   the card on a flat placeholder even when every other album in the set had artwork. These pick
   the first candidate whose art resolves to a real image, and only fall back to the placeholder
   colour when nothing in the set has any.
   Art is async, so the scan resolves progressively: it walks the candidates in order and stops at
   the first one not yet loaded -- requesting it, plus a short lookahead so the next round is
   already in flight -- which is what keeps the choice from ever moving backwards. The answer is
   cached once it can no longer change; an unsettled scan is cheap, but it does run per paint. */
var COVER_CANDS=10, COVER_LOOKAHEAD=2, coverPickCache={};
function coverPick(key,cands,want){
  if(coverPickCache.hasOwnProperty(key)) return coverPickCache[key];
  var out=[], done=true, i, j, h, k;
  if(cands) for(i=0;i<cands.length && out.length<want;i++){
    h=cands[i]; if(!h) continue;
    k=albKey(h);
    if(!artLoaded(k)){
      requestArt(h,k);                                   // wanted on screen now: ahead of bulk warm-up
      for(j=1;j<=COVER_LOOKAHEAD && i+j<cands.length;j++) if(cands[i+j]) requestArt(cands[i+j],albKey(cands[i+j]),true);
      done=false; break;
    }
    if(artCache[k]) out.push(h);
  }
  var res={list:out, done:done};
  if(done && cands && cands.length) coverPickCache[key]=res;   // empty = data not built yet, retry
  return res;
}
/* What a multi-track cover (playlist, All Songs) actually draws: the 2x2 mosaic once four
   candidates have art, else the first single cover there is. While the scan is unsettled it holds
   the old first-track cover, so nothing flickers between two real covers. */
function coverChoice(key,cov){
  var p=coverPick(key,cov.cands,4);
  if(!p.done) return {wait:true, list:[], single:cov.single};
  if(p.list.length>=4) return {wait:false, list:p.list, single:p.list[0]};
  return {wait:false, list:[], single:p.list.length?p.list[0]:cov.single};
}
/* The thumb is checked BEFORE its source, and deliberately outlives it. artCache is the tightest
   cache in the theme -- a ~500px bitmap per entry against a 40px thumb -- so on a large playlist it
   evicts albums whose thumbs are still resident. Asking it first threw away a perfectly good thumb,
   drew the placeholder, and refetched the full image from disk: that is what made row artwork
   visibly "reload" on returning to a big playlist. An evicted source can only ever cost a reload,
   never a wrong pixel, so the derivative is the better authority here. */
function getThumb(h,key,size){
  var tk=key+'|'+size;
  if(thumbCache.hasOwnProperty(tk)) return thumbCache[tk];
  var img=getArtK(h,key);
  if(!artLoaded(key)) return null;             // still loading -> placeholder, don't cache
  var r=null; if(img){ try{ var bw=Math.max(1,px(size)); r=artResizeCoverBitmap(img,bw,bw); }catch(e){ r=null; } }
  capPut(thumbCache,thumbOrder,THUMB_CAP,tk,r); return r;
}

// All Songs group header: rows carry their own candidates (built with the rows, free of interop)
function rowCover(row){
  var p=coverPick('sg|'+row.seed,row.cands,1);
  return p.list.length?p.list[0]:row.handle;
}
function drawCover(gr,x,y,sz,rad,h,seed,key){
  var img=h?getThumb(h,key||albKey(h),sz):null;
  if(img){ gr.DrawImage(img,x,y,sz,sz,0,0,img.Width,img.Height,0,255); }
  else if(rad>0){ gr.FillRoundRect(x,y,sz,sz,rad,rad,coverCol(seed)); }
  else { gr.FillSolidRect(x,y,sz,sz,coverCol(seed)); }
}
/* dominant colour of an album's art, for header gradients (cached; falls back to placeholder) */
var hueCache={};
function artHue(h,seed){
  if(!h) return coverCol(seed);
  var k=albKey(h);
  if(hueCache.hasOwnProperty(k)) return hueCache[k];
  var img=getArt(h);
  if(!artLoaded(k)) return coverCol(seed);   // still loading -> fallback, don't cache (recompute when it arrives)
  var col=coverCol(seed);
  if(img){ try{ var s=img.GetColourScheme(1); if(s && s.length) col=s[0]; }catch(e){} }
  hueCache[k]=col; return col;
}
/* masked art: circular (artists) / rounded (large covers). Masks + results are cached;
   ApplyMask mutates, so it runs on a resized COPY, never the shared original. */
var maskCache={}, rectMaskCache={}, rectMaskOrder=[], RECT_MASK_CAP=128, cArtCache={};
function circleMask(size){
  var k='c'+size; if(maskCache[k]) return maskCache[k];
  var m=dpiImage(size,size), g=dpiGraphics(m.GetGraphics());
  g.FillSolidRect(0,0,size,size,RGB(255,255,255)); g.SetSmoothingMode(2); g.FillEllipse(0,0,size,size,RGB(0,0,0));
  releaseDpiGraphics(m,g); maskCache[k]=m; return m;
}
function roundMask(size,rad){
  var k='r'+size+'_'+rad; if(maskCache[k]) return maskCache[k];
  var m=dpiImage(size,size), g=dpiGraphics(m.GetGraphics());
  g.FillSolidRect(0,0,size,size,RGB(255,255,255)); g.SetSmoothingMode(2); g.FillRoundRect(0,0,size,size,rad,rad,RGB(0,0,0));
  releaseDpiGraphics(m,g); maskCache[k]=m; return m;
}
function roundMaskRect(w,h,rad){
  var mw=Math.max(1,px(w)), mh=Math.max(1,px(h));
  if(mw===mh && w===h) return roundMask(w,rad);
  var r=Math.min(rad,Math.floor(Math.min(w,h)/2));
  var k='rr'+mw+'x'+mh+'_'+px(r);
  if(rectMaskCache[k]) return rectMaskCache[k];
  var m=dpiImage(w,h), g=dpiGraphics(m.GetGraphics());
  g.FillSolidRect(0,0,w,h,RGB(255,255,255)); g.SetSmoothingMode(2);
  if(r>0) g.FillRoundRect(0,0,w,h,r,r,RGB(0,0,0));
  else g.FillSolidRect(0,0,w,h,RGB(0,0,0));
  releaseDpiGraphics(m,g);
  capPut(rectMaskCache,rectMaskOrder,RECT_MASK_CAP,k,m);
  return m;
}
function artRenderMasked(src,size,rad,isCircle){
  if(!src) return null;
  var im=null;
  if(isCircle){
    var bs=Math.max(1,px(size));
    im=artResizeCoverBitmap(src,bs,bs);
    im.ApplyMask(circleMask(size));
    return {img:im,w:size,h:size};
  }
  var fit=artFitContain(src.Width,src.Height,size,size);
  im=dpiResize(src,fit.w,fit.h,2);
  if(rad>0) im.ApplyMask(roundMaskRect(fit.w,fit.h,rad));
  return {img:im,w:fit.w,h:fit.h};
}
function drawBlitCentered(gr,entry,x,y,boxSize){
  if(!entry||!entry.img) return false;
  var dx=(entry.w===boxSize)?x:Math.round(x+(boxSize-entry.w)/2);
  var dy=(entry.h===boxSize)?y:Math.round(y+(boxSize-entry.h)/2);
  gr.DrawImage(entry.img,dx,dy,entry.w,entry.h,0,0,entry.img.Width,entry.img.Height,0,255);
  return true;
}
function maskedArt(h,seed,size,rad,isCircle){
  var k=(h?albKey(h):(seed||''))+'|'+size+'|'+(isCircle?'c':('r'+rad));   // keyed by album, not the seed label ('np' is constant -> stale art)
  if(cArtCache.hasOwnProperty(k)) return cArtCache[k];
  var art=h?getArt(h):null;
  if(h && !artLoaded(albKey(h))) return null;   // still loading -> placeholder, don't cache
  var res=null;
  if(art){ try{ res=artRenderMasked(art,size,rad,isCircle); }catch(e){ res=null; } }
  capPut(cArtCache,cArtOrder,CART_CAP,k,res); return res;
}
function drawCircle(gr,x,y,size,h,seed){
  var cid=(h && typeof coverIdForHandle==='function')?coverIdForHandle(h):'';
  if(cid && typeof coverDrawCircle==='function'){
    if(!coverReady(cid) || coverHasBitmap(cid)){ coverDrawCircle(gr,x,y,size,cid,seed); return; }
  }
  var ci=maskedArt(h,seed,size,0,true);
  if(!drawBlitCentered(gr,ci,x,y,size)) gr.FillEllipse(x,y,size,size,coverCol(seed));
}
function drawRounded(gr,x,y,size,rad,h,seed){
  var ri=maskedArt(h,seed,size,rad,false);
  if(!drawBlitCentered(gr,ri,x,y,size)) gr.FillRoundRect(x,y,size,size,rad,rad,coverCol(seed));
}
/* playlist cover: up to COVER_CANDS DISTINCT albums to choose from -- four of them WITH art make
   the 2x2 mosaic, otherwise the first one with art is shown alone. list/single stay what they
   always were (the first four, the first one), because the reveal gates wait on those: a section
   reveals as soon as its opening covers are in and coverPick refines the choice after. */
var plCoverCache={}, mosaicCache={};
function plCovers(pi){
  if(plCoverCache.hasOwnProperty(pi)) return plCoverCache[pi];
  var it=getItems(pi), res={list:[], single:null, cands:[]};
  if(it && it.Count){
    var seenAlb={}, cap=Math.min(it.Count,60);
    for(var i=0;i<cap && res.cands.length<COVER_CANDS;i++){
      var h=it[i]; if(!h) continue; var k=albKey(h); if(seenAlb[k]) continue;
      seenAlb[k]=1; res.cands.push(h); if(res.list.length<4) res.list.push(h);
    }
    res.single=res.cands.length?res.cands[0]:it[0];
  }
  plCoverCache[pi]=res; return res;
}
function plChoice(pi){ return coverChoice('pl|'+pi,plCovers(pi)); }
function mosaicImg(handles,seed,size,rad){
  var key=(seed||'')+'|'+size+'|m'+rad;
  if(mosaicCache.hasOwnProperty(key)) return mosaicCache[key];
  var i, ready=true;
  for(i=0;i<4;i++){ getArt(handles[i]); if(!artLoaded(albKey(handles[i]))) ready=false; }   // request all; wait for all
  if(!ready) return null;                     // still loading -> placeholder single cover; don't cache a half mosaic
  var res=null;
  try{
    var cv=dpiImage(size,size), g=dpiGraphics(cv.GetGraphics());
    g.SetInterpolationMode(7);
    var h1=Math.floor(size/2), h2=size-h1;
    var cells=[[0,0,h1,h1],[h1,0,h2,h1],[0,h1,h1,h2],[h1,h1,h2,h2]];
    for(i=0;i<4;i++){
      var art=getArt(handles[i]), c=cells[i];
      if(art){
        var crop=artCoverCrop(art.Width,art.Height,px(c[2]),px(c[3]));
        g.DrawImage(art,c[0],c[1],c[2],c[3],crop.sx,crop.sy,crop.sw,crop.sh);
      }
      else g.FillSolidRect(c[0],c[1],c[2],c[3],coverCol((seed||'')+i));
    }
    releaseDpiGraphics(cv,g);
    if(rad>0) cv.ApplyMask(roundMask(size,rad));
    res=cv;
  }catch(e){ res=null; }
  mosaicCache[key]=res; return res;
}
function drawPlCover(gr,x,y,size,rad,pi,seed){
  var c=plChoice(pi);
  if(c.list.length>=4){ var mi=mosaicImg(c.list,seed,size,rad); if(mi){ gr.DrawImage(mi,x,y,size,size,0,0,mi.Width,mi.Height,0,255); return; } }
  drawRounded(gr,x,y,size,rad,c.single,seed);
}
/* Playlist cards are identical between playlist changes, so each is rendered once into a bitmap
   and blitted thereafter -- that removes the rounded rects, cover blits and text layout from
   every frame. Only the resting variant is cached: exactly one card is hovered at a time, so
   that one is painted live rather than doubling the cache.
   Art arrives asynchronously, so a card is not cached until its cover is ready -- the same guard
   maskedArt and mosaicImg use, without which a card would keep its placeholder forever. */
function plCoverReady(pi){
  var c=plChoice(pi), i, h;
  if(c.wait) return false;                  // still choosing -> a baked card would keep the placeholder
  for(i=0;i<c.list.length;i++){ h=c.list[i]; if(h && !artLoaded(albKey(h))) return false; }
  h=c.single; return !h || artLoaded(albKey(h));
}
/* "All Songs" cover: distinct albums sampled ACROSS the library, not just the first few; the four
   drawn are the first of them that have art (see coverChoice) */
var libCovCache=null, libCount_=-1;
function libCount(){ if(libCount_<0){ var l=libItems(); libCount_=l?l.Count:0; } return libCount_; }
function libCovers(){
  if(libCovCache) return libCovCache;
  var lib=libItems();
  var res={list:[], single:null, cands:[]};
  if(lib && lib.Count){
    var seen={}, step=Math.max(1,Math.floor(lib.Count/400));
    for(var i=0;i<lib.Count && res.cands.length<COVER_CANDS;i+=step){
      var h=lib[i]; if(!h) continue; var k=albKey(h); if(seen[k]) continue;
      seen[k]=1; res.cands.push(h); if(res.list.length<4) res.list.push(h);
    }
    res.single=res.cands.length?res.cands[0]:lib[0];
  }
  libCovCache=res; return res;
}
function libChoice(){ return coverChoice('__lib__',libCovers()); }
function drawLibCover(gr,x,y,size,rad){
  var c=libChoice();
  if(c.list.length>=4){ var mi=mosaicImg(c.list,'__lib__',size,rad); if(mi){ gr.DrawImage(mi,x,y,size,size,0,0,mi.Width,mi.Height,0,255); return; } }
  drawRounded(gr,x,y,size,rad,c.single,'__lib__');
}
