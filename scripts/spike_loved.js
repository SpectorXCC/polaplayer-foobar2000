'use strict';

/* ============================================================================
   Verdant Phase 1 Spike -- Real-host verification for LOVED file tag updates
   Temporary JSplitter panel script (NOT included in production main.js).

   Purpose:
   1. Verify UpdateFileInfoFromJSON availability & return semantics on
      IFbMetadbHandleList vs IFbMetadbHandle.
   2. Verify writing {"LOVED":"1"} and reading back via TitleFormat & GetFileInfo.
   3. Verify tag deletion semantics ("" vs [] vs null).
   4. Record on_metadb_changed(handle_list, fromhook) invocation count & fromhook.
   5. Test edge/failure handles (read-only file, CUE subsong, navidrome://).
   6. Probe %added%, %last_modified%, %play_count%, %last_played%, %LOVED%, %MOOD%.

   Results are rendered on screen and saved automatically to:
   <foobar ProfilePath>\verdant-cache\spike_loved_result.txt
   ============================================================================ */

window.DefineScript('Verdant Loved Tag Spike', { author: 'superziper', version: '0.1.0', features: { grab_focus: true } });

var W = window.Width || 1000, H = window.Height || 700;
var mx = -1, my = -1;
var scale = Math.max(1, (window.DPI || 96) / 96);
function sc(v) { return Math.round(v * scale); }

var F_TITLE = gdi.Font('Microsoft YaHei UI', sc(16), 1);
var F_UI = gdi.Font('Microsoft YaHei UI', sc(12), 0);
var F_BOLD = gdi.Font('Microsoft YaHei UI', sc(12), 1);
var F_MONO = gdi.Font('Consolas', sc(11), 0);

var DT_L = 0x4 | 0x20 | 0x800 | 0x8000;
var DT_C = 0x1 | 0x4 | 0x20 | 0x800 | 0x8000;
var DT_R = 0x2 | 0x4 | 0x20 | 0x800;

function RGB(r, g, b) { return (0xff000000 | (r << 16) | (g << 8) | b); }
var C_BG = RGB(20, 22, 26), C_CARD = RGB(30, 33, 39), C_BTN = RGB(48, 53, 63), C_BTN_HOT = RGB(66, 73, 86);
var C_GREEN = RGB(30, 215, 96), C_GREEN_HOT = RGB(46, 228, 110), C_RED = RGB(214, 72, 72), C_RED_HOT = RGB(232, 92, 92);
var C_TXT = RGB(240, 242, 245), C_DIM = RGB(160, 166, 176), C_LINE = RGB(52, 56, 66);

var TF_LOVED = fb.TitleFormat('[%LOVED%]');
var TF_MOOD = fb.TitleFormat('[%MOOD%]');
var TF_TITLE = fb.TitleFormat('[%title%]');
var TF_ARTIST = fb.TitleFormat('[%artist%]');
var TF_ADDED = fb.TitleFormat('[%added%]');
var TF_LASTMOD = fb.TitleFormat('[%last_modified%]');
var TF_PLAYCOUNT = fb.TitleFormat('[%play_count%]');
var TF_LASTPLAYED = fb.TitleFormat('[%last_played%]');
var TF_RATING = fb.TitleFormat('[%rating%]');

var logs = [];
var logScroll = 0, trackScroll = 0;
var busy = false;
var activeWatch = null;
var pendingTimers = [];
var hitBoxes = [];
var visiblePls = [];
var selPl = -1;
var selPlItems = null;
var selIdx = -1;
var targetHandle = null;

function nowIso() {
  var d = new Date();
  function p(n, w) { var s = String(n); while (s.length < (w || 2)) s = '0' + s; return s; }
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
}

function outFilePath() {
  var base = fb.ProfilePath + 'verdant-cache\\';
  try { if (!utils.IsDirectory(base)) utils.CreateFolder(base); } catch (e) {}
  return base + 'spike_loved_result.txt';
}

function saveReport() {
  try {
    utils.WriteTextFile(outFilePath(), logs.join('\r\n') + '\r\n');
  } catch (e) {}
}

function log(msg) {
  var lines = String(msg).split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    logs.push('[' + nowIso() + '] ' + lines[i]);
  }
  if (logs.length > 500) logs.splice(0, logs.length - 500);
  try { console.log('[SpikeLoved] ' + msg); } catch (e) {}
  logScroll = Math.max(0, logs.length - 1);
  saveReport();
  window.Repaint();
}

function setTimer(fn, ms) {
  var id = window.SetTimeout(function () {
    for (var i = 0; i < pendingTimers.length; i++) {
      if (pendingTimers[i] === id) { pendingTimers.splice(i, 1); break; }
    }
    fn();
  }, ms);
  pendingTimers.push(id);
  return id;
}

function clearAllTimers() {
  for (var i = 0; i < pendingTimers.length; i++) {
    try { window.ClearTimeout(pendingTimers[i]); } catch (e) {}
  }
  pendingTimers = [];
}

function refreshPlaylists() {
  visiblePls = [];
  var cnt = plman.PlaylistCount;
  for (var i = 0; i < cnt; i++) {
    var nm = plman.GetPlaylistName(i);
    if (nm === '__verdant_np__' || nm === '__verdant_shuffle__') continue;
    visiblePls.push({ idx: i, name: nm, count: plman.PlaylistItemCount(i) });
  }
  var found = false;
  for (var j = 0; j < visiblePls.length; j++) {
    if (visiblePls[j].idx === selPl) { found = true; break; }
  }
  if (!found) {
    var ap = plman.ActivePlaylist;
    selPl = visiblePls.length ? visiblePls[0].idx : -1;
    for (var k = 0; k < visiblePls.length; k++) {
      if (visiblePls[k].idx === ap) { selPl = ap; break; }
    }
  }
  loadSelectedPlaylist();
}

function loadSelectedPlaylist() {
  try {
    selPlItems = (selPl >= 0) ? plman.GetPlaylistItems(selPl) : null;
  } catch (e) { selPlItems = null; }
  var total = selPlItems ? selPlItems.Count : 0;
  if (selIdx < 0 || selIdx >= total) selIdx = total > 0 ? 0 : -1;
  if (!targetHandle && total > 0 && selIdx >= 0) targetHandle = selPlItems[selIdx];
}

function initTargetFromFoobar() {
  var foc = null;
  try { foc = fb.GetFocusItem(); } catch (e) { foc = null; }
  if (!foc) { try { foc = fb.GetNowPlaying(); } catch (e2) { foc = null; } }
  if (foc) targetHandle = foc;
  refreshPlaylists();
  if (targetHandle && selPlItems) {
    for (var i = 0; i < selPlItems.Count; i++) {
      if (selPlItems[i].Path === targetHandle.Path && selPlItems[i].SubSong === targetHandle.SubSong) {
        selIdx = i; break;
      }
    }
  }
}

function handleKind(h) {
  if (!h) return 'none';
  var p = String(h.Path || '');
  if (/^navidrome:\/\//i.test(p) || /\/rest\/stream/i.test(p)) return 'navidrome';
  var rp = String(h.RawPath || '');
  if (/\.(cue|iso|zip|rar|7z)$/i.test(p) || /\.cue$/i.test(rp) || h.SubSong > 0) return 'cue/subsong';
  return 'local-file';
}

function readTagSnapshot(h) {
  if (!h) return { tfLoved: '', tfMood: '', infoIdx: -1, infoVals: [], err: 'no-handle' };
  var res = {
    tfLoved: '',
    tfMood: '',
    infoIdx: -1,
    infoVals: [],
    allNamesSample: [],
    err: ''
  };
  try { res.tfLoved = TF_LOVED.EvalWithMetadb(h); } catch (e) { res.err += 'TF_LOVED err=' + e.message + '; '; }
  try { res.tfMood = TF_MOOD.EvalWithMetadb(h); } catch (e2) {}
  try {
    var fi = h.GetFileInfo();
    if (fi) {
      res.infoIdx = fi.MetaFind('LOVED');
      if (res.infoIdx >= 0) {
        var vc = fi.MetaValueCount(res.infoIdx);
        for (var i = 0; i < vc; i++) res.infoVals.push(fi.MetaValue(res.infoIdx, i));
      }
      var mc = Math.min(fi.MetaCount || 0, 12);
      for (var m = 0; m < mc; m++) res.allNamesSample.push(fi.MetaName(m));
      if (typeof fi.Dispose === 'function') fi.Dispose();
    }
  } catch (e3) { res.err += 'GetFileInfo err=' + e3.message; }
  return res;
}

function listContainsHandle(hl, target) {
  if (!hl || !target) return -1;
  try {
    for (var i = 0; i < hl.Count; i++) {
      var item = hl[i];
      if (item && item.Path === target.Path && item.SubSong === target.SubSong) return i;
    }
  } catch (e) {}
  return -1;
}

function on_metadb_changed(handles, fromhook) {
  var cnt = handles ? handles.Count : -1;
  var matched = listContainsHandle(handles, targetHandle) >= 0;
  var tfNow = targetHandle ? TF_LOVED.EvalWithMetadb(targetHandle) : '';
  var line = 'EVENT on_metadb_changed count=' + cnt +
             ' fromhook=' + String(fromhook) + ' (' + typeof fromhook + ')' +
             ' matchesTarget=' + matched + ' tfLOVED="' + tfNow + '"';
  if (activeWatch) {
    activeWatch.events.push({
      ms: Date.now() - activeWatch.t0,
      count: cnt,
      fromhook: fromhook,
      typeofFromhook: typeof fromhook,
      matched: matched,
      tfLoved: tfNow
    });
  }
  log(line);
}

function runReadOnlyProbe() {
  log('=== [A] Read-Only Environment & Library Probe ===');
  var probeH = targetHandle;
  var probeHl = fb.CreateHandleList();
  if (probeH) probeHl.Add(probeH);
  log('API typeof fb.CreateHandleList = ' + typeof fb.CreateHandleList);
  log('API typeof hl.UpdateFileInfoFromJSON = ' + typeof probeHl.UpdateFileInfoFromJSON);
  log('API typeof h.UpdateFileInfoFromJSON = ' + (probeH ? typeof probeH.UpdateFileInfoFromJSON : '(no handle)'));
  log('API typeof h.GetFileInfo = ' + (probeH ? typeof probeH.GetFileInfo : '(no handle)'));
  log('API typeof utils.WriteTextFile = ' + typeof utils.WriteTextFile);
  if (typeof probeHl.Dispose === 'function') try { probeHl.Dispose(); } catch (e) {}

  var lib = null;
  try { lib = fb.GetLibraryItems(); } catch (e2) { lib = null; }
  if (!lib || !lib.Count) {
    log('Library Count = 0 (Media Library empty or unavailable)');
    return;
  }
  var total = lib.Count;
  log('Library Count = ' + total);
  function countField(name, tf) {
    var t0 = Date.now(), vals = [], nonEmpty = 0, sample = '';
    try { vals = tf.EvalWithMetadbs(lib); } catch (e3) { log(name + ' EvalWithMetadbs err: ' + e3.message); return; }
    for (var i = 0; i < vals.length; i++) {
      var v = String(vals[i] || '').trim();
      if (v) { nonEmpty++; if (!sample) sample = v; }
    }
    log('Field %' + name + '%: nonEmpty=' + nonEmpty + '/' + total + ' (' + (Date.now() - t0) + 'ms) sample="' + sample + '"');
  }
  countField('added', TF_ADDED);
  countField('last_modified', TF_LASTMOD);
  countField('play_count', TF_PLAYCOUNT);
  countField('last_played', TF_LASTPLAYED);
  countField('rating', TF_RATING);
  countField('LOVED', TF_LOVED);
  countField('MOOD', TF_MOOD);
  log('Saved report to: ' + outFilePath());
}

function execJsonUpdate(label, h, payload, waitMs, next) {
  var hl = fb.CreateHandleList();
  hl.Add(h);
  activeWatch = { label: label, t0: Date.now(), events: [] };
  var ret = '(not called)', threw = '';
  try {
    ret = hl.UpdateFileInfoFromJSON(JSON.stringify(payload));
  } catch (e) {
    threw = String(e && (e.message || e));
  }
  if (typeof hl.Dispose === 'function') try { hl.Dispose(); } catch (e2) {}
  log('CALL [' + label + '] payload=' + JSON.stringify(payload) +
      ' -> ret=' + String(ret) + ' (' + typeof ret + ')' +
      (threw ? (' THROW="' + threw + '"') : ''));
  setTimer(function () {
    var w = activeWatch;
    activeWatch = null;
    var snap = readTagSnapshot(h);
    log('AFTER ' + waitMs + 'ms [' + label + ']: events=' + (w ? w.events.length : 0) +
        ' tfLOVED="' + snap.tfLoved + '" MetaFind(LOVED)=' + snap.infoIdx +
        ' infoVals=' + JSON.stringify(snap.infoVals) + (snap.err ? (' err=' + snap.err) : ''));
    if (next) next(snap, w, threw);
  }, waitMs);
}

function runWriteDeleteSpike() {
  if (busy) { log('Busy, wait for current step to finish.'); return; }
  if (!targetHandle) { log('No target track selected.'); return; }
  var kind = handleKind(targetHandle);
  if (kind === 'navidrome') {
    log('REFUSED [B] on navidrome:// track. Pick a LOCAL TEST COPY for [B], or use [C] for error/stream test.');
    return;
  }
  var h = targetHandle;
  var initSnap = readTagSnapshot(h);
  busy = true;
  log('=== [B] LOVED Write/Readback/Delete Spike ===');
  log('Target Path: ' + h.Path);
  log('Target RawPath: ' + h.RawPath + ' | SubSong=' + h.SubSong + ' | kind=' + kind);
  log('Initial tfLOVED="' + initSnap.tfLoved + '" MetaFind(LOVED)=' + initSnap.infoIdx + ' infoVals=' + JSON.stringify(initSnap.infoVals));

  // Step 1: Array payload write "1"
  execJsonUpdate('1-write-array', h, [{ LOVED: '1' }], 1500, function (s1) {
    // Step 2: Delete via empty string ""
    execJsonUpdate('2-clear-empty-str', h, [{ LOVED: '' }], 1500, function (s2) {
      function testObjSyntax() {
        // Step 3: Single-object syntax test
        execJsonUpdate('3-write-single-obj', h, { LOVED: '1' }, 1500, function () {
          execJsonUpdate('4-clear-single-obj', h, { LOVED: '' }, 1500, function () {
            if (initSnap.tfLoved) {
              execJsonUpdate('5-restore-orig', h, { LOVED: initSnap.tfLoved }, 1000, function () {
                busy = false; log('=== [B] Finished (original value restored) ===');
              });
            } else {
              busy = false; log('=== [B] Finished ===');
            }
          });
        });
      }
      // If empty string did NOT clear MetaFind(LOVED), also probe [] and null
      if (s2.infoIdx >= 0 || s2.tfLoved) {
        log('Empty string "" did not fully remove LOVED; testing [] and null...');
        execJsonUpdate('2b-clear-empty-arr', h, [{ LOVED: [] }], 1500, function (s2b) {
          if (s2b.infoIdx >= 0 || s2b.tfLoved) {
            execJsonUpdate('2c-clear-null', h, [{ LOVED: null }], 1500, testObjSyntax);
          } else testObjSyntax();
        });
      } else {
        testObjSyntax();
      }
    });
  });
}

function runEdgeErrorSpike() {
  if (busy) { log('Busy, wait for current step to finish.'); return; }
  if (!targetHandle) { log('No target track selected.'); return; }
  var h = targetHandle;
  var kind = handleKind(h);
  var initSnap = readTagSnapshot(h);
  busy = true;
  log('=== [C] Edge/Failure Handle Write Test ===');
  log('Target kind=' + kind + ' | Path=' + h.Path + ' | RawPath=' + h.RawPath + ' | SubSong=' + h.SubSong);
  log('Before tfLOVED="' + initSnap.tfLoved + '" MetaFind(LOVED)=' + initSnap.infoIdx);
  execJsonUpdate('edge-write', h, [{ LOVED: '1' }], 1500, function (after) {
    if (after.infoIdx >= 0 && initSnap.infoIdx < 0 && kind === 'local-file') {
      log('Target succeeded (file is writable). Cleaning up LOVED=""...');
      execJsonUpdate('edge-cleanup', h, [{ LOVED: '' }], 1000, function () {
        busy = false; log('=== [C] Finished ===');
      });
    } else {
      busy = false;
      log('=== [C] Finished (see result above for error/no-op behavior) ===');
    }
  });
}

function runCleanLovedTag() {
  if (busy) { log('Busy, wait for current step to finish.'); return; }
  if (!targetHandle) { log('No target track selected.'); return; }
  var h = targetHandle;
  busy = true;
  log('=== [D] Removing LOVED tag on selected track ===');
  execJsonUpdate('clean-loved', h, [{ LOVED: '' }], 1200, function () {
    busy = false; log('=== [D] Finished ===');
  });
}

function drawBtn(gr, x, y, w, h, label, primary, danger, id) {
  var hot = mx >= x && mx < x + w && my >= y && my < y + h;
  var bg = primary ? (hot ? C_GREEN_HOT : C_GREEN) : (danger ? (hot ? C_RED_HOT : C_RED) : (hot ? C_BTN_HOT : C_BTN));
  var fg = primary ? RGB(0, 0, 0) : C_TXT;
  gr.FillRoundRect(x, y, w, h, sc(8), sc(8), bg);
  gr.GdiDrawText(label, F_BOLD, fg, x + sc(8), y, w - sc(16), h, DT_C);
  hitBoxes.push({ x0: x, y0: y, x1: x + w, y1: y + h, id: id });
}

function on_paint(gr) {
  hitBoxes = [];
  gr.FillSolidRect(0, 0, W, H, C_BG);
  var pad = sc(16), y = sc(14);
  gr.GdiDrawText('Verdant Phase 1 Spike: LOVED Tag & Library Probe' + (busy ? '  [RUNNING...]' : ''),
    F_TITLE, C_TXT, pad, y, W - pad * 2, sc(26), DT_L);
  y += sc(32);

  // Action buttons
  var bw1 = sc(200), bw2 = sc(250), bw3 = sc(230), bw4 = sc(180), bh = sc(34), gap = sc(8);
  drawBtn(gr, pad, y, bw1, bh, '[A] Read-Only Lib & API', false, false, 'btn-probe');
  drawBtn(gr, pad + bw1 + gap, y, bw2, bh, '[B] Write/Delete LOVED', true, false, 'btn-write');
  drawBtn(gr, pad + bw1 + bw2 + gap * 2, y, bw3, bh, '[C] ReadOnly/CUE/Navidrome', false, true, 'btn-edge');
  drawBtn(gr, pad + bw1 + bw2 + bw3 + gap * 3, y, bw4, bh, '[D] Clean LOVED Tag', false, false, 'btn-clean');
  y += bh + sc(12);

  // Selected target banner
  gr.FillRoundRect(pad, y, W - pad * 2, sc(48), sc(8), sc(8), C_CARD);
  var tInfo = targetHandle
    ? ('Target [' + handleKind(targetHandle) + ']: ' + (TF_TITLE.EvalWithMetadb(targetHandle) || '') +
       ' | Path: ' + targetHandle.Path + ' | LOVED="' + TF_LOVED.EvalWithMetadb(targetHandle) + '"')
    : 'No target handle selected. Pick a track below.';
  gr.GdiDrawText(tInfo, F_UI, C_TXT, pad + sc(12), y + sc(4), W - pad * 2 - sc(24), sc(40), DT_L);
  y += sc(58);

  // Split: left track picker, right live log
  var leftW = Math.max(sc(260), Math.min(sc(420), Math.round(W * 0.36)));
  var rightX = pad + leftW + sc(14), rightW = W - rightX - pad;
  var paneH = Math.max(sc(120), H - y - pad);

  // Left: playlist switcher + tracks
  gr.FillRoundRect(pad, y, leftW, paneH, sc(8), sc(8), C_CARD);
  var ly = y + sc(10);
  var pName = '(none)';
  for (var pi = 0; pi < visiblePls.length; pi++) {
    if (visiblePls[pi].idx === selPl) { pName = visiblePls[pi].name + ' (' + visiblePls[pi].count + ')'; break; }
  }
  drawBtn(gr, pad + sc(10), ly, sc(32), sc(26), '<', false, false, 'pl-prev');
  drawBtn(gr, pad + leftW - sc(42), ly, sc(32), sc(26), '>', false, false, 'pl-next');
  gr.GdiDrawText(pName, F_BOLD, C_TXT, pad + sc(48), ly, leftW - sc(96), sc(26), DT_C);
  ly += sc(34);

  var rowH = sc(28), totalT = selPlItems ? selPlItems.Count : 0;
  var visRows = Math.max(1, Math.floor((y + paneH - sc(8) - ly) / rowH));
  if (trackScroll > Math.max(0, totalT - visRows)) trackScroll = Math.max(0, totalT - visRows);
  for (var r = 0; r < visRows && (trackScroll + r) < totalT; r++) {
    var idx = trackScroll + r, tr = selPlItems[idx];
    var ry = ly + r * rowH;
    var isSel = targetHandle && tr && (tr.Path === targetHandle.Path && tr.SubSong === targetHandle.SubSong);
    var rHot = mx >= pad + sc(8) && mx < pad + leftW - sc(8) && my >= ry && my < ry + rowH;
    if (isSel || rHot) gr.FillRoundRect(pad + sc(8), ry, leftW - sc(16), rowH - sc(2), sc(5), sc(5), isSel ? RGB(42, 84, 58) : C_BTN);
    var lbl = (idx + 1) + '. [' + handleKind(tr) + '] ' + (TF_TITLE.EvalWithMetadb(tr) || tr.Path);
    gr.GdiDrawText(lbl, F_UI, isSel ? C_GREEN : C_TXT, pad + sc(14), ry, leftW - sc(28), rowH - sc(2), DT_L);
    hitBoxes.push({ x0: pad + sc(8), y0: ry, x1: pad + leftW - sc(8), y1: ry + rowH, id: 'trk', idx: idx });
  }

  // Right: log output
  gr.FillRoundRect(rightX, y, rightW, paneH, sc(8), sc(8), C_CARD);
  var lh = sc(18), maxLogs = Math.max(1, Math.floor((paneH - sc(40)) / lh));
  gr.GdiDrawText('Log -> ' + outFilePath() + '  (' + logs.length + ' lines)', F_BOLD, C_DIM, rightX + sc(12), y + sc(8), rightW - sc(24), sc(20), DT_L);
  var startL = Math.max(0, Math.min(logs.length - maxLogs, logScroll - maxLogs + 1));
  if (startL < 0) startL = 0;
  for (var li = 0; li < maxLogs && (startL + li) < logs.length; li++) {
    var txt = logs[startL + li];
    var col = (txt.indexOf('THROW') >= 0 || txt.indexOf('err=') >= 0) ? C_RED :
              (txt.indexOf('EVENT') >= 0 ? C_GREEN : (txt.indexOf('===') >= 0 ? C_TXT : C_DIM));
    gr.GdiDrawText(txt, F_MONO, col, rightX + sc(12), y + sc(32) + li * lh, rightW - sc(24), lh, DT_L);
  }
}

function on_size(w, h) { W = w; H = h; }
function on_mouse_move(x, y) { mx = x; my = y; window.Repaint(); }
function on_mouse_leave() { mx = -1; my = -1; window.Repaint(); }

function on_mouse_lbtn_up(x, y) {
  for (var i = 0; i < hitBoxes.length; i++) {
    var b = hitBoxes[i];
    if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) {
      if (b.id === 'btn-probe') runReadOnlyProbe();
      else if (b.id === 'btn-write') runWriteDeleteSpike();
      else if (b.id === 'btn-edge') runEdgeErrorSpike();
      else if (b.id === 'btn-clean') runCleanLovedTag();
      else if (b.id === 'pl-prev' && visiblePls.length) {
        var cur = 0;
        for (var j = 0; j < visiblePls.length; j++) if (visiblePls[j].idx === selPl) cur = j;
        selPl = visiblePls[(cur - 1 + visiblePls.length) % visiblePls.length].idx;
        trackScroll = 0; selIdx = 0; loadSelectedPlaylist();
        if (selPlItems && selPlItems.Count > 0) targetHandle = selPlItems[0];
        window.Repaint();
      } else if (b.id === 'pl-next' && visiblePls.length) {
        var cur2 = 0;
        for (var k = 0; k < visiblePls.length; k++) if (visiblePls[k].idx === selPl) cur2 = k;
        selPl = visiblePls[(cur2 + 1) % visiblePls.length].idx;
        trackScroll = 0; selIdx = 0; loadSelectedPlaylist();
        if (selPlItems && selPlItems.Count > 0) targetHandle = selPlItems[0];
        window.Repaint();
      } else if (b.id === 'trk' && selPlItems && b.idx < selPlItems.Count) {
        selIdx = b.idx;
        targetHandle = selPlItems[b.idx];
        window.Repaint();
      }
      return;
    }
  }
}

function on_mouse_wheel(step) {
  var pad = sc(16), leftW = Math.max(sc(260), Math.min(sc(420), Math.round(W * 0.36)));
  if (mx < pad + leftW) {
    var totalT = selPlItems ? selPlItems.Count : 0;
    trackScroll = Math.max(0, Math.min(Math.max(0, totalT - 5), trackScroll - step * 3));
  } else {
    logScroll = Math.max(0, Math.min(Math.max(0, logs.length - 1), logScroll - step * 4));
  }
  window.Repaint();
}

function on_playlist_switch() { initTargetFromFoobar(); window.Repaint(); }
function on_playlists_changed() { refreshPlaylists(); window.Repaint(); }
function on_script_unload() { clearAllTimers(); }

initTargetFromFoobar();
log('Phase 1 spike ready. Step 1: click [A] Read-Only Lib & API Probe.');
log('Step 2: select a TEST COPY audio track on the left and click [B].');
log('Step 3: select a read-only copy / CUE / navidrome:// track and click [C].');
