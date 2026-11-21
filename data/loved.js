/* verdant/data/loved.js -- Local track Loved status via configurable file tags (default LOVED=1)
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

var lovedSet = {};
var lovedBuilt = false;
var lovedVersion = 0;
var lovedSelfWrite = {};
var lovedSelfByPath = {};
var lovedPrompt = null;
var LOVED_HB = null;
var lovedToast = '';
var lovedToastTimer = null;
var _lovedConfirmed = null;

function lovedTrackId(h){
  if(!h) return '';
  var p = String(h.Path || '');
  var ss = h.SubSong || 0;
  return ss ? (p + '#' + ss) : p;
}

function isLovedValue(v){
  v = String(v || '').trim();
  if(!v || v === '?') return false;
  if(typeof LOVED_MATCH === 'string' && LOVED_MATCH){
    return v.toLowerCase() === LOVED_MATCH.toLowerCase();
  }
  return v !== '0' && v.toLowerCase() !== 'false';
}

function lovedIsWritableHandle(h){
  if(!h || !h.Path) return false;
  var p = String(h.Path);
  if(p.indexOf('navidrome://') === 0) return false;
  if(/^https?:\/\//i.test(p) || p.indexOf('cdda://') === 0) return false;
  return true;
}

function lovedWriteConfirmed(){
  if(_lovedConfirmed !== null) return _lovedConfirmed;
  try{
    _lovedConfirmed = Number(window.GetProperty(LOVED_CONFIRMED_PROP, 0)) > 0;
  }catch(e){
    _lovedConfirmed = false;
  }
  return _lovedConfirmed;
}

function lovedEnsureScanned(){
  if(lovedBuilt) return;
  var map = {};
  var lib = (typeof libItems === 'function') ? libItems() : null;
  if(lib && lib.Count){
    var vals = libTF('loved');
    for(var i = 0; i < lib.Count; i++){
      if(isLovedValue(vals[i])) map[lovedTrackId(lib[i])] = true;
    }
  }
  for(var id in lovedSelfWrite){
    if(Object.prototype.hasOwnProperty.call(lovedSelfWrite, id)){
      var ent = lovedSelfWrite[id];
      if(!ent.settled){
        if(ent.next) map[id] = true;
        else delete map[id];
      }
    }
  }
  lovedSet = map;
  lovedBuilt = true;
  lovedVersion++;
}

function lovedInvalidate(){
  lovedBuilt = false;
  lovedVersion++;
}

function lovedIsHandleLoved(h){
  if(!h) return false;
  var id = lovedTrackId(h);
  if(!id) return false;
  if(Object.prototype.hasOwnProperty.call(lovedSelfWrite, id) && !lovedSelfWrite[id].settled){
    return !!lovedSelfWrite[id].next;
  }
  if(lovedBuilt) return !!lovedSet[id];
  try{
    return isLovedValue(TF.loved.EvalWithMetadb(h));
  }catch(e){
    return false;
  }
}

function lovedIsIdLoved(id, h){
  if(!id) return false;
  if(Object.prototype.hasOwnProperty.call(lovedSelfWrite, id) && !lovedSelfWrite[id].settled){
    return !!lovedSelfWrite[id].next;
  }
  if(lovedBuilt) return !!lovedSet[id];
  return h ? lovedIsHandleLoved(h) : false;
}

function lovedShowToast(msg){
  lovedToast = String(msg || '');
  if(lovedToastTimer){
    window.ClearTimeout(lovedToastTimer);
    lovedToastTimer = null;
  }
  if(lovedToast){
    lovedToastTimer = window.SetTimeout(function(){
      lovedToastTimer = null;
      lovedToast = '';
      repaintAll();
    }, 3800);
  }
  repaintAll();
}

function lovedSetEntryTimerCleared(entry){
  if(entry && entry.timer){
    window.ClearTimeout(entry.timer);
    entry.timer = null;
  }
}

function lovedCommitToggle(h, cb){
  if(!h || !lovedIsWritableHandle(h)){
    lovedShowToast(T('err.loved_write_failed', LOVED_FIELD));
    if(cb) cb(false);
    return;
  }
  lovedEnsureScanned();
  var id = lovedTrackId(h);
  var pKey = String(h.Path || '');
  var prev = lovedIsHandleLoved(h);
  var next = !prev;

  if(lovedSelfWrite[id]) lovedSetEntryTimerCleared(lovedSelfWrite[id]);
  if(next) lovedSet[id] = true; else delete lovedSet[id];
  lovedVersion++;

  var entry = {
    id: id,
    path: pKey,
    prev: prev,
    next: next,
    t: Date.now(),
    h: h,
    cb: cb,
    settled: false,
    timer: null
  };
  lovedSelfWrite[id] = entry;
  lovedSelfByPath[pKey] = entry;

  var writeErr = false;
  var hl = null;
  try{
    hl = fb.CreateHandleList();
    hl.Add(h);
    var payload = {};
    payload[LOVED_FIELD] = next ? (LOVED_MATCH || '1') : '';
    hl.UpdateFileInfoFromJSON(JSON.stringify(payload));
  }catch(e){
    writeErr = true;
  }
  if(hl && typeof hl.Dispose === 'function'){
    try{ hl.Dispose(); }catch(e2){}
  }

  if(writeErr){
    delete lovedSelfWrite[id];
    if(lovedSelfByPath[pKey] === entry) delete lovedSelfByPath[pKey];
    if(prev) lovedSet[id] = true; else delete lovedSet[id];
    lovedVersion++;
    lovedShowToast(T('err.loved_write_failed', LOVED_FIELD));
    if(cb) cb(false);
    return;
  }

  entry.timer = window.SetTimeout(function(){
    entry.timer = null;
    if(entry.settled) return;
    entry.settled = true;
    delete lovedSelfWrite[id];
    if(lovedSelfByPath[pKey] === entry) delete lovedSelfByPath[pKey];
    var actual = prev;
    try{ actual = isLovedValue(TF.loved.EvalWithMetadb(h)); }catch(e3){ actual = prev; }
    if(actual !== next){
      if(actual) lovedSet[id] = true; else delete lovedSet[id];
      lovedVersion++;
      lovedShowToast(T('err.loved_write_failed', LOVED_FIELD));
      if(cb) cb(false);
    } else {
      repaintAll();
      if(cb) cb(true);
    }
  }, 1500);

  repaintAll();
}

function lovedToggleLocal(hOrObj, cb){
  var h = (hOrObj && hOrObj.Path) ? hOrObj : (hOrObj && hOrObj.h ? hOrObj.h : null);
  if(!h || !lovedIsWritableHandle(h)){
    lovedShowToast(T('err.loved_write_failed', LOVED_FIELD));
    if(cb) cb(false);
    return;
  }
  if(!LOVED_WRITE){
    lovedShowToast(T('err.loved_write_disabled'));
    if(cb) cb(false);
    return;
  }
  if(!lovedWriteConfirmed()){
    lovedPrompt = { h: h, cb: cb };
    repaintAll();
    return;
  }
  lovedCommitToggle(h, cb);
}

function lovedConfirmWrite(){
  var p = lovedPrompt;
  lovedPrompt = null;
  _lovedConfirmed = true;
  try{ window.SetProperty(LOVED_CONFIRMED_PROP, 1); }catch(e){}
  repaintAll();
  if(p && p.h) lovedCommitToggle(p.h, p.cb);
}

function lovedCancelWrite(){
  var p = lovedPrompt;
  lovedPrompt = null;
  repaintAll();
  if(p && p.cb) p.cb(false);
}

function lovedOnMetadbChanged(handles){
  if(!handles || !handles.Count) return false;
  var now = Date.now();
  var matched = 0;
  var n = handles.Count;
  var i, h, id, pKey, ent;
  for(i = 0; i < n; i++){
    h = handles[i];
    if(!h) continue;
    id = lovedTrackId(h);
    pKey = String(h.Path || '');
    ent = lovedSelfWrite[id] || lovedSelfByPath[pKey] || null;
    if(!ent || (now - ent.t) > 3000) continue;
    matched++;
    lovedSetEntryTimerCleared(ent);
    ent.settled = true;
    delete lovedSelfWrite[ent.id];
    if(lovedSelfByPath[ent.path] === ent) delete lovedSelfByPath[ent.path];

    var actual = ent.next;
    try{ actual = isLovedValue(TF.loved.EvalWithMetadb(h)); }catch(e){ actual = ent.prev; }
    if(actual) lovedSet[ent.id] = true; else delete lovedSet[ent.id];
    lovedVersion++;

    if(actual !== ent.next){
      lovedShowToast(T('err.loved_write_failed', LOVED_FIELD));
      if(ent.cb) ent.cb(false);
    } else if(ent.cb){
      ent.cb(true);
    }
  }
  return matched > 0 && matched === n;
}

function drawLovedPrompt(gr){
  var cw = Math.min(470, W - 40), pw = cw - 56, lh = 24;
  var body = T('dlg.loved_write_body', LOVED_FIELD);
  var nl = Math.max(1, gr.EstimateLineWrap(body, FONT.pl, pw).length / 2);
  var ch = 104 + nl * lh + PILL_H;
  var cy = Math.max(10, Math.round((H - ch) / 2)), cx = modalPanel(gr, cw, ch, cy);
  var px0 = cx + 28, y = cy + 26;
  tL(gr, T('dlg.loved_write_title', LOVED_FIELD), FONT.sect, COL.text, px0, y, pw, 26); y += 36;
  tPara(gr, body, FONT.pl, COL.text2, px0, y, pw, lh);
  var allowLbl = T('btn.write_tags'), cancelLbl = T('btn.cancel');
  var w2 = pillW(gr, allowLbl), w1 = pillW(gr, cancelLbl), gap = 12;
  var by = cy + ch - 22 - PILL_H, x2 = cx + cw - 28 - w2, x1 = x2 - gap - w1;
  LOVED_HB = {
    cancel: drawPill(gr, x1, by, w1, cancelLbl, false),
    confirm: drawPill(gr, x2, by, w2, allowLbl, true)
  };
}
