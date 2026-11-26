import { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { PlaylistsState, PlaylistSummary, SettingsState } from '../types';
import { rpc, sendDroppedFiles } from '../bridge/rpc';
import { fmtNum, t, LangCode } from '../i18n/strings';
import { Cover } from './Cover';
import { Icon } from './Icons';

export type MainRoute =
  | { kind: 'home' }
  | { kind: 'search' }
  | { kind: 'playlist'; id: string }
  | { kind: 'album'; id: string }
  | { kind: 'artist'; id: string }
  | { kind: 'all_songs' }
  | { kind: 'loved' }
  | { kind: 'random' }
  | { kind: 'albums' }
  | { kind: 'artists' };

export interface SidebarProps {
  lang: LangCode;
  settings: SettingsState;
  playlists: PlaylistsState;
  route: MainRoute;
  isDrawer: boolean;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  onNavigate: (route: MainRoute) => void;
  onOpenCreatePlaylist: () => void;
  onOpenPlaylistMenu: (pl: PlaylistSummary, x: number, y: number) => void;
}

export function Sidebar({
  lang,
  settings,
  playlists,
  route,
  isDrawer,
  drawerOpen,
  onCloseDrawer,
  onNavigate,
  onOpenCreatePlaylist,
  onOpenPlaylistMenu
}: SidebarProps): JSX.Element {
  const isNavidrome = settings.activeSource === 'navidrome';
  const hasAllSongs = settings.caps ? settings.caps.allSongs : !isNavidrome;
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const selectRoute = (next: MainRoute) => {
    onNavigate(next);
    if (isDrawer) onCloseDrawer();
  };

  const openPlaylist = (pl: PlaylistSummary) => {
    void rpc('playlists.select', { id: pl.id });
    selectRoute({ kind: 'playlist', id: pl.id });
  };

  const inner = (
    <aside
      id="nav-drawer"
      className={`sidebar ${isDrawer ? 'is-drawer' : ''} ${isDrawer && drawerOpen ? 'open' : ''}`}
      aria-label="Primary navigation"
    >
      <section className="card nav-top">
        {settings.sources === 'both' && (
          <div className="source-switch" role="group" aria-label={t(lang, 'setup.libraries')}>
            <button
              type="button"
              className={`source-pill ${settings.activeSource === 'local' ? 'active' : ''}`}
              aria-pressed={settings.activeSource === 'local'}
              onClick={() => void rpc('source.select', { source: 'local' })}
            >
              {t(lang, 'source.local')}
            </button>
            <button
              type="button"
              className={`source-pill ${settings.activeSource === 'navidrome' ? 'active' : ''}`}
              aria-pressed={settings.activeSource === 'navidrome'}
              onClick={() => void rpc('source.select', { source: 'navidrome' })}
            >
              {t(lang, 'source.navidrome')}
            </button>
          </div>
        )}

        {isNavidrome && (settings.servers?.length || 0) > 1 && (
          <div className="server-switch-row">
            <select
              className="server-select-compact"
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
          </div>
        )}

        <button
          type="button"
          className={`nav-link ${route.kind === 'home' ? 'active' : ''}`}
          onClick={() => selectRoute({ kind: 'home' })}
        >
          <Icon name="home" size={20} />
          <span>{t(lang, 'nav.home')}</span>
        </button>

        <button
          type="button"
          className={`nav-link ${route.kind === 'search' ? 'active' : ''}`}
          onClick={() => selectRoute({ kind: 'search' })}
        >
          <Icon name="search" size={20} />
          <span>{t(lang, 'search.title')}</span>
        </button>
      </section>

      <section className="card nav-lib">
        <div className="nav-lib-head">
          <div className="nav-lib-title">{t(lang, 'nav.your_library')}</div>
          <button
            type="button"
            className={`icon-btn ${playlists.loading ? 'spinning' : ''}`}
            aria-label={t(lang, 'btn.refresh')}
            title={t(lang, 'btn.refresh')}
            onClick={() => void rpc('playlists.refresh')}
          >
            <Icon name="refresh" size={16} />
          </button>
        </div>

        {hasAllSongs && (
          <button
            type="button"
            className={`pl-row pinned ${route.kind === 'all_songs' ? 'selected' : ''}`}
            onClick={() => selectRoute({ kind: 'all_songs' })}
          >
            <Cover url={playlists.libCoverUrl} seed="all-songs" size={42} radius={6} contain />
            <div className="pl-row-meta">
              <div className="pl-row-name">{t(lang, 'nav.all_songs')}</div>
              <div className="pl-row-sub">{t(lang, 'meta.songs', fmtNum(playlists.libCount))}</div>
            </div>
          </button>
        )}

        <div className="quick-grid">
          <button
            type="button"
            className={`quick-chip ${route.kind === 'loved' ? 'active' : ''}`}
            onClick={() => selectRoute({ kind: 'loved' })}
          >
            <span className="qc-badge loved"><Icon name="heart" size={13} /></span>
            <span className="truncate">{t(lang, 'nav.loved')}</span>
          </button>
          <button
            type="button"
            className={`quick-chip ${route.kind === 'random' ? 'active' : ''}`}
            onClick={() => selectRoute({ kind: 'random' })}
          >
            <span className="qc-badge random"><Icon name="shuffle" size={13} /></span>
            <span className="truncate">{t(lang, 'nav.random')}</span>
          </button>
          <button
            type="button"
            className={`quick-chip ${route.kind === 'albums' ? 'active' : ''}`}
            onClick={() => selectRoute({ kind: 'albums' })}
          >
            <span className="qc-badge albums"><Icon name="album" size={13} /></span>
            <span className="truncate">{t(lang, 'nav.albums')}</span>
          </button>
          <button
            type="button"
            className={`quick-chip ${route.kind === 'artists' ? 'active' : ''}`}
            onClick={() => selectRoute({ kind: 'artists' })}
          >
            <span className="qc-badge artists"><Icon name="artist" size={13} /></span>
            <span className="truncate">{t(lang, 'nav.artists')}</span>
          </button>
        </div>

        <div className="nav-pl-scroll scroll-area">
          {playlists.loading && playlists.list.length === 0 ? (
            <div className="nav-empty-note">{t(lang, 'nav.syncing_nv')}</div>
          ) : playlists.error ? (
            <div className="nav-empty-note err">
              <div>{t(lang, 'nav.server_unreachable')}</div>
              <button type="button" className="mini-btn" onClick={() => void rpc('playlists.refresh')}>
                {t(lang, 'btn.retry')}
              </button>
            </div>
          ) : playlists.list.length === 0 ? (
            <div className="nav-empty-note">
              {isNavidrome ? t(lang, 'nav.no_server_playlists') : t(lang, 'home.no_local_pl_hint')}
            </div>
          ) : (
            playlists.list.map((pl) => {
              const isSelected = route.kind === 'playlist' && route.id === pl.id;
              const isPlayingList = playlists.selected === pl.id;
              const canDropHere = !isNavidrome && pl.editable;
              return (
                <div
                  key={pl.id}
                  className={`pl-row ${isSelected ? 'selected' : ''} ${isPlayingList ? 'active-source' : ''} ${dropTarget === pl.id ? 'drop-over' : ''}`}
                  onDragOver={(e) => {
                    if (!canDropHere || !e.dataTransfer?.types.includes('Files')) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    if (dropTarget !== pl.id) setDropTarget(pl.id);
                  }}
                  onDragLeave={() => {
                    if (dropTarget === pl.id) setDropTarget(null);
                  }}
                  onDrop={(e) => {
                    if (!canDropHere) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDropTarget(null);
                    sendDroppedFiles('playlist', pl.id, e.dataTransfer?.files);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onOpenPlaylistMenu(pl, Math.round(e.clientX), Math.round(e.clientY));
                  }}
                >
                  <button
                    type="button"
                    className="pl-row-hit"
                    onClick={() => openPlaylist(pl)}
                    onDblClick={() => void rpc('playlists.play', { id: pl.id, index: 0 })}
                  >
                    <Cover url={pl.coverUrl} seed={pl.id || pl.name} size={42} radius={6} contain />
                    <div className="pl-row-meta">
                      <div className="pl-row-name">{pl.name}</div>
                      <div className="pl-row-sub">
                        {t(lang, 'meta.songs', fmtNum(pl.songCount))}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="pl-row-more"
                    aria-label={t(lang, 'menu.more')}
                    onClick={(e) => {
                      e.stopPropagation();
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      onOpenPlaylistMenu(pl, Math.round(r.left), Math.round(r.bottom + 2));
                    }}
                  >
                    <Icon name="more" size={15} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <button
          type="button"
          className={`nav-new-pl ${dropTarget === '__new__' ? 'drop-over' : ''}`}
          onClick={onOpenCreatePlaylist}
          onDragOver={(e) => {
            if (isNavidrome || !e.dataTransfer?.types.includes('Files')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            if (dropTarget !== '__new__') setDropTarget('__new__');
          }}
          onDragLeave={() => {
            if (dropTarget === '__new__') setDropTarget(null);
          }}
          onDrop={(e) => {
            if (isNavidrome) return;
            e.preventDefault();
            e.stopPropagation();
            setDropTarget(null);
            sendDroppedFiles('new', '', e.dataTransfer?.files);
          }}
        >
          <Icon name="add" size={18} />
          <div className="nav-new-pl-meta">
            <span>{isNavidrome ? t(lang, 'nav.new_server_pl') : t(lang, 'nav.new_playlist')}</span>
            {!isNavidrome && <span className="nav-new-pl-sub">{t(lang, 'nav.new_playlist_sub')}</span>}
          </div>
        </button>
      </section>
    </aside>
  );

  if (!isDrawer) return inner;

  return (
    <>
      {drawerOpen && <div className="drawer-backdrop" onClick={onCloseDrawer} aria-hidden="true" />}
      {inner}
    </>
  );
}
