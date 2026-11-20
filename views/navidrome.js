/* verdant/views/navidrome.js -- unified Spotify-style Subsonic views (Home, Playlists, Albums, Artists, Starred, Random Mix)
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

var nvView = 'home', nvViewId = '', nvViewTitle = '', nvHistory = [];
var nvScroll = 0, nvScrollT = 0, NV_MAXPX = 0;
var nvShelfScroll = 0, nvShelfScrollT = 0, NV_SHELF_MAX = 0, NV_SHELF_STRIDE = 0, NV_SHELF_Y0 = 0, NV_SHELF_Y1 = 0;

var nvPlSort = 'default', nvPlSortDir = 'asc', nvPlSortOpen = false;
var NV_PL_SORTS = [['\u9ed8\u8ba4\u987a\u5e8f','default'],['\u6b4c\u66f2\u540d','title'],['\u6b4c\u624b','artist'],['\u4e13\u8f91','album'],['\u65f6\u957f','dur']];
var nvAlbTabOpen = false;
var NV_ALB_TABS = [['\u6700\u8fd1\u64ad\u653e','recent'],['\u6700\u65b0\u6dfb\u52a0','newest'],['\u6700\u5e38\u64ad\u653e','frequent'],['\u968f\u673a\u4e13\u8f91','random'],['\u6309\u540d\u79f0','alphabeticalByName']];
var nvSrvMenuOpen = false;

var HB_NV_BTN = [], HB_NV_CARDS = [], HB_NV_TR = [], HB_NV_STAR = [], HB_NV_TRDOTS = [], HB_NV_PLDOTS = [];
var NV_ALB_DD_HB = [], NV_SORT_DD_HB = [], NV_SRV_DD_HB = [];
var HB_NV_ALB_DD = null, HB_NV_SORT_DD = null, HB_NV_SORT_DIR = null, HB_NV_SRV_DD = null;

function nvSnapView(){
  return { nvView: nvView, nvViewId: nvViewId, nvViewTitle: nvViewTitle, nvScroll: nvScroll };
}

function nvNavPush(){
  nvHistory.push(nvSnapView());
  if(nvHistory.length > 20) nvHistory.shift();
}

function nvCloseNvMenus(){
  nvPlSortOpen = false; nvAlbTabOpen = false; nvSrvMenuOpen = false;
}

function nvOpenView(nextView, id, title, skipPush){
  if(typeof libSource !== 'undefined') libSource = 'navidrome';
  nvCloseNvMenus();
  if(!skipPush && view === 'navidrome' && (nvView !== nextView || nvViewId !== (id || ''))){
    nvNavPush();
  }
  view = 'navidrome';
  nvView = nextView;
  nvViewId = id || '';
  nvViewTitle = title || '';
  nvScroll = nvScrollT = 0;
  hoverKey = ''; scrollKey = '';
  nvEnsureLoaded();
  if(nextView === 'playlist' && id) nvFetchPlaylistDetail(id, false);
  else if(nextView === 'album' && id) nvFetchAlbumDetail(id, false);
  else if(nextView === 'artist' && id) nvFetchArtistDetail(id, title, false);
  else if(nextView === 'albums') nvFetchAlbums(NVData.albumsTab || 'recent', false, false);
  else if(nextView === 'artists') nvFetchArtists(false);
  else if(nextView === 'starred') nvFetchStarred(false);
  else if(nextView === 'random' && !NVData.randomMix.songs.length) nvFetchRandomSongs(80, false);
  repaintAll();
}

function nvOpenHome(){ nvOpenView('home', '', 'Navidrome', false); }
function nvOpenPlaylist(id, name){ nvOpenView('playlist', id, name || 'Playlist', false); }
function nvOpenAlbum(id, name){ nvOpenView('album', id, name || 'Album', false); }
function nvOpenAlbums(tab){
  if(tab) NVData.albumsTab = tab;
  nvOpenView('albums', NVData.albumsTab, '\u4e13\u8f91', false);
}
function nvSelectAlbumsTab(tab){
  tab = tab || 'recent';
  nvAlbTabOpen = false;
  NVData.albumsTab = tab;
  nvViewId = tab;
  nvScroll = nvScrollT = 0;
  nvFetchAlbums(tab, false, tab === 'random');
  repaintAll();
}
function nvOpenArtist(id, name){ nvOpenView('artist', id, name || 'Artist', false); }
function nvOpenArtists(){ nvOpenView('artists', '', '\u6b4c\u624b', false); }
function nvOpenStarred(){ nvOpenView('starred', '', '\u6211\u559c\u6b22\u7684\u97f3\u4e50', false); }
function nvOpenRandom(){ nvOpenView('random', '', '\u968f\u673a\u6f2b\u6e38', false); }

function nvGoBack(){
  if(!nvHistory.length) return;
  var prev = nvHistory.pop();
  nvCloseNvMenus();
  view = 'navidrome';
  nvView = prev.nvView || 'home';
  nvViewId = prev.nvViewId || '';
  nvViewTitle = prev.nvViewTitle || '';
  nvScroll = nvScrollT = prev.nvScroll || 0;
  repaintAll();
}

function nvRefreshActiveDetail(){
  if(nvView === 'playlist' && nvViewId) nvFetchPlaylistDetail(nvViewId, true);
  else if(nvView === 'album' && nvViewId) nvFetchAlbumDetail(nvViewId, true);
  else if(nvView === 'artist' && nvViewId) nvFetchArtistDetail(nvViewId, nvViewTitle, true);
  else if(nvView === 'albums') nvFetchAlbums(NVData.albumsTab || 'recent', false, true);
  else if(nvView === 'artists') nvFetchArtists(true);
  else if(nvView === 'starred') nvFetchStarred(true);
  else if(nvView === 'random') nvFetchRandomSongs(80, false);
}

function nvDrawMiniPill(gr, x, y, w, h, label, iconName, act, opts){
  opts = opts || {};
  var hot = hv(x, y, x + w, y + h);
  var bg, fg, bdr = 0;
  if(opts.green){
    bg = hot ? COL.greenHot : COL.green;
    fg = COL.black;
  } else if(opts.overlay){
    if(IS_LIGHT){
      bg = hot ? RGBA(0,0,0,50) : RGBA(0,0,0,22);
      fg = COL.text;
      bdr = hot ? COL.text2 : COL.line;
    } else {
      bg = hot ? RGBA(255,255,255,48) : RGBA(0,0,0,96);
      fg = COL.white;
      bdr = hot ? RGBA(255,255,255,115) : RGBA(255,255,255,34);
    }
  } else {
    bg = hot ? COL.pillHot : COL.pill;
    fg = opts.dim ? COL.text3 : COL.text;
    bdr = hot ? COL.text2 : COL.line;
  }
  gr.FillRoundRect(x, y, w, h, h / 2, h / 2, bg);
  if(bdr && typeof strokeRound === 'function') strokeRound(gr, x, y, w, h, h / 2, 1, bdr);
  if(iconName){
    drawIcon(gr, iconName, fg, x + 10, y + (h - 16) / 2, 16, 16, 15);
    if(label) tL(gr, label, FONT.plSub, fg, x + 30, y, w - 38, h);
  } else if(label){
    tC(gr, label, FONT.plSub, fg, x, y, w, h);
  }
  var hb = { x0: x, y0: y, x1: x + w, y1: y + h, act: act, data: opts.data };
  HB_NV_BTN.push(hb);
  return hb;
}

function nvDrawTopStrip(gr, r, overlay){
  var lx = r.x + M.cpad, rx = r.x + r.w - M.cpad, y = r.y + 12, h = 30;
  if(nvHistory.length > 0){
    nvDrawMiniPill(gr, lx, y, 68, h, '\u8fd4\u56de', 'back', 'back', { overlay: overlay });
  } else if(!overlay){
    tL(gr, nvViewTitle || 'Navidrome', FONT.sect2, COL.text, lx, y - 2, Math.max(120, r.w - M.cpad * 2 - 180), 34);
  }
  var curX = rx;
  var refW = 68; curX -= refW;
  nvDrawMiniPill(gr, curX, y, refW, h, '\u5237\u65b0', 'refresh', 'refresh', { overlay: overlay });
  var conn = nvConnection();
  if(conn && NVApi.servers.length > 1 && !overlay){
    curX -= 8;
    var sw = Math.min(160, Math.max(96, gr.CalcTextWidth(conn.name, FONT.plSub) + 40));
    curX -= sw;
    HB_NV_SRV_DD = drawDropPill(gr, curX, y, sw, h, conn.name, nvSrvMenuOpen);
  }
}

function nvDrawActionPill(gr, x, y, w, h, label, iconName, primary, act, data){
  var hot = hv(x, y, x + w, y + h);
  if(primary){
    gr.FillRoundRect(x, y, w, h, h / 2, h / 2, hot ? COL.greenHot : COL.green);
    if(iconName) drawIcon(gr, iconName, COL.black, x + 16, y + (h - 18) / 2, 18, 18, 17);
    tL(gr, label, FONT.pl, COL.black, x + (iconName ? 40 : 16), y, w - (iconName ? 52 : 28), h);
  } else {
    gr.FillRoundRect(x, y, w, h, h / 2, h / 2, hot ? COL.pillHot : COL.pill);
    strokeRound(gr, x, y, w, h, h / 2, 1, hot ? COL.text2 : COL.line);
    var tc = (data && data.active) ? COL.green : COL.text;
    if(iconName) drawIcon(gr, iconName, tc, x + 14, y + (h - 18) / 2, 18, 18, 17);
    tL(gr, label, FONT.pl, tc, x + (iconName ? 38 : 14), y, w - (iconName ? 48 : 26), h);
  }
  HB_NV_BTN.push({ x0: x, y0: y, x1: x + w, y1: y + h, act: act, data: data });
}

var nvCardCache = {}, nvCardN = 0, nvCardTick = 0;

function disposeNvCardEntry(e){
  if(e && e.img){ try{ e.img.Dispose(); }catch(err){} e.img = null; }
}

function clearNvCardCache(){
  for(var k in nvCardCache){
    if(Object.prototype.hasOwnProperty.call(nvCardCache, k)) disposeNvCardEntry(nvCardCache[k]);
  }
  nvCardCache = {}; nvCardN = 0;
}

function evictNvCards(){
  var keys = [], k, i;
  for(k in nvCardCache){
    if(Object.prototype.hasOwnProperty.call(nvCardCache, k)) keys.push(k);
  }
  keys.sort(function(p, q){ return nvCardCache[p].t - nvCardCache[q].t; });
  var n = Math.floor(keys.length / 2);
  for(i = 0; i < n; i++){
    disposeNvCardEntry(nvCardCache[keys[i]]);
    delete nvCardCache[keys[i]];
  }
  nvCardN = keys.length - n;
}

function nvCardImg(kind, id, w, coverId, seed, isArtist){
  if(!nvArtLoaded(coverId)){ nvRequestArt(coverId, false); return null; }
  var hasBmp = coverId && !!nvArtCache[coverId];
  var key = kind + '|' + id + '|' + w + '|' + (IS_LIGHT ? 'L' : 'D') + '|' + (hasBmp ? '1' : '0');
  var e = nvCardCache[key];
  if(e){ e.t = ++nvCardTick; return e.img; }
  var cap = (typeof ART_CARD_CAP === 'number' && ART_CARD_CAP > 0) ? ART_CARD_CAP : 400;
  if(nvCardN >= cap) evictNvCards();
  var h = w + 56, im = null;
  try{
    im = dpiImage(w, h);
    var g = dpiGraphics(im.GetGraphics());
    g.SetSmoothingMode(2);
    g.FillSolidRect(0, 0, w, h, COL.base);
    nvPaintCardShell(g, 0, 0, w, coverId, seed, isArtist, false);
    releaseDpiGraphics(im, g);
  }catch(err){
    if(im){ try{ im.Dispose(); }catch(err2){} }
    im = null;
  }
  if(im){ nvCardCache[key] = { img: im, t: ++nvCardTick }; nvCardN++; }
  return im;
}

function nvPaintCardShell(gr, x, y, w, coverId, seed, isArtist, hov){
  var h = w + 56, cs = w - 24;
  gr.FillRoundRect(x, y, w, h, 8, 8, hov ? COL.cardHov : COL.elev);
  if(hov && typeof strokeRound === 'function') strokeRound(gr, x, y, w, h, 8, 1, COL.line);
  if(isArtist) nvDrawCircle(gr, x + 12, y + 12, cs, coverId, seed);
  else nvDrawRounded(gr, x + 12, y + 12, cs, 6, coverId, seed);
}

function nvPaintCardText(gr, x, y, w, title, sub, isArtist, hov, plDots, x0, x1, y0, y1, clipL, clipR, clipT, clipB){
  var cs = w - 24, tw = cs - ((hov && plDots) ? 26 : 0);
  if(clipL !== undefined && x + 12 < clipL){
    drawCardTextLeftClipped(gr, x, y, w, title, sub, isArtist, hov, isArtist ? cs : tw, isArtist ? cs : tw, x0, x1, y0, y1);
    return;
  }
  var tCol = hov ? COL.green : COL.text, sCol = hov ? COL.text : COL.text2;
  tCard(gr, title, FONT.card, tCol, x + 12, y + cs + 18, isArtist ? cs : tw, 20, isArtist, clipL, clipR, clipT, clipB);
  tCard(gr, sub, FONT.plSub, sCol, x + 12, y + cs + 40, isArtist ? cs : tw, 16, isArtist, clipL, clipR, clipT, clipB);
}

function nvDrawCard(gr, x, y, w, coverId, seed, title, sub, isArtist, kind, id, obj, plDots, clipL, clipR, clipT, clipB){
  x = Math.round(x); y = Math.round(y); w = Math.round(w);
  var h = w + 56;
  var x0 = (clipL !== undefined && x < clipL) ? clipL : x;
  var x1 = (clipR !== undefined && x + w > clipR) ? clipR : x + w;
  var y0 = (clipT !== undefined && y < clipT) ? clipT : y;
  var y1 = (clipB !== undefined && y + h > clipB) ? clipB : y + h;
  if(x1 <= x0 || y1 <= y0 || w <= 24) return;
  var clipped = (x0 > x) || (x1 < x + w) || (y0 > y) || (y1 < y + h);
  var hov = hv(x0, y0, x1, y1);
  var dxLocal = w - 32, dyLocal = (w - 24) + 16;
  var dotsFit = !!(plDots && (x + dxLocal >= x0) && (x + dxLocal + 24 <= x1) && (y + dyLocal >= y0) && (y + dyLocal + 24 <= y1));
  var drawDots = hov && dotsFit;
  var cached = hov ? null : nvCardImg(kind, id, w, coverId, seed, isArtist);

  if(cached){
    blitCard(gr, cached, x, y, x0, y0, x1, y1);
  } else if(!clipped){
    nvPaintCardShell(gr, x, y, w, coverId, seed, isArtist, hov);
  } else {
    // Fallback offscreen slice for hovered or still-downloading edge cards.
    var im = null;
    try{
      im = dpiImage(w, h);
      var g = dpiGraphics(im.GetGraphics());
      g.SetSmoothingMode(2);
      g.FillSolidRect(0, 0, w, h, COL.base);
      nvPaintCardShell(g, 0, 0, w, coverId, seed, isArtist, hov);
      releaseDpiGraphics(im, g);
      blitCard(gr, im, x, y, x0, y0, x1, y1);
    }catch(e){}
    if(im){ try{ im.Dispose(); }catch(e2){} }
  }

  nvPaintCardText(gr, x, y, w, title, sub, isArtist, hov, plDots, x0, x1, y0, y1, clipL, clipR, clipT, clipB);
  if(drawDots){
    var absDx = x + dxLocal, absDy = y + dyLocal;
    if(hv(absDx, absDy, absDx + 24, absDy + 24)) gr.FillEllipse(absDx, absDy, 24, 24, OV(IS_LIGHT ? 36 : 26));
    drawIcon(gr, 'more', COL.text, absDx, absDy, 24, 24, 18);
    HB_NV_PLDOTS.push({ x0: absDx - 2, y0: absDy - 2, x1: absDx + 26, y1: absDy + 26, plObj: obj, mx: absDx, my: absDy + 26 });
  }
  HB_NV_CARDS.push({ x0: x0, y0: y0, x1: x1, y1: y1, kind: kind, id: id, title: title, obj: obj });
}

function nvDrawTrackRow(gr, r, lx, rx, ry, rh, rowsTop, cropY, rowNum, song, list, idx, sourceMeta, plId, origIdx, opts){
  opts = opts || {};
  var vy0 = Math.max(ry, rowsTop), vy1 = Math.min(ry + rh, cropY);
  if(vy1 <= vy0) return;
  var showAlbum = opts.showAlbum && r.w >= 560;
  var numW = 30, durW = 58, actW = 60, cgap = 14;
  var rightCtrlX = rx - durW - actW;
  var albumW = showAlbum ? Math.round((rightCtrlX - lx - numW - cgap * 3) * 0.34) : 0;
  var titleX = lx + numW + cgap;
  var titleW = Math.max(80, rightCtrlX - titleX - (albumW ? (albumW + cgap) : 0) - cgap);
  var albumX = titleX + titleW + cgap;

  var isPlaying = nvIsSongPlaying(song.id);
  var isMenuRow = !!(ctxMenu && ctxMenu.kind === 'nv-track' && ctxMenu.info && ctxMenu.info.song && ctxMenu.info.song.id === song.id && ctxMenu.info.idx === idx);
  var isHover = hv(lx - 8, vy0, rx + 8, vy1) || isMenuRow;
  if(isHover) gr.FillRoundRect(lx - 8, ry, rx - lx + 16, rh, 4, 4, isMenuRow ? COL.rowActive : COL.rowHover);

  var titleCol = isPlaying ? COL.green : COL.text;
  if(isHover) drawIcon(gr, 'play', COL.text, lx, ry, numW, rh, 14);
  else tL(gr, String(rowNum), FONT.rowNum, isPlaying ? COL.green : COL.text2, lx, ry, numW, rh);

  var tx = titleX, tw = titleW;
  if(opts.showThumb !== false){
    var cs = 40, cy = ry + (rh - cs) / 2;
    nvDrawThumb(gr, titleX, cy, cs, 3, song.coverArt, song.album || song.title);
    tx += cs + 12; tw -= (cs + 12);
  }
  if(opts.singleLine){
    tL(gr, song.title, FONT.rowTitle, titleCol, tx, ry, tw, rh);
  } else {
    tL(gr, song.title, FONT.rowTitle, titleCol, tx, ry + 8, tw, 20);
    tL(gr, song.artist || song.albumArtist || '', FONT.rowArtist, COL.text2, tx, ry + 30, tw, 16);
  }
  if(showAlbum) tL(gr, song.album, FONT.rowCell, COL.text2, albumX, ry, albumW, rh);

  var starred = nvIsStarred('song', song.id);
  var stX = rightCtrlX + 2, stY = ry + Math.round((rh - 26) / 2);
  if(starred || isHover){
    var stHov = hv(stX - 2, stY - 2, stX + 28, stY + 28);
    if(stHov) gr.FillEllipse(stX - 2, stY - 2, 28, 28, OV(IS_LIGHT ? 36 : 26));
    drawIcon(gr, starred ? 'heart' : 'heartO', starred ? COL.green : (stHov ? COL.text : COL.text2), stX, stY, 24, 24, 16);
    HB_NV_STAR.push({ x0: stX - 2, y0: Math.max(vy0, stY - 2), x1: stX + 28, y1: Math.min(vy1, stY + 28), song: song });
  }
  if(isHover){
    var mdX = stX + 30, mdY = stY;
    if(hv(mdX - 2, mdY - 2, mdX + 28, mdY + 28)) gr.FillEllipse(mdX - 2, mdY - 2, 28, 28, OV(IS_LIGHT ? 36 : 26));
    drawIcon(gr, 'more', COL.text, mdX, mdY, 24, 24, 16);
    HB_NV_TRDOTS.push({
      x0: mdX - 2, y0: Math.max(vy0, mdY - 2), x1: mdX + 28, y1: Math.min(vy1, mdY + 28),
      mx: mdX - 120, my: mdY + 26,
      info: { song: song, list: list, idx: idx, sourceMeta: sourceMeta, plId: plId || '', songIdx: origIdx !== undefined ? origIdx : -1 }
    });
  }
  tR(gr, song.duration > 0 ? fmtTime(song.duration) : '', FONT.rowCell, COL.text2, rx - durW, ry, durW, rh);
  HB_NV_TR.push({
    x0: lx - 8, y0: vy0, x1: rx + 8, y1: vy1,
    pgx0: lx, pgx1: lx + numW,
    info: { song: song, list: list, idx: idx, sourceMeta: sourceMeta, plId: plId || '', songIdx: origIdx !== undefined ? origIdx : -1 }
  });
}

function nvDrawTrackColsHeader(gr, r, lx, rx, listTop, showAlbum){
  var numW = 30, durW = 58, actW = 60, cgap = 14, rightCtrlX = rx - durW - actW;
  showAlbum = showAlbum && r.w >= 560;
  var albumW = showAlbum ? Math.round((rightCtrlX - lx - numW - cgap * 3) * 0.34) : 0;
  var titleX = lx + numW + cgap;
  var titleW = Math.max(80, rightCtrlX - titleX - (albumW ? (albumW + cgap) : 0) - cgap);
  var albumX = titleX + titleW + cgap;
  tL(gr, '#', FONT.head, COL.text2, lx, listTop, numW, 20);
  tL(gr, 'TITLE', FONT.head, COL.text2, titleX, listTop, titleW, 20);
  if(showAlbum) tL(gr, 'ALBUM', FONT.head, COL.text2, albumX, listTop, albumW, 20);
  drawIcon(gr, 'clock', COL.text2, rx - 16, listTop, 16, 20, 15);
  gr.DrawLine(lx, listTop + 26, rx, listTop + 26, 1, COL.line);
}

function nvDrawGridCols(w, gap, minCardW){
  var cardW = minCardW || 176, cols = Math.max(2, Math.floor((w + gap) / (cardW + gap)));
  cardW = Math.floor((w - gap * (cols - 1)) / cols);
  return { cols: cols, cardW: cardW, cardH: cardW + 56 };
}

function nvDrawLoadingOrErr(gr, r, top, loading, err, retryAct){
  var cy = top + Math.round((r.y + r.h - top) * 0.42);
  if(err){
    tC(gr, err, FONT.sect, COL.danger, r.x + 24, cy - 20, r.w - 48, 28);
    nvDrawActionPill(gr, r.x + Math.round((r.w - 120) / 2), cy + 18, 120, 38, '\u91cd\u8bd5', 'refresh', false, retryAct);
    return true;
  }
  if(loading){
    drawViewSkeleton(gr, r);
    return true;
  }
  return false;
}

/* ---- 1) Navidrome Home ---- */
function nvDrawHome(gr, r){
  nvDrawTopStrip(gr, r, false);
  var pad = M.cpad, x0 = r.x + pad, w = r.w - pad * 2, rightEdge = r.x + r.w, i;
  var topBarBot = r.y + 54;
  if(NVData.error && !NVData.playlists.length){
    tC(gr, NVData.error, FONT.sect, COL.danger, r.x + 24, r.y + Math.round(r.h / 2) - 24, r.w - 48, 28);
    nvDrawActionPill(gr, r.x + Math.round((r.w - 132) / 2), r.y + Math.round(r.h / 2) + 14, 132, 38, '\u91cd\u65b0\u8fde\u63a5', 'refresh', false, 'refresh');
    return;
  }
  var gap = 16, grid = nvDrawGridCols(w, gap, 176), cols = grid.cols, cardW = grid.cardW, cardH = grid.cardH;
  var pls = NVData.playlists;
  var scardW = (pls.length > cols) ? Math.floor((w - cols * gap) / (cols + 0.4)) : cardW, scardH = scardW + 56;
  var shelfTitleY = topBarBot + 6, shelfY = shelfTitleY + 38;
  var quickY = shelfY + scardH + (pls.length > cols ? 28 : 16), quickH = 44;
  var albTitleY = quickY + quickH + 22, gy = albTitleY + 40;
  var cropY = r.y + r.h, rowStep = cardH + 8, viewH = Math.max(60, cropY - gy);

  var recentSlot = NVData.albumsByTab.recent || { list: [], loading: true };
  var albums = recentSlot.list || [];
  nvWarmCovers(pls); nvWarmCovers(albums);

  var totalRows = Math.max(1, Math.ceil(albums.length / cols)), contentH = totalRows * rowStep, maxPx = Math.max(0, contentH - viewH);
  NV_MAXPX = maxPx;
  nvScroll = clampPx(nvScroll, maxPx); nvScrollT = clampPx(nvScrollT, maxPx);

  if(recentSlot.loading && !albums.length){
    skelCardsCached(gr, x0, gy, w, Math.max(60, cropY - gy), cardW, gap); shimmer(gr, x0, gy, w, Math.max(60, cropY - gy));
  } else if(!albums.length){
    tC(gr, '\u6682\u65e0\u6700\u8fd1\u64ad\u653e\u4e13\u8f91', FONT.meta, COL.text3, x0, gy + 40, w, 24);
  } else {
    for(i = Math.floor(nvScroll / rowStep) * cols; i < albums.length; i++){
      var col = i % cols, row = Math.floor(i / cols), ay = Math.round(gy + row * rowStep - nvScroll);
      if(ay >= cropY) break;
      if(ay + cardH <= gy) continue;
      var al = albums[i];
      nvDrawCard(gr, x0 + col * (cardW + gap), ay, cardW, al.coverArt, al.name, al.name, (al.artist || '') + (al.year ? (' ' + CH_DOT + ' ' + al.year) : ''), false, 'album', al.id, al, false, undefined, undefined, gy, cropY);
    }
  }
  gr.FillSolidRect(r.x, cropY, r.w, M.pad + 2, COL.canvas);

  // Sticky top sections covering album grid scroll bleed
  gr.FillSolidRect(r.x, topBarBot, r.w, gy - topBarBot, COL.base);
  tL(gr, '\u6211\u7684 Navidrome \u6b4c\u5355', FONT.sect2, COL.text, x0, shelfTitleY, w - 120, 28);
  nvDrawMiniPill(gr, x0 + w - 110, shelfTitleY - 2, 110, 30, '\u65b0\u5efa\u6b4c\u5355', 'add', 'new-pl');

  var stride = scardW + gap, shelfW = Math.max(0, pls.length * stride - gap);
  NV_SHELF_MAX = Math.max(0, shelfW - w); NV_SHELF_STRIDE = stride;
  nvShelfScroll = clampPx(nvShelfScroll, NV_SHELF_MAX); nvShelfScrollT = clampPx(nvShelfScrollT, NV_SHELF_MAX);
  if(NVData.playlistsLoading && !NVData.playlistsLoaded){
    skelCardsCached(gr, x0, shelfY, w, scardH, scardW, gap); shimmer(gr, x0, shelfY, w, scardH);
  } else if(!pls.length){
    tL(gr, '\u670d\u52a1\u5668\u4e0a\u8fd8\u6ca1\u6709\u6b4c\u5355\uff0c\u70b9\u51fb\u53f3\u4e0a\u89d2\u53ef\u76f4\u63a5\u65b0\u5efa\u3002', FONT.meta, COL.text3, x0, shelfY + 24, w, 24);
  } else {
    for(i = Math.floor(nvShelfScroll / stride); i < pls.length; i++){
      var cx = Math.round(x0 + i * stride - nvShelfScroll);
      if(cx >= rightEdge) break;
      var pl = pls[i];
      nvDrawCard(gr, cx, shelfY, scardW, pl.coverArt, pl.name, pl.name, pl.songCount + ' songs', false, 'pl', pl.id, pl, true, x0, rightEdge, shelfY, shelfY + scardH);
    }
  }
  NV_SHELF_Y0 = shelfY; NV_SHELF_Y1 = shelfY + scardH;
  drawScrollbarH(gr, x0, shelfY + scardH + 6, w, nvShelfScroll, NV_SHELF_MAX, w, shelfW, hv(x0, shelfY, rightEdge, shelfY + scardH + 16) || drag === 'scrollh');

  // Quick discovery row
  var qCards = [
    { label: '\u6211\u559c\u6b22\u7684\u97f3\u4e50', icon: 'heart', act: 'go-starred' },
    { label: '\u5168\u5e93\u968f\u673a\u6f2b\u6e38', icon: 'shuffle', act: 'go-random' },
    { label: '\u6d4f\u89c8\u4e13\u8f91', icon: 'album', act: 'go-albums' },
    { label: '\u6d4f\u89c8\u6b4c\u624b', icon: 'artist', act: 'go-artists' }
  ];
  var qGap = 10, qw = Math.floor((w - qGap * (qCards.length - 1)) / qCards.length);
  for(i = 0; i < qCards.length; i++){
    var qx = x0 + i * (qw + qGap), qhov = hv(qx, quickY, qx + qw, quickY + quickH);
    gr.FillRoundRect(qx, quickY, qw, quickH, 8, 8, qhov ? COL.hover : COL.elev);
    if(qhov && typeof strokeRound === 'function') strokeRound(gr, qx, quickY, qw, quickH, 8, 1, COL.line);
    drawIcon(gr, qCards[i].icon, qhov ? COL.greenHot : COL.green, qx + 12, quickY + (quickH - 18) / 2, 18, 18, 17);
    tL(gr, qCards[i].label, FONT.pl, qhov ? COL.green : COL.text, qx + 38, quickY, qw - 46, quickH);
    HB_NV_BTN.push({ x0: qx, y0: quickY, x1: qx + qw, y1: quickY + quickH, act: qCards[i].act });
  }

  tL(gr, '\u6700\u8fd1\u64ad\u653e\u4e13\u8f91', FONT.sect2, COL.text, x0, albTitleY, w - 100, 28);
  nvDrawMiniPill(gr, x0 + w - 92, albTitleY - 2, 92, 28, '\u67e5\u770b\u5168\u90e8', '', 'go-albums');

  drawScrollbar(gr, x0 + w + 8, gy, viewH, nvScroll, maxPx, viewH, contentH, hv(x0, gy, x0 + w + 16, cropY) || drag === 'scroll');
}

/* ---- 2) Albums Directory ---- */
function nvDrawAlbumsView(gr, r){
  var pad = M.cpad, x0 = r.x + pad, w = r.w - pad * 2, rx = r.x + r.w - pad;
  var tab = NVData.albumsTab || 'recent';
  var slot = NVData.albumsByTab[tab] || { list: [], loading: true, err: '', hasMore: false };
  var pillY = r.y + 52, gy = pillY + 48, cropY = r.y + r.h, viewH = Math.max(60, cropY - gy);

  function drawHeader(){
    gr.FillSolidRect(r.x, r.y + M.radius + 2, r.w, gy - r.y - M.radius - 2, COL.base);
    nvDrawTopStrip(gr, r, false);
    HB_NV_ALB_DD = drawDropPill(gr, x0, pillY, 190, 36, labelOf(NV_ALB_TABS, tab, '\u6700\u8fd1\u64ad\u653e'), nvAlbTabOpen);
  }

  if(slot.loading && !slot.list.length){
    drawHeader();
    skelCardsCached(gr, x0, gy, w, viewH, 176, 16); shimmer(gr, x0, gy, w, viewH);
    return;
  }
  if(slot.err && !slot.list.length){
    drawHeader();
    nvDrawLoadingOrErr(gr, r, gy, false, slot.err, 'refresh');
    return;
  }

  var albums = slot.list, gap = 16, grid = nvDrawGridCols(w, gap, 176), cols = grid.cols, cardW = grid.cardW, cardH = grid.cardH, rowStep = cardH + 8;
  nvWarmCovers(albums);
  var footH = slot.hasMore ? 64 : 12;
  var contentH = Math.max(1, Math.ceil(albums.length / cols)) * rowStep + footH, maxPx = Math.max(0, contentH - viewH);
  NV_MAXPX = maxPx; nvScroll = clampPx(nvScroll, maxPx); nvScrollT = clampPx(nvScrollT, maxPx);

  for(var i = Math.floor(nvScroll / rowStep) * cols; i < albums.length; i++){
    var col = i % cols, row = Math.floor(i / cols), ay = Math.round(gy + row * rowStep - nvScroll);
    if(ay >= cropY) break;
    if(ay + cardH <= gy) continue;
    var al = albums[i];
    nvDrawCard(gr, x0 + col * (cardW + gap), ay, cardW, al.coverArt, al.name, al.name, (al.artist || '') + (al.year ? (' ' + CH_DOT + ' ' + al.year) : ''), false, 'album', al.id, al, false, undefined, undefined, gy, cropY);
  }
  if(slot.hasMore){
    var fy = Math.round(gy + Math.ceil(albums.length / cols) * rowStep - nvScroll + 8);
    if(fy + 38 > gy && fy < cropY){
      nvDrawActionPill(gr, x0 + Math.round((w - 150) / 2), fy, 150, 38, slot.loading ? '\u52a0\u8f7d\u4e2d\u2026' : '\u52a0\u8f7d\u66f4\u591a\u4e13\u8f91', '', false, 'more-albums');
      var mb = HB_NV_BTN[HB_NV_BTN.length - 1];
      if(mb){ mb.y0 = Math.max(gy, mb.y0); mb.y1 = Math.min(cropY, mb.y1); }
    }
  }
  gr.FillSolidRect(r.x, cropY, r.w, M.pad + 2, COL.canvas);
  drawHeader();
  drawScrollbar(gr, rx + 8, gy, viewH, nvScroll, maxPx, viewH, contentH, hv(r.x, gy, r.x + r.w, cropY) || drag === 'scroll');
}

/* ---- 3) Artists Directory ---- */
function nvDrawArtistsView(gr, r){
  var pad = M.cpad, x0 = r.x + pad, w = r.w - pad * 2, rx = r.x + r.w - pad;
  var gy = r.y + 58, cropY = r.y + r.h, viewH = Math.max(60, cropY - gy);
  if(NVData.artistsLoading && NVData.artists === null || NVData.artistsErr && NVData.artists === null){
    nvDrawTopStrip(gr, r, false);
    if(nvDrawLoadingOrErr(gr, r, gy, NVData.artistsLoading && NVData.artists === null, NVData.artistsErr, 'refresh')) return;
  }
  var arts = NVData.artists || [];
  nvWarmCovers(arts);
  var gap = 16, grid = nvDrawGridCols(w, gap, 176), cols = grid.cols, cardW = grid.cardW, cardH = grid.cardH, rowStep = cardH + 8;
  var contentH = Math.max(1, Math.ceil(arts.length / cols)) * rowStep + 16, maxPx = Math.max(0, contentH - viewH);
  NV_MAXPX = maxPx; nvScroll = clampPx(nvScroll, maxPx); nvScrollT = clampPx(nvScrollT, maxPx);

  for(var i = Math.floor(nvScroll / rowStep) * cols; i < arts.length; i++){
    var col = i % cols, row = Math.floor(i / cols), ay = Math.round(gy + row * rowStep - nvScroll);
    if(ay >= cropY) break;
    if(ay + cardH <= gy) continue;
    var a = arts[i];
    nvDrawCard(gr, x0 + col * (cardW + gap), ay, cardW, a.coverArt, a.name, a.name, (a.albumCount ? (a.albumCount + ' \u5f20\u4e13\u8f91') : 'Artist'), true, 'artist', a.id, a, false, undefined, undefined, gy, cropY);
  }
  gr.FillSolidRect(r.x, r.y + M.radius + 2, r.w, gy - r.y - M.radius - 2, COL.base);
  nvDrawTopStrip(gr, r, false);
  gr.FillSolidRect(r.x, cropY, r.w, M.pad + 2, COL.canvas);
  drawScrollbar(gr, rx + 8, gy, viewH, nvScroll, maxPx, viewH, contentH, hv(r.x, gy, r.x + r.w, cropY) || drag === 'scroll');
}

/* ---- 4) Server Playlist Detail ---- */
function nvSortedPlaylistEntries(det){
  var src = (det && det.songs) ? det.songs : [], list = [], i;
  for(i = 0; i < src.length; i++) list.push({ song: src[i], origIdx: i });
  if(nvPlSort !== 'default'){
    var mul = (nvPlSortDir === 'desc') ? -1 : 1;
    list.sort(function(p, q){
      var a = p.song, b = q.song, cmp = 0;
      if(nvPlSort === 'dur') cmp = a.duration - b.duration;
      else{
        var sa = String(nvPlSort === 'title' ? a.title : (nvPlSort === 'artist' ? a.artist : a.album)).toLowerCase();
        var sb = String(nvPlSort === 'title' ? b.title : (nvPlSort === 'artist' ? b.artist : b.album)).toLowerCase();
        cmp = sa < sb ? -1 : (sa > sb ? 1 : 0);
      }
      return cmp !== 0 ? cmp * mul : (p.origIdx - q.origIdx);
    });
  } else if(nvPlSortDir === 'desc'){
    list.reverse();
  }
  return list;
}

function nvDrawPlaylistView(gr, r){
  var det = NVData.plDetails[nvViewId] || { meta: nvPlaylistById(nvViewId), songs: [], loading: true, err: '' };
  var meta = det.meta || nvPlaylistById(nvViewId) || { id: nvViewId, name: nvViewTitle || 'Playlist', coverArt: '', songCount: 0, duration: 0 };
  if(det.loading && !det.songs.length){ drawViewSkeleton(gr, r); nvDrawTopStrip(gr, r, true); return; }
  if(det.err && !det.songs.length){ nvDrawTopStrip(gr, r, false); nvDrawLoadingOrErr(gr, r, r.y + 60, false, det.err, 'refresh'); return; }

  var headH = M.headH, compact = headH < 220;
  gr.FillGradRect(r.x, r.y, r.w, headH, 90, blend(nvArtHue(meta.coverArt, meta.name), COL.base, headMix(0.42)), COL.base, 1.0);
  nvDrawTopStrip(gr, r, true);

  var ax = r.x + M.cpad, ay = r.y + (compact ? 48 : 54), art = Math.min(M.artSz, Math.max(64, r.w * 0.22));
  nvDrawRounded(gr, ax, ay, art, 8, meta.coverArt, meta.name);

  var rx0 = r.x + r.w - M.cpad, tx = ax + art + 24, tw = Math.max(40, rx0 - tx);
  tL(gr, 'NAVIDROME PLAYLIST', FONT.eyebrow, COL.text, tx, ay + 2, tw, 18);
  tL(gr, meta.name, compact ? FONT.sect2 : FONT.title, COL.text, tx, ay + (compact ? 18 : 22), tw, compact ? 36 : 74);
  var dur = meta.duration || 0;
  tL(gr, det.songs.length + ' songs' + (dur > 0 ? (' ' + CH_DOT + ' ' + fmtDur(dur)) : ''), FONT.meta, COL.text2, tx, ay + (compact ? 56 : 100), tw, 22);

  var actY = ay + (compact ? 84 : 138);
  nvDrawActionPill(gr, tx, actY, 108, 38, '\u64ad\u653e', 'play', true, 'play-list');
  nvDrawActionPill(gr, tx + 118, actY, 126, 38, '\u968f\u673a\u64ad\u653e', 'shuffle', false, 'shuf-list');

  var sortDirW = 38, sortGap = 8, sortPillW = Math.min(180, Math.max(110, rx0 - (tx + 260) - sortDirW - sortGap));
  if(rx0 - (tx + 256) >= 160){
    var sx = rx0 - sortPillW - sortGap - sortDirW;
    HB_NV_SORT_DD = drawDropPill(gr, sx, actY, sortPillW, 38, labelOf(NV_PL_SORTS, nvPlSort, '\u9ed8\u8ba4\u987a\u5e8f'), nvPlSortOpen);
    var sdX = sx + sortPillW + sortGap;
    var sdHot = hv(sdX, actY, sdX + sortDirW, actY + 38);
    gr.FillRoundRect(sdX, actY, sortDirW, 38, 19, 19, sdHot ? COL.pillHot : COL.pill);
    strokeRound(gr, sdX, actY, sortDirW, 38, 19, 1, sdHot ? COL.text2 : COL.line);
    drawIcon(gr, nvPlSortDir === 'asc' ? 'sortAsc' : 'sortDesc', COL.text, sdX, actY, sortDirW, 38, 18);
    HB_NV_SORT_DIR = { x0: sdX, y0: actY, x1: sdX + sortDirW, y1: actY + 38 };
  }

  var lx = r.x + M.cpad, rx = rx0, listTop = r.y + headH + 8, rowsTop = listTop + 34, rh = M.rowH, cropY = r.y + r.h, viewH = cropY - rowsTop;
  var entries = nvSortedPlaylistEntries(det), songsOnly = entries.map(function(e){ return e.song; });
  nvWarmCovers(songsOnly);
  var contentH = entries.length * rh, maxPx = Math.max(0, contentH - viewH);
  NV_MAXPX = maxPx; nvScroll = clampPx(nvScroll, maxPx); nvScrollT = clampPx(nvScrollT, maxPx);
  var srcMeta = { subKind: 'playlist', id: meta.id, name: meta.name };

  for(var d = Math.floor(nvScroll / rh); d < entries.length; d++){
    var ry = rowsTop + d * rh - nvScroll; if(ry >= cropY) break;
    var ent = entries[d];
    nvDrawTrackRow(gr, r, lx, rx, ry, rh, rowsTop, cropY, d + 1, ent.song, songsOnly, d, srcMeta, meta.id, ent.origIdx, { showAlbum: true, showThumb: true });
  }
  gr.FillSolidRect(r.x, rowsTop - rh, r.w, rh, COL.base);
  gr.FillSolidRect(r.x, cropY, r.w, M.pad + 2, COL.canvas);
  if(!entries.length){
    tC(gr, '\u8fd9\u4e2a\u6b4c\u5355\u8fd8\u662f\u7a7a\u7684', FONT.sect2, COL.text2, r.x, rowsTop + 60, r.w, 34);
  } else {
    nvDrawTrackColsHeader(gr, r, lx, rx, listTop, true);
    drawScrollbar(gr, rx + 8, rowsTop, viewH, nvScroll, maxPx, viewH, contentH, hv(r.x, r.y, r.x + r.w, cropY) || drag === 'scroll');
  }
}

/* ---- 5) Album Detail ---- */
function nvDrawAlbumView(gr, r){
  var det = NVData.albumDetails[nvViewId] || { meta: null, songs: [], loading: true, err: '' };
  if(det.loading && !det.songs.length){ drawViewSkeleton(gr, r); nvDrawTopStrip(gr, r, true); return; }
  if(det.err && !det.songs.length){ nvDrawTopStrip(gr, r, false); nvDrawLoadingOrErr(gr, r, r.y + 60, false, det.err, 'refresh'); return; }
  var meta = det.meta || { id: nvViewId, name: nvViewTitle || 'Album', artist: '', coverArt: nvViewId, year: '', duration: 0 };

  var headH = M.headH, compact = headH < 220;
  gr.FillGradRect(r.x, r.y, r.w, headH, 90, blend(nvArtHue(meta.coverArt, meta.name), COL.base, headMix(0.42)), COL.base, 1.0);
  nvDrawTopStrip(gr, r, true);

  var ax = r.x + M.cpad, ay = r.y + (compact ? 48 : 54), art = Math.min(M.artSz, Math.max(64, r.w * 0.22));
  nvDrawRounded(gr, ax, ay, art, 8, meta.coverArt, meta.name);

  var rx0 = r.x + r.w - M.cpad, tx = ax + art + 24, tw = Math.max(40, rx0 - tx);
  tL(gr, 'ALBUM', FONT.eyebrow, COL.text, tx, ay + 2, tw, 18);
  tL(gr, meta.name, compact ? FONT.sect2 : FONT.title, COL.text, tx, ay + (compact ? 18 : 22), tw, compact ? 36 : 74);
  var subY = ay + (compact ? 56 : 100);
  var artistName = meta.artist || 'Unknown Artist';
  var subTail = (meta.year ? (' ' + CH_DOT + ' ' + meta.year) : '') + ' ' + CH_DOT + ' ' + det.songs.length + ' songs';
  if(meta.artistId){
    var artistW = Math.min(tw, Math.ceil(gr.CalcTextWidth(artistName, FONT.meta)) + 2);
    var artHot = hv(tx, subY - 2, tx + artistW + 2, subY + 24);
    tL(gr, artistName, FONT.meta, artHot ? COL.green : COL.text, tx, subY, artistW, 22);
    if(artHot) gr.DrawLine(tx, subY + 20, tx + artistW, subY + 20, 1, COL.green);
    if(tw - artistW > 8) tL(gr, subTail, FONT.meta, COL.text2, tx + artistW, subY, tw - artistW, 22);
    HB_NV_BTN.push({ x0: tx, y0: subY - 2, x1: tx + artistW + 2, y1: subY + 24, act: 'open-album-artist', data: meta });
  } else {
    tL(gr, artistName + subTail, FONT.meta, COL.text2, tx, subY, tw, 22);
  }

  var actY = ay + (compact ? 84 : 138);
  nvDrawActionPill(gr, tx, actY, 108, 38, '\u64ad\u653e', 'play', true, 'play-list');
  nvDrawActionPill(gr, tx + 118, actY, 126, 38, '\u968f\u673a\u64ad\u653e', 'shuffle', false, 'shuf-list');
  var alStar = nvIsStarred('album', meta.id);
  nvDrawActionPill(gr, tx + 254, actY, 112, 38, alStar ? '\u5df2\u6536\u85cf' : '\u6536\u85cf\u4e13\u8f91', alStar ? 'heart' : 'heartO', false, 'star-album', { active: alStar, obj: meta });

  var lx = r.x + M.cpad, rx = rx0, listTop = r.y + headH + 8, rowsTop = listTop + 34, rh = M.rowH, cropY = r.y + r.h, viewH = cropY - rowsTop;
  var songs = det.songs, contentH = songs.length * rh, maxPx = Math.max(0, contentH - viewH);
  NV_MAXPX = maxPx; nvScroll = clampPx(nvScroll, maxPx); nvScrollT = clampPx(nvScrollT, maxPx);
  var srcMeta = { subKind: 'album', id: meta.id, name: meta.name };

  for(var i = Math.floor(nvScroll / rh); i < songs.length; i++){
    var ry = rowsTop + i * rh - nvScroll; if(ry >= cropY) break;
    var s = songs[i];
    nvDrawTrackRow(gr, r, lx, rx, ry, rh, rowsTop, cropY, s.track || (i + 1), s, songs, i, srcMeta, '', -1, { showAlbum: false, showThumb: false });
  }
  gr.FillSolidRect(r.x, rowsTop - rh, r.w, rh, COL.base);
  gr.FillSolidRect(r.x, cropY, r.w, M.pad + 2, COL.canvas);
  nvDrawTrackColsHeader(gr, r, lx, rx, listTop, false);
  drawScrollbar(gr, rx + 8, rowsTop, viewH, nvScroll, maxPx, viewH, contentH, hv(r.x, r.y, r.x + r.w, cropY) || drag === 'scroll');
}

/* ---- 6) Artist Detail ---- */
function nvDrawArtistView(gr, r){
  var det = NVData.artistDetails[nvViewId] || { meta: { id: nvViewId, name: nvViewTitle || 'Artist', coverArt: '' }, albums: [], topSongs: [], loading: true, err: '' };
  if(det.loading && !det.albums.length){ drawViewSkeleton(gr, r); nvDrawTopStrip(gr, r, true); return; }
  if(det.err && !det.albums.length){ nvDrawTopStrip(gr, r, false); nvDrawLoadingOrErr(gr, r, r.y + 60, false, det.err, 'refresh'); return; }
  var meta = det.meta;

  var headH = 228, pad = M.cpad, x0 = r.x + pad, w = r.w - pad * 2, rx = r.x + r.w - pad;
  var bodyTop = r.y + headH + 8, cropY = r.y + r.h, viewH = Math.max(60, cropY - bodyTop);
  var topCount = Math.min(5, det.topSongs.length), topH = topCount ? (40 + topCount * 50 + 24) : 0;
  var gap = 16, grid = nvDrawGridCols(w, gap, 176), cols = grid.cols, cardW = grid.cardW, cardH = grid.cardH, rowStep = cardH + 8;
  var albumsH = det.albums.length ? (42 + Math.ceil(det.albums.length / cols) * rowStep + 20) : 40;
  var contentH = topH + albumsH, maxPx = Math.max(0, contentH - viewH);
  NV_MAXPX = maxPx; nvScroll = clampPx(nvScroll, maxPx); nvScrollT = clampPx(nvScrollT, maxPx);

  nvWarmCovers(det.albums);
  var cy = Math.round(bodyTop - nvScroll);
  if(topCount){
    if(cy + 28 > bodyTop && cy < cropY) tL(gr, '\u70ed\u95e8\u6b4c\u66f2', FONT.sect2, COL.text, x0, cy, w, 28);
    var srcMeta = { subKind: 'artist', id: meta.id, name: meta.name + ' \u70ed\u6b4c' };
    for(var ti = 0; ti < topCount; ti++){
      var ry = cy + 38 + ti * 50;
      if(ry >= cropY) break;
      if(ry + 50 <= bodyTop) continue;
      nvDrawTrackRow(gr, r, x0, rx, ry, 50, bodyTop, cropY, ti + 1, det.topSongs[ti], det.topSongs, ti, srcMeta, '', -1, { showAlbum: true, showThumb: true });
    }
    cy += topH;
  }
  if(cy + 28 > bodyTop && cy < cropY) tL(gr, '\u4e13\u8f91', FONT.sect2, COL.text, x0, cy, w, 28);
  var gy = cy + 40;
  for(var i = 0; i < det.albums.length; i++){
    var col = i % cols, row = Math.floor(i / cols), yCard = Math.round(gy + row * rowStep);
    if(yCard >= cropY) break;
    if(yCard + cardH <= bodyTop) continue;
    var al = det.albums[i];
    nvDrawCard(gr, x0 + col * (cardW + gap), yCard, cardW, al.coverArt, al.name, al.name, al.year || 'Album', false, 'album', al.id, al, false, undefined, undefined, bodyTop, cropY);
  }

  // Paint the sticky artist header last so scrolled tracks/headings mask cleanly under it.
  gr.FillSolidRect(r.x, r.y, r.w, bodyTop - r.y, COL.base);
  gr.FillGradRect(r.x, r.y, r.w, headH, 90, blend(nvArtHue(meta.coverArt, meta.name), COL.base, headMix(0.44)), COL.base, 1.0);
  nvDrawTopStrip(gr, r, true);
  var ay = r.y + 52, art = 148;
  nvDrawCircle(gr, x0, ay, art, meta.coverArt, meta.name);
  var tx = x0 + art + 24, tw = Math.max(60, rx - tx);
  tL(gr, 'ARTIST', FONT.eyebrow, COL.text, tx, ay + 6, tw, 18);
  tL(gr, meta.name, FONT.title, COL.text, tx, ay + 24, tw, 68);
  tL(gr, det.albums.length + ' \u5f20\u4e13\u8f91', FONT.meta, COL.text2, tx, ay + 96, tw, 22);

  var actY = ay + 124;
  if(det.topSongs.length){
    nvDrawActionPill(gr, tx, actY, 118, 36, '\u64ad\u653e\u70ed\u6b4c', 'play', true, 'play-list');
    nvDrawActionPill(gr, tx + 128, actY, 126, 36, '\u968f\u673a\u64ad\u653e', 'shuffle', false, 'shuf-list');
  }
  var arStar = nvIsStarred('artist', meta.id);
  nvDrawActionPill(gr, tx + (det.topSongs.length ? 264 : 0), actY, 108, 36, arStar ? '\u5df2\u5173\u6ce8' : '\u5173\u6ce8\u6b4c\u624b', arStar ? 'heart' : 'heartO', false, 'star-artist', { active: arStar, obj: meta });

  gr.FillSolidRect(r.x, cropY, r.w, M.pad + 2, COL.canvas);
  drawScrollbar(gr, rx + 8, bodyTop, viewH, nvScroll, maxPx, viewH, contentH, hv(r.x, bodyTop, r.x + r.w, cropY) || drag === 'scroll');
}

/* ---- 7) Starred / Liked Songs ---- */
function nvDrawStarredView(gr, r){
  var st = NVData.starred;
  if(st.loading && !st.loaded){ drawViewSkeleton(gr, r); nvDrawTopStrip(gr, r, true); return; }
  if(st.err && !st.loaded){ nvDrawTopStrip(gr, r, false); nvDrawLoadingOrErr(gr, r, r.y + 60, false, st.err, 'refresh'); return; }

  var headH = M.headH, compact = headH < 220;
  gr.FillGradRect(r.x, r.y, r.w, headH, 90, blend(RGB(96, 48, 170), COL.base, headMix(0.45)), COL.base, 1.0);
  nvDrawTopStrip(gr, r, true);

  var ax = r.x + M.cpad, ay = r.y + (compact ? 48 : 54), art = Math.min(M.artSz, Math.max(64, r.w * 0.22));
  gr.FillRoundRect(ax, ay, art, art, 8, 8, RGB(88, 56, 176));
  drawIcon(gr, 'heart', COL.white, ax, ay, art, art, Math.round(art * 0.42));

  var rx0 = r.x + r.w - M.cpad, tx = ax + art + 24, tw = Math.max(40, rx0 - tx);
  tL(gr, 'COLLECTION', FONT.eyebrow, COL.text, tx, ay + 2, tw, 18);
  tL(gr, '\u6211\u559c\u6b22\u7684\u97f3\u4e50', compact ? FONT.sect2 : FONT.title, COL.text, tx, ay + (compact ? 18 : 22), tw, compact ? 36 : 74);
  tL(gr, st.songs.length + ' \u9996\u6536\u85cf\u6b4c\u66f2', FONT.meta, COL.text2, tx, ay + (compact ? 56 : 100), tw, 22);

  var actY = ay + (compact ? 84 : 138);
  if(st.songs.length){
    nvDrawActionPill(gr, tx, actY, 108, 38, '\u64ad\u653e', 'play', true, 'play-list');
    nvDrawActionPill(gr, tx + 118, actY, 126, 38, '\u968f\u673a\u64ad\u653e', 'shuffle', false, 'shuf-list');
  }

  var lx = r.x + M.cpad, rx = rx0, listTop = r.y + headH + 8, rowsTop = listTop + 34, rh = M.rowH, cropY = r.y + r.h, viewH = cropY - rowsTop;
  var songs = st.songs, contentH = songs.length * rh, maxPx = Math.max(0, contentH - viewH);
  NV_MAXPX = maxPx; nvScroll = clampPx(nvScroll, maxPx); nvScrollT = clampPx(nvScrollT, maxPx);
  var srcMeta = { subKind: 'starred', id: 'starred', name: '\u6211\u559c\u6b22\u7684\u97f3\u4e50' };
  nvWarmCovers(songs);

  for(var i = Math.floor(nvScroll / rh); i < songs.length; i++){
    var ry = rowsTop + i * rh - nvScroll; if(ry >= cropY) break;
    nvDrawTrackRow(gr, r, lx, rx, ry, rh, rowsTop, cropY, i + 1, songs[i], songs, i, srcMeta, '', -1, { showAlbum: true, showThumb: true });
  }
  gr.FillSolidRect(r.x, rowsTop - rh, r.w, rh, COL.base);
  gr.FillSolidRect(r.x, cropY, r.w, M.pad + 2, COL.canvas);
  if(!songs.length){
    tC(gr, '\u70b9\u51fb\u4efb\u610f\u6b4c\u66f2\u7684\u7ea2\u5fc3\u56fe\u6807\u5373\u53ef\u6536\u85cf\u5230\u8fd9\u91cc', FONT.sect2, COL.text2, r.x, rowsTop + 60, r.w, 34);
  } else {
    nvDrawTrackColsHeader(gr, r, lx, rx, listTop, true);
    drawScrollbar(gr, rx + 8, rowsTop, viewH, nvScroll, maxPx, viewH, contentH, hv(r.x, r.y, r.x + r.w, cropY) || drag === 'scroll');
  }
}

/* ---- 8) Random Mix Radio ---- */
function nvDrawRandomView(gr, r){
  var rm = NVData.randomMix;
  if(rm.loading && !rm.songs.length){ drawViewSkeleton(gr, r); nvDrawTopStrip(gr, r, true); return; }
  if(rm.err && !rm.songs.length){ nvDrawTopStrip(gr, r, false); nvDrawLoadingOrErr(gr, r, r.y + 60, false, rm.err, 'random-rebatch'); return; }

  var headH = M.headH, compact = headH < 220;
  gr.FillGradRect(r.x, r.y, r.w, headH, 90, blend(RGB(24, 130, 96), COL.base, headMix(0.45)), COL.base, 1.0);
  nvDrawTopStrip(gr, r, true);

  var ax = r.x + M.cpad, ay = r.y + (compact ? 48 : 54), art = Math.min(M.artSz, Math.max(64, r.w * 0.22));
  gr.FillRoundRect(ax, ay, art, art, 8, 8, RGB(28, 136, 94));
  drawIcon(gr, 'shuffle', COL.white, ax, ay, art, art, Math.round(art * 0.42));

  var rx0 = r.x + r.w - M.cpad, tx = ax + art + 24, tw = Math.max(40, rx0 - tx);
  tL(gr, 'INFINITE RADIO', FONT.eyebrow, COL.text, tx, ay + 2, tw, 18);
  tL(gr, '\u5168\u5e93\u968f\u673a\u6f2b\u6e38', compact ? FONT.sect2 : FONT.title, COL.text, tx, ay + (compact ? 18 : 22), tw, compact ? 36 : 74);
  tL(gr, '\u652f\u6301\u81ea\u52a8\u65e0\u9650\u7eed\u64ad\uff0c\u961f\u5217\u5feb\u64ad\u5b8c\u65f6\u81ea\u52a8\u62c9\u53d6\u65b0\u66f2', FONT.meta, COL.text2, tx, ay + (compact ? 56 : 100), tw, 22);

  var actY = ay + (compact ? 84 : 138);
  nvDrawActionPill(gr, tx, actY, 138, 38, '\u5f00\u59cb\u6f2b\u6e38\u64ad\u653e', 'play', true, 'play-list');
  nvDrawActionPill(gr, tx + 148, actY, 108, 38, '\u6362\u4e00\u6279', 'refresh', false, 'random-rebatch');

  var lx = r.x + M.cpad, rx = rx0, listTop = r.y + headH + 8, rowsTop = listTop + 34, rh = M.rowH, cropY = r.y + r.h, viewH = cropY - rowsTop;
  var songs = rm.songs, contentH = songs.length * rh, maxPx = Math.max(0, contentH - viewH);
  NV_MAXPX = maxPx; nvScroll = clampPx(nvScroll, maxPx); nvScrollT = clampPx(nvScrollT, maxPx);
  var srcMeta = { subKind: 'random', id: 'random', name: 'Navidrome \u968f\u673a\u6f2b\u6e38' };
  nvWarmCovers(songs);

  for(var i = Math.floor(nvScroll / rh); i < songs.length; i++){
    var ry = rowsTop + i * rh - nvScroll; if(ry >= cropY) break;
    nvDrawTrackRow(gr, r, lx, rx, ry, rh, rowsTop, cropY, i + 1, songs[i], songs, i, srcMeta, '', -1, { showAlbum: true, showThumb: true });
  }
  gr.FillSolidRect(r.x, rowsTop - rh, r.w, rh, COL.base);
  gr.FillSolidRect(r.x, cropY, r.w, M.pad + 2, COL.canvas);
  nvDrawTrackColsHeader(gr, r, lx, rx, listTop, true);
  drawScrollbar(gr, rx + 8, rowsTop, viewH, nvScroll, maxPx, viewH, contentH, hv(r.x, r.y, r.x + r.w, cropY) || drag === 'scroll');
}

function nvDrawNvDropdowns(gr){
  if(nvAlbTabOpen) NV_ALB_DD_HB = drawDropMenu(gr, HB_NV_ALB_DD, NV_ALB_TABS, NVData.albumsTab || 'recent', 190);
  else if(nvPlSortOpen) NV_SORT_DD_HB = drawDropMenu(gr, HB_NV_SORT_DD, NV_PL_SORTS, nvPlSort, 180);
  else if(nvSrvMenuOpen){
    var srvItems = NVApi.servers.map(function(s){ return [s.name, s.name]; });
    var conn = nvConnection();
    NV_SRV_DD_HB = drawDropMenu(gr, HB_NV_SRV_DD, srvItems, conn ? conn.name : '', 170);
  }
}

function nvActivePlaybackSpec(){
  if(nvView === 'playlist'){
    var dp = NVData.plDetails[nvViewId];
    if(dp && dp.songs && dp.songs.length){
      var entries = nvSortedPlaylistEntries(dp);
      return { songs: entries.map(function(e){ return e.song; }), meta: { subKind: 'playlist', id: nvViewId, name: (dp.meta && dp.meta.name) || nvViewTitle } };
    }
  } else if(nvView === 'album'){
    var da = NVData.albumDetails[nvViewId];
    if(da && da.songs && da.songs.length) return { songs: da.songs, meta: { subKind: 'album', id: nvViewId, name: (da.meta && da.meta.name) || nvViewTitle } };
  } else if(nvView === 'artist'){
    var dar = NVData.artistDetails[nvViewId];
    if(dar && dar.topSongs && dar.topSongs.length) return { songs: dar.topSongs, meta: { subKind: 'artist', id: nvViewId, name: dar.meta.name + ' \u70ed\u6b4c' } };
  } else if(nvView === 'starred'){
    if(NVData.starred.songs.length) return { songs: NVData.starred.songs, meta: { subKind: 'starred', id: 'starred', name: '\u6211\u559c\u6b22\u7684\u97f3\u4e50' } };
  } else if(nvView === 'random'){
    if(NVData.randomMix.songs.length) return { songs: NVData.randomMix.songs, meta: { subKind: 'random', id: 'random', name: 'Navidrome \u968f\u673a\u6f2b\u6e38' } };
  }
  return null;
}

function drawNavidromeView(gr, r){
  HB_NV_BTN = []; HB_NV_CARDS = []; HB_NV_TR = []; HB_NV_STAR = []; HB_NV_TRDOTS = []; HB_NV_PLDOTS = [];
  NV_ALB_DD_HB = []; NV_SORT_DD_HB = []; NV_SRV_DD_HB = [];
  HB_NV_ALB_DD = null; HB_NV_SORT_DD = null; HB_NV_SORT_DIR = null; HB_NV_SRV_DD = null;
  nvEnsureLoaded();
  if(nvView === 'albums') nvDrawAlbumsView(gr, r);
  else if(nvView === 'artists') nvDrawArtistsView(gr, r);
  else if(nvView === 'playlist') nvDrawPlaylistView(gr, r);
  else if(nvView === 'album') nvDrawAlbumView(gr, r);
  else if(nvView === 'artist') nvDrawArtistView(gr, r);
  else if(nvView === 'starred') nvDrawStarredView(gr, r);
  else if(nvView === 'random') nvDrawRandomView(gr, r);
  else nvDrawHome(gr, r);
  nvDrawNvDropdowns(gr);
}

function handleNvButtonAction(act, data){
  if(act === 'back') nvGoBack();
  else if(act === 'home') nvOpenHome();
  else if(act === 'refresh') nvRefreshAll(true);
  else if(act === 'new-pl') startNvCreatePlaylist([]);
  else if(act === 'go-starred') nvOpenStarred();
  else if(act === 'go-random') nvOpenRandom();
  else if(act === 'go-albums') nvOpenAlbums();
  else if(act === 'go-artists') nvOpenArtists();
  else if(act === 'more-albums') nvFetchAlbums(NVData.albumsTab || 'recent', true, false);
  else if(act === 'random-rebatch') nvFetchRandomSongs(80, false);
  else if(act === 'open-album-artist' && data && data.artistId) nvOpenArtist(data.artistId, data.artist);
  else if(act === 'star-album' && data && data.obj) nvToggleStar('album', data.obj.id, data.obj);
  else if(act === 'star-artist' && data && data.obj) nvToggleStar('artist', data.obj.id, data.obj);
  else if(act === 'play-list' || act === 'shuf-list'){
    var spec = nvActivePlaybackSpec();
    if(spec){
      if(nvView === 'random') nvPlaySongs(spec.songs, 0, spec.meta, false);
      else nvPlaySongs(spec.songs, 0, spec.meta, act === 'shuf-list' ? true : pbShuffle);
    }
  }
  repaintAll();
}
