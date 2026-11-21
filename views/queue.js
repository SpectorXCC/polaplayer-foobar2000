/* verdant/views/queue.js -- right sidebar: queue and native JS lyrics tabs
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

var qMetaCache = {}, HB_QLY = [], HB_QLY_RETRY = null, HB_QLY_REF = null;
function qRowMeta(h){
  var p = h.Path, e = qMetaCache[p];
  if(!e) e = qMetaCache[p] = { t: TF.title.EvalWithMetadb(h), a: TF.artist.EvalWithMetadb(h) };
  return e;
}
function qRow(gr, r, x, qy, rh){
  var x0 = x - 8, y0 = qy - 6, x1 = r.x + r.w - 10, y1 = qy + rh - 6;
  if(hv(x0, y0, x1, y1)) gr.FillRoundRect(x0, y0, x1 - x0, y1 - y0, 6, 6, COL.rowHover);
  return { x0: x0, y0: y0, x1: x1, y1: y1 };
}

function qDrawArt(gr, x, y, cs, rad, h, seed, key){
  if(h && typeof coverIdForHandle === 'function'){
    var cid = coverIdForHandle(h);
    if(cid && coverHasBitmap(cid)){ coverDrawThumb(gr, x, y, cs, rad, cid, seed); return; }
    if(cid && !coverReady(cid)) coverRequest(cid, true);
  }
  drawCover(gr, x, y, cs, rad, h, seed, key);
}

function qEntry(gr, r, x, y, cs, dy, h, seed, key, title, artist, tcol){
  qDrawArt(gr, x, y, cs, 4, h, seed, key);
  var tx = x + cs + 12, tw = r.w - 36 - cs - 12;
  tL(gr, title, FONT.qName, tcol, tx, y + dy, tw, 18);
  tL(gr, artist, FONT.qArtist, COL.text2, tx, y + dy + 20, tw, 16);
}

function drawQueueLyrics(gr, r, x){
  HB_QLY = []; HB_QLY_RETRY = null; HB_QLY_REF = null;
  if(NP && NV.key !== nvTrackKey()) nvLoad();
  var tw = Math.max(80, r.w - 36);
  var hdrY = r.y + (r.h < 340 ? 48 : 62);
  if(!NP){
    tC(gr, T('queue.no_track'), FONT.sect, COL.text2, r.x + 16, r.y + Math.round(r.h / 2) - 18, r.w - 32, 24);
    tC(gr, T('queue.pick_track_lyrics'), FONT.qArtist, COL.text3, r.x + 16, r.y + Math.round(r.h / 2) + 12, r.w - 32, 20);
    return;
  }

  qDrawArt(gr, x, hdrY, 40, 4, NP, 'np');
  tL(gr, npTitleStr || T('meta.unknown'), FONT.qName, COL.text, x + 50, hdrY + 2, tw - 80, 18);
  tL(gr, npArtistStr || '', FONT.qArtist, COL.text2, x + 50, hdrY + 22, tw - 80, 16);
  var rx = x + tw - 26, ry = hdrY + 8;
  var refHot = hv(rx - 2, ry - 2, rx + 26, ry + 26);
  if(refHot) gr.FillEllipse(rx - 2, ry - 2, 28, 28, COL.rowHover);
  drawIcon(gr, 'refresh', refHot ? COL.text : COL.text2, rx, ry, 24, 24, 16);
  HB_QLY_REF = { x0: rx - 2, y0: ry - 2, x1: rx + 26, y1: ry + 26 };
  gr.DrawLine(x, hdrY + 50, x + tw, hdrY + 50, 1, COL.line);

  var top = hdrY + 60, bot = r.y + r.h - 14;
  if(bot <= top + 20) return;

  var m = activeLyricsModel();
  if(!m){
    var msg = NV.status === 'loading' ? T('lyrics.loading') : T('lyrics.none');
    tC(gr, msg, FONT.sect, COL.text2, x, top + Math.round((bot - top) * 0.42), tw, 28);
    if(NV.status !== 'loading'){
      var retryLbl = T('lyrics.retry');
      var pw = Math.max(112, Math.round(gr.CalcTextWidth(retryLbl, FONT.pl)) + 36), ph = 32;
      var px = x + Math.round((tw - pw) / 2), py = top + Math.round((bot - top) * 0.42) + 40;
      var retryHot = hv(px, py, px + pw, py + ph);
      gr.FillRoundRect(px, py, pw, ph, ph / 2, ph / 2, retryHot ? COL.pillHot : COL.pill);
      if(typeof strokeRound === 'function') strokeRound(gr, px, py, pw, ph, ph / 2, 1, retryHot ? COL.text2 : COL.line);
      tC(gr, retryLbl, FONT.pl, COL.text, px, py, pw, ph);
      HB_QLY_RETRY = { x0: px, y0: py, x1: px + pw, y1: py + ph };
    }
    return;
  }

  var qFont = FONT.qLyric || FONT.sect;
  if(m.synced) drawRollingLyrics(gr, x, top, tw, bot, qFont, COL.green, 'l', m, HB_QLY);
  else drawStaticLyrics(gr, x, tw, top, bot, FONT.qLyricStatic || FONT.meta, 0.55, m, 'l');
}

function drawQueue(gr){
  HB_TABS = []; HB_Q = []; HB_QLY = []; HB_QLY_RETRY = null; HB_QLY_REF = null;
  var r = R.queue; panelBg(gr, r, COL.base);
  var x = r.x + 18;
  var qOn = rightTab === 'queue';
  var qLbl = T('tab.queue'), lLbl = T('tab.lyrics');
  var qw = Math.max(40, Math.ceil(gr.CalcTextWidth(qLbl, FONT.tab)));
  var lw = Math.max(40, Math.ceil(gr.CalcTextWidth(lLbl, FONT.tab)));
  var lx = x + Math.max(82, qw + 24);
  var qTab = { x0: x - 6, y0: r.y + 8, x1: Math.max(x + 72, x + qw + 12), y1: r.y + 48, tab: 'queue' };
  var lTab = { x0: lx - 6, y0: r.y + 8, x1: Math.max(lx + 70, lx + lw + 12), y1: r.y + 48, tab: 'lyrics' };
  var qHov = !qOn && hv(qTab.x0, qTab.y0, qTab.x1, qTab.y1);
  var lHov = qOn && hv(lTab.x0, lTab.y0, lTab.x1, lTab.y1);
  if(qHov) gr.FillRoundRect(qTab.x0, r.y + 10, qTab.x1 - qTab.x0, 34, 6, 6, COL.rowHover);
  if(lHov) gr.FillRoundRect(lTab.x0, r.y + 10, lTab.x1 - lTab.x0, 34, 6, 6, COL.rowHover);
  tL(gr, qLbl, FONT.tab, (qOn || qHov) ? COL.text : COL.text2, x, r.y + 16, qw + 16, 26);
  tL(gr, lLbl, FONT.tab, (!qOn || lHov) ? COL.text : COL.text2, lx, r.y + 16, lw + 16, 26);
  gr.FillSolidRect(qOn ? x : lx, r.y + 46, qOn ? qw : lw, 3, COL.green);
  HB_TABS.push(qTab);
  HB_TABS.push(lTab);

  if(!qOn){ drawQueueLyrics(gr, r, x); return; }

  var shortQ = r.h < 340;
  var qy = r.y + (shortQ ? 52 : 70);
  if(!shortQ){ tL(gr, T('queue.now_playing'), FONT.sect, COL.text, x, qy, r.w - 36, 24); qy += 36; }
  qEntry(gr, r, x, qy, shortQ ? 40 : 48, shortQ ? 3 : 6, NP, 'np', undefined, npTitleStr || T('queue.nothing_playing'), npArtistStr, (fb.IsPlaying || fb.IsPaused) ? COL.green : COL.text);
  qy += shortQ ? 52 : 70;

  var rh = 56, bottom = r.y + r.h - 8, shown = 0, qi;
  var mq = null; try{ mq = plman.GetPlaybackQueueHandles(); }catch(e){ mq = null; }
  if(mq && mq.Count){
    tL(gr, T('queue.next_in_queue'), FONT.sect, COL.text, x, qy, r.w - 110, 24); qy += 36;
    for(qi = 0; qi < mq.Count && shown < 18; qi++){
      if(qy + rh > bottom) break;
      var qh = mq[qi]; if(!qh) continue;
      var qhb = qRow(gr, r, x, qy, rh); qhb.q = qi; HB_Q.push(qhb);
      var qm = qRowMeta(qh);
      qEntry(gr, r, x, qy, 44, 5, qh, 'mq' + qi, undefined, qm.t, qm.a, COL.text);
      qy += rh; shown++;
    }
    qy += 10;
  }
  if(pbRepeat === 2){
    if(NP && qy + rh + 30 < bottom){
      tL(gr, T('queue.repeating_song'), FONT.sect, COL.text, x, qy, r.w - 36, 24); qy += 36;
      qEntry(gr, r, x, qy, 44, 5, NP, 'np', undefined, npTitleStr, npArtistStr, COL.green);
    }
    return;
  }
  var loc = playingLoc();
  var pli = (loc && loc.IsValid) ? loc.PlaylistIndex : plman.ActivePlaylist;
  var start = (loc && loc.IsValid) ? loc.PlaylistItemIndex + 1 : 0;
  var rawnm = (pli >= 0) ? plName(pli) : '';
  var pnm = (pbSource && pbSource.name) ? pbSource.name
          : ((rawnm === SHUF) ? shufSrcName : (rawnm === ROUTE ? (routeSrcName || '') : rawnm));
  if(qy + 30 < bottom){
    tL(gr, pnm ? T('queue.next_from', pnm) : T('queue.next_up'), FONT.sect, COL.text, x, qy, r.w - 110, 24); qy += 36;
    if(pli >= 0 && !ensureBuilt('meta' + pli, function(){ return metaReady(pli); }, function(){ return metaSteps(pli); })){
      if(skelVisible('meta' + pli)) skelRows(gr, x, qy, r.w - 36, Math.min(bottom - qy, rh * 4), rh);
    } else if(pli >= 0){
      var items = getItems(pli), qmeta = getMeta(pli), cnt = plCount(pli);
      for(var k = start; k < cnt && shown < 20; k++){
        if(qy + rh > bottom) break;
        var h = items[k]; if(!h) continue;
        var nhb = qRow(gr, r, x, qy, rh); nhb.pl = pli; nhb.item = k; HB_Q.push(nhb);
        qEntry(gr, r, x, qy, 44, 5, h, qmeta.album[k] || String(k), qmeta.artkey[k], qmeta.title[k], qmeta.artist[k], COL.text);
        qy += rh; shown++;
      }
      if(shown === 0) tL(gr, T('queue.end_of_playlist'), FONT.qArtist, COL.text3, x, qy, r.w - 36, 18);
    }
  }
}
