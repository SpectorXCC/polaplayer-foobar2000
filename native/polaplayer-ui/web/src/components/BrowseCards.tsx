import { JSX } from 'preact';
import { AlbumSummary, ArtistSummary } from '../types';
import { fmtNum, t, LangCode } from '../i18n/strings';
import { Cover } from './Cover';
import { Icon } from './Icons';

export function AlbumCard({
  album,
  lang,
  onOpen,
  onPlay
}: {
  album: AlbumSummary;
  lang: LangCode;
  onOpen: (album: AlbumSummary) => void;
  onPlay: (album: AlbumSummary) => void;
}): JSX.Element {
  const sub = album.year ? `${album.artist} · ${album.year}` : album.artist || t(lang, 'meta.album_sub');

  return (
    <div className="media-card option-a">
      <button type="button" className="media-card-hit" onClick={() => onOpen(album)}>
        <div className="media-card-cover">
          <Cover url={album.coverUrl} seed={album.id || album.name} size="100%" radius={8} contain fallbackIcon="album" />
        </div>
        <div className="media-card-title truncate">{album.name}</div>
        <div className="media-card-sub truncate">{sub}</div>
      </button>
      <button
        type="button"
        className="media-card-play"
        aria-label={`${t(lang, 'btn.play')} ${album.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onPlay(album);
        }}
      >
        <Icon name="play" size={20} />
      </button>
    </div>
  );
}

export function ArtistCard({
  artist,
  lang,
  onOpen
}: {
  artist: ArtistSummary;
  lang: LangCode;
  onOpen: (artist: ArtistSummary) => void;
}): JSX.Element {
  const sub =
    artist.albumCount === 1
      ? t(lang, 'meta.album_one')
      : artist.albumCount > 1
        ? t(lang, 'meta.album_count', fmtNum(artist.albumCount))
        : t(lang, 'meta.artist_sub');

  return (
    <div className="media-card option-a artist-card">
      <button type="button" className="media-card-hit" onClick={() => onOpen(artist)}>
        <div className="media-card-cover">
          <Cover
            url={artist.coverUrl}
            seed={artist.id || artist.name}
            size="100%"
            circle
            contain={false}
            fallbackIcon="artist"
          />
        </div>
        <div className="media-card-title truncate">{artist.name}</div>
        <div className="media-card-sub truncate">{sub}</div>
      </button>
    </div>
  );
}
