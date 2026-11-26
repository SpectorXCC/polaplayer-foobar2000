import { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LyricsState, PlaybackState, QueueState, TrackInfo } from '../types';
import { PlaybackClock } from '../bridge/playbackClock';
import { rpc } from '../bridge/rpc';
import { fmtTime, t, LangCode } from '../i18n/strings';
import { Cover } from './Cover';
import { Icon } from './Icons';

export interface RightPaneProps {
  lang: LangCode;
  rightTab: 'lyrics' | 'queue';
  track: TrackInfo;
  playback: PlaybackState;
  clock: PlaybackClock;
  queue: QueueState;
  lyrics: LyricsState;
  isDrawer: boolean;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}

export function RightPane({
  lang,
  rightTab,
  track,
  playback,
  clock,
  queue,
  lyrics,
  isDrawer,
  drawerOpen,
  onCloseDrawer
}: RightPaneProps): JSX.Element {
  const [activeLineIdx, setActiveLineIdx] = useState(-1);
  const lyricsScrollRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLButtonElement>(null);
  const userScrollingUntilRef = useRef(0);
  const lastTrackedIdxRef = useRef(-1);

  const syncedLines = useMemo(() => {
    if (!lyrics.model?.synced || !Array.isArray(lyrics.model.lines)) return [];
    return lyrics.model.lines.filter((line) => typeof line.t === 'number' && Number.isFinite(line.t));
  }, [lyrics.model]);

  useEffect(() => {
    lastTrackedIdxRef.current = -1;
    setActiveLineIdx(-1);
    if (lyricsScrollRef.current) lyricsScrollRef.current.scrollTop = 0;
  }, [lyrics.key, syncedLines.length]);

  useEffect(() => {
    if (rightTab !== 'lyrics' || syncedLines.length === 0) {
      setActiveLineIdx(-1);
      return;
    }

    const computeIndex = (timeSec: number) => {
      let lo = 0;
      let hi = syncedLines.length - 1;
      let best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if ((syncedLines[mid].t ?? 0) <= timeSec + 0.08) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return best;
    };

    let raf = 0;
    let lastCheck = 0;
    const step = (now: number) => {
      if (now - lastCheck >= 70) {
        lastCheck = now;
        const sec = clock.at(now) / 1000;
        const idx = computeIndex(sec);
        if (idx !== lastTrackedIdxRef.current) {
          lastTrackedIdxRef.current = idx;
          setActiveLineIdx(idx);
        }
      }
      if (playback.playing && !playback.paused) {
        raf = window.requestAnimationFrame(step);
      }
    };

    const nowSec = clock.at(performance.now()) / 1000;
    const initIdx = computeIndex(nowSec);
    lastTrackedIdxRef.current = initIdx;
    setActiveLineIdx(initIdx);

    if (playback.playing && !playback.paused) {
      raf = window.requestAnimationFrame(step);
    }
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [rightTab, syncedLines, playback.playing, playback.paused, playback.time, clock]);

  useEffect(() => {
    if (rightTab !== 'lyrics' || activeLineIdx < 0) return;
    if (performance.now() < userScrollingUntilRef.current) return;
    const host = lyricsScrollRef.current;
    const el = activeLineRef.current;
    if (!host || !el) return;
    const targetTop = el.offsetTop - host.clientHeight * 0.36 + el.clientHeight * 0.5;
    host.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
  }, [activeLineIdx, rightTab]);

  const switchTab = (tab: 'queue' | 'lyrics') => {
    if (tab !== rightTab) {
      void rpc('settings.saveRightTab', { rightTab: tab });
    }
  };

  const handleTabKeyDown = (ev: KeyboardEvent, current: 'queue' | 'lyrics') => {
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'Home' || ev.key === 'End') {
      ev.preventDefault();
      const next: 'queue' | 'lyrics' =
        ev.key === 'Home' ? 'queue' : ev.key === 'End' ? 'lyrics' : current === 'queue' ? 'lyrics' : 'queue';
      switchTab(next);
      const btn = document.getElementById(`rp-tab-${next}`);
      btn?.focus();
    }
  };

  const hasTrack = track.key > 0 && Boolean(track.title);
  const heading =
    lyrics.heading || (track.source === 'navidrome' ? t(lang, 'lyrics.heading_nv') : t(lang, 'lyrics.heading'));

  const pane = (
    <aside
      id="right-drawer"
      className={`card right-pane ${isDrawer ? 'is-drawer' : ''} ${isDrawer && drawerOpen ? 'open' : ''}`}
      aria-label="Queue and Lyrics"
    >
      <div className="rp-header">
        <div className="rp-tabs" role="tablist" aria-label="Right panel tabs">
          <button
            type="button"
            id="rp-tab-queue"
            role="tab"
            className={`rp-tab ${rightTab === 'queue' ? 'active' : ''}`}
            aria-selected={rightTab === 'queue'}
            aria-controls="rp-panel-queue"
            tabIndex={rightTab === 'queue' ? 0 : -1}
            onClick={() => switchTab('queue')}
            onKeyDown={(e) => handleTabKeyDown(e, 'queue')}
          >
            {t(lang, 'tab.queue')}
          </button>
          <button
            type="button"
            id="rp-tab-lyrics"
            role="tab"
            className={`rp-tab ${rightTab === 'lyrics' ? 'active' : ''}`}
            aria-selected={rightTab === 'lyrics'}
            aria-controls="rp-panel-lyrics"
            tabIndex={rightTab === 'lyrics' ? 0 : -1}
            onClick={() => switchTab('lyrics')}
            onKeyDown={(e) => handleTabKeyDown(e, 'lyrics')}
          >
            {t(lang, 'tab.lyrics')}
          </button>
        </div>

        {isDrawer && (
          <button type="button" className="icon-btn" aria-label={t(lang, 'btn.close')} onClick={onCloseDrawer}>
            <Icon name="close" size={16} />
          </button>
        )}
      </div>

      <section
        id="rp-panel-queue"
        role="tabpanel"
        aria-labelledby="rp-tab-queue"
        className="rp-panel scroll-area"
        hidden={rightTab !== 'queue'}
      >
        <div className="q-section-label">{t(lang, 'queue.now_playing')}</div>
        {hasTrack ? (
          <div className="q-row current">
            <Cover url={track.coverUrl} seed={track.title + track.artist} size={42} radius={6} contain />
            <div className="q-row-meta">
              <div className="q-row-title active-green truncate">{track.title}</div>
              <div className="q-row-artist truncate">{track.artist || t(lang, 'meta.unknown')}</div>
            </div>
            <span className="q-row-dur">{fmtTime(playback.length || track.length)}</span>
          </div>
        ) : (
          <div className="q-empty-box">{t(lang, 'queue.nothing_playing')}</div>
        )}

        {queue.manual.length > 0 && (
          <>
            <div className="q-section-label">{t(lang, 'queue.next_in_queue')}</div>
            {queue.manual.map((row) => (
              <div key={`m-${row.index}-${row.title}`} className="q-row">
                <button
                  type="button"
                  className="q-row-hit"
                  onClick={() => void rpc('queue.playManual', { index: row.index })}
                >
                  <Cover url={row.coverUrl} seed={row.title + row.artist} size={40} radius={5} contain />
                  <div className="q-row-meta">
                    <div className="q-row-title truncate">{row.title}</div>
                    <div className="q-row-artist truncate">{row.artist || t(lang, 'meta.unknown')}</div>
                  </div>
                </button>
                <span className="q-row-dur">{fmtTime(row.duration)}</span>
                <button
                  type="button"
                  className="q-row-rm"
                  aria-label={t(lang, 'menu.queue_remove')}
                  title={t(lang, 'menu.queue_remove')}
                  onClick={() => void rpc('queue.removeManual', { index: row.index })}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
          </>
        )}

        <div className="q-section-label">
          {queue.repeatingTrack
            ? t(lang, 'queue.repeating_song')
            : queue.sourceName
              ? t(lang, 'queue.next_from', queue.sourceName)
              : t(lang, 'queue.next_up')}
        </div>

        {queue.repeatingTrack ? null : queue.next.length === 0 ? (
          <div className="q-empty-box">{t(lang, 'queue.end_of_playlist')}</div>
        ) : (
          queue.next.map((row) => (
            <div key={`n-${row.playlistIndex}-${row.itemIndex}`} className="q-row">
              <button
                type="button"
                className="q-row-hit"
                onClick={() =>
                  void rpc('queue.playNext', { playlistIndex: row.playlistIndex, itemIndex: row.itemIndex })
                }
              >
                <Cover url={row.coverUrl} seed={row.title + row.artist} size={40} radius={5} contain />
                <div className="q-row-meta">
                  <div className="q-row-title truncate">{row.title}</div>
                  <div className="q-row-artist truncate">{row.artist || t(lang, 'meta.unknown')}</div>
                </div>
              </button>
              <span className="q-row-dur">{fmtTime(row.duration)}</span>
            </div>
          ))
        )}
      </section>

      <section
        id="rp-panel-lyrics"
        role="tabpanel"
        aria-labelledby="rp-tab-lyrics"
        className="rp-panel lyr-panel"
        hidden={rightTab !== 'lyrics'}
      >
        <div className="lyr-toolbar">
          <span className="lyr-badge">{heading}</span>
          {hasTrack && (
            <button
              type="button"
              className="mini-btn"
              onClick={() => void rpc('lyrics.retry')}
            >
              {t(lang, 'lyrics.retry')}
            </button>
          )}
        </div>

        {hasTrack && (
          <div className="lyr-track-card">
            <Cover url={track.coverUrl} seed={track.title + track.artist} size={40} radius={6} contain />
            <div className="lyr-track-meta">
              <div className="lyr-track-title truncate">{track.title}</div>
              <div className="lyr-track-artist truncate">{track.artist || t(lang, 'meta.unknown')}</div>
            </div>
          </div>
        )}

        <div
          ref={lyricsScrollRef}
          className="lyr-scroll scroll-area"
          onWheel={() => {
            userScrollingUntilRef.current = performance.now() + 3500;
          }}
        >
          {!hasTrack ? (
            <div className="lyr-state">{t(lang, 'lyrics.waiting_music')}</div>
          ) : lyrics.status === 'loading' ? (
            <div className="lyr-state">{t(lang, 'lyrics.loading')}</div>
          ) : !lyrics.model || !lyrics.model.lines || lyrics.model.lines.length === 0 ? (
            <div className="lyr-state">
              <div>{t(lang, 'lyrics.none')}</div>
              <button type="button" className="mini-btn" onClick={() => void rpc('lyrics.retry')}>
                {t(lang, 'lyrics.retry')}
              </button>
            </div>
          ) : syncedLines.length > 0 ? (
            <div className="lyr-lines">
              {syncedLines.map((line, i) => {
                const isActive = i === activeLineIdx;
                const isPast = activeLineIdx >= 0 && i < activeLineIdx;
                return (
                  <button
                    key={`${i}-${line.t}`}
                    ref={isActive ? activeLineRef : undefined}
                    type="button"
                    className={`lyr-line ${isActive ? 'active' : isPast ? 'past' : ''}`}
                    onClick={() => {
                      if (typeof line.t === 'number') {
                        void rpc('playback.seek', { key: track.key, time: line.t });
                      }
                    }}
                  >
                    <span>{line.text}</span>
                    {line.translatedLyric && <span className="lyr-sub">{line.translatedLyric}</span>}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="lyr-lines unsynced">
              {lyrics.model.lines.map((line, i) => (
                <div key={i} className="lyr-line-static">
                  <div>{line.text}</div>
                  {line.translatedLyric && <div className="lyr-sub">{line.translatedLyric}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </aside>
  );

  if (!isDrawer) return pane;

  return (
    <>
      {drawerOpen && <div className="drawer-backdrop" onClick={onCloseDrawer} aria-hidden="true" />}
      {pane}
    </>
  );
}
