import { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { TrackInfo, TrackRow } from '../types';
import { fmtNum, fmtTime, t, LangCode } from '../i18n/strings';
import { Cover } from './Cover';
import { Icon } from './Icons';

export interface TrackTableProps {
  lang: LangCode;
  rows: TrackRow[];
  currentTrack: TrackInfo;
  showHeader?: boolean;
  showCover?: boolean;
  showAlbum?: boolean;
  secondaryColumn?: 'album' | 'artist' | 'none';
  showPlayCount?: boolean;
  canLoveSong?: boolean;
  scrollContainerRef?: { current: HTMLElement | null };
  onPlay: (row: TrackRow, index: number) => void;
  onEnqueue: (row: TrackRow, index: number) => void;
  onToggleLoved?: (row: TrackRow) => void;
  onOpenMenu?: (row: TrackRow, index: number, x: number, y: number) => void;
  onOpenAlbum?: (albumId: string) => void;
  onOpenArtist?: (artistId: string) => void;
}

const ROW_HEIGHT = 56;
const OVERSCAN = 8;

export function TrackTable({
  lang,
  rows,
  currentTrack,
  showHeader = true,
  showCover = true,
  secondaryColumn = 'album',
  showPlayCount = false,
  canLoveSong = true,
  scrollContainerRef,
  onPlay,
  onEnqueue,
  onToggleLoved,
  onOpenMenu,
  onOpenAlbum,
  onOpenArtist
}: TrackTableProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const useVirtual = rows.length > 140;
  const [sliceRange, setSliceRange] = useState<[number, number]>([0, Math.min(rows.length, 60)]);

  useEffect(() => {
    if (!useVirtual) {
      setSliceRange([0, rows.length]);
      return;
    }

    const scroller = scrollContainerRef?.current || hostRef.current?.closest('.scroll-area');
    if (!scroller) {
      setSliceRange([0, Math.min(rows.length, 80)]);
      return;
    }

    const updateRange = () => {
      const host = hostRef.current;
      if (!host) return;
      const scRect = scroller.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const relTop = scRect.top - hostRect.top;
      const start = Math.max(0, Math.floor(relTop / ROW_HEIGHT) - OVERSCAN);
      const visCount = Math.ceil(scroller.clientHeight / ROW_HEIGHT) + OVERSCAN * 2;
      const end = Math.min(rows.length, start + visCount);
      setSliceRange((prev) => (prev[0] === start && prev[1] === end ? prev : [start, end]));
    };

    updateRange();
    scroller.addEventListener('scroll', updateRange, { passive: true });
    window.addEventListener('resize', updateRange);
    return () => {
      scroller.removeEventListener('scroll', updateRange);
      window.removeEventListener('resize', updateRange);
    };
  }, [useVirtual, rows.length, scrollContainerRef]);

  const [startIdx, endIdx] = useVirtual ? sliceRange : [0, rows.length];
  const visibleRows = useMemo(() => rows.slice(startIdx, endIdx), [rows, startIdx, endIdx]);
  const topPad = useVirtual ? startIdx * ROW_HEIGHT : 0;
  const bottomPad = useVirtual ? Math.max(0, (rows.length - endIdx) * ROW_HEIGHT) : 0;

  const hasSecondCol = secondaryColumn !== 'none';
  const gridClass = `${!hasSecondCol ? 'no-sec' : ''} ${showPlayCount ? 'with-plays' : ''}`.trim();

  return (
    <div ref={hostRef} className={`track-table ${gridClass}`}>
      {showHeader && (
        <div className="trk-head">
          <span className="trk-col-num">{t(lang, 'col.num')}</span>
          <span className="trk-col-title">{t(lang, 'col.title')}</span>
          {hasSecondCol && (
            <span className="trk-col-album">
              {secondaryColumn === 'artist' ? t(lang, 'col.artist') : t(lang, 'col.album')}
            </span>
          )}
          {showPlayCount && <span className="trk-col-plays">{t(lang, 'col.plays')}</span>}
          <span className="trk-col-dur" aria-label="Duration">
            <Icon name="clock" size={14} />
          </span>
        </div>
      )}

      <div className="trk-body">
        {topPad > 0 && <div style={{ height: `${topPad}px` }} aria-hidden="true" />}

        {visibleRows.map((row, localOffset) => {
          const i = startIdx + localOffset;
          const isCurrent =
            currentTrack.key > 0 &&
            (currentTrack.id && row.id
              ? currentTrack.id === row.id
              : row.title === currentTrack.title && row.artist === currentTrack.artist);

          return (
            <div
              key={`${i}-${row.id}-${row.origIndex ?? i}`}
              className={`trk-row ${isCurrent ? 'playing' : ''}`}
              onDblClick={() => onPlay(row, i)}
              onContextMenu={(e) => {
                if (!onOpenMenu) return;
                e.preventDefault();
                onOpenMenu(row, i, Math.round(e.clientX), Math.round(e.clientY));
              }}
            >
              <div className="trk-cell-num">
                <span className="trk-idx">{i + 1}</span>
                <button
                  type="button"
                  className="trk-play-mini"
                  aria-label={t(lang, 'menu.trk_play')}
                  onClick={() => onPlay(row, i)}
                >
                  <Icon name="play" size={14} />
                </button>
              </div>

              <div className="trk-cell-title">
                {showCover && (
                  <Cover url={row.coverUrl} seed={row.albumId || row.title + row.artist} size={40} radius={5} contain />
                )}
                <div className="trk-title-stack">
                  <div className="trk-name truncate">{row.title || t(lang, 'meta.unknown')}</div>
                  <div className="trk-artist truncate">
                    {row.artistId && onOpenArtist ? (
                      <button
                        type="button"
                        className="inline-meta-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenArtist(row.artistId!);
                        }}
                      >
                        {row.artist || t(lang, 'meta.unknown')}
                      </button>
                    ) : (
                      row.artist || t(lang, 'meta.unknown')
                    )}
                  </div>
                </div>
              </div>

              {hasSecondCol && (
                <div className="trk-cell-album truncate">
                  {secondaryColumn === 'artist' ? (
                    row.artistId && onOpenArtist ? (
                      <button
                        type="button"
                        className="inline-meta-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenArtist(row.artistId!);
                        }}
                      >
                        {row.artist}
                      </button>
                    ) : (
                      row.artist
                    )
                  ) : row.albumId && onOpenAlbum ? (
                    <button
                      type="button"
                      className="inline-meta-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenAlbum(row.albumId!);
                      }}
                    >
                      {row.album}
                    </button>
                  ) : (
                    row.album
                  )}
                </div>
              )}

              {showPlayCount && (
                <div className="trk-cell-plays">{fmtNum(row.playCount || 0)}</div>
              )}

              <div className="trk-cell-right">
                {canLoveSong && onToggleLoved && (
                  <button
                    type="button"
                    className={`trk-heart-btn ${row.loved ? 'loved' : ''}`}
                    aria-label={row.loved ? 'Unlike song' : 'Like song'}
                    aria-pressed={row.loved}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleLoved(row);
                    }}
                  >
                    <Icon name={row.loved ? 'heart' : 'heartO'} size={15} />
                  </button>
                )}

                <button
                  type="button"
                  className="trk-q-btn"
                  title={t(lang, 'menu.trk_queue')}
                  aria-label={t(lang, 'menu.trk_queue')}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEnqueue(row, i);
                  }}
                >
                  <Icon name="add" size={15} />
                </button>

                <span className="trk-dur">{fmtTime(row.duration)}</span>

                {onOpenMenu && (
                  <button
                    type="button"
                    className="trk-more-btn"
                    title={t(lang, 'menu.more')}
                    aria-label={t(lang, 'menu.more')}
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      onOpenMenu(row, i, Math.round(rect.right), Math.round(rect.bottom + 2));
                    }}
                  >
                    <Icon name="more" size={15} />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {bottomPad > 0 && <div style={{ height: `${bottomPad}px` }} aria-hidden="true" />}
      </div>
    </div>
  );
}
