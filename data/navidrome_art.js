/* verdant/data/navidrome_art.js -- disk-cached cover art pipeline & themed drawing for Navidrome
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

var nvArtCache = {}, nvArtOrder = [], nvArtPending = {}, nvArtQueue = [], nvArtWarmQueue = [];
var nvArtDownloads = {}, nvArtLoads = {}, nvArtInFlight = 0, NV_ART_CAP_INFLIGHT = 4, NV_ART_SZ = 400;
var nvThumbCache = {}, nvThumbOrder = [], nvMaskCache = {}, nvMaskOrder = [], nvHueCache = {};
var nvArtDirReady = false;

function nvArtDir(){
  var base = fb.ProfilePath + 'verdant-cache\\', dir = base + 'nav-art\\';
  if(!nvArtDirReady){
    try{
      if(!utils.IsDirectory(base)) utils.CreateFolder(base);
      if(!utils.IsDirectory(dir)) utils.CreateFolder(dir);
    }catch(e){}
    nvArtDirReady = true;
  }
  return dir;
}

function nvArtFilePath(coverId){
  var dig = '';
  try{ dig = utils.MD5(String(coverId)); }catch(e){ dig = String(hash(coverId)); }
  return nvArtDir() + dig + '_' + NV_ART_SZ + '.img';
}

function nvClearArtDerivCaches(){
  nvThumbCache = {}; nvThumbOrder = [];
  nvMaskCache = {}; nvMaskOrder = [];
}

function nvClearAllArt(){
  nvArtCache = {}; nvArtOrder = [];
  nvArtPending = {}; nvArtQueue = []; nvArtWarmQueue = [];
  nvHueCache = {};
  nvClearArtDerivCaches();
  if(typeof clearBrCardCache === 'function') clearBrCardCache();
}

function nvArtFinish(coverId, img){
  delete nvArtPending[coverId];
  capPut(nvArtCache, nvArtOrder, ART_CAP, coverId, img || null);
  nvArtInFlight = Math.max(0, nvArtInFlight - 1);
  nvArtPump();
  if(typeof fsMode==='boolean' && fsMode){
    if(NP && typeof nvCoverIdFromPath==='function' && nvCoverIdFromPath(NP.Path)===coverId){
      if(typeof fsBridgePushCover==='function') fsBridgePushCover();
      if(typeof fsBridgeIsShowing!=='function' || !fsBridgeIsShowing()) repaintAll();
    }
    return;
  }
  artWarmRepaint();
}

function nvArtStart(coverId){
  var c = nvConnection();
  if(!c){ nvArtFinish(coverId, null); return; }
  var path = nvArtFilePath(coverId), hasFile = false;
  try{ hasFile = utils.IsFile(path); }catch(e){ hasFile = false; }
  if(hasFile){
    nvArtStartLoad(coverId, path);
    return;
  }
  try{
    var url = nvBuildUrl(c, 'getCoverArt', { id: coverId, size: NV_ART_SZ }, 'VerdantNav');
    var timer = window.SetTimeout(function(){
      if(!nvArtDownloads[path]) return;
      delete nvArtDownloads[path];
      nvArtFinish(coverId, null);
    }, 15000);
    nvArtDownloads[path] = { id: coverId, timer: timer };
    utils.DownloadFileAsync(url, path);
  }catch(e){
    nvArtFinish(coverId, null);
  }
}

function nvArtStartLoad(coverId, path){
  try{
    var cookie = gdi.LoadImageAsync(0, path);
    if(!cookie){ nvArtFinish(coverId, null); return; }
    var timer = window.SetTimeout(function(){
      if(!nvArtLoads[cookie]) return;
      delete nvArtLoads[cookie];
      nvArtFinish(coverId, null);
    }, 8000);
    nvArtLoads[cookie] = { id: coverId, timer: timer };
  }catch(e){
    nvArtFinish(coverId, null);
  }
}

function nvOnDownloadDone(path, success){
  var job = nvArtDownloads[path];
  if(!job) return false;
  delete nvArtDownloads[path];
  try{ window.ClearTimeout(job.timer); }catch(e){}
  if(success){
    try{
      if(utils.IsFile(path)){ nvArtStartLoad(job.id, path); return true; }
    }catch(e){}
  }
  nvArtFinish(job.id, null);
  return true;
}

function nvOnLoadImageDone(cookie, image){
  var job = nvArtLoads[cookie];
  if(!job) return false;
  delete nvArtLoads[cookie];
  try{ window.ClearTimeout(job.timer); }catch(e){}
  var img = image || null;
  if(img && Math.max(img.Width, img.Height) > ART_MAXPX){
    var ratio = ART_MAXPX / Math.max(img.Width, img.Height);
    try{ img = img.Resize(Math.max(1, Math.round(img.Width * ratio)), Math.max(1, Math.round(img.Height * ratio)), ART_DOWNSCALE); }catch(e){}
  }
  nvArtFinish(job.id, img);
  return true;
}

function nvArtPump(){
  while(nvArtInFlight < NV_ART_CAP_INFLIGHT && nvArtQueue.length){
    var id = nvArtQueue.shift();
    nvArtInFlight++;
    nvArtStart(id);
  }
  if(nvArtInFlight === 0 && !nvArtQueue.length && nvArtWarmQueue.length){
    var wid = nvArtWarmQueue.shift();
    nvArtInFlight++;
    nvArtStart(wid);
  }
}

function nvRequestArt(coverId, warm){
  if(!coverId) return;
  if(Object.prototype.hasOwnProperty.call(nvArtCache, coverId)) return;
  var cur = nvArtPending[coverId];
  if(cur){
    if(!warm && cur === 'warm'){
      for(var i = 0; i < nvArtWarmQueue.length; i++){
        if(nvArtWarmQueue[i] === coverId){
          nvArtWarmQueue.splice(i, 1);
          nvArtPending[coverId] = 'demand';
          nvArtQueue.unshift(coverId);
          nvArtPump();
          break;
        }
      }
    }
    return;
  }
  nvArtPending[coverId] = warm ? 'warm' : 'demand';
  if(warm) nvArtWarmQueue.push(coverId);
  else nvArtQueue.unshift(coverId);
  nvArtPump();
}

function nvGetArt(coverId){
  if(!coverId) return null;
  if(Object.prototype.hasOwnProperty.call(nvArtCache, coverId)) return nvArtCache[coverId];
  nvRequestArt(coverId, false);
  return null;
}

function nvArtLoaded(coverId){
  return !coverId || Object.prototype.hasOwnProperty.call(nvArtCache, coverId);
}

function nvWarmCovers(items){
  if(!items || !items.length) return;
  for(var i = 0; i < items.length && i < 80; i++){
    var cid = items[i] && items[i].coverArt;
    if(cid) nvRequestArt(cid, true);
  }
}

function nvDrawThumb(gr, x, y, sz, rad, coverId, seed){
  var tk = coverId ? (coverId + '|' + sz) : '', img = null;
  if(tk){
    if(Object.prototype.hasOwnProperty.call(nvThumbCache, tk)) img = nvThumbCache[tk];
    else{
      var src = nvGetArt(coverId);
      if(nvArtLoaded(coverId)){
        if(src){ try{ var bs = Math.max(1, px(sz)); img = artResizeCoverBitmap(src, bs, bs); }catch(e){ img = null; } }
        capPut(nvThumbCache, nvThumbOrder, THUMB_CAP, tk, img);
      }
    }
  }
  if(img) gr.DrawImage(img, x, y, sz, sz, 0, 0, img.Width, img.Height, 0, 255);
  else if(rad > 0) gr.FillRoundRect(x, y, sz, sz, rad, rad, coverCol(seed || coverId || 'nv'));
  else gr.FillSolidRect(x, y, sz, sz, coverCol(seed || coverId || 'nv'));
}

function nvMaskedArt(coverId, size, rad, isCircle){
  if(!coverId) return null;
  var k = coverId + '|' + size + '|' + (isCircle ? 'c' : ('r' + rad));
  if(Object.prototype.hasOwnProperty.call(nvMaskCache, k)) return nvMaskCache[k];
  var src = nvGetArt(coverId);
  if(!nvArtLoaded(coverId)) return null;
  var res = null;
  if(src){ try{ res = artRenderMasked(src, size, rad, isCircle); }catch(e){ res = null; } }
  capPut(nvMaskCache, nvMaskOrder, CART_CAP, k, res);
  return res;
}

function nvDrawRounded(gr, x, y, size, rad, coverId, seed){
  var im = nvMaskedArt(coverId, size, rad, false);
  if(!drawBlitCentered(gr, im, x, y, size)) gr.FillRoundRect(x, y, size, size, rad, rad, coverCol(seed || coverId || 'nv'));
}

function nvDrawCircle(gr, x, y, size, coverId, seed){
  var im = nvMaskedArt(coverId, size, 0, true);
  if(!drawBlitCentered(gr, im, x, y, size)) gr.FillEllipse(x, y, size, size, coverCol(seed || coverId || 'nv'));
}

function nvArtHue(coverId, seed){
  if(!coverId) return coverCol(seed || 'nv');
  if(Object.prototype.hasOwnProperty.call(nvHueCache, coverId)) return nvHueCache[coverId];
  var src = nvGetArt(coverId);
  if(!nvArtLoaded(coverId)) return coverCol(seed || coverId);
  var col = coverCol(seed || coverId);
  if(src){ try{ var s = src.GetColourScheme(1); if(s && s.length) col = s[0]; }catch(e){} }
  nvHueCache[coverId] = col;
  return col;
}
