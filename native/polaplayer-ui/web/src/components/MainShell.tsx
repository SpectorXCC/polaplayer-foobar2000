import { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  AlbumDetailResponse,
  AlbumTabId,
  AllSongsGroupMode,
  AllSongsPageResponse,
  AllSongsRowItem,
  ArtistDetailResponse,
  BrowseAlbumsResponse,
  BrowseArtistsResponse,
  BrowseHomeResponse,
  LovedResponse,
  LovedTarget,
  PlaylistDetailResponse,
  PlaylistSortKey,
  PlaylistsState,
  PlaylistSummary,
  RandomResponse,
  ReplayGainState,
  SearchFullResponse,
  SearchStatus,
  SettingsState,
  TrackInfo,
  TrackRow
} from '../types';
import { rpc, sendDroppedFiles } from '../bridge/rpc';
import { fmtDur, fmtNum, fmtTime, t, LangCode } from '../i18n/strings';
import { AlbumCard, ArtistCard } from './BrowseCards';
import { Cover, headerGradientBg } from './Cover';
import { Icon } from './Icons';
import { MainRoute } from './Sidebar';
import { TrackTable } from './TrackTable';

export interface TrackMenuContext {
  row: TrackRow;
  index: number;
  contextKind: 'playlist' | 'album' | 'artistTop' | 'loved' | 'random' | 'allSongs' | 'search';
  playlistId?: string;
  editable?: boolean;
  query?: string;
  targetId?: string;
  group?: AllSongsGroupMode;
}

export interface MainShellProps {
  lang: LangCode;
  settings: SettingsState;
  playlists: PlaylistsState;
  track: TrackInfo;
  searchStatus: SearchStatus;
  browseRevision: number;
  artHues: Record<string, string>;
  replaygain?: ReplayGainState;
  route: MainRoute;
  canGoBack: boolean;
  onGoBack: () => void;
  onNavigate: (route: MainRoute) => void;
  onToggleLoved: (rowOrTarget: LovedTarget) => void;
  onOpenTrackMenu: (ctx: TrackMenuContext, x: number, y: number) => void;
  onOpenCreatePlaylist: () => void;
  onOpenRenamePlaylist: (pl: PlaylistSummary) => void;
  onOpenDeletePlaylist: (pl: PlaylistSummary) => void;
  onOpenReplayGainPrompt: (missingCount: number, totalCount: number) => void;
  onOpenSetup: () => void;
}

const ALBUM_TABS: Array<{ id: AlbumTabId; key: string }> = [
  { id: 'recent', key: 'alb_tab.recent' },
  { id: 'newest', key: 'alb_tab.newest' },
  { id: 'frequent', key: 'alb_tab.frequent' },
  { id: 'random', key: 'alb_tab.random' },
  { id: 'alphabeticalByName', key: 'alb_tab.name' }
];

const PL_SORTS: Array<{ id: PlaylistSortKey; key: string }> = [
  { id: 'default', key: 'sort.default' },
  { id: 'title', key: 'sort.title' },
  { id: 'artist', key: 'sort.artist' },
  { id: 'album', key: 'sort.album' },
  { id: 'dur', key: 'sort.dur' }
];

const SONGS_GROUPS: Array<{ id: AllSongsGroupMode; key: string }> = [
  { id: 'none', key: 'group.none' },
  { id: 'artist', key: 'group.artist' },
  { id: 'album', key: 'group.album' },
  { id: 'both', key: 'group.both' }
];

export function MainShell({
  lang,
  settings,
  playlists,
  track,
  searchStatus,
  browseRevision,
  artHues,
  replaygain,
  route,
  canGoBack,
  onGoBack,
  onNavigate,
  onToggleLoved,
  onOpenTrackMenu,
  onOpenCreatePlaylist,
  onOpenRenamePlaylist,
  onOpenDeletePlaylist,
  onOpenReplayGainPrompt,
  onOpenSetup
}: MainShellProps): JSX.Element {
  const scrollRef = useRef<HTMLElement>(null);
  const [plDragOver, setPlDragOver] = useState(false);
  const [localRg, setLocalRg] = useState<ReplayGainState | undefined>(replaygain);
  const effRg = replaygain || localRg;

  const [homeData, setHomeData] = useState<BrowseHomeResponse | null>(null);
  const [albumsTab, setAlbumsTab] = useState<AlbumTabId>('recent');
  const [albumsData, setAlbumsData] = useState<BrowseAlbumsResponse | null>(null);
  const [albumDetail, setAlbumDetail] = useState<AlbumDetailResponse | null>(null);
  const [artistsData, setArtistsData] = useState<BrowseArtistsResponse | null>(null);
  const [artistDetail, setArtistDetail] = useState<ArtistDetailResponse | null>(null);
  const [lovedData, setLovedData] = useState<LovedResponse | null>(null);
  const [randomData, setRandomData] = useState<RandomResponse | null>(null);

  const [songsGroup, setSongsGroup] = useState<AllSongsGroupMode>('none');
  const [allSongsRows, setAllSongsRows] = useState<AllSongsRowItem[]>([]);
  const [allSongsMeta, setAllSongsMeta] = useState<{ totalRows: number; totalSongs: number; totalDuration: number }>({
    totalRows: 0,
    totalSongs: 0,
    totalDuration: 0
  });
  const [allSongsLoading, setAllSongsLoading] = useState(false);

  const [plSort, setPlSort] = useState<PlaylistSortKey>('default');
  const [plAsc, setPlAsc] = useState(true);
  const [detail, setDetail] = useState<PlaylistDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [queryInput, setQueryInput] = useState(searchStatus.query || '');
  const [debouncedQuery, setDebouncedQuery] = useState(searchStatus.query || '');
  const [searchFull, setSearchFull] = useState<SearchFullResponse | null>(null);
  const debounceRef = useRef<number>(0);

  const isNavidrome = settings.activeSource === 'navidrome';
  const caps = settings.caps;
  const canLoveSong = !caps || caps.lovedKinds.includes('song');
  const canLoveAlbum = Boolean(caps?.lovedKinds.includes('album'));
  const canFollowArtist = Boolean(caps?.lovedKinds.includes('artist'));

  // Scroll back to top on route change
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [route.kind, route.kind === 'playlist' || route.kind === 'album' || route.kind === 'artist' ? route.id : '']);

  // Home loader
  useEffect(() => {
    if (route.kind !== 'home') return;
    let alive = true;
    rpc<BrowseHomeResponse>('browse.home')
      .then((res) => { if (alive) setHomeData(res); })
      .catch(() => {});
    return () => { alive = false; };
  }, [route.kind, settings.activeSource, settings.activeServerId, browseRevision]);

  // Albums loader
  useEffect(() => {
    if (route.kind !== 'albums') return;
    let alive = true;
    rpc<BrowseAlbumsResponse>('browse.albums', { tab: albumsTab, offset: 0, limit: 60 })
      .then((res) => { if (alive) setAlbumsData(res); })
      .catch(() => {});
    return () => { alive = false; };
  }, [route.kind, albumsTab, settings.activeSource, settings.activeServerId, browseRevision]);

  // Album detail loader
  useEffect(() => {
    if (route.kind !== 'album') return;
    let alive = true;
    rpc<AlbumDetailResponse>('browse.album', { id: route.id })
      .then((res) => { if (alive) setAlbumDetail(res); })
      .catch(() => {});
    return () => { alive = false; };
  }, [route, settings.activeSource, settings.activeServerId, browseRevision]);

  // Artists loader
  useEffect(() => {
    if (route.kind !== 'artists') return;
    let alive = true;
    rpc<BrowseArtistsResponse>('browse.artists', { offset: 0, limit: 120 })
      .then((res) => { if (alive) setArtistsData(res); })
      .catch(() => {});
    return () => { alive = false; };
  }, [route.kind, settings.activeSource, settings.activeServerId, browseRevision]);

  // Artist detail loader
  useEffect(() => {
    if (route.kind !== 'artist') return;
    let alive = true;
    rpc<ArtistDetailResponse>('browse.artist', { id: route.id })
      .then((res) => { if (alive) setArtistDetail(res); })
      .catch(() => {});
    return () => { alive = false; };
  }, [route, settings.activeSource, settings.activeServerId, browseRevision]);

  // Loved loader
  useEffect(() => {
    if (route.kind !== 'loved') return;
    let alive = true;
    rpc<LovedResponse>('browse.loved')
      .then((res) => { if (alive) setLovedData(res); })
      .catch(() => {});
    return () => { alive = false; };
  }, [route.kind, settings.activeSource, settings.activeServerId, browseRevision]);

  // Random loader
  useEffect(() => {
    if (route.kind !== 'random') return;
    let alive = true;
    rpc<RandomResponse>('browse.random', { action: 'get', count: 80 })
      .then((res) => { if (alive) setRandomData(res); })
      .catch(() => {});
    return () => { alive = false; };
  }, [route.kind, settings.activeSource, settings.activeServerId, browseRevision]);

  // All Songs loader (local only)
  useEffect(() => {
    if (route.kind !== 'all_songs' || isNavidrome) return;
    let alive = true;
    setAllSongsLoading(true);
    rpc<AllSongsPageResponse>('browse.allSongs', { group: songsGroup, offset: 0, limit: 250 })
      .then((res) => {
        if (!alive) return;
        setAllSongsRows(res.rows);
        setAllSongsMeta({ totalRows: res.totalRows, totalSongs: res.totalSongs, totalDuration: res.totalDuration });
        if (res.replaygain) setLocalRg(res.replaygain);
        setAllSongsLoading(false);
      })
      .catch(() => { if (alive) setAllSongsLoading(false); });
    return () => { alive = false; };
  }, [route.kind, songsGroup, isNavidrome, browseRevision]);

  // Playlist detail loader
  useEffect(() => {
    if (route.kind !== 'playlist') return;
    let alive = true;
    setDetailLoading(true);
    rpc<PlaylistDetailResponse>('playlists.tracks', {
      id: route.id,
      offset: 0,
      limit: 250,
      sort: plSort,
      asc: plAsc
    })
      .then((res) => {
        if (alive) {
          setDetail(res);
          setDetailLoading(false);
        }
      })
      .catch(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [route, plSort, plAsc, playlists.revision, settings.activeSource, settings.activeServerId, browseRevision]);

  // Search loader (unified 3-section search for Local and Navidrome)
  useEffect(() => {
    if (route.kind !== 'search') return;
    const trimmed = debouncedQuery.trim();
    if (!trimmed) {
      setSearchFull(null);
      return;
    }
    let alive = true;
    rpc<SearchFullResponse>('search.full', { query: trimmed, offset: 0, limit: 200 })
      .then((res) => { if (alive) setSearchFull(res); })
      .catch(() => {});
    return () => { alive = false; };
  }, [route.kind, isNavidrome, settings.activeServerId, debouncedQuery, browseRevision]);

  const handleSearchInput = (val: string) => {
    setQueryInput(val);
    window.clearTimeout(debounceRef.current);
    if (!isNavidrome) {
      setDebouncedQuery(val);
    } else {
      debounceRef.current = window.setTimeout(() => {
        setDebouncedQuery(val);
      }, 220);
    }
  };

  const resolveHue = (hueKey?: string, directHue?: string) => (hueKey && artHues[hueKey]) || directHue || '';

  const playAlbum = (albumId: string, index = 0, shuffle = false) => {
    void rpc('browse.playList', { kind: 'album', id: albumId, index, shuffle });
  };

  const loadMoreAllSongs = () => {
    if (allSongsLoading || allSongsRows.length >= allSongsMeta.totalRows) return;
    setAllSongsLoading(true);
    const offset = allSongsRows.length;
    rpc<AllSongsPageResponse>('browse.allSongs', { group: songsGroup, offset, limit: 250 })
      .then((res) => {
        setAllSongsRows((prev) => [...prev, ...res.rows]);
        setAllSongsLoading(false);
      })
      .catch(() => setAllSongsLoading(false));
  };

  const NavidromePreviewBanner = (titleKey: string) => (
    <main ref={scrollRef} className="card main-pane scroll-area">
      <div className="detail-hero compact" style={{ background: headerGradientBg('', titleKey, settings.light) }}>
        <div className="detail-nav-row">
          {canGoBack && (
            <button type="button" className="circle-nav-btn" aria-label={t(lang, 'btn.back')} onClick={onGoBack}>
              <Icon name="back" size={18} />
            </button>
          )}
        </div>
        <h1 className="hero-title">{t(lang, titleKey)}</h1>
      </div>
      <div className="empty-detail">
        <p>{t(lang, 'nav.coming_phase3')}</p>
        <div className="preview-actions">
          <button type="button" className="action-outline-btn" onClick={() => onNavigate({ kind: 'search' })}>
            <Icon name="search" size={15} />
            <span>{t(lang, 'search.title')}</span>
          </button>
          <button type="button" className="action-outline-btn" onClick={() => onNavigate({ kind: 'home' })}>
            <Icon name="home" size={15} />
            <span>{t(lang, 'nav.home')}</span>
          </button>
        </div>
      </div>
    </main>
  );

  // 1. SEARCH VIEW (3 sections in Local mode)
  if (route.kind === 'search') {
    return (
      <main ref={scrollRef} className="card main-pane scroll-area">
        <div className="search-top">
          {canGoBack && (
            <button type="button" className="circle-nav-btn" aria-label={t(lang, 'btn.back')} onClick={onGoBack}>
              <Icon name="back" size={18} />
            </button>
          )}
          <div className="search-pill">
            <Icon name="search" size={18} className="search-icon" />
            <input
              type="search"
              className="search-input"
              placeholder={t(lang, 'search.placeholder')}
              value={queryInput}
              autoFocus
              onInput={(e) => handleSearchInput((e.currentTarget as HTMLInputElement).value)}
            />
            {queryInput && (
              <button
                type="button"
                className="icon-btn"
                aria-label="Clear search"
                onClick={() => handleSearchInput('')}
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
        </div>

        {!queryInput.trim() ? (
          <div className="center-note">
            {isNavidrome ? t(lang, 'search.hint_nv') : t(lang, 'search.hint_local')}
          </div>
        ) : !searchFull || searchFull.query.trim().toLowerCase() !== debouncedQuery.trim().toLowerCase() ? (
          <div className="center-note">{t(lang, 'search.searching')}</div>
        ) : searchFull.artists.length === 0 && searchFull.albums.length === 0 && searchFull.songs.length === 0 ? (
          <div className="center-note">{t(lang, 'search.no_results', queryInput)}</div>
        ) : (
          <div className="search-results">
            {searchFull.artists.length > 0 && (
              <section className="search-sec">
                <div className="section-head">
                  <h2>{t(lang, 'search.artists')}</h2>
                </div>
                <div className="h-shelf scroll-x">
                  {searchFull.artists.map((ar) => (
                    <div key={ar.id} className="shelf-card-wrap">
                      <ArtistCard
                        artist={ar}
                        lang={lang}
                        onOpen={(a) => onNavigate({ kind: 'artist', id: a.id })}
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {searchFull.albums.length > 0 && (
              <section className="search-sec">
                <div className="section-head">
                  <h2>{t(lang, 'search.albums')}</h2>
                </div>
                <div className="h-shelf scroll-x">
                  {searchFull.albums.map((al) => (
                    <div key={al.id} className="shelf-card-wrap">
                      <AlbumCard
                        album={al}
                        lang={lang}
                        onOpen={(a) => onNavigate({ kind: 'album', id: a.id })}
                        onPlay={(a) => playAlbum(a.id)}
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {searchFull.songs.length > 0 && (
              <section className="search-sec">
                <div className="section-head">
                  <h2>{t(lang, 'search.songs')}</h2>
                  <span className="muted-count">{fmtNum(searchFull.songTotal)}</span>
                </div>
                <TrackTable
                  lang={lang}
                  rows={searchFull.songs}
                  currentTrack={track}
                  canLoveSong={canLoveSong}
                  scrollContainerRef={scrollRef}
                  onPlay={(_, i) =>
                    void rpc('browse.playList', { kind: 'search', query: queryInput.trim(), index: i })
                  }
                  onEnqueue={(row, i) =>
                    isNavidrome
                      ? void rpc('browse.enqueueTrack', { trackId: row.id })
                      : void rpc('queue.enqueue', { scope: 'search', query: queryInput.trim(), index: i })
                  }
                  onToggleLoved={onToggleLoved}
                  onOpenMenu={(row, idx, x, y) =>
                    onOpenTrackMenu({ row, index: idx, contextKind: 'search', query: queryInput.trim() }, x, y)
                  }
                  onOpenAlbum={(aid) => onNavigate({ kind: 'album', id: aid })}
                  onOpenArtist={(arid) => onNavigate({ kind: 'artist', id: arid })}
                />
              </section>
            )}
          </div>
        )}
      </main>
    );
  }

  // 2. PLAYLIST DETAIL VIEW (with Sort dropdown + Direction + Drag-Drop)
  if (route.kind === 'playlist') {
    const summary = playlists.list.find((p) => p.id === route.id);
    const meta = detail?.meta || summary;
    const plName = meta?.name || t(lang, 'meta.playlist_sub');
    const bgGrad = headerGradientBg(meta?.hue, meta?.id || plName, settings.light);
    const totalDur = meta?.duration || 0;
    const totalCount = detail ? detail.total : meta?.songCount || 0;
    const canDropPl = !isNavidrome && meta?.editable !== false;

    return (
      <main
        ref={scrollRef}
        className={`card main-pane scroll-area ${plDragOver ? 'drop-target-active' : ''}`}
        onDragOver={(e) => {
          if (!canDropPl || !e.dataTransfer?.types.includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (!plDragOver) setPlDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target && plDragOver) setPlDragOver(false);
        }}
        onDrop={(e) => {
          if (!canDropPl) return;
          e.preventDefault();
          e.stopPropagation();
          setPlDragOver(false);
          sendDroppedFiles('playlist', route.id, e.dataTransfer?.files);
        }}
      >
        <div className="detail-hero" style={{ background: bgGrad }}>
          <div className="detail-nav-row">
            {canGoBack && (
              <button type="button" className="circle-nav-btn" aria-label={t(lang, 'btn.back')} onClick={onGoBack}>
                <Icon name="back" size={18} />
              </button>
            )}
          </div>

          <div className="detail-hero-body">
            <Cover
              url={meta?.coverUrl}
              seed={meta?.id || plName}
              size={184}
              radius={8}
              contain
              className="hero-cover"
            />
            <div className="detail-hero-info">
              <div className="eyebrow">
                {isNavidrome ? t(lang, 'eyebrow.nv_playlist') : t(lang, 'eyebrow.playlist')}
              </div>
              <h1 className="hero-title">{plName}</h1>
              <div className="hero-meta">
                <span>{t(lang, 'meta.songs', fmtNum(totalCount))}</span>
                {totalDur > 0 && <span>· {fmtDur(totalDur)}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="detail-actions split-actions">
          <div className="detail-actions-left">
            <button
              type="button"
              className="big-play-btn"
              aria-label={t(lang, 'btn.play')}
              onClick={() =>
                void rpc('playlists.play', { id: route.id, index: 0, shuffle: false, sort: plSort, asc: plAsc })
              }
            >
              <Icon name="play" size={24} />
            </button>

            <button
              type="button"
              className="action-outline-btn"
              onClick={() =>
                void rpc('playlists.play', { id: route.id, index: 0, shuffle: true, sort: plSort, asc: plAsc })
              }
            >
              <Icon name="shuffle" size={16} />
              <span>{t(lang, 'btn.shuffle')}</span>
            </button>

            {meta?.editable && (
              <>
                <button type="button" className="action-outline-btn" onClick={() => meta && onOpenRenamePlaylist(meta)}>
                  {t(lang, 'btn.rename')}
                </button>
                <button
                  type="button"
                  className="action-outline-btn danger"
                  onClick={() => meta && onOpenDeletePlaylist(meta)}
                >
                  {t(lang, 'btn.delete')}
                </button>
              </>
            )}
          </div>

            <div className="sort-ctrl-group">
              <select
                className="pola-select"
                aria-label="Playlist sort order"
                value={plSort}
                onChange={(e) => setPlSort((e.currentTarget as HTMLSelectElement).value as PlaylistSortKey)}
              >
                {PL_SORTS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {t(lang, 'sort.prefix', t(lang, opt.key))}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn sort-dir-btn"
                aria-label={plAsc ? 'Ascending' : 'Descending'}
                onClick={() => setPlAsc((a) => !a)}
              >
                <Icon name={plAsc ? 'arrowUp' : 'arrowDown'} size={15} />
              </button>
            </div>
        </div>

        {detailLoading && !detail ? (
          <div className="center-note">{t(lang, 'nav.syncing_nv')}</div>
        ) : detail && detail.rows.length === 0 ? (
          <div className="empty-detail">
            <h3>{t(lang, 'empty.pl_empty')}</h3>
            <p>{t(lang, 'empty.pl_empty_sub')}</p>
            {canDropPl && (
              <div className="empty-cta-row">
                <button
                  type="button"
                  className="action-outline-btn"
                  onClick={() => void rpc('playlists.pickFiles', { playlistId: route.id, folder: false })}
                >
                  {t(lang, 'menu.add_files')}
                </button>
                <button
                  type="button"
                  className="action-outline-btn"
                  onClick={() => void rpc('playlists.pickFiles', { playlistId: route.id, folder: true })}
                >
                  {t(lang, 'menu.add_folder')}
                </button>
              </div>
            )}
          </div>
        ) : detail ? (
          <>
            <TrackTable
              lang={lang}
              rows={detail.rows}
              currentTrack={track}
              canLoveSong={canLoveSong}
              scrollContainerRef={scrollRef}
              onPlay={(_, idx) =>
                void rpc('playlists.play', { id: detail.id, index: idx, sort: plSort, asc: plAsc })
              }
              onEnqueue={(row, idx) =>
                void rpc('queue.enqueue', {
                  scope: 'playlist',
                  playlistId: detail.id,
                  index: row.origIndex ?? idx
                })
              }
              onToggleLoved={onToggleLoved}
              onOpenMenu={(row, idx, x, y) =>
                onOpenTrackMenu(
                  {
                    row,
                    index: row.origIndex ?? idx,
                    contextKind: 'playlist',
                    playlistId: detail.id,
                    editable: meta?.editable !== false
                  },
                  x,
                  y
                )
              }
              onOpenAlbum={(aid) => onNavigate({ kind: 'album', id: aid })}
              onOpenArtist={(arid) => onNavigate({ kind: 'artist', id: arid })}
            />
            {detail.total > detail.rows.length && (
              <div className="load-more-wrap">
                <button
                  type="button"
                  className="action-outline-btn"
                  onClick={() => {
                    rpc<PlaylistDetailResponse>('playlists.tracks', {
                      id: detail.id,
                      offset: detail.rows.length,
                      limit: 250,
                      sort: plSort,
                      asc: plAsc
                    }).then((next) => {
                      setDetail((prev) =>
                        prev && prev.id === next.id ? { ...next, rows: [...prev.rows, ...next.rows] } : next
                      );
                    }).catch(() => {});
                  }}
                >
                  {t(lang, 'btn.load_more_albums').replace(/albums|专辑/gi, '').trim() || 'Load more'} ({detail.rows.length} / {detail.total})
                </button>
              </div>
            )}
          </>
        ) : null}
      </main>
    );
  }

  // 3. ALBUMS VIEW (5-Tab + Option A Hover + Pagination)
  if (route.kind === 'albums') {
    const items = albumsData?.items || [];

    return (
      <main ref={scrollRef} className="card main-pane scroll-area">
        <div className="browse-header">
          <div className="browse-title-row">
            {canGoBack && (
              <button type="button" className="circle-nav-btn" aria-label={t(lang, 'btn.back')} onClick={onGoBack}>
                <Icon name="back" size={18} />
              </button>
            )}
            <h1 className="browse-heading">{t(lang, 'nav.albums')}</h1>
            <span className="muted-count">{albumsData ? fmtNum(albumsData.total) : ''}</span>
          </div>

          <div className="alb-tab-row" role="tablist" aria-label="Album sort tabs">
            {ALBUM_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={albumsTab === tab.id}
                className={`pill-tab ${albumsTab === tab.id ? 'active' : ''}`}
                onClick={() => {
                  if (tab.id === 'random' && albumsTab === 'random') {
                    void rpc<BrowseAlbumsResponse>('browse.albums', { tab: 'random', offset: 0, limit: 60, force: true })
                      .then(setAlbumsData)
                      .catch(() => {});
                  } else {
                    setAlbumsTab(tab.id);
                  }
                }}
              >
                {t(lang, tab.key)}
              </button>
            ))}
          </div>
        </div>

        {!albumsData ? (
          <div className="center-note">{t(lang, 'btn.loading')}</div>
        ) : items.length === 0 ? (
          <div className="empty-detail">
            <h3>{t(lang, 'empty.lib_empty')}</h3>
            <p>{t(lang, 'empty.lib_empty_sub')}</p>
          </div>
        ) : (
          <div className="browse-grid-wrap">
            <div className="pl-card-grid">
              {items.map((al) => (
                <AlbumCard
                  key={al.id}
                  album={al}
                  lang={lang}
                  onOpen={(a) => onNavigate({ kind: 'album', id: a.id })}
                  onPlay={(a) => playAlbum(a.id)}
                />
              ))}
            </div>
            {albumsData.hasMore && (
              <div className="load-more-wrap">
                <button
                  type="button"
                  className="action-outline-btn"
                  onClick={() => {
                    rpc<BrowseAlbumsResponse>('browse.albums', {
                      tab: albumsTab,
                      offset: items.length,
                      limit: 60
                    }).then((more) => {
                      setAlbumsData((prev) =>
                        prev ? { ...more, items: [...prev.items, ...more.items] } : more
                      );
                    }).catch(() => {});
                  }}
                >
                  {t(lang, 'btn.load_more_albums')} ({items.length} / {albumsData.total})
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    );
  }

  // 4. ALBUM DETAIL VIEW
  if (route.kind === 'album') {
    const meta = albumDetail?.meta;
    const hue = resolveHue(meta?.hueKey, meta?.hue);
    const bgGrad = headerGradientBg(hue, route.id, settings.light);

    return (
      <main ref={scrollRef} className="card main-pane scroll-area">
        <div className="detail-hero" style={{ background: bgGrad }}>
          <div className="detail-nav-row">
            {canGoBack && (
              <button type="button" className="circle-nav-btn" aria-label={t(lang, 'btn.back')} onClick={onGoBack}>
                <Icon name="back" size={18} />
              </button>
            )}
          </div>

          <div className="detail-hero-body">
            <Cover
              url={meta?.coverUrl}
              seed={route.id}
              size={188}
              radius={8}
              contain
              className="hero-cover"
            />
            <div className="detail-hero-info">
              <div className="eyebrow">{t(lang, 'eyebrow.album')}</div>
              <h1 className="hero-title">{meta?.name || t(lang, 'meta.unknown_album')}</h1>
              <div className="hero-meta">
                {meta?.artistId ? (
                  <button
                    type="button"
                    className="hero-link"
                    onClick={() => onNavigate({ kind: 'artist', id: meta.artistId })}
                  >
                    {meta.artist}
                  </button>
                ) : (
                  <span>{meta?.artist || t(lang, 'meta.unknown_artist')}</span>
                )}
                {meta?.year && <span>· {meta.year}</span>}
                {meta && <span>· {t(lang, 'meta.songs', fmtNum(meta.songCount))}</span>}
                {meta && meta.duration > 0 && <span>· {fmtDur(meta.duration)}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="detail-actions">
          <button
            type="button"
            className="big-play-btn"
            aria-label={t(lang, 'btn.play')}
            onClick={() => playAlbum(route.id, 0, false)}
          >
            <Icon name="play" size={24} />
          </button>
          <button
            type="button"
            className="action-outline-btn"
            onClick={() => playAlbum(route.id, 0, true)}
          >
            <Icon name="shuffle" size={16} />
            <span>{t(lang, 'btn.shuffle')}</span>
          </button>
          {canLoveAlbum && meta && (
            <button
              type="button"
              className={`action-outline-btn ${meta.loved ? 'is-loved' : ''}`}
              aria-pressed={meta.loved}
              onClick={() => onToggleLoved({ kind: 'album', id: meta.id })}
            >
              <Icon name={meta.loved ? 'heart' : 'heartO'} size={16} />
              <span>{meta.loved ? t(lang, 'btn.album_starred') : t(lang, 'btn.star_album')}</span>
            </button>
          )}
        </div>

        {!albumDetail ? (
          <div className="center-note">{t(lang, 'btn.loading')}</div>
        ) : (
          <TrackTable
            lang={lang}
            rows={albumDetail.rows}
            currentTrack={track}
            showCover={false}
            secondaryColumn="none"
            canLoveSong={canLoveSong}
            scrollContainerRef={scrollRef}
            onPlay={(_, idx) => playAlbum(route.id, idx, false)}
            onEnqueue={(row) => void rpc('browse.enqueueTrack', { trackId: row.id })}
            onToggleLoved={onToggleLoved}
            onOpenMenu={(row, idx, x, y) =>
              onOpenTrackMenu({ row, index: idx, contextKind: 'album', targetId: route.id }, x, y)
            }
            onOpenArtist={(arid) => onNavigate({ kind: 'artist', id: arid })}
          />
        )}
      </main>
    );
  }

  // 5. ARTISTS VIEW
  if (route.kind === 'artists') {
    const items = artistsData?.items || [];

    return (
      <main ref={scrollRef} className="card main-pane scroll-area">
        <div className="browse-header">
          <div className="browse-title-row">
            {canGoBack && (
              <button type="button" className="circle-nav-btn" aria-label={t(lang, 'btn.back')} onClick={onGoBack}>
                <Icon name="back" size={18} />
              </button>
            )}
            <h1 className="browse-heading">{t(lang, 'nav.artists')}</h1>
            <span className="muted-count">{artistsData ? fmtNum(artistsData.total) : ''}</span>
          </div>
        </div>

        {!artistsData ? (
          <div className="center-note">{t(lang, 'btn.loading')}</div>
        ) : items.length === 0 ? (
          <div className="empty-detail">
            <h3>{t(lang, 'empty.lib_empty')}</h3>
            <p>{t(lang, 'empty.lib_empty_sub')}</p>
          </div>
        ) : (
          <div className="browse-grid-wrap">
            <div className="pl-card-grid">
              {items.map((ar) => (
                <ArtistCard
                  key={ar.id}
                  artist={ar}
                  lang={lang}
                  onOpen={(a) => onNavigate({ kind: 'artist', id: a.id })}
                />
              ))}
            </div>
            {artistsData.hasMore && (
              <div className="load-more-wrap">
                <button
                  type="button"
                  className="action-outline-btn"
                  onClick={() => {
                    rpc<BrowseArtistsResponse>('browse.artists', {
                      offset: items.length,
                      limit: 120
                    }).then((more) => {
                      setArtistsData((prev) =>
                        prev ? { ...more, items: [...prev.items, ...more.items] } : more
                      );
                    }).catch(() => {});
                  }}
                >
                  Load more ({items.length} / {artistsData.total})
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    );
  }

  // 6. ARTIST DETAIL VIEW
  if (route.kind === 'artist') {
    const meta = artistDetail?.meta;
    const hue = resolveHue(meta?.hueKey, meta?.hue);
    const bgGrad = headerGradientBg(hue, route.id, settings.light);
    const topRows = artistDetail?.topRows || [];
    const albums = artistDetail?.albums || [];

    return (
      <main ref={scrollRef} className="card main-pane scroll-area">
        <div className="detail-hero" style={{ background: bgGrad }}>
          <div className="detail-nav-row">
            {canGoBack && (
              <button type="button" className="circle-nav-btn" aria-label={t(lang, 'btn.back')} onClick={onGoBack}>
                <Icon name="back" size={18} />
              </button>
            )}
          </div>

          <div className="detail-hero-body">
            <Cover
              url={meta?.coverUrl}
              seed={route.id}
              size={172}
              circle
              contain={false}
              fallbackIcon="artist"
              className="hero-cover"
            />
            <div className="detail-hero-info">
              <div className="eyebrow">{t(lang, 'eyebrow.artist')}</div>
              <h1 className="hero-title">{meta?.name || route.id}</h1>
              {meta && (
                <div className="hero-meta">
                  <span>
                    {meta.albumCount === 1
                      ? t(lang, 'meta.album_one')
                      : t(lang, 'meta.album_count', fmtNum(meta.albumCount))}
                  </span>
                  <span>· {t(lang, 'meta.songs', fmtNum(meta.songCount))}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="detail-actions">
          <button
            type="button"
            className="big-play-btn"
            aria-label={t(lang, 'btn.play')}
            onClick={() => {
              if (topRows.length > 0) {
                void rpc('browse.playList', { kind: 'artistTop', id: route.id, index: 0, shuffle: false });
              } else if (albums.length > 0) {
                playAlbum(albums[0].id, 0, false);
              }
            }}
          >
            <Icon name="play" size={24} />
          </button>

          {topRows.length > 0 && (
            <button
              type="button"
              className="action-outline-btn"
              onClick={() =>
                void rpc('browse.playList', { kind: 'artistTop', id: route.id, index: 0, shuffle: true })
              }
            >
              <Icon name="shuffle" size={16} />
              <span>{t(lang, 'btn.play_top')}</span>
            </button>
          )}

          {canFollowArtist && meta && (
            <button
              type="button"
              className={`action-outline-btn ${meta.loved ? 'is-loved' : ''}`}
              aria-pressed={meta.loved}
              onClick={() => onToggleLoved({ kind: 'artist', id: meta.id })}
            >
              <Icon name={meta.loved ? 'heart' : 'heartO'} size={16} />
              <span>{meta.loved ? t(lang, 'btn.following') : t(lang, 'btn.follow_artist')}</span>
            </button>
          )}
        </div>

        {topRows.length > 0 && (
          <section className="browse-section">
            <div className="section-head">
              <h2>{t(lang, 'meta.artist_top_src', isNavidrome ? t(lang, 'source.navidrome') : t(lang, 'source.local'))}</h2>
            </div>
            <TrackTable
              lang={lang}
              rows={topRows}
              currentTrack={track}
              secondaryColumn="album"
              showPlayCount
              canLoveSong={canLoveSong}
              scrollContainerRef={scrollRef}
              onPlay={(_, idx) =>
                void rpc('browse.playList', { kind: 'artistTop', id: route.id, index: idx, shuffle: false })
              }
              onEnqueue={(row) => void rpc('browse.enqueueTrack', { trackId: row.id })}
              onToggleLoved={onToggleLoved}
              onOpenMenu={(row, idx, x, y) =>
                onOpenTrackMenu({ row, index: idx, contextKind: 'artistTop', targetId: route.id }, x, y)
              }
              onOpenAlbum={(aid) => onNavigate({ kind: 'album', id: aid })}
            />
          </section>
        )}

        <section className="browse-section">
          <div className="section-head">
            <h2>{t(lang, 'nav.albums')}</h2>
          </div>
          <div className="pl-card-grid">
            {albums.map((al) => (
              <AlbumCard
                key={al.id}
                album={al}
                lang={lang}
                onOpen={(a) => onNavigate({ kind: 'album', id: a.id })}
                onPlay={(a) => playAlbum(a.id)}
              />
            ))}
          </div>
        </section>
      </main>
    );
  }

  // 7. LIKED SONGS VIEW
  if (route.kind === 'loved') {
    const songs = lovedData?.songs || [];
    const lovedAlbums = lovedData?.albums || [];
    const lovedArtists = lovedData?.artists || [];

    return (
      <main ref={scrollRef} className="card main-pane scroll-area">
        <div className="detail-hero" style={{ background: headerGradientBg('#7d3aa8', 'loved', settings.light) }}>
          <div className="detail-nav-row">
            {canGoBack && (
              <button type="button" className="circle-nav-btn" aria-label={t(lang, 'btn.back')} onClick={onGoBack}>
                <Icon name="back" size={18} />
              </button>
            )}
          </div>
          <div className="detail-hero-body">
            <div className="special-hero-art loved hero-cover">
              <Icon name="heart" size={72} />
            </div>
            <div className="detail-hero-info">
              <div className="eyebrow">{t(lang, 'eyebrow.collection')}</div>
              <h1 className="hero-title">{t(lang, 'nav.loved')}</h1>
              <div className="hero-meta">
                <span>{t(lang, 'meta.songs', fmtNum(songs.length))}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="detail-actions">
          <button
            type="button"
            className="big-play-btn"
            aria-label={t(lang, 'btn.play')}
            onClick={() => void rpc('browse.playList', { kind: 'loved', index: 0, shuffle: false })}
          >
            <Icon name="play" size={24} />
          </button>
          <button
            type="button"
            className="action-outline-btn"
            onClick={() => void rpc('browse.playList', { kind: 'loved', index: 0, shuffle: true })}
          >
            <Icon name="shuffle" size={16} />
            <span>{t(lang, 'btn.shuffle')}</span>
          </button>
        </div>

        {!lovedData ? (
          <div className="center-note">{t(lang, 'btn.loading')}</div>
        ) : songs.length === 0 && lovedAlbums.length === 0 && lovedArtists.length === 0 ? (
          <div className="empty-detail">
            <p>{t(lang, 'empty.loved_empty')}</p>
          </div>
        ) : (
          <>
            {songs.length > 0 && (
              <TrackTable
                lang={lang}
                rows={songs}
                currentTrack={track}
                canLoveSong={canLoveSong}
                scrollContainerRef={scrollRef}
                onPlay={(_, idx) => void rpc('browse.playList', { kind: 'loved', index: idx, shuffle: false })}
                onEnqueue={(row) => void rpc('browse.enqueueTrack', { trackId: row.id })}
                onToggleLoved={onToggleLoved}
                onOpenMenu={(row, idx, x, y) =>
                  onOpenTrackMenu({ row, index: idx, contextKind: 'loved' }, x, y)
                }
                onOpenAlbum={(aid) => onNavigate({ kind: 'album', id: aid })}
                onOpenArtist={(arid) => onNavigate({ kind: 'artist', id: arid })}
              />
            )}

            {lovedAlbums.length > 0 && (
              <section className="browse-section">
                <div className="section-head">
                  <h2>{t(lang, 'home.fav_albums')}</h2>
                  <span className="muted-count">{fmtNum(lovedAlbums.length)}</span>
                </div>
                <div className="h-shelf scroll-x">
                  {lovedAlbums.map((al) => (
                    <div key={al.id} className="shelf-card-wrap">
                      <AlbumCard
                        album={al}
                        lang={lang}
                        onOpen={(a) => onNavigate({ kind: 'album', id: a.id })}
                        onPlay={(a) => playAlbum(a.id)}
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {lovedArtists.length > 0 && (
              <section className="browse-section">
                <div className="section-head">
                  <h2>{t(lang, 'home.followed_artists')}</h2>
                  <span className="muted-count">{fmtNum(lovedArtists.length)}</span>
                </div>
                <div className="h-shelf scroll-x">
                  {lovedArtists.map((ar) => (
                    <div key={ar.id} className="shelf-card-wrap">
                      <ArtistCard
                        artist={ar}
                        lang={lang}
                        onOpen={(a) => onNavigate({ kind: 'artist', id: a.id })}
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    );
  }

  // 8. RADIO MIX VIEW
  if (route.kind === 'random') {
    const rows = randomData?.rows || [];

    return (
      <main ref={scrollRef} className="card main-pane scroll-area">
        <div className="detail-hero" style={{ background: headerGradientBg('#178c52', 'random', settings.light) }}>
          <div className="detail-nav-row">
            {canGoBack && (
              <button type="button" className="circle-nav-btn" aria-label={t(lang, 'btn.back')} onClick={onGoBack}>
                <Icon name="back" size={18} />
              </button>
            )}
          </div>
          <div className="detail-hero-body">
            <div className="special-hero-art random hero-cover">
              <Icon name="shuffle" size={72} />
            </div>
            <div className="detail-hero-info">
              <div className="eyebrow">{t(lang, 'eyebrow.infinite_radio')}</div>
              <h1 className="hero-title">{t(lang, 'nav.random')}</h1>
              <div className="hero-meta">
                <span>{t(lang, 'meta.songs', fmtNum(rows.length))}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="detail-actions">
          <button
            type="button"
            className="big-play-btn"
            aria-label={t(lang, 'btn.start_radio')}
            onClick={() => void rpc('browse.playList', { kind: 'random', index: 0, shuffle: false })}
          >
            <Icon name="play" size={24} />
          </button>
          <button
            type="button"
            className="action-outline-btn"
            onClick={() => {
              rpc<RandomResponse>('browse.random', { action: 'rebatch', count: 80 })
                .then(setRandomData)
                .catch(() => {});
            }}
          >
            <Icon name="refresh" size={15} />
            <span>{t(lang, 'btn.new_mix')}</span>
          </button>
        </div>

        {!randomData ? (
          <div className="center-note">{t(lang, 'btn.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="empty-detail">
            <h3>{t(lang, 'empty.lib_empty')}</h3>
            <p>{t(lang, 'empty.lib_empty_sub')}</p>
          </div>
        ) : (
          <TrackTable
            lang={lang}
            rows={rows}
            currentTrack={track}
            canLoveSong={canLoveSong}
            scrollContainerRef={scrollRef}
            onPlay={(_, idx) => void rpc('browse.playList', { kind: 'random', index: idx, shuffle: false })}
            onEnqueue={(row) => void rpc('browse.enqueueTrack', { trackId: row.id })}
            onToggleLoved={onToggleLoved}
            onOpenMenu={(row, idx, x, y) =>
              onOpenTrackMenu({ row, index: idx, contextKind: 'random' }, x, y)
            }
            onOpenAlbum={(aid) => onNavigate({ kind: 'album', id: aid })}
            onOpenArtist={(arid) => onNavigate({ kind: 'artist', id: arid })}
          />
        )}
      </main>
    );
  }

  // 9. ALL SONGS VIEW (Flat Virtual Table or Grouped Artist / Album / Both)
  if (route.kind === 'all_songs') {
    if (isNavidrome) return NavidromePreviewBanner('nav.all_songs');
    const flatOnly = songsGroup === 'none';
    const flatTrackRows: TrackRow[] = flatOnly
      ? allSongsRows.filter((item) => item.kind === 'track' && item.track).map((item) => item.track!)
      : [];

    return (
      <main
        ref={scrollRef}
        className="card main-pane scroll-area"
        onScroll={(e) => {
          const el = e.currentTarget as HTMLElement;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 420) {
            loadMoreAllSongs();
          }
        }}
      >
        <div
          className="detail-hero"
          style={{ background: headerGradientBg(playlists.libHue, 'all-songs', settings.light) }}
        >
          <div className="detail-nav-row">
            {canGoBack && (
              <button type="button" className="circle-nav-btn" aria-label={t(lang, 'btn.back')} onClick={onGoBack}>
                <Icon name="back" size={18} />
              </button>
            )}
          </div>
          <div className="detail-hero-body">
            <Cover url={playlists.libCoverUrl} seed="all-songs" size={180} radius={8} contain className="hero-cover" />
            <div className="detail-hero-info">
              <div className="eyebrow">{t(lang, 'eyebrow.library')}</div>
              <h1 className="hero-title">{t(lang, 'nav.all_songs')}</h1>
              <div className="hero-meta">
                <span>{t(lang, 'meta.songs', fmtNum(allSongsMeta.totalSongs || playlists.libCount))}</span>
                {allSongsMeta.totalDuration > 0 && <span>· {fmtDur(allSongsMeta.totalDuration)}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="detail-actions split-actions">
          <div className="detail-actions-left">
            <button
              type="button"
              className="big-play-btn"
              aria-label={t(lang, 'btn.play')}
              onClick={() =>
                void rpc('browse.playList', { kind: 'allSongs', group: songsGroup, index: 0, shuffle: false })
              }
            >
              <Icon name="play" size={24} />
            </button>
            <button
              type="button"
              className="action-outline-btn"
              onClick={() =>
                void rpc('browse.playList', { kind: 'allSongs', group: songsGroup, index: 0, shuffle: true })
              }
            >
              <Icon name="shuffle" size={16} />
              <span>{t(lang, 'btn.shuffle')}</span>
            </button>

            <div className="rg-ctrl-wrap">
              <button
                type="button"
                className={`pill-tab ${effRg?.active ? 'active' : ''}`}
                aria-pressed={Boolean(effRg?.active)}
                onClick={() => {
                  rpc<ReplayGainState & { needsConfirm?: boolean }>('replaygain.toggle')
                    .then((res) => {
                      setLocalRg(res);
                      if (res?.needsConfirm) onOpenReplayGainPrompt(res.missingCount, res.total);
                    })
                    .catch(() => {});
                }}
              >
                <Icon name="equalizer" size={15} />
                <span>{t(lang, 'btn.normalize')}</span>
              </button>
              {effRg && effRg.total > 0 && (
                <span className="rg-cap">
                  {effRg.missingCount > 0
                    ? t(lang, 'rg.scanned_progress', fmtNum(effRg.scanned), fmtNum(effRg.total))
                    : t(lang, 'rg.scanned_done', t(lang, effRg.active ? 'rg.on' : 'rg.off'))}
                </span>
              )}
            </div>
          </div>

          <div className="sort-ctrl-group">
            <select
              className="pola-select"
              aria-label="Group songs by"
              value={songsGroup}
              onChange={(e) => setSongsGroup((e.currentTarget as HTMLSelectElement).value as AllSongsGroupMode)}
            >
              {SONGS_GROUPS.map((gOpt) => (
                <option key={gOpt.id} value={gOpt.id}>
                  {t(lang, 'group.prefix', t(lang, gOpt.key))}
                </option>
              ))}
            </select>
          </div>
        </div>

        {allSongsMeta.totalSongs === 0 && !allSongsLoading ? (
          <div className="empty-detail">
            <h3>{t(lang, 'empty.lib_empty')}</h3>
            <p>{t(lang, 'empty.lib_empty_sub')}</p>
          </div>
        ) : flatOnly ? (
          <>
            <TrackTable
              lang={lang}
              rows={flatTrackRows}
              currentTrack={track}
              canLoveSong={canLoveSong}
              scrollContainerRef={scrollRef}
              onPlay={(_, idx) =>
                void rpc('browse.playList', { kind: 'allSongs', group: 'none', index: idx, shuffle: false })
              }
              onEnqueue={(row) => void rpc('browse.enqueueTrack', { trackId: row.id })}
              onToggleLoved={onToggleLoved}
              onOpenMenu={(row, idx, x, y) =>
                onOpenTrackMenu({ row, index: idx, contextKind: 'allSongs' }, x, y)
              }
              onOpenAlbum={(aid) => onNavigate({ kind: 'album', id: aid })}
              onOpenArtist={(arid) => onNavigate({ kind: 'artist', id: arid })}
            />
            {allSongsRows.length < allSongsMeta.totalRows && (
              <div className="load-more-wrap">
                <button type="button" className="action-outline-btn" onClick={loadMoreAllSongs}>
                  {t(lang, 'btn.loading')} ({allSongsRows.length} / {allSongsMeta.totalRows})
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="grouped-songs-list">
            {allSongsRows.map((item) => {
              if (item.kind === 'g1_artist') {
                return (
                  <button
                    key={`g1a-${item.rowIndex}`}
                    type="button"
                    className={`sg-banner ${songsGroup === 'both' ? 'nested-root' : ''}`}
                    onClick={() => item.targetId && onNavigate({ kind: 'artist', id: item.targetId })}
                  >
                    <Cover url={item.coverUrl} seed={item.label || 'artist'} size={48} circle contain={false} fallbackIcon="artist" />
                    <div className="sg-banner-meta">
                      {songsGroup === 'both' && <div className="eyebrow">{t(lang, 'eyebrow.artist')}</div>}
                      <div className="sg-banner-title truncate">{item.label}</div>
                      <div className="sg-banner-sub">
                        {item.albumCount
                          ? `${item.albumCount === 1 ? t(lang, 'meta.album_one') : t(lang, 'meta.album_count', fmtNum(item.albumCount))} · `
                          : ''}
                        {t(lang, 'meta.songs', fmtNum(item.songCount || 0))}
                      </div>
                    </div>
                  </button>
                );
              }
              if (item.kind === 'g1_album' || item.kind === 'g2_album') {
                const nested = item.kind === 'g2_album';
                return (
                  <button
                    key={`ga-${item.rowIndex}`}
                    type="button"
                    className={`sg-banner ${nested ? 'nested-album' : ''}`}
                    onClick={() => item.targetId && onNavigate({ kind: 'album', id: item.targetId })}
                  >
                    <Cover url={item.coverUrl} seed={item.targetId || item.label || 'alb'} size={nested ? 38 : 46} radius={5} contain />
                    <div className="sg-banner-meta">
                      <div className="sg-banner-title truncate">{item.label}</div>
                      <div className="sg-banner-sub">
                        {item.sub ? `${item.sub} · ` : ''}
                        {t(lang, 'meta.songs', fmtNum(item.songCount || 0))}
                      </div>
                    </div>
                  </button>
                );
              }
              const tr = item.track;
              if (!tr) return null;
              const isCurrent = track.key > 0 && track.id === tr.id;
              return (
                <div
                  key={`gt-${item.rowIndex}`}
                  className={`trk-row compact-grouped ${songsGroup === 'both' ? 'indent-2' : 'indent-1'} ${isCurrent ? 'playing' : ''}`}
                  onDblClick={() =>
                    void rpc('browse.playList', {
                      kind: 'allSongs',
                      group: songsGroup,
                      index: item.rowIndex,
                      shuffle: false
                    })
                  }
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onOpenTrackMenu(
                      { row: tr, index: item.rowIndex, contextKind: 'allSongs', group: songsGroup },
                      Math.round(e.clientX),
                      Math.round(e.clientY)
                    );
                  }}
                >
                  <div className="trk-cell-num">
                    <span className="trk-idx">{tr.index + 1}</span>
                    <button
                      type="button"
                      className="trk-play-mini"
                      aria-label={t(lang, 'menu.trk_play')}
                      onClick={() =>
                        void rpc('browse.playList', {
                          kind: 'allSongs',
                          group: songsGroup,
                          index: item.rowIndex,
                          shuffle: false
                        })
                      }
                    >
                      <Icon name="play" size={14} />
                    </button>
                  </div>
                  <div className="trk-cell-title">
                    <div className="trk-title-stack">
                      <div className="trk-name truncate">
                        {tr.title}
                        {songsGroup === 'album' && tr.artist ? <span className="trk-inline-artist"> — {tr.artist}</span> : ''}
                      </div>
                    </div>
                  </div>
                  <div className="trk-cell-right">
                    {canLoveSong && (
                      <button
                        type="button"
                        className={`trk-heart-btn ${tr.loved ? 'loved' : ''}`}
                        onClick={() => onToggleLoved(tr)}
                      >
                        <Icon name={tr.loved ? 'heart' : 'heartO'} size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="trk-q-btn"
                      onClick={() => void rpc('browse.enqueueTrack', { trackId: tr.id })}
                    >
                      <Icon name="add" size={15} />
                    </button>
                    <span className="trk-dur">{fmtTime(tr.duration)}</span>
                    <button
                      type="button"
                      className="trk-more-btn"
                      aria-label={t(lang, 'menu.more')}
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        onOpenTrackMenu(
                          { row: tr, index: item.rowIndex, contextKind: 'allSongs', group: songsGroup },
                          Math.round(rect.right),
                          Math.round(rect.bottom + 2)
                        );
                      }}
                    >
                      <Icon name="more" size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
            {allSongsRows.length < allSongsMeta.totalRows && (
              <div className="load-more-wrap">
                <button type="button" className="action-outline-btn" onClick={loadMoreAllSongs}>
                  Load more ({allSongsRows.length} / {allSongsMeta.totalRows})
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    );
  }

  // 10. HOME OVERVIEW
  const quickCards: Array<{ kind: MainRoute['kind']; label: string; icon: 'heart' | 'shuffle' | 'album' | 'artist'; tone: string }> = [
    { kind: 'loved', label: t(lang, 'home.quick_loved'), icon: 'heart', tone: 'loved' },
    { kind: 'random', label: t(lang, 'home.quick_random'), icon: 'shuffle', tone: 'random' },
    { kind: 'albums', label: t(lang, 'home.quick_albums'), icon: 'album', tone: 'albums' },
    { kind: 'artists', label: t(lang, 'home.quick_artists'), icon: 'artist', tone: 'artists' }
  ];

  const recentAlbums = homeData?.recentAlbums || [];
  const homeArtists = homeData?.artists || [];

  return (
    <main ref={scrollRef} className="card main-pane scroll-area home-pane">
      <div className="home-hero-band" style={{ background: headerGradientBg(track.hue || playlists.libHue, 'home', settings.light) }}>
        <div className="home-top-bar">
          <h1 className="home-heading">PolaPlayer</h1>
          <div className="home-top-actions">
            {isNavidrome && (settings.servers?.length || 0) > 1 && (
              <select
                className="pola-select"
                aria-label={t(lang, 'nav.switch_server')}
                value={settings.activeServerId || settings.servers![0].id}
                onChange={(e) => {
                  void rpc('settings.selectServer', { id: (e.currentTarget as HTMLSelectElement).value });
                }}
              >
                {settings.servers!.map((srv) => (
                  <option key={srv.id} value={srv.id}>
                    {srv.name || srv.server}
                  </option>
                ))}
              </select>
            )}
            {isNavidrome && !settings.configured && (
              <button type="button" className="action-outline-btn" onClick={onOpenSetup}>
                {t(lang, 'menu.settings')}
              </button>
            )}
            <button type="button" className="action-outline-btn" onClick={onOpenCreatePlaylist}>
              <Icon name="add" size={15} />
              <span>{t(lang, 'btn.new_pl')}</span>
            </button>
          </div>
        </div>

        <div className="home-quick-grid">
          {quickCards.map((c) => (
            <button
              key={c.kind}
              type="button"
              className="home-quick-card"
              onClick={() => onNavigate({ kind: c.kind } as MainRoute)}
            >
              <span className={`hq-icon ${c.tone}`}>
                <Icon name={c.icon} size={22} />
              </span>
              <span className="hq-label truncate">{c.label}</span>
            </button>
          ))}
        </div>
      </div>

      {recentAlbums.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <h2>{t(lang, 'home.recent_albums')}</h2>
            <button type="button" className="see-all-link" onClick={() => onNavigate({ kind: 'albums' })}>
              {t(lang, 'btn.see_all')}
            </button>
          </div>
          <div className="h-shelf scroll-x">
            {recentAlbums.map((al) => (
              <div key={al.id} className="shelf-card-wrap">
                <AlbumCard
                  album={al}
                  lang={lang}
                  onOpen={(a) => onNavigate({ kind: 'album', id: a.id })}
                  onPlay={(a) => playAlbum(a.id)}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="home-section">
        <div className="section-head">
          <h2>{isNavidrome ? t(lang, 'home.nv_playlists') : t(lang, 'home.local_playlists')}</h2>
        </div>

        {playlists.list.length === 0 ? (
          <div className="center-note">
            {isNavidrome ? t(lang, 'home.no_pl_hint') : t(lang, 'home.no_local_pl_hint')}
          </div>
        ) : (
          <div className="pl-card-grid">
            {playlists.list.map((pl) => (
              <div key={pl.id} className="media-card option-a">
                <button
                  type="button"
                  className="media-card-hit"
                  onClick={() => {
                    void rpc('playlists.select', { id: pl.id });
                    onNavigate({ kind: 'playlist', id: pl.id });
                  }}
                >
                  <div className="media-card-cover">
                    <Cover url={pl.coverUrl} seed={pl.id || pl.name} size="100%" radius={8} contain />
                  </div>
                  <div className="media-card-title truncate">{pl.name}</div>
                  <div className="media-card-sub truncate">{t(lang, 'meta.songs', fmtNum(pl.songCount))}</div>
                </button>
                <button
                  type="button"
                  className="media-card-play"
                  aria-label={`${t(lang, 'btn.play')} ${pl.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void rpc('playlists.play', { id: pl.id, index: 0, shuffle: false });
                  }}
                >
                  <Icon name="play" size={20} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {homeArtists.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <h2>{t(lang, 'home.artists_in_lib')}</h2>
            <button type="button" className="see-all-link" onClick={() => onNavigate({ kind: 'artists' })}>
              {t(lang, 'btn.see_all')}
            </button>
          </div>
          <div className="h-shelf scroll-x">
            {homeArtists.map((ar) => (
              <div key={ar.id} className="shelf-card-wrap">
                <ArtistCard
                  artist={ar}
                  lang={lang}
                  onOpen={(a) => onNavigate({ kind: 'artist', id: a.id })}
                />
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
