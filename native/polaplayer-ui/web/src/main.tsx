import { render, JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import '@applemusic-like-lyrics/core/style.css';
import './styles/app.css';
import {
  DupPromptState,
  LovedTarget,
  LyricsState,
  NavConnectionState,
  PlaybackState,
  PlaylistsState,
  PlaylistSummary,
  QueueState,
  ReplayGainState,
  SearchStatus,
  SettingsState,
  ToggleLovedResponse,
  TrackInfo,
  TrackRow,
  WindowState
} from './types';
import { onHostEvent, rpc, signalReady } from './bridge/rpc';
import { PlaybackClock } from './bridge/playbackClock';
import { t } from './i18n/strings';
import { Titlebar } from './components/Titlebar';
import { MainRoute, Sidebar } from './components/Sidebar';
import { RightPane } from './components/RightPane';
import { PlayerBar } from './components/PlayerBar';
import { MainShell, TrackMenuContext } from './components/MainShell';
import {
  ContextPopupMenu,
  DeletePlaylistDialog,
  DuplicateTracksDialog,
  LovedConfirmDialog,
  OnboardingWizardDialog,
  PlaylistPromptDialog,
  PopupMenuItem,
  ReplayGainDialog,
  SetupDialog
} from './components/Modals';
import { FullscreenOverlay, VizFrame } from './fullscreen/FullscreenOverlay';

const INITIAL_WINDOW: WindowState = { maximized: false, fullscreen: false, fsView: 'lyrics' };
const INITIAL_SETTINGS: SettingsState = {
  themeMode: 0,
  light: false,
  languageMode: 'auto',
  language: 'en',
  sources: 'local',
  activeSource: 'local',
  rightTab: 'lyrics',
  server: '',
  user: '',
  configured: false,
  lovedConfirmed: false,
  activeServerId: '',
  servers: []
};
const INITIAL_TRACK: TrackInfo = {
  key: 0,
  source: 'local',
  title: '',
  artist: '',
  album: '',
  length: 0,
  coverUrl: '',
  hue: '',
  loved: false
};
const INITIAL_PLAYBACK: PlaybackState = {
  playing: false,
  paused: false,
  time: 0,
  length: 0,
  volume: 1,
  shuffle: false,
  repeat: 0
};
const INITIAL_PLAYLISTS: PlaylistsState = {
  source: 'local',
  selected: null,
  revision: 0,
  loading: false,
  error: '',
  libCount: 0,
  libCoverUrl: '',
  libHue: '',
  list: []
};
const INITIAL_QUEUE: QueueState = {
  sourceName: '',
  repeatingTrack: false,
  manual: [],
  next: []
};
const INITIAL_LYRICS: LyricsState = {
  key: 0,
  remote: false,
  heading: 'LYRICS',
  status: 'ready',
  model: null
};
const INITIAL_SEARCH: SearchStatus = {
  source: 'local',
  query: '',
  revision: 0,
  status: 'idle',
  count: 0
};

function App(): JSX.Element {
  const clockRef = useRef<PlaybackClock>(new PlaybackClock());

  const [winState, setWinState] = useState<WindowState>(INITIAL_WINDOW);
  const [settings, setSettings] = useState<SettingsState>(INITIAL_SETTINGS);
  const [track, setTrack] = useState<TrackInfo>(INITIAL_TRACK);
  const [playback, setPlayback] = useState<PlaybackState>(INITIAL_PLAYBACK);
  const [playlists, setPlaylists] = useState<PlaylistsState>(INITIAL_PLAYLISTS);
  const [queue, setQueue] = useState<QueueState>(INITIAL_QUEUE);
  const [lyrics, setLyrics] = useState<LyricsState>(INITIAL_LYRICS);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>(INITIAL_SEARCH);
  const [navConn, setNavConn] = useState<NavConnectionState>({ status: 'idle' });
  const [browseRev, setBrowseRev] = useState(1);
  const [artHues, setArtHues] = useState<Record<string, string>>({});

  const [history, setHistory] = useState<MainRoute[]>([{ kind: 'home' }]);
  const route = history[history.length - 1];

  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);

  const [setupOpen, setSetupOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const wizardCheckedRef = useRef(false);
  const [plPrompt, setPlPrompt] = useState<{ mode: 'create' | 'rename'; pl?: PlaylistSummary; addTrackIds?: string[] } | null>(null);
  const [plDelete, setPlDelete] = useState<PlaylistSummary | null>(null);
  const [pendingLovedTrackId, setPendingLovedTrackId] = useState<string | null>(null);
  const [dupPrompt, setDupPrompt] = useState<DupPromptState | null>(null);
  const [replaygain, setReplaygain] = useState<ReplayGainState | undefined>(undefined);
  const [rgPrompt, setRgPrompt] = useState<{ missing: number; total: number } | null>(null);
  const [vizFrame, setVizFrame] = useState<VizFrame>(() => ({ bass: 0, bands: [] }));
  const [toast, setToast] = useState<{ text: string; kind: string } | null>(null);
  const toastTimerRef = useRef<number>(0);
  const prevSourceRef = useRef<{ source: 'local' | 'navidrome'; serverId: string } | null>(null);
  const [popupMenu, setPopupMenu] = useState<{ x: number; y: number; items: PopupMenuItem[] } | null>(null);

  const isNavDrawer = vp.w < 700;
  const isRightDrawer = vp.w < 1120;
  const isCompactMenu = vp.w < 560;
  const isCompactVol = vp.w < 1200;
  const isNarrowBar = vp.w < 640;
  const isShortWindow = vp.h < 560;

  // Apply theme & language to <html>
  useEffect(() => {
    const theme = settings.light && !winState.fullscreen ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = settings.language === 'zh-CN' ? 'zh-CN' : 'en';
  }, [settings.light, settings.language, winState.fullscreen]);

  // Viewport tracking
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const showToastMsg = useCallback((text: string, kind = 'info') => {
    setToast({ text, kind });
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3800);
  }, []);

  // Host RPC events
  useEffect(() => {
    const clock = clockRef.current;
    const unsubs = [
      onHostEvent<WindowState>('windowState', (d) => {
        setWinState(d);
        if (!d.fullscreen || d.fsView !== 'viz') {
          setVizFrame({ bass: 0, bands: [] });
        }
      }),
      onHostEvent<VizFrame>('viz.frame', (vf) => setVizFrame(vf)),
      onHostEvent<SettingsState>('settings', (d) => {
        setSettings(d);
        const curServer = d.activeServerId || '';
        const prev = prevSourceRef.current;
        prevSourceRef.current = { source: d.activeSource, serverId: curServer };
        if (
          prev &&
          (prev.source !== d.activeSource || (d.activeSource === 'navidrome' && prev.serverId !== curServer))
        ) {
          const allowAllSongs = d.caps ? d.caps.allSongs : d.activeSource !== 'navidrome';
          setHistory((hist) => {
            const top = hist[hist.length - 1];
            const isShared =
              top.kind === 'home' ||
              top.kind === 'search' ||
              top.kind === 'albums' ||
              top.kind === 'artists' ||
              top.kind === 'loved' ||
              top.kind === 'random' ||
              (top.kind === 'all_songs' && allowAllSongs);
            return [isShared ? top : { kind: 'home' }];
          });
        }
        if (d.replaygain) setReplaygain(d.replaygain);
        if (!wizardCheckedRef.current) {
          wizardCheckedRef.current = true;
          if (d.onboardingNeeded) setWizardOpen(true);
        }
      }),
      onHostEvent<ReplayGainState>('replaygain', (rg) => setReplaygain(rg)),
      onHostEvent<DupPromptState>('dup.prompt', (dp) => setDupPrompt(dp)),
      onHostEvent<{ id: string }>('playlist.open', (d) => {
        if (d?.id) {
          setHistory((prev) => [...prev, { kind: 'playlist', id: d.id }]);
        }
      }),
      onHostEvent<TrackInfo>('track', (d) => {
        setTrack((prev) => {
          if (prev.key !== d.key) {
            clock.sync(0, d.length, false, true, performance.now());
          }
          return d;
        });
      }),
      onHostEvent<PlaybackState>('playback', (d) => {
        setPlayback(d);
        clock.sync(d.time, d.length, d.playing && !d.paused, Boolean(d.seek), performance.now());
      }),
      onHostEvent<PlaylistsState>('playlists', (d) => setPlaylists(d)),
      onHostEvent<QueueState>('queue', (d) => setQueue(d)),
      onHostEvent<LyricsState>('lyrics', (d) => setLyrics(d)),
      onHostEvent<SearchStatus>('search.updated', (d) => setSearchStatus(d)),
      onHostEvent<NavConnectionState>('nav.connection', (d) => setNavConn(d)),
      onHostEvent('browse.updated', () => setBrowseRev((v) => v + 1)),
      onHostEvent<{ messageKey: string; arg?: string; kind?: string }>('toast', (d) => {
        setSettings((cur) => {
          showToastMsg(t(cur.language, d.messageKey, d.arg || ''), d.kind || 'info');
          return cur;
        });
      }),
      onHostEvent<{ key: string; hue: string }>('art.hue', (d) => {
        setArtHues((prev) => (prev[d.key] === d.hue ? prev : { ...prev, [d.key]: d.hue }));
        if (d.key.startsWith('pl:')) {
          const pid = d.key.slice(3);
          setPlaylists((prev) => ({
            ...prev,
            list: prev.list.map((p) => (p.id === pid ? { ...p, hue: d.hue } : p))
          }));
        } else if (d.key === 'lib') {
          setPlaylists((prev) => ({ ...prev, libHue: d.hue }));
        } else {
          setTrack((prev) => ({ ...prev, hue: d.hue }));
        }
      }),
      onHostEvent<{ view?: 'lyrics' | 'default'; visible?: boolean; track?: TrackInfo; playback?: PlaybackState; lyrics?: LyricsState }>('raw:init', (d) => {
        if (d.track) setTrack(d.track);
        if (d.playback) {
          setPlayback(d.playback);
          clock.sync(
            d.playback.time,
            d.playback.length,
            d.playback.playing && !d.playback.paused,
            true,
            performance.now()
          );
        }
        if (d.lyrics) setLyrics(d.lyrics);
        if (d.visible) {
          setWinState((prev) => ({ ...prev, fullscreen: true, fsView: d.view || prev.fsView }));
        }
      })
    ];

    signalReady();
    const preventNavDrop = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener('dragover', preventNavDrop);
    window.addEventListener('drop', preventNavDrop);
    return () => {
      window.removeEventListener('dragover', preventNavDrop);
      window.removeEventListener('drop', preventNavDrop);
      for (const fn of unsubs) fn();
    };
  }, [showToastMsg]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const isEditable =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);

      if (ev.key === 'F11') {
        ev.preventDefault();
        if (winState.fullscreen) {
          void rpc('fullscreen.exit');
        } else {
          void rpc('fullscreen.enter', { view: winState.fsView || 'lyrics' });
        }
        return;
      }

      if (ev.key === 'Escape') {
        if (popupMenu) { setPopupMenu(null); return; }
        if (navDrawerOpen) { setNavDrawerOpen(false); return; }
        if (rightDrawerOpen) { setRightDrawerOpen(false); return; }
        if (winState.fullscreen && !setupOpen && !plPrompt && !plDelete && !pendingLovedTrackId) {
          void rpc('fullscreen.exit');
          return;
        }
      }

      if (ev.code === 'Space' && !isEditable && !setupOpen && !plPrompt && !plDelete && !pendingLovedTrackId) {
        if (target?.tagName !== 'BUTTON') {
          ev.preventDefault();
          void rpc('playback.ctrl', { act: 'play' });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [popupMenu, navDrawerOpen, rightDrawerOpen, winState.fullscreen, setupOpen, plPrompt, plDelete, pendingLovedTrackId]);

  const navigate = useCallback((next: MainRoute) => {
    setHistory((prev) => {
      const top = prev[prev.length - 1];
      if (
        top.kind === next.kind &&
        (('id' in top && 'id' in next) ? top.id === next.id : true)
      ) {
        return prev;
      }
      return [...prev.slice(-24), next];
    });
  }, []);

  const goBack = useCallback(() => {
    setHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const lang = settings.language;
  const canLoveSong = !settings.caps || settings.caps.lovedKinds.includes('song');

  const handleToggleLoved = useCallback((rowOrTarget: LovedTarget) => {
    const kind = typeof rowOrTarget === 'object' && 'kind' in rowOrTarget ? rowOrTarget.kind : 'song';
    const targetId = typeof rowOrTarget === 'string' ? rowOrTarget : rowOrTarget.id;
    if (!targetId) return;
    rpc<ToggleLovedResponse>('track.toggleLoved', { kind, id: targetId, trackId: targetId })
      .then((res) => {
        if (res?.needsConfirm && kind === 'song') setPendingLovedTrackId(targetId);
      })
      .catch(() => {});
  }, []);

  const openSnapMenu = (x: number, y: number) => {
    const presets: Array<[string, string]> = [
      ['max', 'snap.maximize'],
      ['h-l', 'snap.half_left'],
      ['h-r', 'snap.half_right'],
      ['t-l', 'snap.third_left'],
      ['t-m', 'snap.third_mid'],
      ['t-r', 'snap.third_right'],
      ['q-tl', 'snap.q_tl'],
      ['q-tr', 'snap.q_tr'],
      ['q-bl', 'snap.q_bl'],
      ['q-br', 'snap.q_br']
    ];
    setPopupMenu({
      x,
      y,
      items: presets.map(([id, key]) => ({
        label: t(lang, key),
        onClick: () => void rpc('chrome.snapPreset', { preset: id })
      }))
    });
  };

  const openCompactMenu = (x: number, y: number) => {
    setPopupMenu({
      x,
      y,
      items: [
        { label: t(lang, 'menu.file'), onClick: () => void rpc('chrome.openMenu', { root: 'file', x, y }) },
        { label: t(lang, 'menu.library'), onClick: () => void rpc('chrome.openMenu', { root: 'library', x, y }) },
        { label: t(lang, 'menu.settings'), onClick: () => setSetupOpen(true) },
        { label: t(lang, 'menu.help'), onClick: () => void rpc('chrome.openMenu', { root: 'help', x, y }) }
      ]
    });
  };

  const openPlaylistMenu = (pl: PlaylistSummary, x: number, y: number) => {
    const isNv = settings.activeSource === 'navidrome';
    const items: PopupMenuItem[] = [
      { label: t(lang, 'menu.pl_play'), accent: true, onClick: () => void rpc('playlists.play', { id: pl.id, index: 0, shuffle: false }) },
      { label: t(lang, 'menu.pl_shuf'), onClick: () => void rpc('playlists.play', { id: pl.id, index: 0, shuffle: true }) }
    ];
    if (!isNv && pl.editable) {
      items.push({ label: t(lang, 'menu.add_files'), sepBefore: true, onClick: () => void rpc('playlists.pickFiles', { playlistId: pl.id, folder: false }) });
      items.push({ label: t(lang, 'menu.add_folder'), onClick: () => void rpc('playlists.pickFiles', { playlistId: pl.id, folder: true }) });
    }
    if (pl.editable) {
      items.push({ label: t(lang, 'menu.rename'), sepBefore: isNv, onClick: () => setPlPrompt({ mode: 'rename', pl }) });
      items.push({ label: t(lang, 'menu.delete'), danger: true, onClick: () => setPlDelete(pl) });
    }
    if (!isNv && settings.sources === 'both' && settings.configured) {
      items.push({
        label: t(lang, 'menu.sync_nv'),
        sepBefore: true,
        onClick: () => void rpc('playlists.syncToNavidrome', { id: pl.id })
      });
    }
    setPopupMenu({ x, y, items });
  };

  const openTrackMenu = (ctx: TrackMenuContext, x: number, y: number) => {
    const { row, index } = ctx;
    const isNv = settings.activeSource === 'navidrome';
    const playWithShuffle = (shuffle: boolean) => {
      if (ctx.contextKind === 'playlist') {
        void rpc('playlists.play', { id: ctx.playlistId || '', index, shuffle });
      } else {
        void rpc('browse.playList', {
          kind: ctx.contextKind,
          id: ctx.targetId || '',
          query: ctx.query || '',
          group: ctx.group || 'none',
          index,
          shuffle
        });
      }
    };

    const editablePls = playlists.list.filter((p) => p.editable);
    const addSubmenu: PopupMenuItem[] = [
      {
        label: t(lang, isNv ? 'menu.add_new_nv_pl' : 'menu.add_new_pl'),
        accent: true,
        onClick: () => setPlPrompt({ mode: 'create', addTrackIds: [row.id] })
      },
      ...editablePls.map((p, idx) => ({
        label: p.name,
        sepBefore: idx === 0,
        onClick: () => void rpc('playlists.addTracks', { targetPlaylistId: p.id, trackIds: [row.id] })
      }))
    ];

    const realIndex = typeof row.origIndex === 'number' ? row.origIndex : index;
    const items: PopupMenuItem[] = [
      { label: t(lang, 'menu.trk_play'), accent: true, onClick: () => playWithShuffle(false) },
      { label: t(lang, 'menu.trk_shuf'), onClick: () => playWithShuffle(true) },
      {
        label: t(lang, 'menu.trk_play_next'),
        onClick: () => void rpc('track.playNext', { trackId: row.id, playlistId: ctx.playlistId || '', index: realIndex })
      },
      {
        label: t(lang, 'menu.trk_queue'),
        onClick: () => void rpc('browse.enqueueTrack', { trackId: row.id })
      }
    ];

    if (canLoveSong) {
      items.push({
        label: t(lang, row.loved ? 'menu.trk_unstar' : 'menu.trk_star'),
        sepBefore: true,
        onClick: () => handleToggleLoved(row)
      });
    }

    items.push({
      label: t(lang, isNv ? 'menu.trk_add_pl' : 'menu.trk_add_local_pl'),
      sepBefore: !canLoveSong,
      submenu: addSubmenu
    });

    if (row.albumId || row.artistId) {
      let sepNeeded = true;
      if (row.albumId) {
        items.push({
          label: t(lang, 'menu.trk_view_album'),
          sepBefore: sepNeeded,
          onClick: () => navigate({ kind: 'album', id: row.albumId! })
        });
        sepNeeded = false;
      }
      if (row.artistId) {
        items.push({
          label: t(lang, 'menu.trk_view_artist'),
          sepBefore: sepNeeded,
          onClick: () => navigate({ kind: 'artist', id: row.artistId! })
        });
      }
    }

    if (!isNv) {
      items.push({
        label: t(lang, 'menu.trk_open_folder'),
        sepBefore: true,
        onClick: () => void rpc('track.openInFolder', { trackId: row.id, playlistId: ctx.playlistId || '', index: realIndex })
      });
      items.push({
        label: t(lang, 'menu.trk_properties'),
        onClick: () => void rpc('track.showProperties', { trackId: row.id, playlistId: ctx.playlistId || '', index: realIndex })
      });
    }

    if (ctx.contextKind === 'playlist' && ctx.editable && ctx.playlistId) {
      items.push({
        label: t(lang, 'menu.trk_remove'),
        sepBefore: true,
        danger: true,
        onClick: () =>
          void rpc('playlists.removeTrack', {
            id: ctx.playlistId!,
            index: realIndex,
            songId: row.id
          })
      });
    }

    setPopupMenu({ x, y, items });
  };

  return (
    <div className="app-shell">
      <Titlebar
        lang={lang}
        maximized={winState.maximized}
        isNarrowWindow={isNavDrawer}
        isCompactMenu={isCompactMenu}
        navOpen={navDrawerOpen}
        onToggleNav={() => {
          setRightDrawerOpen(false);
          setNavDrawerOpen((o) => !o);
        }}
        onOpenSetup={() => setSetupOpen(true)}
        onOpenCompactMenu={openCompactMenu}
        onOpenSnapMenu={openSnapMenu}
      />

      <div className="workspace">
        <Sidebar
          lang={lang}
          settings={settings}
          playlists={playlists}
          route={route}
          isDrawer={isNavDrawer}
          drawerOpen={navDrawerOpen}
          onCloseDrawer={() => setNavDrawerOpen(false)}
          onNavigate={navigate}
          onOpenCreatePlaylist={() => setPlPrompt({ mode: 'create' })}
          onOpenPlaylistMenu={openPlaylistMenu}
        />

        <MainShell
          lang={lang}
          settings={settings}
          playlists={playlists}
          track={track}
          searchStatus={searchStatus}
          browseRevision={browseRev}
          artHues={artHues}
          replaygain={replaygain}
          route={route}
          canGoBack={history.length > 1}
          onGoBack={goBack}
          onNavigate={navigate}
          onToggleLoved={handleToggleLoved}
          onOpenTrackMenu={openTrackMenu}
          onOpenCreatePlaylist={() => setPlPrompt({ mode: 'create' })}
          onOpenRenamePlaylist={(pl) => setPlPrompt({ mode: 'rename', pl })}
          onOpenDeletePlaylist={(pl) => setPlDelete(pl)}
          onOpenReplayGainPrompt={(missing, total) => setRgPrompt({ missing, total })}
          onOpenSetup={() => setSetupOpen(true)}
        />

        <RightPane
          lang={lang}
          rightTab={settings.rightTab}
          track={track}
          playback={playback}
          clock={clockRef.current}
          queue={queue}
          lyrics={lyrics}
          isDrawer={isRightDrawer}
          drawerOpen={rightDrawerOpen}
          onCloseDrawer={() => setRightDrawerOpen(false)}
        />
      </div>

      <PlayerBar
        lang={lang}
        track={track}
        playback={playback}
        clock={clockRef.current}
        canLoveSong={canLoveSong}
        compactVol={isCompactVol}
        hasRightDrawer={isRightDrawer}
        rightDrawerOpen={rightDrawerOpen}
        shortWindow={isShortWindow}
        narrowBar={isNarrowBar}
        onToggleLovedCurrent={() => track.id && handleToggleLoved(track.id)}
        onToggleRightDrawer={() => {
          setNavDrawerOpen(false);
          setRightDrawerOpen((o) => !o);
        }}
        onEnterFullscreen={() => void rpc('fullscreen.enter', { view: 'lyrics' })}
      />

      <FullscreenOverlay
        visible={winState.fullscreen}
        view={winState.fsView}
        lang={lang}
        track={track}
        playback={playback}
        clock={clockRef.current}
        lyrics={lyrics}
        vizFrame={vizFrame}
      />

      <SetupDialog
        open={setupOpen}
        lang={lang}
        settings={settings}
        navConnection={navConn}
        onClose={() => setSetupOpen(false)}
      />

      <PlaylistPromptDialog
        open={Boolean(plPrompt)}
        mode={plPrompt?.mode || 'create'}
        lang={lang}
        initialName={plPrompt?.pl?.name || t(lang, 'nav.default_pl_name')}
        onSubmit={async (name) => {
          if (plPrompt?.mode === 'rename' && plPrompt.pl) {
            await rpc('playlists.rename', { id: plPrompt.pl.id, name });
          } else {
            const res = await rpc<{ id?: string; playlistId?: string }>('playlists.create', { name });
            const newId = res?.id || res?.playlistId;
            if (newId && plPrompt?.addTrackIds?.length) {
              await rpc('playlists.addTracks', { targetPlaylistId: newId, trackIds: plPrompt.addTrackIds });
            }
          }
        }}
        onClose={() => setPlPrompt(null)}
      />

      <DeletePlaylistDialog
        lang={lang}
        playlist={plDelete}
        isNavidrome={settings.activeSource === 'navidrome'}
        onConfirm={async (pl) => {
          await rpc('playlists.delete', { id: pl.id });
          if (route.kind === 'playlist' && route.id === pl.id) {
            navigate({ kind: 'home' });
          }
        }}
        onClose={() => setPlDelete(null)}
      />

      <DuplicateTracksDialog
        lang={lang}
        prompt={dupPrompt}
        onClose={() => setDupPrompt(null)}
      />

      <ReplayGainDialog
        lang={lang}
        open={Boolean(rgPrompt)}
        missingCount={rgPrompt?.missing || 0}
        totalCount={rgPrompt?.total || 0}
        onConfirm={() => {
          void rpc('replaygain.confirmScan').then((st) => {
            if (st) setReplaygain(st);
          }).catch(() => {});
        }}
        onClose={() => setRgPrompt(null)}
      />

      <OnboardingWizardDialog
        open={wizardOpen}
        lang={lang}
        settings={settings}
        navConnection={navConn}
        onClose={() => setWizardOpen(false)}
      />

      <LovedConfirmDialog
        open={Boolean(pendingLovedTrackId)}
        lang={lang}
        onConfirm={() => {
          const tid = pendingLovedTrackId;
          setPendingLovedTrackId(null);
          if (tid) void rpc('track.toggleLoved', { trackId: tid, confirmed: true });
        }}
        onClose={() => setPendingLovedTrackId(null)}
      />

      {popupMenu && (
        <ContextPopupMenu
          x={popupMenu.x}
          y={popupMenu.y}
          items={popupMenu.items}
          onClose={() => setPopupMenu(null)}
        />
      )}

      {toast && (
        <div className={`toast-banner ${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}

const root = document.getElementById('root');
if (root) render(<App />, root);
