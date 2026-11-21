/* verdant/views/browse.js -- unified browse views: Home, Albums, Artists, Playlist, Album, Artist, Loved, Random Mix
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

var brView = 'home', brViewId = '', brViewTitle = '', brHistory = [];
var brScroll = 0, brScrollT = 0, BR_MAXPX = 0;
var brShelfScroll = 0, brShelfScrollT = 0, BR_SHELF_MAX = 0, BR_SHELF_STRIDE = 0, BR_SHELF_Y0 = 0, BR_SHELF_Y1 = 0;

var brPlSort = 'default', brPlSortDir = 'asc', brPlSortOpen = false;
var brAlbTabOpen = false, brSrvMenuOpen = false;

function brSnapView(){
  return { brView: brView, brViewId: brViewId, brViewTitle: brViewTitle, brScroll: brScroll };
}

function brNavPush(){
  brHistory.push(brSnapView());
  if(brHistory.length > 20) brHistory.shift();
}

function brCloseMenus(){
  brPlSortOpen = false; brAlbTabOpen = false; brSrvMenuOpen = false;
}

function brOpenView(nextView, id, title, skipPush){
  brCloseMenus();
  if(!skipPush && view === 'browse' && (brView !== nextView || brViewId !== (id || ''))){
    brNavPush();
  }
  view = 'browse';
  brView = nextView;
  brViewId = id || '';
  brViewTitle = title || '';
  brScroll = brScrollT = 0;
  hoverKey = ''; scrollKey = '';
  var src = brSrc();
  if(src){
    src.ensureLoaded();
    if(nextView === 'playlist' && id) src.fetchPlaylist(id, false);
    else if(nextView === 'album' && id) src.fetchAlbum(id, false);
    else if(nextView === 'artist' && id) src.fetchArtist(id, title, false);
    else if(nextView === 'albums') src.fetchAlbums(src.albumsTab(), false, false);
    else if(nextView === 'artists') src.fetchArtists(false);
    else if(nextView === 'starred') src.fetchLoved(false);
    else if(nextView === 'random'){
      var rm0 = src.random();
      if(!(rm0.rows ? rm0.rows.count : (rm0.songs && rm0.songs.length))) src.fetchRandom(80, false);
    }
    if(nextView === 'playlist' && id && src.id === 'local'){
      var lpi = parseInt(id, 10);
      if(!isNaN(lpi) && lpi >= 0 && lpi < plman.PlaylistCount){
        try{ plman.ActivePlaylist = lpi; }catch(e){}
      }
    }
  }
  repaintAll();
}

function brOpenHome(){
  var src = brSrc();
  var defTitle = (src && src.id === 'local') ? T('source.local') : T('source.navidrome');
  brOpenView('home', '', defTitle, false);
}
function brOpenPlaylist(id, name){ brOpenView('playlist', id, name || T('meta.playlist_sub'), false); }
function brOpenAlbum(id, name){ brOpenView('album', id, name || T('meta.album_sub'), false); }
function brOpenAlbums(tab){
  var src = brSrc();
  if(src && tab) src.setAlbumsTab(tab);
  brOpenView('albums', src ? src.albumsTab() : (tab || 'recent'), T('nav.albums'), false);
}
function brSelectAlbumsTab(tab){
  tab = tab || 'recent';
  brAlbTabOpen = false;
  var src = brSrc();
  if(src){ src.setAlbumsTab(tab); src.fetchAlbums(tab, false, tab === 'random'); }
  brViewId = tab;
  brScroll = brScrollT = 0;
  repaintAll();
}
function brOpenArtist(id, name){ brOpenView('artist', id, name || T('meta.artist_sub'), false); }
function brOpenArtists(){ brOpenView('artists', '', T('nav.artists'), false); }
function brOpenStarred(){ brOpenView('starred', '', T('home.quick_loved'), false); }
function brOpenRandom(){ brOpenView('random', '', T('home.quick_random'), false); }

function brGoBack(){
  if(!brHistory.length) return;
  var prev = brHistory.pop();
  brCloseMenus();
  view = 'browse';
  brView = prev.brView || 'home';
  brViewId = prev.brViewId || '';
  brViewTitle = prev.brViewTitle || '';
  brScroll = brScrollT = prev.brScroll || 0;
  repaintAll();
}

function brRefreshActiveDetail(){
  var src = brSrc();
  if(!src) return;
  if(brView === 'playlist' && brViewId) src.fetchPlaylist(brViewId, true);
  else if(brView === 'album' && brViewId) src.fetchAlbum(brViewId, true);
  else if(brView === 'artist' && brViewId) src.fetchArtist(brViewId, brViewTitle, true);
  else if(brView === 'albums') src.fetchAlbums(src.albumsTab(), false, true);
  else if(brView === 'artists') src.fetchArtists(true);
  else if(brView === 'starred') src.fetchLoved(true);
  else if(brView === 'random') src.fetchRandom(80, false);
}

/* ---- 1) Home ---- */
function brBuildQuickCards(src){
  var qCards = [{ label: T('home.quick_loved'), icon: 'heart', act: 'go-starred' }];
  if(!src || sourceHasCap(src, 'randomMix')) qCards.push({ label: T('home.quick_random'), icon: 'shuffle', act: 'go-random' });
  qCards.push(
    { label: T('home.quick_albums'), icon: 'album', act: 'go-albums' },
    { label: T('home.quick_artists'), icon: 'artist', act: 'go-artists' }
  );
  return qCards;
}

function brDrawQuickRow(gr, x0, w, quickY, quickH, qCards, twoRows){
  var qGap = 8, cols = twoRows ? 2 : qCards.length, qw = Math.floor((w - qGap * (cols - 1)) / cols);
  for(var i = 0; i < qCards.length; i++){
    var col = i % cols, row = Math.floor(i / cols);
    var qx = x0 + col * (qw + qGap), qy = quickY + row * (quickH + qGap), qhov = hv(qx, qy, qx + qw, qy + quickH);
    gr.FillRoundRect(qx, qy, qw, quickH, 8, 8, qhov ? COL.hover : COL.elev);
    if(qhov && typeof strokeRound === 'function') strokeRound(gr, qx, qy, qw, quickH, 8, 1, COL.line);
    drawIcon(gr, qCards[i].icon, qhov ? COL.greenHot : COL.green, qx + 10, qy + (quickH - 18) / 2, 18, 18, 16);
    tL(gr, qCards[i].label, FONT.pl, qhov ? COL.green : COL.text, qx + 34, qy, Math.max(20, qw - 40), quickH);
    HB_BR_BTN.push({ x0: qx, y0: qy, x1: qx + qw, y1: qy + quickH, act: qCards[i].act });
  }
}

function brDrawHome(gr, r){
  brDrawTopStrip(gr, r, false);
  var pad = M.cpad, x0 = r.x + pad, w = Math.max(80, r.w - pad * 2), rightEdge = r.x + r.w, i;
  var topBarBot = r.y + (r.h < 380 ? 44 : 54);
  var src = brSrc();
  var plSt = src ? src.playlists() : { list: [], loading: false, loaded: true, err: '' };
  if(plSt.err && !plSt.list.length){
    tC(gr, plSt.err, FONT.sect, COL.danger, r.x + 24, r.y + Math.round(r.h / 2) - 24, r.w - 48, 28);
    var recLbl = T('btn.reconnect'), recW = brActionPillW(gr, recLbl, 'refresh', 132);
    brDrawActionPill(gr, r.x + Math.round((r.w - recW) / 2), r.y + Math.round(r.h / 2) + 14, recW, 38, recLbl, 'refresh', false, 'refresh');
    return;
  }
  var gap = 16, grid = brDrawGridCols(w, gap, 176), cols = grid.cols, cardW = grid.cardW, cardH = grid.cardH;
  var pls = plSt.list;
  var scardW = (pls.length > cols) ? Math.floor((w - cols * gap) / (cols + 0.4)) : cardW, scardH = scardW + 56;
  var qCards = brBuildQuickCards(src);
  var twoRowsQ = w < 540 && qCards.length > 2, quickH = twoRowsQ ? 38 : 44;
  var quickTotalH = twoRowsQ ? (Math.ceil(qCards.length / 2) * quickH + 8) : quickH;
  var recentSlot = src ? src.albums('recent') : { list: [], loading: false };
  var albums = recentSlot.list || [];
  coverWarm(pls); coverWarm(albums);
  var cropY = r.y + r.h, rowStep = cardH + 8, totalRows = Math.max(1, Math.ceil(albums.length / cols));
  var stride = scardW + gap, shelfW = Math.max(0, pls.length * stride - gap);
  BR_SHELF_MAX = Math.max(0, shelfW - w); BR_SHELF_STRIDE = stride;
  brShelfScroll = clampPx(brShelfScroll, BR_SHELF_MAX); brShelfScrollT = clampPx(brShelfScrollT, BR_SHELF_MAX);
  var newPlLbl = T('btn.new_pl'), newPlW = Math.max(96, Math.round(gr.CalcTextWidth(newPlLbl, FONT.plSub)) + 38);
  var seeLbl = T('btn.see_all'), seeW = Math.max(84, Math.round(gr.CalcTextWidth(seeLbl, FONT.plSub)) + 26);

  if(r.h < 460){
    var sTitle0 = topBarBot + 4, sY0 = sTitle0 + 34, qY0 = sY0 + scardH + (pls.length > cols ? 22 : 14);
    var aTitle0 = qY0 + quickTotalH + 18, gy0 = aTitle0 + 36;
    var viewHF = Math.max(60, cropY - topBarBot);
    var docH = (gy0 - topBarBot) + (albums.length ? totalRows * rowStep : 90), maxPxF = Math.max(0, docH - viewHF);
    BR_MAXPX = maxPxF; brScroll = clampPx(brScroll, maxPxF); brScrollT = clampPx(brScrollT, maxPxF);
    var sTitleY = Math.round(sTitle0 - brScroll), shelfY = Math.round(sY0 - brScroll), quickY = Math.round(qY0 - brScroll);
    var albTitleY = Math.round(aTitle0 - brScroll), gy = Math.round(gy0 - brScroll);
    if(sTitleY >= topBarBot && sTitleY + 28 <= cropY){
      tL(gr, T((src && src.id === 'local') ? 'home.local_playlists' : 'home.nv_playlists'), FONT.sect2, COL.text, x0, sTitleY, w - newPlW - 10, 28);
      brDrawMiniPill(gr, x0 + w - newPlW, sTitleY - 1, newPlW, 28, newPlLbl, 'add', 'new-pl');
    }
    if(shelfY + scardH > topBarBot && shelfY < cropY){
      if(plSt.loading && !plSt.loaded){
        var skT = Math.max(topBarBot, shelfY), skB = Math.min(cropY, shelfY + scardH);
        if(skB > skT){ skelCardsCached(gr, x0, skT, w, skB - skT, scardW, gap); shimmer(gr, x0, skT, w, skB - skT); }
      } else if(!pls.length){
        if(shelfY >= topBarBot && shelfY + 24 <= cropY) tL(gr, T((src && src.id === 'local') ? 'home.no_local_pl_hint' : 'home.no_pl_hint'), FONT.meta, COL.text3, x0, shelfY + 14, w, 24);
      } else {
        for(i = Math.floor(brShelfScroll / stride); i < pls.length; i++){
          var cxF = Math.round(x0 + i * stride - brShelfScroll);
          if(cxF >= rightEdge) break;
          var plF = pls[i];
          brDrawCard(gr, cxF, shelfY, scardW, plF.coverArt, plF.name, plF.name, T('meta.songs', plF.songCount), false, 'pl', plF.id, plF, true, x0, rightEdge, Math.max(topBarBot, shelfY), Math.min(cropY, shelfY + scardH));
        }
      }
    }
    BR_SHELF_Y0 = Math.max(topBarBot, shelfY); BR_SHELF_Y1 = Math.min(cropY, shelfY + scardH);
    if(shelfY + scardH + 6 >= topBarBot && shelfY + scardH + 12 <= cropY){
      drawScrollbarH(gr, x0, shelfY + scardH + 6, w, brShelfScroll, BR_SHELF_MAX, w, shelfW, hv(x0, Math.max(topBarBot, shelfY), rightEdge, Math.min(cropY, shelfY + scardH + 16)) || drag === 'scrollh');
    }
    if(quickY >= topBarBot && quickY + quickTotalH <= cropY) brDrawQuickRow(gr, x0, w, quickY, quickH, qCards, twoRowsQ);
    if(albTitleY >= topBarBot && albTitleY + 28 <= cropY){
      tL(gr, T('home.recent_albums'), FONT.sect2, COL.text, x0, albTitleY, w - seeW - 8, 28);
      brDrawMiniPill(gr, x0 + w - seeW, albTitleY - 1, seeW, 28, seeLbl, '', 'go-albums');
    }
    if(recentSlot.loading && !albums.length){
      var aSkT = Math.max(topBarBot, gy);
      if(cropY > aSkT){ skelCardsCached(gr, x0, aSkT, w, cropY - aSkT, cardW, gap); shimmer(gr, x0, aSkT, w, cropY - aSkT); }
    } else if(!albums.length){
      if(gy + 40 <= cropY) tC(gr, T('home.no_recent_albums'), FONT.meta, COL.text3, x0, Math.max(topBarBot, gy + 20), w, 24);
    } else {
      var stRow = Math.max(0, Math.floor((topBarBot - gy) / rowStep));
      for(i = stRow * cols; i < albums.length; i++){
        var colF = i % cols, rowF = Math.floor(i / cols), ayF = Math.round(gy + rowF * rowStep);
        if(ayF >= cropY) break;
        if(ayF + cardH <= topBarBot) continue;
        var alF = albums[i];
        brDrawCard(gr, x0 + colF * (cardW + gap), ayF, cardW, alF.coverArt, alF.name, alF.name, (alF.artist || '') + (alF.year ? (' ' + CH_DOT + ' ' + alF.year) : ''), false, 'album', alF.id, alF, false, undefined, undefined, topBarBot, cropY);
      }
    }
    gr.FillSolidRect(r.x, cropY, r.w, M.pad + 2, COL.canvas);
    drawScrollbar(gr, x0 + w + 4, topBarBot, viewHF, brScroll, maxPxF, viewHF, docH, hv(r.x, topBarBot, r.x + r.w, cropY) || drag === 'scroll');
    return;
  }

  var shelfTitleY = topBarBot + 6, shelfY2 = shelfTitleY + 38;
  var quickY2 = shelfY2 + scardH + (pls.length > cols ? 28 : 16);
  var albTitleY2 = quickY2 + quickTotalH + 22, gy2 = albTitleY2 + 40;
  var viewH = Math.max(60, cropY - gy2);

  var contentH = totalRows * rowStep, maxPx = Math.max(0, contentH - viewH);
  BR_MAXPX = maxPx;
  brScroll = clampPx(brScroll, maxPx); brScrollT = clampPx(brScrollT, maxPx);

  if(recentSlot.loading && !albums.length){
    skelCardsCached(gr, x0, gy2, w, Math.max(60, cropY - gy2), cardW, gap); shimmer(gr, x0, gy2, w, Math.max(60, cropY - gy2));
  } else if(!albums.length){
    tC(gr, T('home.no_recent_albums'), FONT.meta, COL.text3, x0, gy2 + 40, w, 24);
  } else {
    for(i = Math.floor(brScroll / rowStep) * cols; i < albums.length; i++){
      var col = i % cols, row = Math.floor(i / cols), ay = Math.round(gy2 + row * rowStep - brScroll);
      if(ay >= cropY) break;
      if(ay + cardH <= gy2) continue;
      var al = albums[i];
      brDrawCard(gr, x0 + col * (cardW + gap), ay, cardW, al.coverArt, al.name, al.name, (al.artist || '') + (al.year ? (' ' + CH_DOT + ' ' + al.year) : ''), false, 'album', al.id, al, false, undefined, undefined, gy2, cropY);
    }
  }
  gr.FillSolidRect(r.x, cropY, r.w, M.pad + 2, COL.canvas);

  gr.FillSolidRect(r.x, topBarBot, r.w, gy2 - topBarBot, COL.base);
  tL(gr, T((src && src.id === 'local') ? 'home.local_playlists' : 'home.nv_playlists'), FONT.sect2, COL.text, x0, shelfTitleY, w - newPlW - 10, 28);
  brDrawMiniPill(gr, x0 + w - newPlW, shelfTitleY - 2, newPlW, 30, newPlLbl, 'add', 'new-pl');

  if(plSt.loading && !plSt.loaded){
    skelCardsCached(gr, x0, shelfY2, w, scardH, scardW, gap); shimmer(gr, x0, shelfY2, w, scardH);
  } else if(!pls.length){
    tL(gr, T((src && src.id === 'local') ? 'home.no_local_pl_hint' : 'home.no_pl_hint'), FONT.meta, COL.text3, x0, shelfY2 + 24, w, 24);
  } else {
    for(i = Math.floor(brShelfScroll / stride); i < pls.length; i++){
      var cx = Math.round(x0 + i * stride - brShelfScroll);
      if(cx >= rightEdge) break;
      var pl = pls[i];
      brDrawCard(gr, cx, shelfY2, scardW, pl.coverArt, pl.name, pl.name, T('meta.songs', pl.songCount), false, 'pl', pl.id, pl, true, x0, rightEdge, shelfY2, shelfY2 + scardH);
    }
  }
  BR_SHELF_Y0 = shelfY2; BR_SHELF_Y1 = shelfY2 + scardH;
  drawScrollbarH(gr, x0, shelfY2 + scardH + 6, w, brShelfScroll, BR_SHELF_MAX, w, shelfW, hv(x0, shelfY2, rightEdge, shelfY2 + scardH + 16) || drag === 'scrollh');

  brDrawQuickRow(gr, x0, w, quickY2, quickH, qCards, twoRowsQ);

  tL(gr, T('home.recent_albums'), FONT.sect2, COL.text, x0, albTitleY2, w - seeW - 8, 28);
  brDrawMiniPill(gr, x0 + w - seeW, albTitleY2 - 2, seeW, 28, seeLbl, '', 'go-albums');

  drawScrollbar(gr, x0 + w + 8, gy2, viewH, brScroll, maxPx, viewH, contentH, hv(x0, gy2, x0 + w + 16, cropY) || drag === 'scroll');
}

/* ---- 2) Albums Directory ---- */
function brDrawAlbumsView(gr, r){
  var pad = M.cpad, x0 = r.x + pad, w = r.w - pad * 2, rx = r.x + r.w - pad;
  var src = brSrc();
  var tab = src ? src.albumsTab() : 'recent';
  var slot = src ? src.albums(tab) : { list: [], loading: true, err: '', hasMore: false };
  var pillY = r.y + 52, gy = pillY + 48, cropY = r.y + r.h, viewH = Math.max(60, cropY - gy);

  function drawHeader(){
    gr.FillSolidRect(r.x, r.y + M.radius + 2, r.w, gy - r.y - M.radius - 2, COL.base);
    brDrawTopStrip(gr, r, false);
    HB_BR_ALB_DD = drawDropPill(gr, x0, pillY, 210, 36, labelOf(brAlbumTabOptions(src), tab, T('alb_tab.recent')), brAlbTabOpen);
  }

  if(slot.loading && !slot.list.length){
    drawHeader();
    skelCardsCached(gr, x0, gy, w, viewH, 176, 16); shimmer(gr, x0, gy, w, viewH);
    return;
  }
  if(slot.err && !slot.list.length){
    drawHeader();
    brDrawLoadingOrErr(gr, r, gy, false, slot.err, 'refresh');
    return;
  }

  var albums = slot.list, gap = 16, grid = brDrawGridCols(w, gap, 176), cols = grid.cols, cardW = grid.cardW, cardH = grid.cardH, rowStep = cardH + 8;
  coverWarm(albums);
  var footH = slot.hasMore ? 64 : 12;
  var contentH = Math.max(1, Math.ceil(albums.length / cols)) * rowStep + footH, maxPx = Math.max(0, contentH - viewH);
  BR_MAXPX = maxPx; brScroll = clampPx(brScroll, maxPx); brScrollT = clampPx(brScrollT, maxPx);

  for(var i = Math.floor(brScroll / rowStep) * cols; i < albums.length; i++){
    var col = i % cols, row = Math.floor(i / cols), ay = Math.round(gy + row * rowStep - brScroll);
    if(ay >= cropY) break;
    if(ay + cardH <= gy) continue;
    var al = albums[i];
    brDrawCard(gr, x0 + col * (cardW + gap), ay, cardW, al.coverArt, al.name, al.name, (al.artist || '') + (al.year ? (' ' + CH_DOT + ' ' + al.year) : ''), false, 'album', al.id, al, false, undefined, undefined, gy, cropY);
  }
  if(slot.hasMore){
    var fy = Math.round(gy + Math.ceil(albums.length / cols) * rowStep - brScroll + 8);
    if(fy + 38 > gy && fy < cropY){
      var moreLbl = slot.loading ? T('btn.loading') : T('btn.load_more_albums');
      var moreW = brActionPillW(gr, moreLbl, '', 150);
      brDrawActionPill(gr, x0 + Math.round((w - moreW) / 2), fy, moreW, 38, moreLbl, '', false, 'more-albums');
      var mb = HB_BR_BTN[HB_BR_BTN.length - 1];
      if(mb){ mb.y0 = Math.max(gy, mb.y0); mb.y1 = Math.min(cropY, mb.y1); }
    }
  }
  gr.FillSolidRect(r.x, cropY, r.w, M.pad + 2, COL.canvas);
  drawHeader();
  drawScrollbar(gr, rx + 8, gy, viewH, brScroll, maxPx, viewH, contentH, hv(r.x, gy, r.x + r.w, cropY) || drag === 'scroll');
}

/* ---- 3) Artists Directory ---- */
function brDrawArtistsView(gr, r){
  var pad = M.cpad, x0 = r.x + pad, w = r.w - pad * 2, rx = r.x + r.w - pad;
  var gy = r.y + 58, cropY = r.y + r.h, viewH = Math.max(60, cropY - gy);
  var src = brSrc();
  var st = src ? src.artists() : { list: [], loaded: false, loading: false, err: '' };
  if((st.loading && !st.loaded) || (st.err && !st.loaded)){
    brDrawTopStrip(gr, r, false);
    if(brDrawLoadingOrErr(gr, r, gy, st.loading && !st.loaded, st.err, 'refresh')) return;
  }
  var arts = st.list || [];
  coverWarm(arts);
  var gap = 16, grid = brDrawGridCols(w, gap, 176), cols = grid.cols, cardW = grid.cardW, cardH = grid.cardH, rowStep = cardH + 8;
  var contentH = Math.max(1, Math.ceil(arts.length / cols)) * rowStep + 16, maxPx = Math.max(0, contentH - viewH);
  BR_MAXPX = maxPx; brScroll = clampPx(brScroll, maxPx); brScrollT = clampPx(brScrollT, maxPx);

  for(var i = Math.floor(brScroll / rowStep) * cols; i < arts.length; i++){
    var col = i % cols, row = Math.floor(i / cols), ay = Math.round(gy + row * rowStep - brScroll);
    if(ay >= cropY) break;
    if(ay + cardH <= gy) continue;
    var a = arts[i];
    brDrawCard(gr, x0 + col * (cardW + gap), ay, cardW, a.coverArt, a.name, a.name, (a.albumCount ? T('meta.album_count', a.albumCount) : T('meta.artist_sub')), true, 'artist', a.id, a, false, undefined, undefined, gy, cropY);
  }
  gr.FillSolidRect(r.x, r.y + M.radius + 2, r.w, gy - r.y - M.radius - 2, COL.base);
  brDrawTopStrip(gr, r, false);
  gr.FillSolidRect(r.x, cropY, r.w, M.pad + 2, COL.canvas);
  drawScrollbar(gr, rx + 8, gy, viewH, brScroll, maxPx, viewH, contentH, hv(r.x, gy, r.x + r.w, cropY) || drag === 'scroll');
}

/* ---- 4) Playlist Detail ---- */
function drawPlEmpty(gr, r, top, bottom){
  var availH = bottom - top, availW = r.w - M.cpad * 2;
  if(availW < 220 || availH < 110) return;
  var cx = r.x + Math.round(r.w / 2);
  if(plDropHover){ drawDropZone(gr, cx, top, availW, availH); return; }

  var badge = availH >= 250, sub = availH >= 170;
  var blockH = (badge ? 86 : 0) + 40 + (sub ? 24 : 0) + 24 + PILL_H;
  var y = top + Math.round((availH - blockH) / 2);
  if(badge){
    var bs = 64, bx = cx - bs / 2;
    gr.FillEllipse(bx, y, bs, bs, OV(16));
    drawIcon(gr, 'add', COL.text2, bx, y, bs, bs, 26);
    y += 86;
  }
  tC(gr, T('empty.add_songs'), FONT.sect2, COL.text, r.x, y, r.w, 40); y += 40;
  if(sub){ tC(gr, T('empty.add_songs_sub'), FONT.meta, COL.text2, r.x, y, r.w, 24); y += 24; }
  y += 24;
  var bFiles = T('btn.browse_files'), bFolder = T('btn.browse_folder');
  var w1 = pillW(gr, bFiles), w2 = pillW(gr, bFolder), gap = 12;
  var px0 = cx - Math.round((w1 + w2 + gap) / 2);
  HB_PLADD_FILES = drawPill(gr, px0, y, w1, bFiles, true);
  HB_PLADD_FOLDER = drawPill(gr, px0 + w1 + gap, y, w2, bFolder, false);
}

function drawDropZone(gr, cx, top, availW, availH){
  var bw = Math.min(560, availW), bh = Math.min(260, availH - 24);
  var bx = cx - Math.round(bw / 2), by = top + Math.round((availH - bh) / 2), rad = Math.min(14, bw / 2, bh / 2);
  gr.FillRoundRect(bx, by, bw, bh, rad, rad, RGBA(30, 215, 96, 26));
  strokeRound(gr, bx, by, bw, bh, rad, 2, COL.green);
  var iy = by + Math.round(bh / 2) - 40;
  drawIcon(gr, 'add', COL.green, bx, iy, bw, 34, 34);
  tC(gr, T('empty.drop_to_add'), FONT.sect, COL.green, bx, iy + 44, bw, 26);
}

function brSortedPlaylistRows(det){
  var rows = (det && det.rows) ? det.rows : makeListRows(det && det.songs);
  var n = rows.count;
  if(brPlSort === 'default' && brPlSortDir === 'asc'){
    return {
      count: n,
      origIdx: function(d){ return d; },
      get: function(d){ return rows.get(d); },
      all: function(){ return rows.all(); }
    };
  }
  var sc = rows._sortedCache;
  if(sc && sc.sort === brPlSort && sc.dir === brPlSortDir && sc.n === n) return sc.view;
  var idx = [], i;
  for(i = 0; i < n; i++) idx.push(i);
  if(brPlSort === 'default'){
    idx.reverse();
  } else {
    var mul = (brPlSortDir === 'desc') ? -1 : 1;
    var sk = rows.sortKeys;
    if(sk){
      var ka = (brPlSort === 'dur') ? sk.dur : sk[brPlSort];
      idx.sort(function(ia, ib){
        var cmp = 0;
        if(brPlSort === 'dur') cmp = (parseInt(ka[ia], 10) || 0) - (parseInt(ka[ib], 10) || 0);
        else { var sa = ka[ia] || '', sb = ka[ib] || ''; cmp = sa < sb ? -1 : (sa > sb ? 1 : 0); }
        return cmp !== 0 ? cmp * mul : (ia - ib);
      });
    } else {
      idx.sort(function(ia, ib){
        var a = rows.get(ia), b = rows.get(ib), cmp = 0;
        if(brPlSort === 'dur') cmp = a.duration - b.duration;
        else{
          var sa = String(brPlSort === 'title' ? a.title : (brPlSort === 'artist' ? a.artist : a.album)).toLowerCase();
          var sb = String(brPlSort === 'title' ? b.title : (brPlSort === 'artist' ? b.artist : b.album)).toLowerCase();
          cmp = sa < sb ? -1 : (sa > sb ? 1 : 0);
        }
        return cmp !== 0 ? cmp * mul : (ia - ib);
      });
    }
  }
  var sortedView = {
    count: n,
    origIdx: function(d){ return (d >= 0 && d < n) ? idx[d] : -1; },
    get: function(d){ return (d >= 0 && d < n) ? rows.get(idx[d]) : null; },
    all: function(){ var out = []; for(var k = 0; k < n; k++) out.push(rows.get(idx[k])); return out; }
  };
  rows._sortedCache = { sort: brPlSort, dir: brPlSortDir, n: n, view: sortedView };
  return sortedView;
}

function brDrawPlaylistView(gr, r){
  var src = brSrc();
  var det = src ? src.playlist(brViewId) : { meta: null, rows: EMPTY_ROWS, loading: true, err: '' };
  var meta = det.meta || (src && src.playlistById && src.playlistById(brViewId)) || { id: brViewId, name: brViewTitle || T('meta.playlist_sub'), coverArt: '', songCount: 0, duration: 0 };
  var rawRows = det.rows || makeListRows(det.songs);
  if(det.loading && !rawRows.count){ drawViewSkeleton(gr, r); brDrawTopStrip(gr, r, true); return; }
  if(det.err && !rawRows.count){ brDrawTopStrip(gr, r, false); brDrawLoadingOrErr(gr, r, r.y + 60, false, det.err, 'refresh'); return; }

  var hm = brHeaderMetrics(r, M.headH), headH = hm.headH, shortH = hm.shortH, compact = hm.compact;
  gr.FillGradRect(r.x, r.y, r.w, headH, 90, blend(coverHue(meta.coverArt, meta.name), COL.base, headMix(0.42)), COL.base, 1.0);
  brDrawTopStrip(gr, r, true);

  coverDrawRounded(gr, hm.ax, hm.ay, hm.art, 8, meta.coverArt, meta.name);
  var dur = meta.duration || 0, metaStr = T('meta.songs', rawRows.count) + (dur > 0 ? (' ' + CH_DOT + ' ' + fmtDur(dur)) : '');
  if(shortH){
    tL(gr, meta.name, FONT.sect, COL.text, hm.tx, hm.ay, hm.tw, 22);
    tL(gr, metaStr, FONT.plSub, COL.text2, hm.tx, hm.ay + 22, hm.tw, 16);
  } else {
    tL(gr, T((src && src.id === 'local') ? 'eyebrow.playlist' : 'eyebrow.nv_playlist'), FONT.eyebrow, COL.text, hm.tx, hm.ay + 2, hm.tw, 18);
    tL(gr, meta.name, compact ? FONT.sect2 : FONT.title, COL.text, hm.tx, hm.ay + (compact ? 18 : 22), hm.tw, compact ? 36 : 74);
    tL(gr, metaStr, FONT.meta, COL.text2, hm.tx, hm.ay + (compact ? 56 : 100), hm.tw, 22);
  }

  var sortDirW = hm.actH, sortGap = 6;
  var reserveSort = (hm.rx0 - hm.tx >= 290) ? 148 : 0;
  var actEnd = brDrawPillRow(gr, hm.tx, hm.rx0 - reserveSort, hm.actY, hm.actH, [
    { label: T('btn.play'), icon: 'play', minW: shortH ? 76 : 108, primary: true, act: 'play-list' },
    { label: T('btn.shuffle'), icon: 'shuffle', minW: shortH ? 84 : 126, primary: false, act: 'shuf-list' }
  ]);
  if(hm.rx0 - actEnd >= 132){
    var sortPillW = Math.min(180, Math.max(82, hm.rx0 - actEnd - sortDirW - sortGap - 4));
    var sx = hm.rx0 - sortPillW - sortGap - sortDirW;
    HB_BR_SORT_DD = drawDropPill(gr, sx, hm.actY, sortPillW, hm.actH, labelOf(BR_PL_SORTS, brPlSort, T('sort.default')), brPlSortOpen);
    var sdX = sx + sortPillW + sortGap;
    var sdHot = hv(sdX, hm.actY, sdX + sortDirW, hm.actY + hm.actH);
    gr.FillRoundRect(sdX, hm.actY, sortDirW, hm.actH, hm.actH / 2, hm.actH / 2, sdHot ? COL.pillHot : COL.pill);
    strokeRound(gr, sdX, hm.actY, sortDirW, hm.actH, hm.actH / 2, 1, sdHot ? COL.text2 : COL.line);
    drawIcon(gr, brPlSortDir === 'asc' ? 'sortAsc' : 'sortDesc', COL.text, sdX, hm.actY, sortDirW, hm.actH, 16);
    HB_BR_SORT_DIR = { x0: sdX, y0: hm.actY, x1: sdX + sortDirW, y1: hm.actY + hm.actH };
  }

  var lx = r.x + M.cpad, rx = hm.rx0, listTop = r.y + headH + 8, rowsTop = listTop + 34, rh = M.rowH, cropY = r.y + r.h, viewH = cropY - rowsTop;
  var rows = brSortedPlaylistRows(det);
  coverWarm(rows);
  var contentH = rows.count * rh, maxPx = Math.max(0, contentH - viewH);
  BR_MAXPX = maxPx; brScroll = clampPx(brScroll, maxPx); brScrollT = clampPx(brScrollT, maxPx);
  var srcMeta = { subKind: 'playlist', id: meta.id, name: meta.name };

  for(var d = Math.floor(brScroll / rh); d < rows.count; d++){
    var ry = rowsTop + d * rh - brScroll; if(ry >= cropY) break;
    brDrawTrackRow(gr, r, lx, rx, ry, rh, rowsTop, cropY, d + 1, rows.get(d), rows, d, srcMeta, meta.id, rows.origIdx(d), { showAlbum: true, showThumb: true });
  }
  gr.FillSolidRect(r.x, rowsTop - rh, r.w, rh, COL.base);
  gr.FillSolidRect(r.x, cropY, r.w, M.pad + 2, COL.canvas);
  if(!rows.count){
    if(src && src.id === 'local' && meta.editable !== false){
      drawPlEmpty(gr, r, rowsTop - rh, cropY);
    } else {
      tC(gr, T('empty.pl_empty'), FONT.sect2, COL.text2, r.x, rowsTop + 60, r.w, 34);
    }
  } else {
    brDrawTrackColsHeader(gr, r, lx, rx, listTop, true);
    drawScrollbar(gr, rx + 8, rowsTop, viewH, brScroll, maxPx, viewH, contentH, hv(r.x, r.y, r.x + r.w, cropY) || drag === 'scroll');
    if(plDropHover && src && src.id === 'local' && meta.editable !== false){
      var iy = rowsTop - rh, ih = cropY - iy, ix = lx - 12, iw = rx - lx + 24, ir = Math.min(12, iw / 2, ih / 2);
      gr.FillRoundRect(ix, iy, iw, ih, ir, ir, RGBA(30, 215, 96, 20));
      strokeRound(gr, ix, iy, iw, ih, ir, 2, COL.green);
      var dLbl = T('empty.drop_to_add'), dlh = 34, dly = iy + ih - dlh - 18, dlw = Math.min(iw - 32, pillW(gr, dLbl));
      if(dlw >= dlh && ih > dlh + 36){
        var dlx = cxOf(ix, iw, dlw);
        gr.FillRoundRect(dlx, dly, dlw, dlh, dlh / 2, dlh / 2, COL.green);
        tC(gr, dLbl, FONT.pl, COL.black, dlx, dly, dlw, dlh);
      }
    }
  }
}

/* ---- 5) Album Detail ---- */
function brDrawAlbumView(gr, r){
  var src = brSrc();
  var det = src ? src.album(brViewId) : { meta: null, rows: EMPTY_ROWS, loading: true, err: '' };
  var rows = det.rows || makeListRows(det.songs);
  if(det.loading && !rows.count){ drawViewSkeleton(gr, r); brDrawTopStrip(gr, r, true); return; }
  if(det.err && !rows.count){ brDrawTopStrip(gr, r, false); brDrawLoadingOrErr(gr, r, r.y + 60, false, det.err, 'refresh'); return; }
  var meta = det.meta || { id: brViewId, name: brViewTitle || T('meta.album_sub'), artist: '', coverArt: brViewId, year: '', duration: 0 };

  var hm = brHeaderMetrics(r, M.headH), headH = hm.headH, shortH = hm.shortH, compact = hm.compact;
  gr.FillGradRect(r.x, r.y, r.w, headH, 90, blend(coverHue(meta.coverArt, meta.name), COL.base, headMix(0.42)), COL.base, 1.0);
  brDrawTopStrip(gr, r, true);

  coverDrawRounded(gr, hm.ax, hm.ay, hm.art, 8, meta.coverArt, meta.name);

  if(!shortH) tL(gr, T('eyebrow.album'), FONT.eyebrow, COL.text, hm.tx, hm.ay + 2, hm.tw, 18);
  tL(gr, meta.name, shortH ? FONT.sect : (compact ? FONT.sect2 : FONT.title), COL.text, hm.tx, hm.ay + (shortH ? 0 : (compact ? 18 : 22)), hm.tw, shortH ? 22 : (compact ? 36 : 74));
  var subY = hm.ay + (shortH ? 22 : (compact ? 56 : 100));
  var artistName = meta.artist || T('meta.unknown_artist');
  var subTail = (meta.year ? (' ' + CH_DOT + ' ' + meta.year) : '') + ' ' + CH_DOT + ' ' + T('meta.songs', rows.count);
  if(meta.artistId){
    var artistW = Math.min(hm.tw, Math.ceil(gr.CalcTextWidth(artistName, shortH ? FONT.plSub : FONT.meta)) + 2);
    var artHot = hv(hm.tx, subY - 2, hm.tx + artistW + 2, subY + 20);
    tL(gr, artistName, shortH ? FONT.plSub : FONT.meta, artHot ? COL.green : COL.text, hm.tx, subY, artistW, shortH ? 16 : 22);
    if(artHot) gr.DrawLine(hm.tx, subY + (shortH ? 16 : 20), hm.tx + artistW, subY + (shortH ? 16 : 20), 1, COL.green);
    if(hm.tw - artistW > 8) tL(gr, subTail, shortH ? FONT.plSub : FONT.meta, COL.text2, hm.tx + artistW, subY, hm.tw - artistW, shortH ? 16 : 22);
    HB_BR_BTN.push({ x0: hm.tx, y0: subY - 2, x1: hm.tx + artistW + 2, y1: subY + 22, act: 'open-album-artist', data: meta });
  } else {
    tL(gr, artistName + subTail, shortH ? FONT.plSub : FONT.meta, COL.text2, hm.tx, subY, hm.tw, shortH ? 16 : 22);
  }

  var albPills = [
    { label: T('btn.play'), icon: 'play', minW: shortH ? 74 : 108, primary: true, act: 'play-list' },
    { label: T('btn.shuffle'), icon: 'shuffle', minW: shortH ? 82 : 126, primary: false, act: 'shuf-list' }
  ];
  if(src && sourceCanLove(src, 'album')){
    var alStar = src.isLoved('album', meta.id), starLbl = alStar ? T('btn.album_starred') : T('btn.star_album');
    albPills.push({ label: starLbl, icon: alStar ? 'heart' : 'heartO', minW: shortH ? 76 : 112, primary: false, act: 'star-album', data: { active: alStar, obj: meta } });
  }
  brDrawPillRow(gr, hm.tx, hm.rx0, hm.actY, hm.actH, albPills);

  var lx = r.x + M.cpad, rx = hm.rx0, listTop = r.y + headH + 8, rowsTop = listTop + 34, rh = M.rowH, cropY = r.y + r.h, viewH = cropY - rowsTop;
  var contentH = rows.count * rh, maxPx = Math.max(0, contentH - viewH);
  BR_MAXPX = maxPx; brScroll = clampPx(brScroll, maxPx); brScrollT = clampPx(brScrollT, maxPx);
  var srcMeta = { subKind: 'album', id: meta.id, name: meta.name };

  for(var i = Math.floor(brScroll / rh); i < rows.count; i++){
    var ry = rowsTop + i * rh - brScroll; if(ry >= cropY) break;
    var s = rows.get(i);
    if(s) brDrawTrackRow(gr, r, lx, rx, ry, rh, rowsTop, cropY, s.track || (i + 1), s, rows, i, srcMeta, '', -1, { showAlbum: false, showThumb: false });
  }
  gr.FillSolidRect(r.x, rowsTop - rh, r.w, rh, COL.base);
  gr.FillSolidRect(r.x, cropY, r.w, M.pad + 2, COL.canvas);
  brDrawTrackColsHeader(gr, r, lx, rx, listTop, false);
  drawScrollbar(gr, rx + 8, rowsTop, viewH, brScroll, maxPx, viewH, contentH, hv(r.x, r.y, r.x + r.w, cropY) || drag === 'scroll');
}

/* ---- 6) Artist Detail ---- */
function brDrawArtistView(gr, r){
  var src = brSrc();
  var det = src ? src.artist(brViewId, brViewTitle) : { meta: { id: brViewId, name: brViewTitle || T('meta.artist_sub'), coverArt: '' }, albums: [], topRows: EMPTY_ROWS, loading: true, err: '' };
  if(det.loading && !det.albums.length){ drawViewSkeleton(gr, r); brDrawTopStrip(gr, r, true); return; }
  if(det.err && !det.albums.length){ brDrawTopStrip(gr, r, false); brDrawLoadingOrErr(gr, r, r.y + 60, false, det.err, 'refresh'); return; }
  var meta = det.meta;
  var topRows = det.topRows || makeListRows(det.topSongs);

  var hm = brHeaderMetrics(r, Math.min(228, Math.max(122, M.headH)));
  var headH = hm.headH, pad = M.cpad, x0 = r.x + pad, w = Math.max(80, r.w - pad * 2), rx = hm.rx0;
  var bodyTop = r.y + headH + 8, cropY = r.y + r.h, viewH = Math.max(60, cropY - bodyTop);
  var topCount = Math.min(5, topRows.count), topH = topCount ? (40 + topCount * 50 + 24) : 0;
  var gap = 16, grid = brDrawGridCols(w, gap, 176), cols = grid.cols, cardW = grid.cardW, cardH = grid.cardH, rowStep = cardH + 8;
  var albumsH = det.albums.length ? (42 + Math.ceil(det.albums.length / cols) * rowStep + 20) : 40;
  var contentH = topH + albumsH, maxPx = Math.max(0, contentH - viewH);
  BR_MAXPX = maxPx; brScroll = clampPx(brScroll, maxPx); brScrollT = clampPx(brScrollT, maxPx);

  coverWarm(det.albums);
  var cy = Math.round(bodyTop - brScroll);
  if(topCount){
    if(cy + 28 > bodyTop && cy < cropY) tL(gr, T('nav.top_tracks'), FONT.sect2, COL.text, x0, cy, w, 28);
    var srcMeta = { subKind: 'artist', id: meta.id, name: T('meta.artist_top_src', meta.name) };
    for(var ti = 0; ti < topCount; ti++){
      var ry = cy + 38 + ti * 50;
      if(ry >= cropY) break;
      if(ry + 50 <= bodyTop) continue;
      brDrawTrackRow(gr, r, x0, rx, ry, 50, bodyTop, cropY, ti + 1, topRows.get(ti), topRows, ti, srcMeta, '', -1, { showAlbum: true, showThumb: true });
    }
    cy += topH;
  }
  if(cy + 28 > bodyTop && cy < cropY) tL(gr, T('nav.albums'), FONT.sect2, COL.text, x0, cy, w, 28);
  var gy = cy + 40;
  for(var i = 0; i < det.albums.length; i++){
    var col = i % cols, row = Math.floor(i / cols), yCard = Math.round(gy + row * rowStep);
    if(yCard >= cropY) break;
    if(yCard + cardH <= bodyTop) continue;
    var al = det.albums[i];
    brDrawCard(gr, x0 + col * (cardW + gap), yCard, cardW, al.coverArt, al.name, al.name, al.year || T('meta.album_sub'), false, 'album', al.id, al, false, undefined, undefined, bodyTop, cropY);
  }

  gr.FillSolidRect(r.x, r.y, r.w, bodyTop - r.y, COL.base);
  gr.FillGradRect(r.x, r.y, r.w, headH, 90, blend(coverHue(meta.coverArt, meta.name), COL.base, headMix(0.44)), COL.base, 1.0);
  brDrawTopStrip(gr, r, true);
  var art = hm.shortH ? hm.art : (hm.compact ? 104 : 148), ay = hm.shortH ? hm.ay : (hm.compact ? r.y + 44 : r.y + 52);
  coverDrawCircle(gr, x0, ay, art, meta.coverArt, meta.name);
  var tx = x0 + art + (hm.shortH ? 14 : 24), tw = Math.max(60, rx - tx);
  if(hm.shortH){
    tL(gr, meta.name, FONT.sect, COL.text, tx, ay, tw, 22);
    tL(gr, T('meta.album_count', det.albums.length), FONT.plSub, COL.text2, tx, ay + 22, tw, 16);
  } else if(hm.compact){
    tL(gr, T('eyebrow.artist'), FONT.eyebrow, COL.text, tx, ay + 2, tw, 18);
    tL(gr, meta.name, FONT.sect2, COL.text, tx, ay + 18, tw, 32);
    tL(gr, T('meta.album_count', det.albums.length), FONT.meta, COL.text2, tx, ay + 52, tw, 20);
  } else {
    tL(gr, T('eyebrow.artist'), FONT.eyebrow, COL.text, tx, ay + 6, tw, 18);
    tL(gr, meta.name, FONT.title, COL.text, tx, ay + 24, tw, 68);
    tL(gr, T('meta.album_count', det.albums.length), FONT.meta, COL.text2, tx, ay + 96, tw, 22);
  }

  var actY = hm.shortH ? (r.y + headH - 36) : (hm.compact ? (ay + 80) : (ay + 124));
  var arPills = [];
  if(topRows.count){
    arPills.push({ label: T('btn.play_top'), icon: 'play', minW: hm.shortH ? 82 : 118, primary: true, act: 'play-list' });
    arPills.push({ label: T('btn.shuffle'), icon: 'shuffle', minW: hm.shortH ? 84 : 126, primary: false, act: 'shuf-list' });
  }
  if(src && sourceCanLove(src, 'artist')){
    var arStar = src.isLoved('artist', meta.id), followLbl = arStar ? T('btn.following') : T('btn.follow_artist');
    arPills.push({ label: followLbl, icon: arStar ? 'heart' : 'heartO', minW: hm.shortH ? 76 : 108, primary: false, act: 'star-artist', data: { active: arStar, obj: meta } });
  }
  if(arPills.length) brDrawPillRow(gr, tx, rx, actY, hm.shortH ? 30 : 36, arPills);

  gr.FillSolidRect(r.x, cropY, r.w, M.pad + 2, COL.canvas);
  drawScrollbar(gr, rx + 8, bodyTop, viewH, brScroll, maxPx, viewH, contentH, hv(r.x, bodyTop, r.x + r.w, cropY) || drag === 'scroll');
}

/* ---- 7) Loved Songs ---- */
function brDrawStarredView(gr, r){
  var src = brSrc();
  var st = src ? src.loved() : { rows: EMPTY_ROWS, loading: true, loaded: false, err: '' };
  if(st.loading && !st.loaded){ drawViewSkeleton(gr, r); brDrawTopStrip(gr, r, true); return; }
  if(st.err && !st.loaded){ brDrawTopStrip(gr, r, false); brDrawLoadingOrErr(gr, r, r.y + 60, false, st.err, 'refresh'); return; }
  var rows = st.rows || makeListRows(st.songs);

  var hm = brHeaderMetrics(r, M.headH), headH = hm.headH, shortH = hm.shortH, compact = hm.compact;
  gr.FillGradRect(r.x, r.y, r.w, headH, 90, blend(RGB(96, 48, 170), COL.base, headMix(0.45)), COL.base, 1.0);
  brDrawTopStrip(gr, r, true);

  gr.FillRoundRect(hm.ax, hm.ay, hm.art, hm.art, 8, 8, RGB(88, 56, 176));
  drawIcon(gr, 'heart', COL.white, hm.ax, hm.ay, hm.art, hm.art, Math.round(hm.art * 0.42));

  if(shortH){
    tL(gr, T('home.quick_loved'), FONT.sect, COL.text, hm.tx, hm.ay, hm.tw, 22);
    tL(gr, T('meta.loved_count', rows.count), FONT.plSub, COL.text2, hm.tx, hm.ay + 22, hm.tw, 16);
  } else {
    tL(gr, T('eyebrow.collection'), FONT.eyebrow, COL.text, hm.tx, hm.ay + 2, hm.tw, 18);
    tL(gr, T('home.quick_loved'), compact ? FONT.sect2 : FONT.title, COL.text, hm.tx, hm.ay + (compact ? 18 : 22), hm.tw, compact ? 36 : 74);
    tL(gr, T('meta.loved_count', rows.count), FONT.meta, COL.text2, hm.tx, hm.ay + (compact ? 56 : 100), hm.tw, 22);
  }

  if(rows.count){
    brDrawPillRow(gr, hm.tx, hm.rx0, hm.actY, hm.actH, [
      { label: T('btn.play'), icon: 'play', minW: shortH ? 76 : 108, primary: true, act: 'play-list' },
      { label: T('btn.shuffle'), icon: 'shuffle', minW: shortH ? 84 : 126, primary: false, act: 'shuf-list' }
    ]);
  }

  var lx = r.x + M.cpad, rx = hm.rx0, listTop = r.y + headH + 8, rowsTop = listTop + 34, rh = M.rowH, cropY = r.y + r.h, viewH = cropY - rowsTop;
  var contentH = rows.count * rh, maxPx = Math.max(0, contentH - viewH);
  BR_MAXPX = maxPx; brScroll = clampPx(brScroll, maxPx); brScrollT = clampPx(brScrollT, maxPx);
  var srcMeta = { subKind: 'starred', id: 'starred', name: T('meta.loved_src') };
  coverWarm(rows);

  for(var i = Math.floor(brScroll / rh); i < rows.count; i++){
    var ry = rowsTop + i * rh - brScroll; if(ry >= cropY) break;
    brDrawTrackRow(gr, r, lx, rx, ry, rh, rowsTop, cropY, i + 1, rows.get(i), rows, i, srcMeta, '', -1, { showAlbum: true, showThumb: true });
  }
  gr.FillSolidRect(r.x, rowsTop - rh, r.w, rh, COL.base);
  gr.FillSolidRect(r.x, cropY, r.w, M.pad + 2, COL.canvas);
  if(!rows.count){
    tC(gr, T('empty.loved_empty'), FONT.sect2, COL.text2, r.x, rowsTop + 60, r.w, 34);
  } else {
    brDrawTrackColsHeader(gr, r, lx, rx, listTop, true);
    drawScrollbar(gr, rx + 8, rowsTop, viewH, brScroll, maxPx, viewH, contentH, hv(r.x, r.y, r.x + r.w, cropY) || drag === 'scroll');
  }
}

/* ---- 8) Random Mix Radio ---- */
function brDrawRandomView(gr, r){
  var src = brSrc();
  var rm = src ? src.random() : { rows: EMPTY_ROWS, loading: true, err: '' };
  var rows = rm.rows || makeListRows(rm.songs);
  if(rm.loading && !rows.count){ drawViewSkeleton(gr, r); brDrawTopStrip(gr, r, true); return; }
  if(rm.err && !rows.count){ brDrawTopStrip(gr, r, false); brDrawLoadingOrErr(gr, r, r.y + 60, false, rm.err, 'random-rebatch'); return; }

  var hm = brHeaderMetrics(r, M.headH), headH = hm.headH, shortH = hm.shortH, compact = hm.compact;
  gr.FillGradRect(r.x, r.y, r.w, headH, 90, blend(RGB(24, 130, 96), COL.base, headMix(0.45)), COL.base, 1.0);
  brDrawTopStrip(gr, r, true);

  gr.FillRoundRect(hm.ax, hm.ay, hm.art, hm.art, 8, 8, RGB(28, 136, 94));
  drawIcon(gr, 'shuffle', COL.white, hm.ax, hm.ay, hm.art, hm.art, Math.round(hm.art * 0.42));

  if(shortH){
    tL(gr, T('home.quick_random'), FONT.sect, COL.text, hm.tx, hm.ay, hm.tw, 22);
    tL(gr, T('meta.radio_desc'), FONT.plSub, COL.text2, hm.tx, hm.ay + 22, hm.tw, 16);
  } else {
    tL(gr, T('eyebrow.infinite_radio'), FONT.eyebrow, COL.text, hm.tx, hm.ay + 2, hm.tw, 18);
    tL(gr, T('home.quick_random'), compact ? FONT.sect2 : FONT.title, COL.text, hm.tx, hm.ay + (compact ? 18 : 22), hm.tw, compact ? 36 : 74);
    tL(gr, T('meta.radio_desc'), FONT.meta, COL.text2, hm.tx, hm.ay + (compact ? 56 : 100), hm.tw, 22);
  }

  brDrawPillRow(gr, hm.tx, hm.rx0, hm.actY, hm.actH, [
    { label: T('btn.start_radio'), icon: 'play', minW: shortH ? 96 : 138, primary: true, act: 'play-list' },
    { label: T('btn.new_mix'), icon: 'refresh', minW: shortH ? 80 : 108, primary: false, act: 'random-rebatch' }
  ]);

  var lx = r.x + M.cpad, rx = hm.rx0, listTop = r.y + headH + 8, rowsTop = listTop + 34, rh = M.rowH, cropY = r.y + r.h, viewH = cropY - rowsTop;
  var contentH = rows.count * rh, maxPx = Math.max(0, contentH - viewH);
  BR_MAXPX = maxPx; brScroll = clampPx(brScroll, maxPx); brScrollT = clampPx(brScrollT, maxPx);
  var srcMeta = { subKind: 'random', id: 'random', name: T((src && src.id === 'local') ? 'meta.local_random_src' : 'meta.random_src') };
  coverWarm(rows);

  for(var i = Math.floor(brScroll / rh); i < rows.count; i++){
    var ry = rowsTop + i * rh - brScroll; if(ry >= cropY) break;
    brDrawTrackRow(gr, r, lx, rx, ry, rh, rowsTop, cropY, i + 1, rows.get(i), rows, i, srcMeta, '', -1, { showAlbum: true, showThumb: true });
  }
  gr.FillSolidRect(r.x, rowsTop - rh, r.w, rh, COL.base);
  gr.FillSolidRect(r.x, cropY, r.w, M.pad + 2, COL.canvas);
  brDrawTrackColsHeader(gr, r, lx, rx, listTop, true);
  drawScrollbar(gr, rx + 8, rowsTop, viewH, brScroll, maxPx, viewH, contentH, hv(r.x, r.y, r.x + r.w, cropY) || drag === 'scroll');
}

function brDrawDropdowns(gr){
  var src = brSrc();
  if(brAlbTabOpen) BR_ALB_DD_HB = drawDropMenu(gr, HB_BR_ALB_DD, brAlbumTabOptions(src), src ? src.albumsTab() : 'recent', 210);
  else if(brPlSortOpen) BR_SORT_DD_HB = drawDropMenu(gr, HB_BR_SORT_DD, BR_PL_SORTS, brPlSort, 180);
  else if(brSrvMenuOpen){
    var srvs = (src && src.servers) ? src.servers() : [];
    var srvItems = srvs.map(function(s){ return [s.name, s.name]; });
    var conn = (src && src.activeServer) ? src.activeServer() : null;
    BR_SRV_DD_HB = drawDropMenu(gr, HB_BR_SRV_DD, srvItems, conn ? conn.name : '', 170);
  }
}

function brActivePlaybackSpec(){
  var src = brSrc();
  if(!src) return null;
  if(brView === 'playlist'){
    var dp = src.playlist(brViewId);
    var pr = brSortedPlaylistRows(dp);
    if(pr.count) return { rows: pr, meta: { subKind: 'playlist', id: brViewId, name: (dp.meta && dp.meta.name) || brViewTitle } };
  } else if(brView === 'album'){
    var da = src.album(brViewId), ar = (da && (da.rows || makeListRows(da.songs))) || EMPTY_ROWS;
    if(ar.count) return { rows: ar, meta: { subKind: 'album', id: brViewId, name: (da.meta && da.meta.name) || brViewTitle } };
  } else if(brView === 'artist'){
    var dar = src.artist(brViewId, brViewTitle), tr = (dar && (dar.topRows || makeListRows(dar.topSongs))) || EMPTY_ROWS;
    if(tr.count) return { rows: tr, meta: { subKind: 'artist', id: brViewId, name: T('meta.artist_top_src', dar.meta.name) } };
  } else if(brView === 'starred'){
    var dl = src.loved(), lr = (dl && (dl.rows || makeListRows(dl.songs))) || EMPTY_ROWS;
    if(lr.count) return { rows: lr, meta: { subKind: 'starred', id: 'starred', name: T('meta.loved_src') } };
  } else if(brView === 'random'){
    var dr = src.random(), rr = (dr && (dr.rows || makeListRows(dr.songs))) || EMPTY_ROWS;
    if(rr.count) return { rows: rr, meta: { subKind: 'random', id: 'random', name: T(src.id === 'local' ? 'meta.local_random_src' : 'meta.random_src') } };
  }
  return null;
}

function drawBrowseView(gr, r){
  HB_BR_BTN = []; HB_BR_CARDS = []; HB_BR_TR = []; HB_BR_STAR = []; HB_BR_TRDOTS = []; HB_BR_PLDOTS = [];
  BR_ALB_DD_HB = []; BR_SORT_DD_HB = []; BR_SRV_DD_HB = [];
  HB_BR_ALB_DD = null; HB_BR_SORT_DD = null; HB_BR_SORT_DIR = null; HB_BR_SRV_DD = null;
  var src = brSrc();
  if(src) src.ensureLoaded();
  if(brView === 'albums') brDrawAlbumsView(gr, r);
  else if(brView === 'artists') brDrawArtistsView(gr, r);
  else if(brView === 'playlist') brDrawPlaylistView(gr, r);
  else if(brView === 'album') brDrawAlbumView(gr, r);
  else if(brView === 'artist') brDrawArtistView(gr, r);
  else if(brView === 'starred') brDrawStarredView(gr, r);
  else if(brView === 'random') brDrawRandomView(gr, r);
  else brDrawHome(gr, r);
  brDrawDropdowns(gr);
}

function handleBrowseButtonAction(act, data){
  var src = brSrc();
  if(act === 'back') brGoBack();
  else if(act === 'home') brOpenHome();
  else if(act === 'refresh'){ if(src) src.refresh(true); }
  else if(act === 'new-pl') startNvCreatePlaylist([], src);
  else if(act === 'go-starred') brOpenStarred();
  else if(act === 'go-random') brOpenRandom();
  else if(act === 'go-albums') brOpenAlbums();
  else if(act === 'go-artists') brOpenArtists();
  else if(act === 'more-albums'){ if(src) src.loadMoreAlbums(src.albumsTab()); }
  else if(act === 'random-rebatch'){ if(src) src.randomRebatch(80); }
  else if(act === 'open-album-artist' && data && data.artistId) brOpenArtist(data.artistId, data.artist);
  else if(act === 'star-album' && data && data.obj){ if(src) src.toggleLoved('album', data.obj.id, data.obj); }
  else if(act === 'star-artist' && data && data.obj){ if(src) src.toggleLoved('artist', data.obj.id, data.obj); }
  else if(act === 'play-list' || act === 'shuf-list'){
    var spec = brActivePlaybackSpec();
    if(spec && src && src.play){
      if(brView === 'random') src.play(spec.rows, 0, spec.meta, false);
      else src.play(spec.rows, 0, spec.meta, act === 'shuf-list' ? true : pbShuffle);
    }
  }
  repaintAll();
}
