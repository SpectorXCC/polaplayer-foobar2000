import { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { PlaybackState, TrackInfo } from '../types';
import { PlaybackClock } from '../bridge/playbackClock';
import { rpc } from '../bridge/rpc';
import { fmtTime, t, LangCode } from '../i18n/strings';
import { Cover } from './Cover';
import { Icon } from './Icons';

export interface PlayerBarProps {
  lang: LangCode;
  track: TrackInfo;
  playback: PlaybackState;
  clock: PlaybackClock;
  canLoveSong: boolean;
  compactVol: boolean;
  hasRightDrawer: boolean;
  rightDrawerOpen: boolean;
  shortWindow: boolean;
  narrowBar: boolean;
  onToggleLovedCurrent: () => void;
  onToggleRightDrawer: () => void;
  onEnterFullscreen: () => void;
}

export function PlayerBar({
  lang,
  track,
  playback,
  clock,
  canLoveSong,
  compactVol,
  hasRightDrawer,
  rightDrawerOpen,
  shortWindow,
  narrowBar,
  onToggleLovedCurrent,
  onToggleRightDrawer,
  onEnterFullscreen
}: PlayerBarProps): JSX.Element {
  const [dragSeekSec, setDragSeekSec] = useState<number | null>(null);
  const [liveSec, setLiveSec] = useState(0);
  const [volPopupOpen, setVolPopupOpen] = useState(false);
  const [mutedRestore, setMutedRestore] = useState(0.75);
  const volWrapRef = useRef<HTMLDivElement>(null);

  const hasTrack = track.key > 0 && Boolean(track.title);
  const duration = Math.max(0, playback.length || track.length || 0);
  const isPlayingActive = playback.playing && !playback.paused;

  useEffect(() => {
    setDragSeekSec(null);
  }, [track.key]);

  useEffect(() => {
    let raf = 0;
    let lastUpdate = 0;
    const tick = (now: number) => {
      if (now - lastUpdate >= 60) {
        lastUpdate = now;
        setLiveSec(clock.at(now) / 1000);
      }
      if (isPlayingActive) {
        raf = window.requestAnimationFrame(tick);
      }
    };
    setLiveSec(clock.at(performance.now()) / 1000);
    if (isPlayingActive) {
      raf = window.requestAnimationFrame(tick);
    }
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [isPlayingActive, playback.time, playback.length, clock]);

  useEffect(() => {
    if (!volPopupOpen) return;
    const onDocDown = (ev: MouseEvent) => {
      if (volWrapRef.current && !volWrapRef.current.contains(ev.target as Node)) {
        setVolPopupOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDocDown);
    return () => document.removeEventListener('pointerdown', onDocDown);
  }, [volPopupOpen]);

  const currentSec = dragSeekSec !== null ? dragSeekSec : Math.min(duration || liveSec, liveSec);
  const maxSeek = Math.max(duration, 1);
  const volPct = Math.round(Math.max(0, Math.min(1, playback.volume)) * 100);

  const toggleMute = () => {
    if (playback.volume > 0.01) {
      setMutedRestore(playback.volume);
      void rpc('playback.volume', { pos: 0 });
    } else {
      void rpc('playback.volume', { pos: mutedRestore > 0.05 ? mutedRestore : 0.75 });
    }
  };

  const commitSeek = (sec: number) => {
    setDragSeekSec(null);
    if (hasTrack && duration > 0) {
      void rpc('playback.seek', { key: track.key, time: Math.max(0, Math.min(duration, sec)) });
    }
  };

  return (
    <footer className={`player-bar ${shortWindow ? 'short' : ''} ${narrowBar ? 'narrow' : ''}`} role="contentinfo">
      <div className="pb-left">
        <button
          type="button"
          className="pb-cover-btn"
          aria-label="Open full-screen now playing"
          onClick={onEnterFullscreen}
        >
          <Cover url={track.coverUrl} seed={track.title || 'pola'} size={shortWindow ? 44 : 56} radius={6} contain />
        </button>

        <div className="pb-meta">
          <div className="pb-title truncate">
            {hasTrack ? track.title : t(lang, 'meta.now_playing')}
          </div>
          <div className="pb-artist truncate">
            {hasTrack ? track.artist || t(lang, 'meta.unknown') : t(lang, 'meta.choose_music')}
          </div>
        </div>

        {hasTrack && canLoveSong && (
          <button
            type="button"
            className={`pb-ctl pb-heart ${track.loved ? 'loved' : ''}`}
            aria-label={track.loved ? 'Unlike song' : 'Like song'}
            aria-pressed={track.loved}
            onClick={onToggleLovedCurrent}
          >
            <Icon name={track.loved ? 'heart' : 'heartO'} size={17} />
          </button>
        )}
      </div>

      <div className="pb-center">
        <div className="pb-controls">
          <button
            type="button"
            className={`pb-ctl ${playback.shuffle ? 'is-on' : ''}`}
            aria-label={t(lang, 'btn.shuffle')}
            aria-pressed={playback.shuffle}
            onClick={() => void rpc('playback.ctrl', { act: 'shuffle' })}
          >
            <Icon name="shuffle" size={16} />
          </button>

          <button
            type="button"
            className="pb-ctl"
            aria-label="Previous track"
            onClick={() => void rpc('playback.ctrl', { act: 'prev' })}
          >
            <Icon name="prev" size={18} />
          </button>

          <button
            type="button"
            className={`pb-play ${shortWindow ? 'small' : ''}`}
            aria-label={isPlayingActive ? 'Pause' : 'Play'}
            onClick={() => void rpc('playback.ctrl', { act: 'play' })}
          >
            <Icon name={isPlayingActive ? 'pause' : 'play'} size={shortWindow ? 17 : 20} />
          </button>

          <button
            type="button"
            className="pb-ctl"
            aria-label="Next track"
            onClick={() => void rpc('playback.ctrl', { act: 'next' })}
          >
            <Icon name="next" size={18} />
          </button>

          <button
            type="button"
            className={`pb-ctl ${playback.repeat > 0 ? 'is-on' : ''}`}
            aria-label="Repeat mode"
            aria-pressed={playback.repeat > 0}
            onClick={() => void rpc('playback.ctrl', { act: 'repeat' })}
          >
            <Icon name={playback.repeat === 2 ? 'repeat1' : 'repeat'} size={16} />
          </button>
        </div>

        <div className="pb-seek-row">
          <span className="pb-time">{fmtTime(hasTrack ? currentSec : 0)}</span>
          <input
            type="range"
            className="pola-range"
            aria-label="Playback seek"
            min={0}
            max={maxSeek}
            step={0.1}
            value={hasTrack ? currentSec : 0}
            disabled={!hasTrack || duration <= 0}
            style={{
              '--control-value': String(hasTrack ? currentSec : 0),
              '--attr-min': '0',
              '--attr-max': String(maxSeek)
            } as JSX.CSSProperties}
            onInput={(e) => {
              const v = Number((e.currentTarget as HTMLInputElement).value);
              setDragSeekSec(v);
            }}
            onChange={(e) => {
              const v = Number((e.currentTarget as HTMLInputElement).value);
              commitSeek(v);
            }}
          />
          <span className="pb-time right">{fmtTime(duration)}</span>
        </div>
      </div>

      <div className="pb-right">
        {hasRightDrawer && (
          <button
            type="button"
            className={`pb-ctl ${rightDrawerOpen ? 'is-on' : ''}`}
            aria-label={`${t(lang, 'tab.queue')} / ${t(lang, 'tab.lyrics')}`}
            aria-expanded={rightDrawerOpen}
            aria-controls="right-drawer"
            onClick={onToggleRightDrawer}
          >
            <Icon name="mic" size={17} />
          </button>
        )}

        <div
          ref={volWrapRef}
          className="pb-vol-wrap"
          onWheel={(e) => {
            e.preventDefault();
            const step = e.deltaY < 0 ? 0.05 : e.deltaY > 0 ? -0.05 : 0;
            if (step !== 0) {
              const next = Math.max(0, Math.min(1, playback.volume + step));
              void rpc('playback.volume', { pos: next });
            }
          }}
        >
          {compactVol ? (
            <>
              <button
                type="button"
                className="pb-ctl"
                aria-label="Volume"
                aria-expanded={volPopupOpen}
                onClick={() => setVolPopupOpen((o) => !o)}
              >
                <Icon name={volPct === 0 ? 'volumeMute' : 'volume'} size={18} />
              </button>
              {volPopupOpen && (
                <div className="vol-popover card">
                  <button type="button" className="pb-ctl" aria-label="Mute toggle" onClick={toggleMute}>
                    <Icon name={volPct === 0 ? 'volumeMute' : 'volume'} size={16} />
                  </button>
                  <input
                    type="range"
                    className="pola-range vol-range"
                    aria-label="Volume slider"
                    min={0}
                    max={100}
                    step={1}
                    value={volPct}
                    style={{
                      '--control-value': String(volPct),
                      '--attr-min': '0',
                      '--attr-max': '100'
                    } as JSX.CSSProperties}
                    onInput={(e) => {
                      const pct = Number((e.currentTarget as HTMLInputElement).value);
                      void rpc('playback.volume', { pos: pct / 100 });
                    }}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="pb-vol-inline">
              <button type="button" className="pb-ctl" aria-label="Mute toggle" onClick={toggleMute}>
                <Icon name={volPct === 0 ? 'volumeMute' : 'volume'} size={18} />
              </button>
              <input
                type="range"
                className="pola-range vol-range"
                aria-label="Volume"
                min={0}
                max={100}
                step={1}
                value={volPct}
                style={{
                  '--control-value': String(volPct),
                  '--attr-min': '0',
                  '--attr-max': '100'
                } as JSX.CSSProperties}
                onInput={(e) => {
                  const pct = Number((e.currentTarget as HTMLInputElement).value);
                  void rpc('playback.volume', { pos: pct / 100 });
                }}
              />
            </div>
          )}
        </div>

        <button
          type="button"
          className="pb-ctl"
          aria-label="Fullscreen"
          title="Fullscreen"
          onClick={onEnterFullscreen}
        >
          <Icon name="expand" size={17} />
        </button>
      </div>
    </footer>
  );
}
