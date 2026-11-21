/* verdant/views/components.js -- shared UI components: top strip, pills, cards, track rows, loading states
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

var BR_PL_SORTS = [];
var BR_ALB_TABS = [];
onLangChange(function(){
  BR_PL_SORTS = [
    [T('sort.default'), 'default'],
    [T('sort.title'), 'title'],
    [T('sort.artist'), 'artist'],
    [T('sort.album'), 'album'],
    [T('sort.dur'), 'dur']
  ];
  BR_ALB_TABS = [
    [T('alb_tab.recent'), 'recent'],
    [T('alb_tab.newest'), 'newest'],
    [T('alb_tab.frequent'), 'frequent'],
    [T('alb_tab.random'), 'random'],
    [T('alb_tab.name'), 'alphabeticalByName']
  ];
});

var HB_BR_BTN = [], HB_BR_CARDS = [], HB_BR_TR = [], HB_BR_STAR = [], HB_BR_TRDOTS = [], HB_BR_PLDOTS = [];
var BR_ALB_DD_HB = [], BR_SORT_DD_HB = [], BR_SRV_DD_HB = [];
var HB_BR_ALB_DD = null, HB_BR_SORT_DD = null, HB_BR_SORT_DIR = null, HB_BR_SRV_DD = null;

function brSrc(){
  return (typeof activeSource === 'function') ? (activeSource() || sourceById('local') || sourceById('navidrome')) : null;
}

function brAlbumTabOptions(src){
  var allowed = (typeof sourceAlbumTabs === 'function') ? sourceAlbumTabs(src) : [];
  if(!allowed || !allowed.length) return BR_ALB_TABS;
  var allow = {}, out = [], i;
  for(i = 0; i < allowed.length; i++) allow[allowed[i]] = true;
  for(i = 0; i < BR_ALB_TABS.length; i++){
    if(allow[BR_ALB_TABS[i][1]]) out.push(BR_ALB_TABS[i]);
  }
  return out.length ? out : BR_ALB_TABS;
}

function brDrawMiniPill(gr, x, y, w, h, label, iconName, act, opts){
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
  HB_BR_BTN.push(hb);
  return hb;
}

function brDrawTopStrip(gr, r, overlay){
  var lx = r.x + M.cpad, rx = r.x + r.w - M.cpad, y = r.y + (r.h < 380 ? 8 : 12), h = r.h < 380 ? 28 : 30;
  var src = brSrc();
  var curX = rx;
  var refLbl = T('btn.refresh'), refW = Math.max(60, Math.round(gr.CalcTextWidth(refLbl, FONT.plSub)) + 38);
  curX -= refW;
  brDrawMiniPill(gr, curX, y, refW, h, refLbl, 'refresh', 'refresh', { overlay: overlay });
  if(src && sourceHasCap(src, 'multiServer') && !overlay){
    var conn = src.activeServer ? src.activeServer() : null;
    var srvs = src.servers ? src.servers() : [];
    if(conn && srvs.length > 1){
      curX -= 8;
      var sw = Math.min(r.w < 480 ? 110 : 160, Math.max(82, gr.CalcTextWidth(conn.name, FONT.plSub) + 36));
      curX -= sw;
      HB_BR_SRV_DD = drawDropPill(gr, curX, y, sw, h, conn.name, brSrvMenuOpen);
    }
  }
  if(typeof view === 'string' && view === 'browse' && brHistory.length > 0){
    var backLbl = T('btn.back'), backW = Math.max(62, Math.round(gr.CalcTextWidth(backLbl, FONT.plSub)) + 36);
    brDrawMiniPill(gr, lx, y, backW, h, backLbl, 'back', 'back', { overlay: overlay });
  } else if(!overlay){
    var defTitle = (src && src.id === 'local') ? T('source.local') : T('source.navidrome');
    tL(gr, brViewTitle || defTitle, FONT.sect2, COL.text, lx, y - 2, Math.max(60, curX - lx - 10), 32);
  }
}

function brActionPillW(gr, label, iconName, minW){
  return Math.max(minW || 100, Math.round(gr.CalcTextWidth(label, FONT.pl)) + (iconName ? 54 : 32));
}

function brDrawActionPill(gr, x, y, w, h, label, iconName, primary, act, data){
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
  HB_BR_BTN.push({ x0: x, y0: y, x1: x + w, y1: y + h, act: act, data: data });
}

var brCardCache = {}, brCardN = 0, brCardTick = 0;

function disposeBrCardEntry(e){
  if(e && e.img){ try{ e.img.Dispose(); }catch(err){} e.img = null; }
}

function clearBrCardCache(){
  for(var k in brCardCache){
    if(Object.prototype.hasOwnProperty.call(brCardCache, k)) disposeBrCardEntry(brCardCache[k]);
  }
  brCardCache = {}; brCardN = 0;
}

function evictBrCards(){
  var keys = [], k, i;
  for(k in brCardCache){
    if(Object.prototype.hasOwnProperty.call(brCardCache, k)) keys.push(k);
  }
  keys.sort(function(p, q){ return brCardCache[p].t - brCardCache[q].t; });
  var n = Math.floor(keys.length / 2);
  for(i = 0; i < n; i++){
    disposeBrCardEntry(brCardCache[keys[i]]);
    delete brCardCache[keys[i]];
  }
  brCardN = keys.length - n;
}

function brCardImg(kind, id, w, coverId, seed, isArtist){
  if(!coverReady(coverId)){ coverRequest(coverId, false); return null; }
  var hasBmp = coverHasBitmap(coverId);
  var key = kind + '|' + id + '|' + w + '|' + (IS_LIGHT ? 'L' : 'D') + '|' + (hasBmp ? '1' : '0');
  var e = brCardCache[key];
  if(e){ e.t = ++brCardTick; return e.img; }
  var cap = (typeof ART_CARD_CAP === 'number' && ART_CARD_CAP > 0) ? ART_CARD_CAP : 400;
  if(brCardN >= cap) evictBrCards();
  var h = w + 56, im = null;
  try{
    im = dpiImage(w, h);
    var g = dpiGraphics(im.GetGraphics());
    g.SetSmoothingMode(2);
    g.FillSolidRect(0, 0, w, h, COL.base);
    brPaintCardShell(g, 0, 0, w, coverId, seed, isArtist, false);
    releaseDpiGraphics(im, g);
  }catch(err){
    if(im){ try{ im.Dispose(); }catch(err2){} }
    im = null;
  }
  if(im){ brCardCache[key] = { img: im, t: ++brCardTick }; brCardN++; }
  return im;
}

function brPaintCardShell(gr, x, y, w, coverId, seed, isArtist, hov){
  var h = w + 56, cs = w - 24;
  gr.FillRoundRect(x, y, w, h, 8, 8, hov ? COL.cardHov : COL.elev);
  if(hov && typeof strokeRound === 'function') strokeRound(gr, x, y, w, h, 8, 1, COL.line);
  if(isArtist) coverDrawCircle(gr, x + 12, y + 12, cs, coverId, seed);
  else coverDrawRounded(gr, x + 12, y + 12, cs, 6, coverId, seed);
}

function brPaintCardText(gr, x, y, w, title, sub, isArtist, hov, plDots, x0, x1, y0, y1, clipL, clipR, clipT, clipB){
  var cs = w - 24, tw = cs - ((hov && plDots) ? 26 : 0);
  if(clipL !== undefined && x + 12 < clipL){
    drawCardTextLeftClipped(gr, x, y, w, title, sub, isArtist, hov, isArtist ? cs : tw, isArtist ? cs : tw, x0, x1, y0, y1);
    return;
  }
  var tCol = hov ? COL.green : COL.text, sCol = hov ? COL.text : COL.text2;
  tCard(gr, title, FONT.card, tCol, x + 12, y + cs + 18, isArtist ? cs : tw, 20, isArtist, clipL, clipR, clipT, clipB);
  tCard(gr, sub, FONT.plSub, sCol, x + 12, y + cs + 40, isArtist ? cs : tw, 16, isArtist, clipL, clipR, clipT, clipB);
}

function brDrawCard(gr, x, y, w, coverId, seed, title, sub, isArtist, kind, id, obj, plDots, clipL, clipR, clipT, clipB){
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
  var cached = hov ? null : brCardImg(kind, id, w, coverId, seed, isArtist);

  if(cached){
    blitCard(gr, cached, x, y, x0, y0, x1, y1);
  } else if(!clipped){
    brPaintCardShell(gr, x, y, w, coverId, seed, isArtist, hov);
  } else {
    var im = null;
    try{
      im = dpiImage(w, h);
      var g = dpiGraphics(im.GetGraphics());
      g.SetSmoothingMode(2);
      g.FillSolidRect(0, 0, w, h, COL.base);
      brPaintCardShell(g, 0, 0, w, coverId, seed, isArtist, hov);
      releaseDpiGraphics(im, g);
      blitCard(gr, im, x, y, x0, y0, x1, y1);
    }catch(e){}
    if(im){ try{ im.Dispose(); }catch(e2){} }
  }

  brPaintCardText(gr, x, y, w, title, sub, isArtist, hov, plDots, x0, x1, y0, y1, clipL, clipR, clipT, clipB);
  if(drawDots){
    var absDx = x + dxLocal, absDy = y + dyLocal;
    if(hv(absDx, absDy, absDx + 24, absDy + 24)) gr.FillEllipse(absDx, absDy, 24, 24, OV(IS_LIGHT ? 36 : 26));
    drawIcon(gr, 'more', COL.text, absDx, absDy, 24, 24, 18);
    HB_BR_PLDOTS.push({ x0: absDx - 2, y0: absDy - 2, x1: absDx + 26, y1: absDy + 26, plObj: obj, mx: absDx, my: absDy + 26 });
  }
  HB_BR_CARDS.push({ x0: x0, y0: y0, x1: x1, y1: y1, kind: kind, id: id, title: title, obj: obj });
}

function brDrawTrackRow(gr, r, lx, rx, ry, rh, rowsTop, cropY, rowNum, song, list, idx, sourceMeta, plId, origIdx, opts){
  if(!song) return;
  opts = opts || {};
  var vy0 = Math.max(ry, rowsTop), vy1 = Math.min(ry + rh, cropY);
  if(vy1 <= vy0) return;
  var showAlbum = opts.showAlbum && r.w >= 560;
  var showArtist = !showAlbum && opts.showArtist && r.w >= 560;
  var numW = opts.numW || (r.w < 460 ? 24 : 30), durW = r.w < 460 ? 46 : 58, actW = r.w < 460 ? 52 : 60, cgap = r.w < 460 ? 8 : 14;
  var rightCtrlX = rx - durW - actW;
  var secW = (showAlbum || showArtist) ? Math.round((rightCtrlX - lx - numW - cgap * 3) * (showArtist ? 0.28 : 0.34)) : 0;
  var titleX = lx + numW + cgap;
  var titleW = Math.max(60, rightCtrlX - titleX - (secW ? (secW + cgap) : 0) - cgap);
  var secX = titleX + titleW + cgap;

  var src = opts.src || brSrc();
  var isPlaying = !!(src && src.isTrackPlaying && src.isTrackPlaying(song));
  var isMenuRow = !!(ctxMenu && ctxMenu.kind === 'nv-track' && ctxMenu.info && ctxMenu.info.song && ctxMenu.info.song.id === song.id && ctxMenu.info.idx === idx);
  var isHover = hv(lx - 8, vy0, rx + 8, vy1) || isMenuRow;
  if(isHover) gr.FillRoundRect(lx - 8, ry, rx - lx + 16, rh, 4, 4, isMenuRow ? COL.rowActive : COL.rowHover);

  var titleCol = isPlaying ? COL.green : COL.text;
  if(isHover) drawIcon(gr, 'play', COL.text, lx, ry, numW, rh, 14);
  else tL(gr, String(rowNum), FONT.rowNum, isPlaying ? COL.green : COL.text2, lx, ry, numW, rh);

  var tx = titleX, tw = titleW;
  if(opts.showThumb !== false){
    var cs = 40, cy = ry + (rh - cs) / 2;
    coverDrawThumb(gr, titleX, cy, cs, 3, song.coverArt, song.album || song.title);
    tx += cs + 12; tw -= (cs + 12);
  }
  if(opts.singleLine){
    tL(gr, song.title, FONT.rowTitle, titleCol, tx, ry, tw, rh);
  } else {
    tL(gr, song.title, FONT.rowTitle, titleCol, tx, ry + 8, tw, 20);
    tL(gr, song.artist || song.albumArtist || '', FONT.rowArtist, COL.text2, tx, ry + 30, tw, 16);
  }
  if(showAlbum) tL(gr, song.album, FONT.rowCell, COL.text2, secX, ry, secW, rh);
  else if(showArtist) tL(gr, song.artist || song.albumArtist || '', FONT.rowCell, COL.text2, secX, ry, secW, rh);

  var canLoveSong = !!(src && sourceCanLove(src, 'song'));
  var starred = canLoveSong && src.isLoved('song', song.id, song);
  var stX = rightCtrlX + 2, stY = ry + Math.round((rh - 26) / 2);
  if(canLoveSong && (starred || isHover)){
    var stHov = hv(stX - 2, stY - 2, stX + 28, stY + 28);
    if(stHov) gr.FillEllipse(stX - 2, stY - 2, 28, 28, OV(IS_LIGHT ? 36 : 26));
    drawIcon(gr, starred ? 'heart' : 'heartO', starred ? COL.green : (stHov ? COL.text : COL.text2), stX, stY, 24, 24, 16);
    HB_BR_STAR.push({ x0: stX - 2, y0: Math.max(vy0, stY - 2), x1: stX + 28, y1: Math.min(vy1, stY + 28), song: song });
  }
  var rowInfo = { song: song, list: list, idx: idx, sourceMeta: sourceMeta, plId: plId || '', songIdx: origIdx !== undefined ? origIdx : -1 };
  if(isHover){
    var mdX = stX + 30, mdY = stY;
    if(hv(mdX - 2, mdY - 2, mdX + 28, mdY + 28)) gr.FillEllipse(mdX - 2, mdY - 2, 28, 28, OV(IS_LIGHT ? 36 : 26));
    drawIcon(gr, 'more', COL.text, mdX, mdY, 24, 24, 16);
    HB_BR_TRDOTS.push({
      x0: mdX - 2, y0: Math.max(vy0, mdY - 2), x1: mdX + 28, y1: Math.min(vy1, mdY + 28),
      mx: mdX - 120, my: mdY + 26,
      info: rowInfo
    });
  }
  tR(gr, song.duration > 0 ? fmtTime(song.duration) : '', FONT.rowCell, COL.text2, rx - durW, ry, durW, rh);
  HB_BR_TR.push({
    x0: lx - 8, y0: vy0, x1: rx + 8, y1: vy1,
    pgx0: lx, pgx1: lx + numW,
    info: rowInfo
  });
}

function brDrawTrackColsHeader(gr, r, lx, rx, listTop, colMode, opts){
  opts = opts || {};
  var colLx = lx + (opts.indent || 0);
  var numW = opts.numW || (r.w < 460 ? 24 : 30), durW = r.w < 460 ? 46 : 58, actW = r.w < 460 ? 52 : 60, cgap = r.w < 460 ? 8 : 14, rightCtrlX = rx - durW - actW;
  var showAlbum = (colMode === true || colMode === 'album') && r.w >= 560;
  var showArtist = (colMode === 'artist') && r.w >= 560;
  var secW = (showAlbum || showArtist) ? Math.round((rightCtrlX - colLx - numW - cgap * 3) * (showArtist ? 0.28 : 0.34)) : 0;
  var titleX = colLx + numW + cgap;
  var titleW = Math.max(60, rightCtrlX - titleX - (secW ? (secW + cgap) : 0) - cgap);
  var secX = titleX + titleW + cgap;
  tL(gr, T('col.num'), FONT.head, COL.text2, colLx, listTop, numW, 20);
  tL(gr, T('col.title'), FONT.head, COL.text2, titleX, listTop, titleW, 20);
  if(showAlbum) tL(gr, T('col.album'), FONT.head, COL.text2, secX, listTop, secW, 20);
  else if(showArtist) tL(gr, T('col.artist'), FONT.head, COL.text2, secX, listTop, secW, 20);
  drawIcon(gr, 'clock', COL.text2, rx - 16, listTop, 16, 20, 15);
  gr.DrawLine(lx, listTop + 26, rx, listTop + 26, 1, COL.line);
}

function brDrawGridCols(w, gap, minCardW){
  var baseW = (w < 380 && (!minCardW || minCardW >= 170)) ? 124 : (minCardW || 176);
  var cols = Math.max(2, Math.floor((w + gap) / (baseW + gap)));
  var cardW = Math.max(80, Math.floor((w - gap * (cols - 1)) / cols));
  return { cols: cols, cardW: cardW, cardH: cardW + 56 };
}

function brHeaderMetrics(r, baseHeadH){
  var headH = baseHeadH || M.headH, shortH = headH <= 140, compact = headH < 220;
  var ax = r.x + M.cpad, ay = r.y + (shortH ? 38 : (compact ? 48 : 54));
  var art = Math.min(M.artSz, Math.max(shortH ? 48 : 64, Math.floor(r.w * (shortH ? 0.16 : 0.22))));
  var rx0 = r.x + r.w - M.cpad, tx = ax + art + (shortH ? 14 : 24), tw = Math.max(40, rx0 - tx);
  var actH = shortH ? 30 : 38;
  var actY = shortH ? (r.y + headH - actH - 6) : (ay + (compact ? 84 : 138));
  return { headH: headH, shortH: shortH, compact: compact, ax: ax, ay: ay, art: art, rx0: rx0, tx: tx, tw: tw, actH: actH, actY: actY };
}

function brDrawPillRow(gr, x0, rx0, y, h, specs){
  var gap = 8, total = 0, i, widths = [];
  for(i = 0; i < specs.length; i++){
    var w = brActionPillW(gr, specs[i].label, specs[i].icon, specs[i].minW);
    widths.push(w); total += w + (i > 0 ? gap : 0);
  }
  var avail = Math.max(60, rx0 - x0);
  if(total > avail && specs.length > 0){
    var scale = Math.max(0.55, (avail - gap * (specs.length - 1)) / Math.max(1, total - gap * (specs.length - 1)));
    for(i = 0; i < widths.length; i++) widths[i] = Math.max(54, Math.floor(widths[i] * scale));
  }
  var cx = x0;
  for(i = 0; i < specs.length; i++){
    if(cx + 48 > rx0) break;
    var bw = Math.min(widths[i], rx0 - cx);
    brDrawActionPill(gr, cx, y, bw, h, specs[i].label, specs[i].icon, specs[i].primary, specs[i].act, specs[i].data);
    cx += bw + gap;
  }
  return cx;
}

function brDrawLoadingOrErr(gr, r, top, loading, err, retryAct){
  var cy = top + Math.round((r.y + r.h - top) * 0.42);
  if(err){
    tC(gr, err, FONT.sect, COL.danger, r.x + 24, cy - 20, r.w - 48, 28);
    var retryLbl = T('btn.retry'), rw = brActionPillW(gr, retryLbl, 'refresh', 120);
    brDrawActionPill(gr, r.x + Math.round((r.w - rw) / 2), cy + 18, rw, 38, retryLbl, 'refresh', false, retryAct);
    return true;
  }
  if(loading){
    drawViewSkeleton(gr, r);
    return true;
  }
  return false;
}
