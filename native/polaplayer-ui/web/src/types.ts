export interface WindowState {
  maximized: boolean;
  fullscreen: boolean;
  fsView: 'lyrics' | 'default' | 'viz';
}

export type AlbumTabId = 'recent' | 'newest' | 'frequent' | 'random' | 'alphabeticalByName';
export type AllSongsGroupMode = 'none' | 'artist' | 'album' | 'both';
export type PlaylistSortKey = 'default' | 'title' | 'artist' | 'album' | 'dur';

export interface SourceCaps {
  albumTabs: AlbumTabId[];
  topSongs: boolean;
  lovedKinds: Array<'song' | 'album' | 'artist'>;
  randomMix: boolean;
  allSongs: boolean;
  playlistEdit: 'foobar' | 'navidrome';
}

export interface ServerProfile {
  id: string;
  name: string;
  server: string;
  user: string;
}

export interface ReplayGainState {
  total: number;
  scanned: number;
  missingCount: number;
  mode: number;
  active: boolean;
}

export interface DupPromptState {
  kind: 'local' | 'navidrome';
  playlistId: string;
  playlistName: string;
  dupCount: number;
  totalCount: number;
  uniqueCount: number;
  rows: Array<{ title: string; artist: string }>;
}

export interface SettingsState {
  themeMode: 0 | 1 | 2;
  light: boolean;
  languageMode: 'auto' | 'en' | 'zh-CN';
  language: 'en' | 'zh-CN';
  sources: 'local' | 'both';
  activeSource: 'local' | 'navidrome';
  rightTab: 'lyrics' | 'queue';
  server: string;
  user: string;
  configured: boolean;
  lovedConfirmed?: boolean;
  onboardingNeeded?: boolean;
  replaygain?: ReplayGainState;
  activeServerId?: string;
  servers?: ServerProfile[];
  caps?: SourceCaps;
}

export type LovedTarget =
  | TrackRow
  | string
  | { kind: 'song' | 'album' | 'artist'; id: string };

export interface PlaybackState {
  playing: boolean;
  paused: boolean;
  time: number;
  length: number;
  volume: number;
  shuffle: boolean;
  repeat: 0 | 1 | 2;
  seek?: boolean;
}

export interface TrackInfo {
  key: number;
  id?: string;
  source: 'local' | 'navidrome';
  title: string;
  artist: string;
  album: string;
  length: number;
  coverUrl: string;
  hue: string;
  loved: boolean;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  songCount: number;
  duration: number;
  editable: boolean;
  coverUrl: string;
  hue: string;
}

export interface PlaylistsState {
  source: 'local' | 'navidrome';
  selected: string | null;
  revision: number;
  loading: boolean;
  error: string;
  libCount: number;
  libCoverUrl: string;
  libHue: string;
  list: PlaylistSummary[];
}

export interface TrackRow {
  index: number;
  origIndex?: number;
  flatIndex?: number;
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId?: string;
  artistId?: string;
  duration: number;
  coverUrl: string;
  hueKey?: string;
  loved: boolean;
  playCount?: number;
}

export interface AlbumSummary {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  year: string;
  songCount: number;
  duration: number;
  coverUrl: string;
  hue: string;
  hueKey?: string;
  loved: boolean;
}

export interface ArtistSummary {
  id: string;
  name: string;
  albumCount: number;
  songCount: number;
  coverUrl: string;
  hue: string;
  hueKey?: string;
  loved: boolean;
}

export interface PlaylistDetailResponse {
  id: string;
  revision: number;
  status: 'loading' | 'ready' | 'error';
  error: string;
  meta?: PlaylistSummary;
  total: number;
  offset: number;
  rows: TrackRow[];
}

export interface BrowseHomeResponse {
  recentAlbums: AlbumSummary[];
  artists: ArtistSummary[];
  totalAlbums: number;
  totalArtists: number;
  totalSongs: number;
}

export interface BrowseAlbumsResponse {
  tab: AlbumTabId;
  offset: number;
  total: number;
  hasMore: boolean;
  items: AlbumSummary[];
}

export interface AlbumDetailResponse {
  found: boolean;
  meta?: AlbumSummary;
  total: number;
  rows: TrackRow[];
}

export interface BrowseArtistsResponse {
  offset: number;
  total: number;
  hasMore: boolean;
  items: ArtistSummary[];
}

export interface ArtistDetailResponse {
  found: boolean;
  meta?: ArtistSummary;
  albums: AlbumSummary[];
  topRows: TrackRow[];
}

export interface LovedResponse {
  total: number;
  songs: TrackRow[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
}

export interface RandomResponse {
  total: number;
  rows: TrackRow[];
}

export interface AllSongsRowItem {
  rowIndex: number;
  kind: 'track' | 'g1_artist' | 'g1_album' | 'g2_album';
  track?: TrackRow;
  label?: string;
  sub?: string;
  coverUrl?: string;
  songCount?: number;
  albumCount?: number;
  targetId?: string;
}

export interface AllSongsPageResponse {
  group: AllSongsGroupMode;
  offset: number;
  totalRows: number;
  totalSongs: number;
  totalDuration: number;
  rows: AllSongsRowItem[];
  replaygain?: ReplayGainState;
}

export interface SearchFullResponse {
  query: string;
  offset: number;
  songTotal: number;
  artists: ArtistSummary[];
  albums: AlbumSummary[];
  songs: TrackRow[];
}

export interface ToggleLovedResponse {
  ok: boolean;
  needsConfirm?: boolean;
  loved?: boolean;
}

export interface QueueRow {
  index: number;
  kind: 'manual' | 'next';
  playlistIndex: number;
  itemIndex: number;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
}

export interface QueueState {
  sourceName: string;
  repeatingTrack: boolean;
  manual: QueueRow[];
  next: QueueRow[];
}

export interface RawLyricLine {
  t?: number;
  text: string;
  translatedLyric?: string;
  romanLyric?: string;
}

export interface RawLyricsModel {
  synced: boolean;
  lines: RawLyricLine[];
}

export interface LyricsState {
  key: number;
  remote: boolean;
  heading: string;
  status: 'loading' | 'ready' | 'error';
  model: RawLyricsModel | null;
}

export interface SearchStatus {
  source: 'local' | 'navidrome';
  query: string;
  revision: number;
  status: 'idle' | 'loading' | 'ready' | 'error';
  count: number;
}

export interface SearchPageResponse {
  revision: number;
  offset: number;
  total: number;
  rows: TrackRow[];
}

export interface NavConnectionState {
  status: 'idle' | 'testing' | 'connected' | 'failed' | 'unconfigured';
  error?: string;
}
