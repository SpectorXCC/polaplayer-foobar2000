/* verdant/views/cards.js -- playlist + artist cards, shared by home and search
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

/* Nothing may be painted outside [clipL,clipR): RepaintRect does not clip drawing, so anything
   spilling past the panel would be stranded on the neighbouring one by a panel-scoped repaint.
   Edge cards are therefore blitted through a bitmap with a source rect instead of being drawn
   wide and masked over afterwards. Hover and hit target clip to the same band. */
function drawPlaylistCard(gr,x,y,w,i,clipL,clipR){
  var h=w+56;
  var hx0=(clipL!==undefined&&x<clipL)?clipL:x, hx1=(clipR!==undefined&&x+w>clipR)?clipR:x+w;
  if(hx1<=hx0) return;
  var cardHov=hv(hx0,y,hx1,y+h), clipped=(hx0>x)||(hx1<x+w);
  var im=cardHov?null:plCardImg(i,w);
  var tmp=(!im && clipped)?renderPlCard(i,w,cardHov):null;   // hovered, or art still loading, at an edge
  var srcIm=im||tmp;
  if(srcIm) blitCard(gr,srcIm,x,y,hx0,y,hx1,y+h);
  else paintPlCardShell(gr,x,y,w,i,cardHov);
  if(tmp){ try{ tmp.Dispose(); }catch(e){} }
  paintPlCardText(gr,x,y,w,i,cardHov,hx0,hx1,y,y+h,clipL,clipR,undefined,undefined);
  var dx=x+w-32;
  if(cardHov && dx>=hx0 && dx+32<=hx1) drawDots(gr,dx,y+(w-24)+16,i);
  HB_CARD.push({x0:hx0,y0:y,x1:hx1,y1:y+h,kind:'pl',id:i});
}
function paintArtistCardShell(gr,x,y,w,a,hov){
  gr.FillRoundRect(x,y,w,w+56,8,8,hov?COL.cardHov:COL.elev);
  if(hov && typeof strokeRound==='function') strokeRound(gr,x,y,w,w+56,8,1,COL.line);
  var cs=w-24;
  drawCircle(gr,x+12,y+12,cs,artistCover(a.name,a.handle),a.name);
}
function paintArtistCardText(gr,x,y,w,a,hov,clipTop,clipBot){
  var cs=w-24, tCol=hov?COL.green:COL.text, sCol=hov?COL.text:COL.text2;
  tCard(gr,a.name,FONT.card,tCol,x+12,y+cs+18,cs,20,true,undefined,undefined,clipTop,clipBot);
  tCard(gr,'Artist',FONT.plSub,sCol,x+12,y+cs+40,cs,16,true,undefined,undefined,clipTop,clipBot);
}
function paintArtistCard(gr,x,y,w,a,hov){
  paintArtistCardShell(gr,x,y,w,a,hov);
  paintArtistCardText(gr,x,y,w,a,hov);
}
/* The artist grid is the bulk of a home frame -- ~30 cards on a wide window, each an antialiased
   rounded rect, a masked circular cover and two centred labels, all redrawn every paint. Cache
   them like playlist cards. Unlike playlists a library can have thousands of artists, so the
   cache is capped and dropped wholesale when it grows past the cap. */
// 120 could not hold a 269-artist library: measurement showed ~400 misses per 30 frames while
// scrolling home, i.e. a dozen cards re-rendered every frame instead of blitted
var artCardCache={}, artCardN=0, ART_CARD_CAP=400, artTick=0;
/* Least-recently-used eviction. Wiping the whole cache on overflow meant the very next frame had
   to re-render every visible card at once -- the worst possible moment, since overflow happens
   while scrolling. Dropping the oldest half instead keeps what is on screen and costs only the
   newly-revealed row. */
function evictArtCards(){
  var keys=[], k, i;
  for(k in artCardCache) keys.push(k);
  keys.sort(function(p,q){ return artCardCache[p].t-artCardCache[q].t; });
  var n=Math.floor(keys.length/2);
  for(i=0;i<n;i++) delete artCardCache[keys[i]];
  artCardN=keys.length-n;
}
function artCardImg(a,w){
  var key=a.name+'|'+w, e=artCardCache[key];
  if(e){ e.t=++artTick; return e.img; }
  var ah=artistCover(a.name,a.handle);
  if(!artistCoverReady(a.name,a.handle)) return null;   // still choosing a cover -> don't bake a placeholder
  if(ah && !artLoaded(albKey(ah))) return null;         // art still loading -> same
  if(artCardN>=ART_CARD_CAP) evictArtCards();
  var im=null;
  try{
    im=dpiImage(w,w+56); var g=dpiGraphics(im.GetGraphics());
    g.SetSmoothingMode(2);
    g.FillSolidRect(0,0,w,w+56,COL.base);
    paintArtistCardShell(g,0,0,w,a,false);
    releaseDpiGraphics(im,g);
  }catch(e2){ if(im){ try{ im.Dispose(); }catch(e3){} } im=null; }
  artCardCache[key]={img:im,t:++artTick}; artCardN++; return im;
}
function drawArtistCard(gr,x,y,w,a,clipTop,clipBot){
  var h=w+56;
  // clip drawing and the click target to the scroll viewport
  var vy0=(clipTop!==undefined&&y<clipTop)?clipTop:y, vy1=(clipBot!==undefined&&y+h>clipBot)?clipBot:y+h;
  if(vy1<=vy0) return;
  var hov=hv(x,vy0,x+w,vy1), clipped=(vy0>y)||(vy1<y+h);
  var im=hov?null:artCardImg(a,w);                   // the one hovered card is painted live
  // angle/alpha omitted on purpose: passing them takes GdiGraphics' transform+colour-matrix path,
  // which is far slower than the plain blit these 1:1 draws need
  if(im){
    blitCard(gr,im,x,y,x,vy0,x+w,vy1);
  } else if(clipped){
    var tmp=null;
    try{
      tmp=dpiImage(w,h); var g=dpiGraphics(tmp.GetGraphics());
      g.SetSmoothingMode(2);
      g.FillSolidRect(0,0,w,h,COL.base);
      paintArtistCardShell(g,0,0,w,a,hov);
      releaseDpiGraphics(tmp,g);
      blitCard(gr,tmp,x,y,x,vy0,x+w,vy1);
    }catch(e){}
    if(tmp){ try{ tmp.Dispose(); }catch(e2){} }
  } else {
    paintArtistCardShell(gr,x,y,w,a,hov);
  }
  paintArtistCardText(gr,x,y,w,a,hov,clipTop,clipBot);
  HB_CARD.push({x0:x,y0:vy0,x1:x+w,y1:vy1,kind:'artist',id:a.name});
}
