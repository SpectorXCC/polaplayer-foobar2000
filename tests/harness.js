'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

const VERDANT_DIR = path.resolve(__dirname, '..');

function createHarness(opts) {
  opts = opts || {};
  const MOCK_PROFILE = path.join(__dirname, 'mock_profile');
  if (opts.cleanProfile !== false) {
    try { fs.rmSync(MOCK_PROFILE, { recursive: true, force: true }); } catch (e) {}
  }
  fs.mkdirSync(path.join(MOCK_PROFILE, 'verdant-cache', 'nav-art'), { recursive: true });
  fs.mkdirSync(path.join(MOCK_PROFILE, 'foo_ui_columns'), { recursive: true });

  const state = {
    props: Object.assign({
      'Navigation: music source': 'local',
      'Navigation: right pane': 'lyrics'
    }, opts.props || {}),
    httpQueue: [],
    nextHttpId: 100,
    dlQueue: [],
    loadImgQueue: [],
    nextImgCookie: 500,
    nextAddTaskId: 700,
    addTasks: [],
    nextTimerId: 1,
    timers: new Map(),
    panelsState: {
      Navidrome: { visible: false, rect: null, calls: [] },
      Lyrics: { visible: false, rect: null, calls: [] }
    },
    playlists: opts.playlists ? opts.playlists.map(p => ({ name: p.name, items: (p.items || []).slice(), locked: !!p.locked, auto: !!p.auto })) : [
      { name: 'Local Mix', items: [], locked: false, auto: false }
    ],
    activePlaylist: 0,
    playingPlaylist: -1,
    playingItemIndex: -1,
    playbackQueue: [],
    playbackOrder: 0,
    nowPlayingHandle: null,
    isPlaying: false,
    isPaused: false,
    playbackTime: 0,
    playbackLength: 0,
    seekTo: null,
    volumeDb: -10,
    darkUi: opts.darkUi !== undefined ? opts.darkUi : true,
    localeName: opts.localeName !== undefined ? opts.localeName : 'en-US',
    navidromeInstalled: opts.navidromeInstalled !== false,
    navidromeConfigured: opts.navidromeConfigured !== false,
    preferencesCalls: 0,
    openedUrls: [],
    repaintCount: 0,
    repaintFullCount: 0,
    repaintRectCalls: [],
    mockNowMs: 1000,
    sqliteCmdCalls: [],
    imgCreateCount: 0,
    imgDisposeCount: 0,
    installedFonts: new Set([
      'HarmonyOS Sans SC', 'HarmonyOS Sans SC Medium',
      'Noto Sans SC', 'Noto Sans SC Medium',
      'PingFang SC Regular', 'PingFang SC Medium', 'PingFang SC Bold',
      'Microsoft YaHei UI',
      'Segoe UI', 'Segoe UI Semibold',
      'Segoe MDL2 Assets'
    ]),
    cuiFontName: 'Segoe UI',
    libraryItems: opts.libraryItems ? opts.libraryItems.slice() : [],
    tagWrites: [],
    failTagWrites: opts.failTagWrites || false
  };

  function makeHandle(p, meta) {
    const rawMeta = meta || {};
    const m = Object.assign({
      title: path.basename(String(p || '')),
      artist: 'Local Artist',
      album: 'Local Album',
      albumArtist: '',
      tracknumber: '',
      year: '',
      length: '3:20',
      lengthSec: 200,
      added: '',
      lastModified: '',
      playCount: '',
      lastPlayed: '',
      loved: '',
      replaygainTrackGain: ''
    }, rawMeta);
    m._custom = Object.assign({}, rawMeta._custom || {});
    if (rawMeta.LOVED !== undefined && m.loved === '') m.loved = rawMeta.LOVED;
    return {
      Path: p,
      RawPath: p,
      SubSong: rawMeta.SubSong || 0,
      Length: m.lengthSec,
      FileSize: 1024,
      _readOnly: !!rawMeta.readOnly,
      _meta: m,
      Compare(other) { return other && this.Path === other.Path && (this.SubSong || 0) === (other.SubSong || 0); }
    };
  }

  function applyTagPatch(h, patch) {
    if (!h || !patch || typeof patch !== 'object') return;
    if (!h._meta) h._meta = {};
    if (!h._meta._custom) h._meta._custom = {};
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      const str = (v === '' || (Array.isArray(v) && v.length === 0))
        ? ''
        : (v === null ? 'null' : String(v));
      const upper = k.toUpperCase();
      if (str === '') delete h._meta._custom[upper];
      else h._meta._custom[upper] = str;
      if (upper === 'LOVED') h._meta.loved = str;
      else if (upper === 'TITLE') h._meta.title = str;
      else if (upper === 'ARTIST') h._meta.artist = str;
      else if (upper === 'ALBUM') h._meta.album = str;
      else if (upper === 'ALBUM ARTIST') h._meta.albumArtist = str;
    }
  }

  function makeHandleList(arr) {
    const list = (arr || []).slice();
    const proxy = {
      Add(h) { list.push(h); },
      AddRange(other) {
        if (!other) return;
        for (let i = 0; i < other.Count; i++) list.push(other[i]);
      },
      Insert(idx, h) { list.splice(idx, 0, h); },
      RemoveById(idx) { list.splice(idx, 1); },
      Sort() {},
      Clone() { return makeHandleList(list); },
      GetLibraryRelativePath() { return ''; },
      MakeDifference() {},
      Dispose() {},
      UpdateFileInfoFromJSON(jsonStr) {
        if (state.failTagWrites === 'throw') throw new Error('Mock read-only file');
        const parsed = JSON.parse(String(jsonStr || '{}'));
        for (let i = 0; i < list.length; i++) {
          const h = list[i];
          const patch = Array.isArray(parsed) ? parsed[i] : parsed;
          if (!patch || typeof patch !== 'object') continue;
          const ro = !!(h._readOnly || state.failTagWrites);
          state.tagWrites.push({ path: h.Path, patch: Object.assign({}, patch), readOnly: ro });
          if (!ro) applyTagPatch(h, patch);
        }
      },
      get Count() { return list.length; },
      get _items() { return list; }
    };
    return new Proxy(proxy, {
      get(target, prop) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) return list[Number(prop)];
        return target[prop];
      }
    });
  }

  function makeImage(w, h) {
    state.imgCreateCount++;
    const img = {
      Width: w || 400,
      Height: h || 400,
      _disposed: false,
      _drawOps: [],
      _maskDims: null,
      Dispose() {
        if (!this._disposed) {
          this._disposed = true;
          state.imgDisposeCount++;
        }
      },
      Clone(x, y, cw, ch) { return makeImage(cw, ch); },
      Resize(rw, rh) { return makeImage(rw, rh); },
      GetGraphics() {
        const g = makeGraphics();
        img._drawOps = g.drawImageCalls;
        img._gdiDrawTextOps = g.gdiDrawTextCalls;
        img._drawStringOps = g.drawStringCalls;
        img._textHintOps = g.textHintCalls;
        return g;
      },
      ReleaseGraphics() {},
      ApplyMask(mask) {
        if (mask) {
          assert.strictEqual(mask.Width, this.Width, 'ApplyMask width mismatch: mask=' + mask.Width + ' img=' + this.Width);
          assert.strictEqual(mask.Height, this.Height, 'ApplyMask height mismatch: mask=' + mask.Height + ' img=' + this.Height);
          this._maskDims = { w: mask.Width, h: mask.Height };
        }
      },
      StackBlur() {},
      GetColourScheme() { return [0xFF336699, 0xFF112233]; },
      ApplyAlpha() {}
    };
    return img;
  }

  function makeGraphics() {
    const drawImageCalls = [];
    const fillRoundRectCalls = [];
    const drawRoundRectCalls = [];
    const fillSolidRectCalls = [];
    const fillEllipseCalls = [];
    const drawLineCalls = [];
    const textHintCalls = [];
    const drawStringCalls = [];
    const gdiDrawTextCalls = [];
    const calcTextHeightCalls = [];
    return {
      drawImageCalls,
      fillRoundRectCalls,
      drawRoundRectCalls,
      fillSolidRectCalls,
      fillEllipseCalls,
      drawLineCalls,
      textHintCalls,
      drawStringCalls,
      gdiDrawTextCalls,
      calcTextHeightCalls,
      SetSmoothingMode() {},
      SetInterpolationMode() {},
      SetTextRenderingHint(h) { textHintCalls.push(h); },
      PushTransform() {},
      PopTransform() {},
      Rotate() {},
      FillSolidRect(x, y, w, h, col) {
        fillSolidRectCalls.push({ x, y, w, h, col });
      },
      FillGradRect() {},
      FillRoundRect(x, y, w, h, rx, ry, col) {
        fillRoundRectCalls.push({ x, y, w, h, rx, ry, col });
      },
      DrawRoundRect(x, y, w, h, rx, ry, lw, col) {
        drawRoundRectCalls.push({ x, y, w, h, rx, ry, lw, col });
      },
      FillPolygon() {},
      DrawPolygon() {},
      DrawRect() {},
      FillEllipse(x, y, w, h, col) {
        fillEllipseCalls.push({ x, y, w, h, col });
      },
      DrawEllipse() {},
      DrawLine(x1, y1, x2, y2, lw, col) {
        drawLineCalls.push({ x1, y1, x2, y2, lw, col });
      },
      DrawImage(im, x, y, w, h, sx, sy, sw, sh) {
        drawImageCalls.push({
          imW: im ? im.Width : 0,
          imH: im ? im.Height : 0,
          x, y, w, h, sx, sy, sw, sh
        });
      },
      GdiDrawText(str, font, col, x, y, w, h, fmt) {
        gdiDrawTextCalls.push({ str, font, col, x, y, w, h, fmt });
      },
      DrawString(str, font, col, x, y, w, h, fmt) {
        drawStringCalls.push({ str, font, col, x, y, w, h, fmt });
      },
      CalcTextWidth(str) { return String(str || '').length * 8; },
      CalcTextHeight(str, font) {
        const s = String(str || '');
        calcTextHeightCalls.push({ text: s, font });
        return s.indexOf('\u6b4c') >= 0 ? 22 : 18;
      },
      EstimateLineWrap(str) {
        const s = String(str || '');
        return s ? [s, s.length] : ['', 0];
      }
    };
  }

  const uiWizardMock = {
    FrameStyle: 3,
    MoveStyle: 0,
    DisableWindowSizing: false,
    DisableWindowMaximizing: false,
    WindowState: 0,
    DisplayResolution: '2560x1600',
    WindowMinWidth: 0,
    WindowMinHeight: 0,
    captionCalls: [],
    sizeLimitsCalls: [],
    posCalls: [],
    sizeCalls: [],
    SetCaptionAreaSize(x, y, w, h) { this.captionCalls.push({ x, y, w, h }); },
    SetWindowSizeLimits(minW, minH, maxW, maxH) {
      this.sizeLimitsCalls.push({ minW, minH, maxW, maxH });
    },
    SetWindowPosition(x, y) { this.posCalls.push({ x, y }); },
    SetWindowSize(w, h) { this.sizeCalls.push({ w, h }); },
    ExitMaximize() { this.WindowState = 0; },
    ToggleMaximize() { this.WindowState = (this.WindowState === 1) ? 0 : 1; },
    WindowMinimize() {}
  };

  const verdantChromeMock = {
    attached: false,
    attachCalls: 0,
    WindowState: 0,
    MaxButtonHot: false,
    metricsCalls: [],
    fullscreenCalls: [],
    themeCalls: [],
    detachCalls: 0,
    exitDetachCalls: 0,
    Attach() {
      this.attachCalls++;
      if (opts.verdantChromeAttachFails) {
        this.attached = false;
        return false;
      }
      this.attached = true;
      return true;
    },
    Detach() { this.attached = false; this.detachCalls++; },
    DetachForExit() { this.exitDetachCalls++; },
    SetChromeMetrics(cx, cy, cw, ch, mx, my, mw, mh, minW, minH) {
      this.metricsCalls.push({ cx, cy, cw, ch, mx, my, mw, mh, minW, minH });
    },
    SetFullscreen(v) { this.fullscreenCalls.push(v); },
    SetTheme(isDark, canvasRef, borderRef) {
      this.themeCalls.push({ isDark, canvasRef, borderRef });
    },
    ToggleMaximize() { this.WindowState = (this.WindowState === 1) ? 0 : 1; },
    WindowMinimize() {},
    ExitMaximize() { this.WindowState = 0; }
  };

  let ctx = null;
  const sandbox = {
    console,
    Math,
    Date,
    performance: { now() { return state.mockNowMs; } },
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    encodeURIComponent,
    decodeURIComponent,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    DLGC_WANTALLKEYS: 4,
    DLGC_WANTCHARS: 128,
    window: {
      Width: 1440,
      Height: 900,
      DlgCode: 128,
      InstanceType: 0,
      IsTransparent: false,
      ID: 1,
      get IsDark() { return state.darkUi; },
      DefineScript() {},
      GetProperty(k, def) {
        return Object.prototype.hasOwnProperty.call(state.props, k) ? state.props[k] : def;
      },
      SetProperty(k, v) { state.props[k] = v; },
      SetTimeout(fn, ms) {
        const id = state.nextTimerId++;
        state.timers.set(id, { fn, ms });
        return id;
      },
      ClearTimeout(id) { state.timers.delete(id); },
      SetInterval(fn, ms) {
        const id = state.nextTimerId++;
        state.timers.set(id, { fn, ms, interval: true });
        return id;
      },
      ClearInterval(id) { state.timers.delete(id); },
      Repaint() { state.repaintCount++; state.repaintFullCount++; },
      RepaintRect(x, y, w, h) { state.repaintCount++; state.repaintRectCalls.push({ x, y, w, h }); },
      GetColourCUI(id) {
        if (id === 3) return state.darkUi ? 0xFF121212 : 0xFFF5F5F5;
        return state.darkUi ? 0xFFFFFFFF : 0xFF111111;
      },
      GetFontCUI() { return sandbox.gdi.Font(state.cuiFontName, 14, 0); },
      GetPanel(name) {
        if (!state.panelsState[name]) throw new Error('Panel not found: ' + name);
        const st = state.panelsState[name];
        return {
          set ShowCaption(v) {},
          set Locked(v) {},
          Move(x, y, w, h) { st.rect = { x, y, w, h }; st.calls.push(['Move', x, y, w, h]); },
          Show(v) { st.visible = !!v; st.calls.push(['Show', !!v]); }
        };
      },
      CreatePopupMenu() {
        return { AppendMenuItem() {}, AppendMenuSeparator() {}, TrackPopupMenu() { return 0; } };
      }
    },
    fb: {
      ProfilePath: MOCK_PROFILE + '\\',
      ComponentPath: MOCK_PROFILE + '\\',
      Version: '2.25.0',
      ReplaygainMode: 0,
      PlaybackOrder: 0,
      StopAfterCurrent: false,
      get IsPlaying() { return state.isPlaying; },
      get IsPaused() { return state.isPaused; },
      get PlaybackTime() { return state.playbackTime; },
      set PlaybackTime(v) { state.seekTo = v; state.playbackTime = v; },
      get PlaybackLength() { return state.playbackLength; },
      get Volume() { return state.volumeDb; },
      set Volume(v) { state.volumeDb = v; },
      GetNowPlaying() { return state.nowPlayingHandle; },
      CreateHandleList() { return makeHandleList([]); },
      GetLibraryItems() { return makeHandleList(state.libraryItems); },
      IsLibraryEnabled() { return true; },
      TitleFormat(expr) {
        return {
          EvalWithMetadb(h) {
            if (!h) return '';
            const m = h._meta || {};
            const e = String(expr || '');
            if (e === '%album artist% - %album%') {
              const aa = m.albumArtist || m.artist || '';
              const al = m.album || '';
              return (aa || '?') + ' - ' + (al || '?');
            }
            if (e === '%album artist%') return m.albumArtist || m.artist || '?';
            if (e === '$year(%date%)') {
              const d = String(m.date || m.year || '');
              const ym = /(\d{4})/.exec(d);
              return ym ? ym[1] : '';
            }
            if (e === '%length_seconds%') return String(m.lengthSec !== undefined ? m.lengthSec : (h.Length || 0));
            if (e === '%tracknumber%') return String(m.tracknumber !== undefined && m.tracknumber !== '' ? m.tracknumber : '');
            if (e === '$if2([%added%],[%last_modified%])') {
              return String(m.added || m.lastModified || m.last_modified || '');
            }
            if (e === '[%play_count%]') {
              const pc = m.playCount !== undefined && m.playCount !== '' ? m.playCount : m.play_count;
              return pc !== undefined && pc !== '' ? String(pc) : '';
            }
            if (e === '[%last_played%]') return String(m.lastPlayed || m.last_played || '');
            if (e === '$if(%replaygain_track_gain%,1,0)') return m.replaygainTrackGain ? '1' : '0';
            const brMatch = /^\[%([A-Za-z0-9_ ]+)%\]$/.exec(e);
            if (brMatch) {
              const key = brMatch[1];
              const upper = key.toUpperCase();
              if (m._custom && m._custom[upper] !== undefined) return String(m._custom[upper]);
              if (upper === 'LOVED') return String(m.loved || '');
              if (upper === 'ARTIST') return m.artist || 'Unknown';
              if (upper === 'ALBUM') return m.album || 'Album';
              if (upper === 'TITLE') return m.title || h.Path;
              return m[key] !== undefined ? String(m[key]) : '';
            }
            const unbrMatch = /^%([A-Za-z0-9_ ]+)%$/.exec(e);
            if (unbrMatch) {
              const key = unbrMatch[1];
              const upper = key.toUpperCase();
              if (upper === 'TITLE') return m.title || h.Path;
              if (upper === 'ARTIST') return m.artist || '?';
              if (upper === 'ALBUM') return m.album || '?';
              if (upper === 'LENGTH') return m.length || '3:00';
              if (upper === 'PATH') return h.Path;
              if (m._custom && m._custom[upper] !== undefined) return String(m._custom[upper]);
              if (upper === 'LOVED') return m.loved ? String(m.loved) : '?';
              return m[key] !== undefined && m[key] !== '' ? String(m[key]) : '?';
            }
            if (e.indexOf('title') >= 0) return m.title || h.Path;
            if (e.indexOf('artist') >= 0) return m.artist || 'Unknown';
            if (e.indexOf('album') >= 0) return m.album || 'Album';
            if (e.indexOf('length') >= 0) return m.length || '3:00';
            if (e.indexOf('path') >= 0) return h.Path;
            return '';
          },
          EvalWithMetadbs(hl) {
            const out = [];
            for (let i = 0; i < hl.Count; i++) out.push(this.EvalWithMetadb(hl[i]));
            return out;
          }
        };
      },
      PlayOrPause() { state.isPaused = !state.isPaused; },
      Play() { state.isPlaying = true; state.isPaused = false; },
      Stop() { state.isPlaying = false; state.isPaused = false; },
      Next() {},
      Prev() {},
      Exit() { state.exitCalls=(state.exitCalls||0)+1; },
      ShowPreferences() { state.preferencesCalls++; },
      AddLocationsAsync(urls) {
        const tid = state.nextAddTaskId++;
        state.addTasks.push({ tid, urls: Array.from(urls || []) });
        return tid;
      },
      CreateMainMenuManager() { return { Init() {}, BuildMenu() {}, ExecuteByID() {} }; }
    },
    plman: {
      get PlaylistCount() { return state.playlists.length; },
      get ActivePlaylist() { return state.activePlaylist; },
      set ActivePlaylist(i) { state.activePlaylist = i; },
      get PlayingPlaylist() { return state.playingPlaylist; },
      set PlayingPlaylist(i) { state.playingPlaylist = i; },
      get PlaybackOrder() { return state.playbackOrder; },
      set PlaybackOrder(v) { state.playbackOrder = v; },
      GetPlaylistName(i) { return (state.playlists[i] && state.playlists[i].name) || ''; },
      PlaylistItemCount(i) { return (state.playlists[i] && state.playlists[i].items.length) || 0; },
      GetPlaylistItems(i) { return makeHandleList(state.playlists[i] ? state.playlists[i].items : []); },
      IsPlaylistLocked(i) { return !!(state.playlists[i] && state.playlists[i].locked); },
      IsAutoPlaylist(i) { return !!(state.playlists[i] && state.playlists[i].auto); },
      FindPlaylist(name) { return state.playlists.findIndex(p => p.name === name); },
      FindOrCreatePlaylist(name) {
        let idx = state.playlists.findIndex(p => p.name === name);
        if (idx < 0) {
          state.playlists.push({ name, items: [], locked: false, auto: false });
          idx = state.playlists.length - 1;
        }
        return idx;
      },
      CreatePlaylist(idx, name) {
        state.playlists.splice(idx, 0, { name, items: [], locked: false, auto: false });
        return idx;
      },
      RenamePlaylist(i, name) { if (state.playlists[i]) state.playlists[i].name = name; },
      RemovePlaylist(i) {
        state.playlists.splice(i, 1);
        if (state.activePlaylist >= state.playlists.length) state.activePlaylist = Math.max(-1, state.playlists.length - 1);
      },
      ClearPlaylist(i) { if (state.playlists[i]) state.playlists[i].items = []; },
      InsertPlaylistItems(i, pos, hl) {
        if (!state.playlists[i]) return;
        for (let k = 0; k < hl.Count; k++) state.playlists[i].items.splice(pos + k, 0, hl[k]);
      },
      RemovePlaylistSelection(i, crop) {
        const pl = state.playlists[i];
        if (!pl || !pl.sel) return;
        const keep = [];
        for (let k = 0; k < pl.items.length; k++) {
          const selected = !!pl.sel[k];
          if (crop ? selected : !selected) keep.push(pl.items[k]);
        }
        pl.items = keep;
        pl.sel = {};
      },
      SetPlaylistSelectionSingle(i, itemIdx, selState) {
        const pl = state.playlists[i];
        if (!pl) return;
        if (!pl.sel) pl.sel = {};
        if (selState) pl.sel[itemIdx] = true;
        else delete pl.sel[itemIdx];
      },
      ClearPlaylistSelection(i) {
        if (state.playlists[i]) state.playlists[i].sel = {};
      },
      GetPlaylistLockedActions(i) {
        return (state.playlists[i] && state.playlists[i].locked) ? 'RemoveItems' : '';
      },
      UndoBackup() {},
      ExecutePlaylistDefaultAction(plIdx, itemIdx) {
        state.playingPlaylist = plIdx;
        state.playingItemIndex = itemIdx;
        const it = state.playlists[plIdx] && state.playlists[plIdx].items[itemIdx];
        state.nowPlayingHandle = it || null;
        state.isPlaying = !!it;
        state.isPaused = false;
        state.playbackLength = it ? (it.Length || 180) : 0;
        state.playbackTime = 0;
      },
      GetPlayingItemLocation() {
        return {
          IsValid: state.playingPlaylist >= 0 && state.playingItemIndex >= 0,
          PlaylistIndex: state.playingPlaylist,
          PlaylistItemIndex: state.playingItemIndex
        };
      },
      AddItemToPlaybackQueue(h) { state.playbackQueue.push({ Handle: h }); },
      GetPlaybackQueueContents() { return state.playbackQueue.slice(); },
      FlushPlaybackQueue() { state.playbackQueue = []; },
      RemoveItemFromPlaybackQueue(idx) { state.playbackQueue.splice(idx, 1); }
    },
    utils: {
      GetSystemMetrics() { return 96; },
      IsFile(p) {
        if (p.endsWith('config.sqlite')) return true;
        return fs.existsSync(p) && fs.statSync(p).isFile();
      },
      IsFolder(p) { return fs.existsSync(p) && fs.statSync(p).isDirectory(); },
      IsDirectory(p) { return fs.existsSync(p) && fs.statSync(p).isDirectory(); },
      CreateFolder(p) { fs.mkdirSync(p, { recursive: true }); },
      OpenDatabase() {
        const cfg = {
          'cfg_var.A1B2C3D4-1111-2222-AABB-CCDDEEFF011B':
            'name=Demo%20Primary&url=https%3A%2F%2Fdemo.example.invalid%3A4533%2F&user=alice&pass=sec%26ret%3D1&headers=&filter=&libs=\n' +
            'name=Home%20Backup&url=http%3A%2F%2F192.168.1.9%3A4533&user=bob&pass=p%40ss&headers=&filter=&libs=',
          'cfg_var.A1B2C3D4-1111-2222-AABB-CCDDEEFF011C': 'Demo Primary'
        };
        return {
          Exec() {},
          Close() {},
          Query(sql, params) {
            const k = params && params[0];
            return state.navidromeConfigured && Object.prototype.hasOwnProperty.call(cfg, k) ? [{ value: cfg[k] }] : [];
          }
        };
      },
      FileTest(p) { return fs.existsSync(p); },
      FileExists(p) { return fs.existsSync(p); },
      ReadTextFile(p) { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; },
      WriteTextFile(p, content) {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, String(content), 'utf8');
        return true;
      },
      Glob() { return []; },
      GetAlbumArtAsync() {},
      GetAlbumArtV2() { return null; },
      ReadINI() { return ''; },
      MD5(str) {
        return crypto.createHash('md5').update(String(str || ''), 'utf8').digest('hex');
      },
      HTTPRequestAsync(type, url, headers) {
        const id = state.nextHttpId++;
        state.httpQueue.push({ id, type, url, headers });
        return id;
      },
      DownloadFileAsync(url, dstPath) {
        state.dlQueue.push({ url, dstPath });
      },
      ShowHtmlDialog() {},
      InputBox() { return ''; },
      CheckComponent(name) { return name === 'foo_navidrome' && state.navidromeInstalled; },
      CheckFont(name) { return state.installedFonts.has(String(name || '')); }
    },
    gdi: {
      Font(name, size, style) { return { Name: name, Size: size, Style: style }; },
      CreateImage(w, h) { return makeImage(w, h); },
      LoadImage(p) { return fs.existsSync(p) ? makeImage(400, 400) : null; },
      LoadImageAsync(winId, p) {
        const cookie = state.nextImgCookie++;
        state.loadImgQueue.push({ cookie, winId, path: p });
        return cookie;
      }
    },
    ActiveXObject: function (progId) {
      if (progId === 'WScript.Shell') {
        return {
          Exec(cmd) {
            state.sqliteCmdCalls.push(cmd);
            const row1 = 'A1B2C3D4-1111-2222-AABB-CCDDEEFF011B|name=Demo%20Primary&url=https%3A%2F%2Fdemo.example.invalid%3A4533%2F&user=alice&pass=sec%26ret%3D1&headers=&filter=&libs=\n' +
                         'name=Home%20Backup&url=http%3A%2F%2F192.168.1.9%3A4533&user=bob&pass=p%40ss&headers=&filter=&libs=';
            const row2 = 'A1B2C3D4-1111-2222-AABB-CCDDEEFF011C|Demo Primary';
            const out = row1 + '\n' + row2 + '\n';
            let pos = 0;
            return {
              Status: 1,
              StdOut: {
                get AtEndOfStream() { return pos >= out.length; },
                ReadAll() { pos = out.length; return out; }
              },
              StdErr: { ReadAll() { return ''; } }
            };
          },
          Run() { return 0; },
          RegRead(key) {
            if (state.localeName === null) throw new Error('Registry key not found: ' + key);
            return String(state.localeName);
          }
        };
      }
      if (progId === 'Scripting.FileSystemObject') {
        return {
          FolderExists(p) { return fs.existsSync(p); },
          CreateFolder(p) { fs.mkdirSync(p, { recursive: true }); },
          FileExists(p) { return fs.existsSync(p); }
        };
      }
      if (progId === 'Shell.Application') {
        return { ShellExecute(url) { state.openedUrls.push(url); } };
      }
      if (progId === 'UIWizard') {
        return uiWizardMock;
      }
      if (progId === 'Verdant.Chrome' && opts.verdantChrome) {
        return verdantChromeMock;
      }
      throw new Error('Unsupported ActiveXObject: ' + progId);
    },
    include(rel) {
      const full = path.join(VERDANT_DIR, rel);
      const code = fs.readFileSync(full, 'utf8');
      vm.runInContext(code, ctx, { filename: full });
    }
  };

  ctx = vm.createContext(sandbox);
  const mainCode = fs.readFileSync(path.join(VERDANT_DIR, 'main.js'), 'utf8');
  vm.runInContext(mainCode, ctx, { filename: path.join(VERDANT_DIR, 'main.js') });

  function flushOneHttp(matchSubstr, status, jsonBody, failHttp) {
    const idx = state.httpQueue.findIndex(h => h.url.indexOf(matchSubstr) >= 0);
    if (idx < 0) return null;
    const req = state.httpQueue.splice(idx, 1)[0];
    const respText = typeof jsonBody === 'string' ? jsonBody : JSON.stringify(jsonBody);
    ctx.on_http_request_done(req.id, !failHttp, respText, status);
    return req;
  }

  function flushTimers(filterMs) {
    const entries = Array.from(state.timers.entries());
    let ran = 0;
    for (const [id, t] of entries) {
      if (filterMs !== undefined && t.ms !== filterMs) continue;
      if (!state.timers.has(id)) continue;
      if (!t.interval) state.timers.delete(id);
      t.fn();
      ran++;
    }
    return ran;
  }

  return {
    VERDANT_DIR,
    MOCK_PROFILE,
    state,
    sandbox,
    ctx,
    uiWizardMock,
    verdantChromeMock,
    makeHandle,
    makeHandleList,
    makeImage,
    makeGraphics,
    flushOneHttp,
    flushTimers
  };
}

module.exports = { VERDANT_DIR, createHarness };
