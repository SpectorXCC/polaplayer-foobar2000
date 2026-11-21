/* verdant/views/search.js -- search view: box + artist/song results
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

// factored out so the blinking caret repaints just this strip (dirtySearch), not the whole view
var SBOX_H=44, SBOX_TOP=26;   // box height + offset below R.main.y
function searchBoxRect(){ var r=R.main, boxW=Math.min(520,r.w-M.cpad*2); return {x:r.x+M.cpad-2,y:r.y+SBOX_TOP-4,w:boxW+8,h:SBOX_H+8}; }
function drawSearchBox(gr,r){
  var x0=r.x+M.cpad, boxH=SBOX_H, boxY=r.y+SBOX_TOP, boxW=Math.min(520,r.w-M.cpad*2);
  gr.FillSolidRect(x0-2,boxY-4,boxW+8,boxH+8,COL.base);   // clean bg for partial repaints
  gr.FillRoundRect(x0,boxY,boxW,boxH,boxH/2,boxH/2,COL.searchBox);
  var txtX=x0+48, txtW=boxW-(txtX-x0)-18;
  drawIcon(gr,'search',COL.text2,x0+16,boxY,22,boxH,18);
  var empty=!searchQuery.length, caretH=20, caretY=boxY+(boxH-caretH)/2, caretX;
  if(empty){
    caretX=txtX;
    tL(gr,T('search.placeholder'),FONT.searchTxt,COL.text3,txtX+12,boxY,txtW-12,boxH);
  } else {
    tL(gr,searchQuery,FONT.searchTxt,COL.text,txtX,boxY,txtW,boxH);
    caretX=txtX+Math.min(txtW,gr.CalcTextWidth(searchQuery,FONT.searchTxt))+2;
  }
  if(caretOn) gr.FillSolidRect(caretX,caretY,2,caretH,empty?COL.text2:COL.text);
}
/* Artists + Songs are one continuously-scrolled document (same model as the home artist grid).
   The search box stays pinned: content is drawn first and allowed to overflow upward, then the
   band above the viewport is painted over and the box redrawn on top. */
function drawSearch(gr,r){
  HB_BR_CARDS=[]; HB_BR_TR=[]; HB_BR_STAR=[]; HB_BR_TRDOTS=[]; HB_BR_PLDOTS=[];
  var pad=M.cpad, x0=r.x+pad, w=r.w-pad*2, i;
  var boxH=SBOX_H, boxY=r.y+(r.h<360?12:SBOX_TOP), q=searchQuery.trim();
  var src=(typeof activeSource==='function'&&(activeSource()||sourceById('local')||sourceById('navidrome')))||null;
  if(!q){
    drawSearchBox(gr,r);
    tL(gr,T((src&&src.id==='local')?'search.hint_local':'search.hint_nv'),FONT.qArtist,COL.text3,x0+2,boxY+boxH+18,w,18);
    return;
  }
  var st=src?src.searchResults():{artists:[],albums:[],songs:[],rows:EMPTY_ROWS,loading:false,requested:'',err:''};
  var arts=st.artists||[], albs=st.albums||[], rows=st.rows||makeListRows(st.songs);
  if(!arts.length && !albs.length && !rows.count){
    drawSearchBox(gr,r);
    var msg=(st.loading || st.requested!==q) ? T('search.searching_nv') : (st.err ? st.err : T('search.no_results',searchQuery));
    tC(gr,msg,FONT.sect,COL.text2,r.x,r.y+Math.round(r.h/2),r.w,24);
    return;
  }
  var top=boxY+boxH+26, cropY=r.y+r.h, viewH=cropY-top;
  var gap=16, minCard=w<380?124:176, cols=Math.max(2,Math.floor((w+gap)/(minCard+gap)));
  var cardW=Math.max(80,Math.floor((w-gap*(cols-1))/cols));
  var cardH=cardW+56, rh=56;
  var artsH=arts.length?(42+Math.ceil(arts.length/cols)*(cardH+8)+18):0;
  var albsH=albs.length?(42+Math.ceil(albs.length/cols)*(cardH+8)+18):0;
  var songsH=rows.count?(38+rows.count*rh):0;
  var contentH=artsH+albsH+songsH, maxPx=Math.max(0,contentH-viewH);
  SEARCH_MAXPX=maxPx;
  searchScroll=clampPx(searchScroll,maxPx); searchScrollT=clampPx(searchScrollT,maxPx);
  var cy=top-searchScroll;
  if(arts.length){
    tL(gr,T('search.artists'),FONT.sect2,COL.text,x0,cy,w,28);
    var gy=cy+42;
    for(i=0;i<arts.length;i++){
      var ay=gy+Math.floor(i/cols)*(cardH+8);
      if(ay>=cropY) break;
      if(ay+cardH<=top) continue;
      var ar=arts[i];
      brDrawCard(gr,x0+(i%cols)*(cardW+gap),ay,cardW,ar.coverArt,ar.name,ar.name,(ar.albumCount?T('meta.album_count',ar.albumCount):T('meta.artist_sub')),true,'artist',ar.id,ar,false,undefined,undefined,top,cropY);
      var hbA=HB_BR_CARDS[HB_BR_CARDS.length-1];
      if(hbA){ hbA.y0=Math.max(top,hbA.y0); hbA.y1=Math.min(cropY,hbA.y1); }
    }
    cy+=artsH;
  }
  if(albs.length){
    tL(gr,T('search.albums'),FONT.sect2,COL.text,x0,cy,w,28);
    var ay0=cy+42;
    for(i=0;i<albs.length;i++){
      var ly=ay0+Math.floor(i/cols)*(cardH+8);
      if(ly>=cropY) break;
      if(ly+cardH<=top) continue;
      var al=albs[i];
      brDrawCard(gr,x0+(i%cols)*(cardW+gap),ly,cardW,al.coverArt,al.name,al.name,(al.artist||'')+(al.year?(' '+CH_DOT+' '+al.year):''),false,'album',al.id,al,false,undefined,undefined,top,cropY);
      var hbL=HB_BR_CARDS[HB_BR_CARDS.length-1];
      if(hbL){ hbL.y0=Math.max(top,hbL.y0); hbL.y1=Math.min(cropY,hbL.y1); }
    }
    cy+=albsH;
  }
  if(rows.count){
    tL(gr,T('search.songs'),FONT.sect2,COL.text,x0,cy,w,28);
    var ry0=cy+38, sm={subKind:'search',id:'search:'+q,name:T('search.prefix',q)};
    for(i=0;i<rows.count;i++){
      var ry=ry0+i*rh;
      if(ry>=cropY) break;
      if(ry+rh<=top) continue;
      brDrawTrackRow(gr,r,x0,r.x+r.w-pad,ry,rh,top,cropY,i+1,rows.get(i),rows,i,sm,'',-1,{showAlbum:true,showThumb:true});
    }
  }
  gr.FillSolidRect(r.x,r.y,r.w,top-r.y,COL.base);
  gr.FillSolidRect(r.x,cropY,r.w,M.pad+2,COL.canvas);
  drawSearchBox(gr,r);
  drawScrollbar(gr,x0+w+8,top,viewH,searchScroll,maxPx,viewH,contentH,hv(x0,top,x0+w+16,cropY)||drag==='scroll');
}
