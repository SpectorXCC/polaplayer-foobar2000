import { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  BackgroundRender,
  DomLyricPlayer,
  LyricLineMouseEvent,
  MeshGradientRenderer
} from '@applemusic-like-lyrics/core';
import { LyricsState, PlaybackState, TrackInfo } from '../types';
import { toAmllLines } from '../bridge/lyricsAdapter';
import { PlaybackClock } from '../bridge/playbackClock';
import { rpc } from '../bridge/rpc';
import { fmtTime, t, LangCode } from '../i18n/strings';
import { Icon } from '../components/Icons';
import { VisualizerCanvas, VizStyle } from './VisualizerCanvas';

export interface VizFrame {
  bass: number;
  bands: number[];
}

export interface FullscreenOverlayProps {
  visible: boolean;
  view: 'lyrics' | 'default' | 'viz';
  lang: LangCode;
  track: TrackInfo;
  playback: PlaybackState;
  clock: PlaybackClock;
  lyrics: LyricsState;
  vizFrame: VizFrame;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function barFraction(el: HTMLElement, clientX: number): number {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 ? clamp01((clientX - rect.left) / rect.width) : 0;
}

export function FullscreenOverlay({
  visible,
  view,
  lang,
  track,
  playback,
  clock,
  lyrics,
  vizFrame
}: FullscreenOverlayProps): JSX.Element | null {
  const appRef = useRef<HTMLDivElement>(null);
  const bgHostRef = useRef<HTMLDivElement>(null);
  const amllHostRef = useRef<HTMLDivElement>(null);
  const staticLyricsRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<BackgroundRender<MeshGradientRenderer> | null>(null);
  const playerRef = useRef<DomLyricPlayer | null>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const volBarRef = useRef<HTMLDivElement>(null);

  const lastCoverRef = useRef<string>('');
  const lastTrackKeyRef = useRef<number>(0);
  const seekTrackKeyRef = useRef<number>(0);

  const [compact, setCompact] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 1000 || window.innerHeight < 560 : false
  );
  const [reducedMotion, setReducedMotion] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );
  const [coverFailed, setCoverFailed] = useState(false);

  const [draggingSeek, setDraggingSeek] = useState(false);
  const [seekDragFrac, setSeekDragFrac] = useState<number | null>(null);
  const [draggingVol, setDraggingVol] = useState(false);
  const [volDragFrac, setVolDragFrac] = useState<number | null>(null);
  const [liveSec, setLiveSec] = useState(0);

  const [vizStyle, setVizStyle] = useState<VizStyle>(() => {
    try {
      return localStorage.getItem('pola.vizStyle') === 'radial' ? 'radial' : 'bars';
    } catch {
      return 'bars';
    }
  });

  const toggleVizStyle = () => {
    setVizStyle((cur) => {
      const next = cur === 'bars' ? 'radial' : 'bars';
      try {
        localStorage.setItem('pola.vizStyle', next);
      } catch {}
      return next;
    });
  };

  const hasTrack = track.key > 0 && Boolean(track.title);
  const duration = Math.max(0, playback.length || track.length || 0);
  const isPlayingActive = playback.playing && !playback.paused;
  const isViz = view === 'viz';
  const showLyricsCol = view === 'lyrics';
  const amllLines = useMemo(() => toAmllLines(lyrics.model, duration), [lyrics.model, duration]);
  const hasSyncedLyrics = amllLines.length > 0;
  const staticLines = useMemo(
    () => (lyrics.model?.lines || []).filter((l) => Boolean(l.text || l.translatedLyric)),
    [lyrics.model]
  );

  useEffect(() => {
    lastTrackKeyRef.current = track.key;
    setSeekDragFrac(null);
    setDraggingSeek(false);
  }, [track.key]);

  useEffect(() => {
    setCoverFailed(false);
  }, [track.coverUrl]);

  // Match fullscreen-web reduced motion & compact threshold (<1000px || <560px)
  useEffect(() => {
    if (!visible) return;
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onMotion = () => setReducedMotion(Boolean(mq?.matches));
    onMotion();
    mq?.addEventListener?.('change', onMotion);

    const onResize = () => {
      setCompact(window.innerWidth < 1000 || window.innerHeight < 560);
      playerRef.current?.onResize();
    };
    onResize();
    window.addEventListener('resize', onResize);

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    if (ro && amllHostRef.current) ro.observe(amllHostRef.current);

    return () => {
      mq?.removeEventListener?.('change', onMotion);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, [visible, showLyricsCol]);

  // Mount AMLL BackgroundRender matching fullscreen-web parameters
  useEffect(() => {
    if (!visible) return;
    const bgHost = bgHostRef.current;
    if (!bgHost) return;

    let bg: BackgroundRender<MeshGradientRenderer> | null = null;
    try {
      if (MeshGradientRenderer.isSupported()) {
        bg = BackgroundRender.new(MeshGradientRenderer);
        bg.setRenderScale(0.5);
        bg.setFPS(45);
        bg.setFlowSpeed(1.8);
        bgHost.appendChild(bg.getElement());
        bgRef.current = bg;
        lastCoverRef.current = '';
      }
    } catch {
      bg = null;
    }

    return () => {
      bg?.dispose();
      bgRef.current = null;
      lastCoverRef.current = '';
    };
  }, [visible]);

  // Mount AMLL DomLyricPlayer matching fullscreen-web physics & alignment
  useEffect(() => {
    if (!visible || !showLyricsCol) return;
    const host = amllHostRef.current;
    if (!host) return;

    const player = new DomLyricPlayer();
    player.setEnableBlur(!reducedMotion);
    player.setEnableScale(!reducedMotion);
    player.setEnableSpring(!reducedMotion);
    player.setAlignPosition(0.44);
    player.setEnableAutoSeekDetection(true);
    player.pause();
    host.appendChild(player.getElement());
    playerRef.current = player;

    const onLineClick = (ev: Event) => {
      const lme = ev as LyricLineMouseEvent;
      const startMs = lme.line?.getLine?.()?.startTime;
      if (typeof startMs === 'number' && Number.isFinite(startMs) && lastTrackKeyRef.current > 0) {
        void rpc('playback.seek', { key: lastTrackKeyRef.current, time: Math.max(0, startMs / 1000) });
      }
    };
    player.addEventListener('line-click', onLineClick);

    return () => {
      player.removeEventListener('line-click', onLineClick);
      player.dispose();
      playerRef.current = null;
    };
  }, [visible, showLyricsCol]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.setEnableSpring(!reducedMotion);
    player.setEnableScale(!reducedMotion);
    player.setEnableBlur(!reducedMotion);
  }, [reducedMotion]);

  // Update background album art
  useEffect(() => {
    const bg = bgRef.current;
    const src = track.coverUrl || '';
    if (!visible || !bg) return;
    if (src !== lastCoverRef.current) {
      lastCoverRef.current = src;
      void bg.setAlbum(src).catch(() => {});
    }
  }, [visible, track.coverUrl]);

  // Sync background & lyric player playback state
  useEffect(() => {
    const bg = bgRef.current;
    if (visible && bg) {
      bg.getElement().style.display = reducedMotion ? 'none' : '';
      if (reducedMotion) {
        bg.pause();
      } else {
        bg.resume();
        bg.setFlowSpeed(isPlayingActive ? 2.0 : 0.45);
        bg.setHasLyric(showLyricsCol && hasSyncedLyrics);
      }
    }

    const player = playerRef.current;
    if (player) {
      if (visible && showLyricsCol && isPlayingActive) player.resume();
      else player.pause();
    }
  }, [visible, reducedMotion, isPlayingActive, showLyricsCol, hasSyncedLyrics]);

  // Push lyric lines & reset scroll cleanly when track/lyrics change
  useEffect(() => {
    const player = playerRef.current;
    if (!visible || !player || !showLyricsCol) return;
    if (hasSyncedLyrics) {
      const curMs = Math.round(clock.at(performance.now()));
      player.setLyricLines(amllLines, curMs);
      player.resetScroll();
      player.onResize();
      player.setCurrentTime(curMs, true);
      player.update(0);
    } else {
      player.setLyricLines([], 0);
    }
  }, [visible, showLyricsCol, hasSyncedLyrics, amllLines, clock]);

  // 60fps animation frame driving DomLyricPlayer + smooth seek clock
  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    let lastPerf = performance.now();

    const frame = (now: number) => {
      raf = 0;
      const dt = Math.max(0, Math.min(100, now - lastPerf));
      lastPerf = now;
      const ms = clock.at(now);
      setLiveSec(ms / 1000);

      const player = playerRef.current;
      if (player && showLyricsCol && hasSyncedLyrics) {
        if (isPlayingActive) player.setCurrentTime(Math.round(ms), false);
        player.update(dt);
      }
      if (isPlayingActive) {
        raf = window.requestAnimationFrame(frame);
      }
    };

    const initMs = clock.at(performance.now());
    setLiveSec(initMs / 1000);
    if (playerRef.current && showLyricsCol && hasSyncedLyrics) {
      playerRef.current.setCurrentTime(Math.round(initMs), true);
      playerRef.current.update(0);
    }
    if (isPlayingActive) {
      raf = window.requestAnimationFrame(frame);
    }
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [visible, showLyricsCol, hasSyncedLyrics, isPlayingActive, playback.time, playback.length, clock]);

  if (!visible) return null;

  const shownSec =
    draggingSeek && seekDragFrac !== null
      ? duration * seekDragFrac
      : Math.min(duration || liveSec, liveSec);
  const seekFrac = duration > 0 ? clamp01(shownSec / duration) : 0;
  const volFrac = clamp01(draggingVol && volDragFrac !== null ? volDragFrac : playback.volume);

  const onSeekDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !hasTrack || duration <= 0) return;
    const bar = seekBarRef.current;
    if (!bar) return;
    setDraggingSeek(true);
    seekTrackKeyRef.current = track.key;
    bar.setPointerCapture(e.pointerId);
    setSeekDragFrac(barFraction(bar, e.clientX));
  };

  const onSeekMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!draggingSeek || !seekBarRef.current) return;
    setSeekDragFrac(barFraction(seekBarRef.current, e.clientX));
  };

  const finishSeek = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!draggingSeek) return;
    const bar = seekBarRef.current;
    const finalFrac = bar ? barFraction(bar, e.clientX) : (seekDragFrac ?? 0);
    setDraggingSeek(false);
    setSeekDragFrac(null);
    if (bar) {
      try { bar.releasePointerCapture(e.pointerId); } catch {}
    }
    if (e.type === 'pointerup' && duration > 0 && seekTrackKeyRef.current === track.key) {
      void rpc('playback.seek', { key: track.key, time: duration * finalFrac });
    }
  };

  const onVolDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !volBarRef.current) return;
    setDraggingVol(true);
    volBarRef.current.setPointerCapture(e.pointerId);
    const f = barFraction(volBarRef.current, e.clientX);
    setVolDragFrac(f);
    void rpc('playback.volume', { pos: f });
  };

  const onVolMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!draggingVol || !volBarRef.current) return;
    const f = barFraction(volBarRef.current, e.clientX);
    setVolDragFrac(f);
    void rpc('playback.volume', { pos: f });
  };

  const finishVol = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!draggingVol) return;
    setDraggingVol(false);
    setVolDragFrac(null);
    if (volBarRef.current) {
      try { volBarRef.current.releasePointerCapture(e.pointerId); } catch {}
    }
  };

  const onOverlayWheel = (e: JSX.TargetedWheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey) {
      e.preventDefault();
      return;
    }
    const target = e.target as HTMLElement | null;
    if (
      showLyricsCol &&
      target &&
      (amllHostRef.current?.contains(target) || staticLyricsRef.current?.contains(target))
    ) {
      const staticEl = staticLyricsRef.current;
      if (hasSyncedLyrics || (staticEl && staticEl.scrollHeight > staticEl.clientHeight)) {
        return;
      }
    }
    const step = e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0;
    if (step !== 0) {
      const nextVol = clamp01(playback.volume + step * 0.05);
      void rpc('playback.volume', { pos: nextVol });
    }
  };

  const renderTransport = () => (
    <div className="fs-ctrl-row">
      <button
        type="button"
        className={`fs-transport-btn sm ${playback.shuffle ? 'active' : ''}`}
        aria-label="Shuffle"
        aria-pressed={playback.shuffle}
        onClick={(e) => {
          (e.currentTarget as HTMLButtonElement).blur();
          void rpc('playback.ctrl', { act: 'shuffle' });
        }}
      >
        <Icon name="shuffle" size={21} />
      </button>
      <button
        type="button"
        className="fs-transport-btn md"
        aria-label="Previous track"
        onClick={(e) => {
          (e.currentTarget as HTMLButtonElement).blur();
          void rpc('playback.ctrl', { act: 'prev' });
        }}
      >
        <Icon name="prev" size={34} />
      </button>
      <button
        type="button"
        className="fs-transport-btn lg"
        aria-label={isPlayingActive ? 'Pause' : 'Play'}
        onClick={(e) => {
          (e.currentTarget as HTMLButtonElement).blur();
          void rpc('playback.ctrl', { act: 'play' });
        }}
      >
        <Icon name={isPlayingActive ? 'pause' : 'play'} size={36} />
      </button>
      <button
        type="button"
        className="fs-transport-btn md"
        aria-label="Next track"
        onClick={(e) => {
          (e.currentTarget as HTMLButtonElement).blur();
          void rpc('playback.ctrl', { act: 'next' });
        }}
      >
        <Icon name="next" size={34} />
      </button>
      <button
        type="button"
        className={`fs-transport-btn sm ${playback.repeat > 0 ? 'active' : ''}`}
        aria-label="Repeat mode"
        aria-pressed={playback.repeat > 0}
        onClick={(e) => {
          (e.currentTarget as HTMLButtonElement).blur();
          void rpc('playback.ctrl', { act: 'repeat' });
        }}
      >
        <Icon name={playback.repeat === 2 ? 'repeat1' : 'repeat'} size={21} />
      </button>
    </div>
  );

  const renderSeekSection = () => (
    <div className="fs-seek-section">
      <div
        ref={seekBarRef}
        className={`fs-slider-track fs-seek-track ${draggingSeek ? 'dragging' : ''}`}
        role="slider"
        tabIndex={-1}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(hasTrack ? shownSec : 0)}
        onPointerDown={onSeekDown}
        onPointerMove={onSeekMove}
        onPointerUp={finishSeek}
        onPointerCancel={finishSeek}
      >
        <div className="fs-slider-rail">
          <div className="fs-slider-fill" style={{ width: `${((hasTrack ? seekFrac : 0) * 100).toFixed(3)}%` }} />
        </div>
      </div>
      <div className="fs-time-row">
        <span className="fs-time-label">{fmtTime(hasTrack ? shownSec : 0)}</span>
        <span className="fs-time-label">{`\u2212${fmtTime(Math.max(0, duration - (hasTrack ? shownSec : 0)))}`}</span>
      </div>
    </div>
  );

  const renderVolumeRow = () => (
    <div className="fs-vol-row">
      <span className="fs-vol-icon">
        <Icon name={volFrac === 0 ? 'volumeMute' : 'volume'} size={18} />
      </span>
      <div
        ref={volBarRef}
        className={`fs-slider-track fs-vol-track ${draggingVol ? 'dragging' : ''}`}
        role="slider"
        tabIndex={-1}
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(volFrac * 100)}
        onPointerDown={onVolDown}
        onPointerMove={onVolMove}
        onPointerUp={finishVol}
        onPointerCancel={finishVol}
      >
        <div className="fs-slider-rail">
          <div className="fs-slider-fill" style={{ width: `${(volFrac * 100).toFixed(2)}%` }} />
        </div>
      </div>
    </div>
  );

  const showImg = Boolean(track.coverUrl) && !coverFailed;
  const lyricsHeading =
    lyrics.heading || (track.source === 'navidrome' ? t(lang, 'lyrics.heading_nv') : t(lang, 'lyrics.heading'));

  return (
    <div className="fs-overlay" role="region" aria-label="Fullscreen player" onWheel={onOverlayWheel}>
      <div
        className="fs-bg-fallback"
        style={track.coverUrl ? { backgroundImage: `url("${track.coverUrl}")`, opacity: 1 } : undefined}
        aria-hidden="true"
      />
      <div ref={bgHostRef} className="fs-bg-layer" aria-hidden="true" />
      <div className="fs-scrim" aria-hidden="true" />

      <div
        ref={appRef}
        className={`fs-app ${isViz ? 'mode-viz' : showLyricsCol ? 'mode-lyrics' : 'mode-default'}`}
        data-compact={compact ? '1' : '0'}
      >
        <header className="fs-top-bar">
          <div className="fs-top-title">{t(lang, 'meta.now_playing')}</div>
          <div className="fs-top-actions">
            <button
              id="btn-viz"
              type="button"
              className={`fs-icon-btn ${isViz ? 'active' : ''}`}
              aria-label={t(lang, 'fs.toggle_viz')}
              aria-pressed={isViz}
              onClick={(e) => {
                (e.currentTarget as HTMLButtonElement).blur();
                void rpc('fullscreen.setView', { view: isViz ? 'lyrics' : 'viz' });
              }}
            >
              <Icon name="equalizer" size={22} />
            </button>
            <button
              id="btn-lyrics"
              type="button"
              className={`fs-icon-btn ${showLyricsCol ? 'active' : ''}`}
              aria-label={t(lang, 'fs.toggle_lyrics')}
              aria-pressed={showLyricsCol}
              onClick={(e) => {
                (e.currentTarget as HTMLButtonElement).blur();
                void rpc('fullscreen.setView', { view: showLyricsCol ? 'default' : 'lyrics' });
              }}
            >
              <Icon name="mic" size={22} />
            </button>
            <button
              id="btn-exit"
              type="button"
              className="fs-icon-btn"
              aria-label={t(lang, 'fs.exit')}
              onClick={(e) => {
                (e.currentTarget as HTMLButtonElement).blur();
                void rpc('fullscreen.exit');
              }}
            >
              <Icon name="compress" size={22} />
            </button>
          </div>
        </header>

        {isViz ? (
          <main className="fs-viz-stage">
            <div className="fs-viz-head">
              <div className="fs-viz-mini-np">
                {showImg ? (
                  <img
                    className="fs-viz-mini-cover"
                    src={track.coverUrl}
                    alt=""
                    crossOrigin="anonymous"
                    onError={() => setCoverFailed(true)}
                  />
                ) : (
                  <div className="fs-viz-mini-ph">
                    <Icon name="album" size={28} />
                  </div>
                )}
                <div className="fs-viz-mini-meta">
                  <div className="fs-viz-mini-title truncate">
                    {hasTrack ? track.title : t(lang, 'queue.nothing_playing')}
                  </div>
                  <div className="fs-viz-mini-artist truncate">
                    {hasTrack ? track.artist : t(lang, 'meta.choose_music')}
                  </div>
                </div>
              </div>
              <button
                id="btn-viz-style"
                type="button"
                className="fs-style-pill"
                onClick={toggleVizStyle}
              >
                {vizStyle === 'radial' ? t(lang, 'fs.radial') : t(lang, 'fs.bars')}
              </button>
            </div>

            <div className="fs-viz-canvas-wrap">
              <VisualizerCanvas
                bands={vizFrame.bands}
                bass={vizFrame.bass}
                style={vizStyle}
                track={track}
                onToggleStyle={toggleVizStyle}
              />
            </div>

            <div className="fs-viz-bottom">
              {renderSeekSection()}
              {renderTransport()}
            </div>
          </main>
        ) : (
          <main className="fs-stage">
            <section className="fs-left-col">
              <div className="fs-cover-wrap">
                {showImg && (
                  <img
                    className="fs-cover-img"
                    src={track.coverUrl}
                    alt=""
                    crossOrigin="anonymous"
                    onError={() => setCoverFailed(true)}
                  />
                )}
                {!showImg && (
                  <div className="fs-cover-placeholder">
                    <div className="fs-cover-ph-icon">
                      <Icon name="album" size={64} />
                    </div>
                  </div>
                )}
              </div>

              <div className="fs-track-meta">
                <div className="fs-track-title truncate">
                  {hasTrack ? track.title : t(lang, 'queue.nothing_playing')}
                </div>
                <div className="fs-track-artist truncate">
                  {hasTrack ? track.artist : t(lang, 'meta.choose_music')}
                </div>
              </div>

              {renderSeekSection()}
              {renderTransport()}
              {renderVolumeRow()}
            </section>

            <section className="fs-right-col">
              <div className="fs-lyrics-heading">{lyricsHeading}</div>
              <div className="fs-lyrics-stage">
                <div
                  ref={amllHostRef}
                  className={`fs-amll-host ${hasSyncedLyrics ? '' : 'hidden'}`}
                />
                {!hasSyncedLyrics && staticLines.length > 0 && (
                  <div ref={staticLyricsRef} className="fs-static-lyrics">
                    {staticLines.map((l, idx) => (
                      <div key={idx} className="fs-static-line">
                        <div>{l.text}</div>
                        {l.translatedLyric && <div className="fs-static-trans">{l.translatedLyric}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {!hasSyncedLyrics && staticLines.length === 0 && (
                  <div className="fs-lyrics-empty">
                    <div className="fs-lyrics-empty-text">
                      {!hasTrack
                        ? t(lang, 'lyrics.waiting_music')
                        : lyrics.status === 'loading'
                          ? t(lang, 'lyrics.loading')
                          : t(lang, 'lyrics.none')}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </main>
        )}
      </div>
    </div>
  );
}
