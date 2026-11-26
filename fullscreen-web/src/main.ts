import '@applemusic-like-lyrics/core/style.css';
import './style.css';
import {
  BackgroundRender,
  DomLyricPlayer,
  LyricLineMouseEvent,
  MeshGradientRenderer
} from '@applemusic-like-lyrics/core';
import { RawLyricsModel, toAmllLines } from './lyrics_adapter';
import { PlaybackClock } from './playback_clock';
import { createPreview, PreviewMessage } from './preview';

interface HostPlaybackPayload {
  playing: boolean;
  paused: boolean;
  time: number;
  length: number;
  volume: number;
  shuffle: boolean;
  repeat: number;
}

interface HostTrackPayload {
  key: number;
  title: string;
  artist: string;
  coverUrl: string;
  length: number;
}

interface HostLyricsPayload {
  remote: boolean;
  heading: string;
  status: string;
  model: RawLyricsModel | null;
}

interface HostUiStrings {
  nowPlaying: string;
  nothingPlaying: string;
  chooseMusic: string;
  loadingLyrics: string;
  waitingMusic: string;
  noLyrics: string;
}

interface HostFontsPayload {
  ui?: string;
  lyric?: string;
}

interface HostInitPayload {
  type: 'init';
  view?: 'lyrics' | 'default';
  visible?: boolean;
  track?: HostTrackPayload;
  lyrics?: HostLyricsPayload;
  playback?: HostPlaybackPayload;
  strings?: HostUiStrings;
  fonts?: HostFontsPayload;
}

const ICONS = {
  play: "<path d='M8 5v14l11-7z'/>",
  pause: "<rect x='6' y='5' width='4' height='14' rx='1.3'/><rect x='14' y='5' width='4' height='14' rx='1.3'/>",
  prev: "<path d='M6 6h2.2v12H6zm3 6l9 6V6z'/>",
  next: "<path d='M15.8 6H18v12h-2.2zM6 18l9-6-9-6z'/>",
  shuffle: "<path d='M10.59 9.17 5.41 4 4 5.41l5.17 5.17zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04z'/>",
  repeat: "<path d='M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z'/>",
  repeat1: "<path d='M13 15V9h-1l-2 1v1h1.5v4zm4-8v3l4-4-4-4v3H5v6h2V7zm0 10H7v-3l-4 4 4 4v-3h12v-6h-2z'/>",
  volume: "<path d='M3 9v6h4l5 5V4L7 9zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z'/>",
  equalizer: "<path d='M10 20h4V4h-4zm-6 0h4v-8H4zm12-11v11h4V9z'/>",
  mic: "<path d='M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11z'/>",
  compress: "<path d='M5 16h3v3h2v-5H5zm3-8H5v2h5V5H8zm6 11h2v-3h3v-2h-5zm2-11V5h-2v5h5V8z'/>",
  album: "<path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z'/>"
};

function iconSvg(pathStr: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${pathStr}</svg>`;
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function postToHost(msg: Record<string, unknown>): void {
  try {
    const wv = (window as unknown as { chrome?: { webview?: { postMessage?: (d: unknown) => void } } }).chrome?.webview;
    if (wv && typeof wv.postMessage === 'function') {
      wv.postMessage(msg);
    }
  } catch {
    // Ignore when previewed outside WebView2
  }
}

const preview = createPreview(postToHost, fmtTime, {
  prev: iconSvg(ICONS.prev), play: iconSvg(ICONS.play), pause: iconSvg(ICONS.pause), next: iconSvg(ICONS.next)
});

const elApp = document.getElementById('app')!;
const elBgFallback = document.getElementById('bg-fallback')!;
const elBgLayer = document.getElementById('bg-layer')!;
const elTopNow = document.getElementById('top-now-playing')!;
const btnViz = document.getElementById('btn-viz') as HTMLButtonElement;
const btnLyrics = document.getElementById('btn-lyrics') as HTMLButtonElement;
const btnExit = document.getElementById('btn-exit') as HTMLButtonElement;

const elCoverImg = document.getElementById('cover-img') as HTMLImageElement;
const elCoverPh = document.getElementById('cover-placeholder')!;
const elCoverPhIcon = document.getElementById('cover-ph-icon')!;
const elTitle = document.getElementById('track-title')!;
const elArtist = document.getElementById('track-artist')!;

const elSeekBar = document.getElementById('seek-bar')!;
const elSeekFill = document.getElementById('seek-fill')!;
const elTimeCur = document.getElementById('time-cur')!;
const elTimeRem = document.getElementById('time-rem')!;

const btnShuffle = document.getElementById('btn-shuffle') as HTMLButtonElement;
const btnPrev = document.getElementById('btn-prev') as HTMLButtonElement;
const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
const btnNext = document.getElementById('btn-next') as HTMLButtonElement;
const btnRepeat = document.getElementById('btn-repeat') as HTMLButtonElement;

const elVolIcon = document.getElementById('vol-icon')!;
const elVolBar = document.getElementById('vol-bar')!;
const elVolFill = document.getElementById('vol-fill')!;

const elLyricsHeading = document.getElementById('lyrics-heading')!;
const elAmllHost = document.getElementById('amll-host')!;
const elStaticLyrics = document.getElementById('static-lyrics')!;
const elLyricsEmpty = document.getElementById('lyrics-empty')!;
const elLyricsEmptyText = document.getElementById('lyrics-empty-text')!;

btnViz.innerHTML = iconSvg(ICONS.equalizer);
btnLyrics.innerHTML = iconSvg(ICONS.mic);
btnExit.innerHTML = iconSvg(ICONS.compress);
btnShuffle.innerHTML = iconSvg(ICONS.shuffle);
btnPrev.innerHTML = iconSvg(ICONS.prev);
btnPlay.innerHTML = iconSvg(ICONS.play);
btnNext.innerHTML = iconSvg(ICONS.next);
btnRepeat.innerHTML = iconSvg(ICONS.repeat);
elVolIcon.innerHTML = iconSvg(ICONS.volume);
elCoverPhIcon.innerHTML = iconSvg(ICONS.album);

let strings: HostUiStrings = {
  nowPlaying: 'Now Playing',
  nothingPlaying: 'Nothing Playing',
  chooseMusic: '',
  loadingLyrics: 'Loading lyrics...',
  waitingMusic: 'Waiting for music...',
  noLyrics: 'No lyrics'
};

const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
let bgRender: BackgroundRender<MeshGradientRenderer> | null = null;
try {
  if (MeshGradientRenderer.isSupported()) {
    bgRender = BackgroundRender.new(MeshGradientRenderer);
    bgRender.setRenderScale(0.5);
    bgRender.setFPS(45);
    bgRender.setFlowSpeed(1.8);
    elBgLayer.appendChild(bgRender.getElement());
  }
} catch {
  bgRender = null;
}

const lyricPlayer = new DomLyricPlayer();
lyricPlayer.setEnableBlur(true);
lyricPlayer.setEnableScale(true);
lyricPlayer.setEnableSpring(true);
lyricPlayer.setAlignPosition(0.44);
lyricPlayer.setEnableAutoSeekDetection(true);
lyricPlayer.pause();
elAmllHost.appendChild(lyricPlayer.getElement());

let appVisible = false;
let currentView: 'lyrics' | 'default' = 'lyrics';
let currentCoverUrl = '';
let currentTrackLen = 0;
let currentTrackKey: number | null = null;
let hasSyncedLyrics = false;

let pbState: HostPlaybackPayload = {
  playing: false,
  paused: false,
  time: 0,
  length: 0,
  volume: 0.7,
  shuffle: false,
  repeat: 0
};
const clock = new PlaybackClock();
let lyricPlaybackActive = false;
let seekTrackKey: number | null = null;
let draggingSeek = false;
let seekDragFrac = 0;
let draggingVol = false;
let volDragFrac = 0.7;

let rafId = 0;
let lastFramePerf = performance.now();

function currentMediaSec(now = performance.now()): number {
  return clock.at(now) / 1000;
}

function updateTimeAndSeekUi(sec: number): void {
  const len = pbState.length || currentTrackLen || 0;
  const shown = draggingSeek ? len * seekDragFrac : sec;
  const frac = len > 0 ? clamp01(shown / len) : 0;
  elSeekFill.style.width = `${(frac * 100).toFixed(3)}%`;
  elTimeCur.textContent = fmtTime(shown);
  elTimeRem.textContent = `\u2212${fmtTime(Math.max(0, len - shown))}`;
}

function applyVolumeUi(frac: number): void {
  const v = clamp01(draggingVol ? volDragFrac : frac);
  elVolFill.style.width = `${(v * 100).toFixed(2)}%`;
}

function syncBackgroundPlaybackState(): void {
  if (!bgRender) return;
  const reduced = motionPreference.matches;
  bgRender.getElement().style.display = reduced ? 'none' : '';
  if (!appVisible || reduced) {
    bgRender.pause();
    return;
  }
  bgRender.resume();
  const activelyPlaying = pbState.playing && !pbState.paused;
  bgRender.setFlowSpeed(activelyPlaying ? 2.0 : 0.45);
  bgRender.setHasLyric(currentView === 'lyrics' && hasSyncedLyrics);
}

function syncLyricPlayerPlaybackState(forceSeek = false): void {
  const active = appVisible && currentView === 'lyrics' && pbState.playing && !pbState.paused;
  if (lyricPlaybackActive !== active) {
    lyricPlaybackActive = active;
    if (active) lyricPlayer.resume();
    else lyricPlayer.pause();
  }
  if (forceSeek && hasSyncedLyrics) {
    lyricPlayer.setCurrentTime(Math.round(currentMediaSec() * 1000), true);
    lyricPlayer.update(0);
  }
}

function applyMotionPreference(): void {
  const reduced = motionPreference.matches;
  lyricPlayer.setEnableSpring(!reduced);
  lyricPlayer.setEnableScale(!reduced);
  lyricPlayer.setEnableBlur(!reduced);
  syncBackgroundPlaybackState();
}

function frameLoop(now: number): void {
  rafId = 0;
  if (!appVisible) return;

  const dt = Math.max(0, Math.min(100, now - lastFramePerf));
  lastFramePerf = now;

  const sec = currentMediaSec(now);
  updateTimeAndSeekUi(sec);

  if (currentView === 'lyrics' && hasSyncedLyrics) {
    if (lyricPlaybackActive) lyricPlayer.setCurrentTime(Math.round(sec * 1000), false);
    lyricPlayer.update(dt);
  }

  rafId = requestAnimationFrame(frameLoop);
}

function startLoop(): void {
  if (!appVisible || rafId) return;
  lastFramePerf = performance.now();
  rafId = requestAnimationFrame(frameLoop);
}

function stopLoop(): void {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function updateCompactFlag(): void {
  const compact = window.innerWidth < 1000 || window.innerHeight < 560;
  elApp.dataset.compact = compact ? '1' : '0';
  lyricPlayer.onResize();
}

const ro = new ResizeObserver(() => {
  updateCompactFlag();
});
ro.observe(elAmllHost);
window.addEventListener('resize', updateCompactFlag);

function applyFonts(fonts?: HostFontsPayload): void {
  if (!fonts) return;
  const fallback = '"HarmonyOS Sans SC", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", sans-serif';
  if (fonts.ui) {
    document.documentElement.style.setProperty('--fs-ui-font', `"${fonts.ui.replace(/"/g, '')}", ${fallback}`);
  }
  if (fonts.lyric) {
    document.documentElement.style.setProperty('--fs-lyric-font', `"${fonts.lyric.replace(/"/g, '')}", ${fallback}`);
  }
  lyricPlayer.onResize();
}

function applyStrings(s?: HostUiStrings): void {
  if (s) strings = { ...strings, ...s };
  elTopNow.textContent = strings.nowPlaying;
}

function applyView(v: 'lyrics' | 'default'): void {
  currentView = v === 'default' ? 'default' : 'lyrics';
  elApp.classList.toggle('mode-lyrics', currentView === 'lyrics');
  elApp.classList.toggle('mode-default', currentView === 'default');
  btnLyrics.classList.toggle('active', currentView === 'lyrics');
  syncBackgroundPlaybackState();
  syncLyricPlayerPlaybackState();
  requestAnimationFrame(() => lyricPlayer.onResize());
}

function applyVisible(v: boolean): void {
  appVisible = !!v;
  syncBackgroundPlaybackState();
  syncLyricPlayerPlaybackState(false);
  if (appVisible) {
    updateCompactFlag();
    startLoop();
  } else {
    stopLoop();
  }
}

function applyPlayback(pb?: HostPlaybackPayload, isSeek = false): void {
  if (!pb) return;
  const activelyPlaying = pb.playing && !pb.paused;
  pbState = { ...pb };
  clock.sync(pb.time, pb.length, activelyPlaying, isSeek, performance.now());

  btnPlay.innerHTML = iconSvg(activelyPlaying ? ICONS.pause : ICONS.play);
  btnShuffle.classList.toggle('active', !!pb.shuffle);
  btnRepeat.classList.toggle('active', pb.repeat > 0);
  btnRepeat.innerHTML = iconSvg(pb.repeat === 2 ? ICONS.repeat1 : ICONS.repeat);

  updateTimeAndSeekUi(currentMediaSec());
  applyVolumeUi(pb.volume);
  syncBackgroundPlaybackState();
  syncLyricPlayerPlaybackState(isSeek);
}

function applyCover(url: string): void {
  if (url === currentCoverUrl) return;
  currentCoverUrl = url;
  if (url) {
    elCoverImg.src = url;
    elCoverImg.classList.remove('empty');
    elCoverPh.classList.add('hidden-ph');
    elBgFallback.style.backgroundImage = `url("${url}")`;
    elBgFallback.style.opacity = '1';
    if (bgRender) {
      bgRender.setAlbum(url).catch(() => {});
    }
  } else {
    elCoverImg.removeAttribute('src');
    elCoverImg.classList.add('empty');
    elCoverPh.classList.remove('hidden-ph');
    elBgFallback.style.backgroundImage = '';
    if (bgRender) {
      bgRender.setAlbum('').catch(() => {});
    }
  }
}

elCoverImg.addEventListener('error', () => {
  elCoverImg.classList.add('empty');
  elCoverPh.classList.remove('hidden-ph');
});

function applyTrack(tr?: HostTrackPayload): boolean {
  if (!tr || !Number.isSafeInteger(tr.key)) return false;
  const changed = tr.key !== currentTrackKey;
  currentTrackKey = tr.key;
  currentTrackLen = tr.length || 0;
  elTitle.textContent = tr.title || strings.nothingPlaying;
  elArtist.textContent = tr.artist || strings.chooseMusic;
  applyCover(tr.coverUrl || '');
  return changed;
}

function applyLyrics(ly?: HostLyricsPayload): void {
  if (!ly) return;
  elLyricsHeading.textContent = ly.heading || '';
  const model = ly.model;

  if (!model || !Array.isArray(model.lines) || model.lines.length === 0) {
    hasSyncedLyrics = false;
    elAmllHost.classList.add('hidden');
    elStaticLyrics.classList.add('hidden');
    elLyricsEmpty.classList.remove('hidden');

    let msg = strings.noLyrics;
    if (ly.status === 'loading') msg = strings.loadingLyrics;
    else if (ly.remote && ly.status === 'idle') msg = strings.waitingMusic;
    elLyricsEmptyText.textContent = msg;
    lyricPlayer.setLyricLines([], 0);
    syncBackgroundPlaybackState();
    return;
  }

  if (model.synced) {
    const converted = toAmllLines(model, pbState.length || currentTrackLen);
    if (converted.length > 0) {
      hasSyncedLyrics = true;
      elLyricsEmpty.classList.add('hidden');
      elStaticLyrics.classList.add('hidden');
      elAmllHost.classList.remove('hidden');

      const curMs = Math.round(currentMediaSec() * 1000);
      lyricPlayer.setLyricLines(converted, curMs);
      lyricPlayer.resetScroll();
      lyricPlayer.onResize();
      lyricPlayer.setCurrentTime(curMs, true);
      lyricPlayer.update(0);
      syncBackgroundPlaybackState();
      return;
    }
  }

  hasSyncedLyrics = false;
  elAmllHost.classList.add('hidden');
  elLyricsEmpty.classList.add('hidden');
  elStaticLyrics.classList.remove('hidden');
  elStaticLyrics.textContent = model.lines.map((l) => l.text).join('\n');
  elStaticLyrics.scrollTop = 0;
  lyricPlayer.setLyricLines([], 0);
  syncBackgroundPlaybackState();
}

// AMLL click-to-seek
lyricPlayer.addEventListener('line-click', (e) => {
  const evt = e as LyricLineMouseEvent;
  const line = evt.line?.getLine?.();
  if (line && typeof line.startTime === 'number') {
    const timeSec = Math.max(0, line.startTime / 1000);
    postToHost({ type: 'seek', key: currentTrackKey, time: timeSec });
  }
});

// Top bar actions
function bindButton(btn: HTMLButtonElement, fn: () => void): void {
  btn.addEventListener('click', () => {
    btn.blur();
    fn();
  });
}

bindButton(btnViz, () => postToHost({ type: 'fsAct', act: 'viz' }));
bindButton(btnLyrics, () => {
  applyView(currentView === 'lyrics' ? 'default' : 'lyrics');
  postToHost({ type: 'fsAct', act: 'lyrics' });
});
bindButton(btnExit, () => postToHost({ type: 'fsAct', act: 'exit' }));

// Transport actions
bindButton(btnShuffle, () => postToHost({ type: 'ctrl', act: 'shuffle' }));
bindButton(btnPrev, () => postToHost({ type: 'ctrl', act: 'prev' }));
bindButton(btnPlay, () => postToHost({ type: 'ctrl', act: 'play' }));
bindButton(btnNext, () => postToHost({ type: 'ctrl', act: 'next' }));
bindButton(btnRepeat, () => postToHost({ type: 'ctrl', act: 'repeat' }));

// Seek bar pointer interaction
function barFraction(bar: HTMLElement, clientX: number): number {
  const rect = bar.getBoundingClientRect();
  return rect.width > 0 ? clamp01((clientX - rect.left) / rect.width) : 0;
}

elSeekBar.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  draggingSeek = true;
  seekTrackKey = currentTrackKey;
  elSeekBar.classList.add('dragging');
  elSeekBar.setPointerCapture(e.pointerId);
  seekDragFrac = barFraction(elSeekBar, e.clientX);
  updateTimeAndSeekUi(currentMediaSec());
});

elSeekBar.addEventListener('pointermove', (e) => {
  if (!draggingSeek) return;
  seekDragFrac = barFraction(elSeekBar, e.clientX);
  updateTimeAndSeekUi(currentMediaSec());
});

function finishSeek(e: PointerEvent): void {
  if (!draggingSeek) return;
  draggingSeek = false;
  elSeekBar.classList.remove('dragging');
  try { elSeekBar.releasePointerCapture(e.pointerId); } catch {}
  const len = pbState.length || currentTrackLen || 0;
  if (e.type === 'pointerup' && len > 0 && seekTrackKey === currentTrackKey) {
    const sec = len * seekDragFrac;
    postToHost({ type: 'seek', key: seekTrackKey, time: sec });
  }
}
elSeekBar.addEventListener('pointerup', finishSeek);
elSeekBar.addEventListener('pointercancel', finishSeek);

// Volume bar pointer interaction
elVolBar.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  draggingVol = true;
  elVolBar.classList.add('dragging');
  elVolBar.setPointerCapture(e.pointerId);
  volDragFrac = barFraction(elVolBar, e.clientX);
  applyVolumeUi(volDragFrac);
  postToHost({ type: 'volume', pos: volDragFrac });
});

elVolBar.addEventListener('pointermove', (e) => {
  if (!draggingVol) return;
  volDragFrac = barFraction(elVolBar, e.clientX);
  applyVolumeUi(volDragFrac);
  postToHost({ type: 'volume', pos: volDragFrac });
});

function finishVol(e: PointerEvent): void {
  if (!draggingVol) return;
  draggingVol = false;
  elVolBar.classList.remove('dragging');
  try { elVolBar.releasePointerCapture(e.pointerId); } catch {}
}
elVolBar.addEventListener('pointerup', finishVol);
elVolBar.addEventListener('pointercancel', finishVol);

// Wheel -> volume when not scrolling lyrics
window.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    return;
  }
  const target = e.target as HTMLElement | null;
  if (target && (elAmllHost.contains(target) || elStaticLyrics.contains(target))) {
    if (currentView === 'lyrics' && (hasSyncedLyrics || elStaticLyrics.scrollHeight > elStaticLyrics.clientHeight)) {
      return;
    }
  }
  const delta = e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0;
  if (delta !== 0) {
    postToHost({ type: 'volumeDelta', step: delta });
  }
}, { passive: false });

window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('dragstart', (e) => e.preventDefault());
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    postToHost({ type: 'key', code: 27 });
  } else if (e.key === ' ') {
    e.preventDefault();
    postToHost({ type: 'key', code: 32 });
  }
});

// Inbound updates from JSplitter
const wvApi = (window as unknown as {
  chrome?: {
    webview?: {
      addEventListener?: (type: string, cb: (ev: { data: unknown }) => void) => void;
    };
  };
}).chrome?.webview;

if (wvApi && typeof wvApi.addEventListener === 'function') {
  wvApi.addEventListener('message', (ev) => {
    const d = ev.data as Record<string, unknown> | null;
    if (!d || typeof d !== 'object') return;
    const type = String(d.type || '');
    if (type === 'preview-open') {
      applyVisible(false);
      elApp.classList.add('hidden');
      preview.message(d as unknown as PreviewMessage);
    } else if (type.startsWith('preview-')) {
      preview.message(d as unknown as PreviewMessage);
    } else if (type === 'init') {
      preview.close();
      elApp.classList.remove('hidden');
      const p = d as unknown as HostInitPayload;
      applyStrings(p.strings);
      applyFonts(p.fonts);
      if (p.view) applyView(p.view);
      applyTrack(p.track);
      hasSyncedLyrics = false;
      applyPlayback(p.playback, true);
      applyLyrics(p.lyrics);
      if (p.visible !== undefined) applyVisible(!!p.visible);
    } else if (type === 'track') {
      const changed = applyTrack(d.track as HostTrackPayload);
      if (changed) {
        applyLyrics({ remote: false, heading: '', status: 'loading', model: null });
      }
      applyPlayback(d.playback as HostPlaybackPayload, changed);
    } else if (type === 'cover') {
      if (d.key === currentTrackKey) {
        applyCover(String(d.coverUrl || ''));
      }
    } else if (type === 'lyrics') {
      if (d.key === currentTrackKey) {
        applyLyrics(d.lyrics as HostLyricsPayload);
      }
    } else if (type === 'playback') {
      if (d.key === currentTrackKey) applyPlayback(d.playback as HostPlaybackPayload, !!d.seek);
    } else if (type === 'view') {
      applyView(d.view === 'default' ? 'default' : 'lyrics');
    } else if (type === 'visible') {
      if (!d.visible) preview.close();
      applyVisible(!!d.visible);
    } else if (type === 'fonts') {
      applyFonts(d.fonts as HostFontsPayload);
    }
  });
}

updateCompactFlag();
motionPreference.addEventListener('change', applyMotionPreference);
applyMotionPreference();
postToHost({ type: 'ready' });
