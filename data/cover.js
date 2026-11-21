/* verdant/data/cover.js -- unified cover protocol across local handles, mosaics, and remote IDs
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

var coverHandles = {};

function registerCoverHandle(key, h){
  if(key && h && !coverHandles[key]) coverHandles[key] = h;
}

function clearCoverHandles(){
  coverHandles = {};
}

function nvCoverIdFromPath(path){
  var m = /[?&]coverArt=([^&]+)/i.exec(String(path || ''));
  if(!m) return '';
  try{ return decodeURIComponent(m[1]); }catch(e){ return m[1]; }
}

function coverKind(cover){
  var s = String(cover || '');
  if(s.indexOf('local:') === 0) return 'h';
  if(s.indexOf('localar:') === 0) return 'ar';
  if(s.indexOf('localpl:') === 0 || s === 'locallib') return 'mosaic';
  return 'nv';
}

function coverHandle(cover){
  var k = coverKind(cover);
  if(k === 'h'){
    var key = String(cover || '').slice(6);
    if(key && coverHandles[key]) return coverHandles[key];
    if(typeof localHandleForAlbumKey === 'function') return localHandleForAlbumKey(key);
    return null;
  }
  if(k === 'ar'){
    var name = String(cover || '').slice(8);
    return (name && typeof artistCover === 'function') ? artistCover(name) : null;
  }
  return null;
}

function coverIdForHandle(h){
  if(!h) return '';
  return nvCoverIdFromPath(h.Path);
}

function coverPlaylistIdx(cover){
  var pi = parseInt(String(cover || '').slice(8), 10);
  if(isNaN(pi) || pi < 0 || typeof plman !== 'object' || pi >= plman.PlaylistCount) return -1;
  return pi;
}

function coverReady(cover){
  if(!cover) return true;
  var k = coverKind(cover);
  if(k === 'nv') return (typeof nvArtLoaded === 'function') ? nvArtLoaded(cover) : true;
  if(k === 'h'){
    var h = coverHandle(cover);
    return !h || (typeof artLoaded === 'function' ? artLoaded(albKey(h)) : true);
  }
  if(k === 'ar'){
    var nm = String(cover).slice(8);
    if(typeof artistCoverReady === 'function' && !artistCoverReady(nm)) return false;
    var ah = (typeof artistCover === 'function') ? artistCover(nm) : null;
    return !ah || (typeof artLoaded === 'function' ? artLoaded(albKey(ah)) : true);
  }
  if(k === 'mosaic'){
    var i;
    if(cover === 'locallib'){
      if(typeof libChoice !== 'function') return true;
      var lc = libChoice();
      if(lc.wait) return false;
      for(i = 0; i < lc.list.length; i++){
        if(lc.list[i] && typeof artLoaded === 'function' && !artLoaded(albKey(lc.list[i]))) return false;
      }
      return !lc.single || (typeof artLoaded === 'function' ? artLoaded(albKey(lc.single)) : true);
    }
    var pi = coverPlaylistIdx(cover);
    if(pi < 0 || typeof plCoverReady !== 'function') return true;
    return plCoverReady(pi);
  }
  return true;
}

function coverHasBitmap(cover){
  if(!cover) return false;
  var k = coverKind(cover);
  if(k === 'nv' && typeof nvArtCache === 'object') return !!nvArtCache[cover];
  if(k === 'h'){
    var h = coverHandle(cover);
    return !!(h && typeof artCache === 'object' && artCache[albKey(h)]);
  }
  if(k === 'ar'){
    var nm = String(cover).slice(8);
    var ah = (typeof artistCover === 'function') ? artistCover(nm) : null;
    return !!(ah && typeof artCache === 'object' && artCache[albKey(ah)]);
  }
  if(k === 'mosaic'){
    var c = null, i;
    if(cover === 'locallib'){
      if(typeof libChoice !== 'function') return false;
      c = libChoice();
    } else {
      var pi = coverPlaylistIdx(cover);
      if(pi < 0 || typeof plChoice !== 'function') return false;
      c = plChoice(pi);
    }
    if(c.list && c.list.length >= 4){
      for(i = 0; i < 4; i++){
        if(c.list[i] && typeof artCache === 'object' && artCache[albKey(c.list[i])]) return true;
      }
      return false;
    }
    return !!(c.single && typeof artCache === 'object' && artCache[albKey(c.single)]);
  }
  return false;
}

function coverRequest(cover, warm){
  if(!cover) return;
  var k = coverKind(cover);
  if(k === 'nv'){
    if(typeof nvRequestArt === 'function') nvRequestArt(cover, warm);
    return;
  }
  if(k === 'h'){
    var h = coverHandle(cover);
    if(h && typeof requestArt === 'function') requestArt(h, albKey(h), warm ? true : 'demand');
    return;
  }
  if(k === 'ar'){
    var nm = String(cover).slice(8);
    if(warm){
      var fh = (typeof artistFirst === 'function') ? artistFirst(nm) : null;
      if(fh && typeof requestArt === 'function') requestArt(fh, albKey(fh), true);
    } else if(typeof artistCover === 'function'){
      artistCover(nm);
    }
    return;
  }
  if(k === 'mosaic'){
    if(cover === 'locallib'){
      if(warm){
        var lc = (typeof libCovers === 'function') ? libCovers() : null;
        if(lc && lc.single && typeof requestArt === 'function') requestArt(lc.single, albKey(lc.single), true);
      } else if(typeof libChoice === 'function'){
        libChoice();
      }
      return;
    }
    var pi = coverPlaylistIdx(cover);
    if(pi < 0) return;
    if(warm){
      var pc = (typeof plCovers === 'function') ? plCovers(pi) : null;
      if(pc && pc.single && typeof requestArt === 'function') requestArt(pc.single, albKey(pc.single), true);
    } else if(typeof plChoice === 'function'){
      plChoice(pi);
    }
  }
}

function coverDrawThumb(gr, x, y, sz, rad, cover, seed){
  var k = coverKind(cover);
  if(k === 'nv' && typeof nvDrawThumb === 'function'){ nvDrawThumb(gr, x, y, sz, rad, cover, seed); return; }
  if(k === 'h'){
    var h = coverHandle(cover);
    if(typeof drawCover === 'function'){ drawCover(gr, x, y, sz, rad, h, seed, h ? albKey(h) : String(cover || '').slice(6)); return; }
  }
  if(k === 'ar'){
    var ah = coverHandle(cover);
    if(typeof drawCover === 'function'){ drawCover(gr, x, y, sz, rad, ah, seed); return; }
  }
  if(k === 'mosaic'){
    if(cover === 'locallib' && typeof drawLibCover === 'function'){ drawLibCover(gr, x, y, sz, rad); return; }
    var pi = coverPlaylistIdx(cover);
    if(pi >= 0 && typeof drawPlCover === 'function'){ drawPlCover(gr, x, y, sz, rad, pi, seed); return; }
  }
  if(rad > 0) gr.FillRoundRect(x, y, sz, sz, rad, rad, coverCol(seed || cover || ''));
  else gr.FillSolidRect(x, y, sz, sz, coverCol(seed || cover || ''));
}

function coverDrawRounded(gr, x, y, size, rad, cover, seed){
  var k = coverKind(cover);
  if(k === 'nv' && typeof nvDrawRounded === 'function'){ nvDrawRounded(gr, x, y, size, rad, cover, seed); return; }
  if((k === 'h' || k === 'ar') && typeof drawRounded === 'function'){
    drawRounded(gr, x, y, size, rad, coverHandle(cover), seed);
    return;
  }
  if(k === 'mosaic'){
    if(cover === 'locallib' && typeof drawLibCover === 'function'){ drawLibCover(gr, x, y, size, rad); return; }
    var pi = coverPlaylistIdx(cover);
    if(pi >= 0 && typeof drawPlCover === 'function'){ drawPlCover(gr, x, y, size, rad, pi, seed); return; }
  }
  gr.FillRoundRect(x, y, size, size, rad, rad, coverCol(seed || cover || ''));
}

function coverDrawCircle(gr, x, y, size, cover, seed){
  var k = coverKind(cover);
  if(k === 'nv' && typeof nvDrawCircle === 'function'){ nvDrawCircle(gr, x, y, size, cover, seed); return; }
  if(k === 'h' || k === 'ar'){
    var h = coverHandle(cover);
    if(typeof maskedArt === 'function' && typeof drawBlitCentered === 'function'){
      var ci = maskedArt(h, seed, size, 0, true);
      if(drawBlitCentered(gr, ci, x, y, size)) return;
    }
  }
  gr.FillEllipse(x, y, size, size, coverCol(seed || cover || ''));
}

function coverHue(cover, seed){
  var k = coverKind(cover);
  if(k === 'nv' && typeof nvArtHue === 'function') return nvArtHue(cover, seed);
  if((k === 'h' || k === 'ar') && typeof artHue === 'function') return artHue(coverHandle(cover), seed);
  if(k === 'mosaic' && typeof artHue === 'function'){
    if(cover === 'locallib' && typeof libChoice === 'function') return artHue(libChoice().single, seed || '__lib__');
    var pi = coverPlaylistIdx(cover);
    if(pi >= 0 && typeof plChoice === 'function') return artHue(plChoice(pi).single, seed);
  }
  return coverCol(seed || cover || '');
}

function coverWarm(items){
  if(!items) return;
  var isRows = (typeof items.count === 'number' && typeof items.get === 'function');
  var len = isRows ? items.count : (items.length || 0);
  if(!len) return;
  for(var i = 0; i < len && i < 80; i++){
    var item = isRows ? items.get(i) : items[i];
    var cid = item && item.coverArt;
    if(cid) coverRequest(cid, true);
  }
}

function coverClearAll(){
  if(typeof nvClearAllArt === 'function') nvClearAllArt();
  clearCoverHandles();
}
