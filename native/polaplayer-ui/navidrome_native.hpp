#pragma once

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace pola::nav {

struct Config {
    std::wstring server, user, password;
};

struct ServerEntry {
    std::wstring id;
    std::wstring name;
    std::wstring server;
    std::wstring user;
    std::wstring password;
};

struct MultiConfig {
    std::wstring activeId;
    std::vector<ServerEntry> servers;
};

struct Playlist {
    std::wstring id, name, coverArt;
    std::size_t songCount = 0;
    double duration = 0;
    bool editable = false;
};

struct Album {
    std::wstring id, name, artist, artistId, year, coverArt;
    std::size_t songCount = 0;
    double duration = 0;
    bool starred = false;
};

struct Artist {
    std::wstring id, name, coverArt;
    std::size_t albumCount = 0;
    bool starred = false;
};

struct Song {
    std::wstring id, title, artist, album, albumId, artistId, coverArt;
    double duration = 0;
    int discNumber = 0;
    int track = 0;
    int playCount = 0;
    bool starred = false;
    std::wstring suffix;
};

struct LyricLine {
    double time = -1; // Seconds, or -1 for an untimed line.
    std::wstring text;
};

enum class Action {
    Ping, Playlists, Playlist, Search, Lyrics,
    CreatePlaylist, RenamePlaylist, DeletePlaylist, AddSong, RemoveSong,
    Song, Cover,
    AlbumList, AlbumDetail, Artists, ArtistDetail, Starred, RandomSongs, SearchAll,
    Star, Unstar, Scrobble, SyncLocalPlaylist
};

struct SyncTrackSpec {
    std::wstring title;
    std::wstring artist;
};

struct Result {
    std::uint64_t requestId = 0;
    Action action = Action::Ping;
    bool ok = false, synced = false, duplicate = false;
    std::wstring error, playlistId;
    std::wstring tag; // extra metadata (e.g. album tab type, star kind+id)
    int matchedCount = 0;
    int totalCount = 0;
    std::vector<Playlist> playlists;
    std::vector<Album> albums;
    std::optional<Album> albumMeta;
    std::vector<Artist> artists;
    std::optional<Artist> artistMeta;
    std::vector<Song> songs;
    std::vector<LyricLine> lyrics;
    std::vector<unsigned char> imageBytes;
    std::wstring imageSuffix;
};

// The file is encrypted with DPAPI for the current Windows account.
std::optional<Config> loadConfig(std::filesystem::path const& profile);
bool saveConfig(std::filesystem::path const& profile, Config const& config);

MultiConfig loadMultiConfig(std::filesystem::path const& profile);
bool saveMultiConfig(std::filesystem::path const& profile, MultiConfig const& cfg);
std::vector<ServerEntry> importFooNavidromeServers(std::filesystem::path const& profile);

struct CoverBlob {
    std::vector<unsigned char> bytes;
    std::wstring suffix;
};

// Synchronously fetches cover art on a caller-owned worker thread without touching Client's queue.
std::optional<CoverBlob> fetchCoverSync(Config const& config, std::wstring_view coverArtId, int sizePx);

class Client {
public:
    Client();
    ~Client();
    Client(Client const&) = delete;
    Client& operator=(Client const&) = delete;

    bool configure(Config config);
    Config configuration() const;
    std::uint64_t request(Action action, std::wstring id = {}, std::wstring query = {},
        std::wstring songId = {}, int index = -1);
    std::uint64_t requestAlbumList(std::wstring tabType, int size, int offset);
    std::uint64_t requestStar(bool star, std::wstring kind, std::wstring targetId);
    std::uint64_t requestScrobble(std::wstring songId, std::int64_t timeMs);
    std::uint64_t requestSyncPlaylist(std::wstring name, std::vector<SyncTrackSpec> specs);
    std::uint64_t requestPing(Config draft);
    std::optional<Result> poll();

    // A stream URL contains a Subsonic authentication token. Keep it in the native host.
    std::wstring streamUrl(std::wstring_view songId) const;
    std::wstring streamUrl(std::wstring_view songId, Config const& expected) const;
    std::wstring streamUrl(std::wstring_view songId, std::wstring_view expectedServer, std::wstring_view expectedUser) const;
    std::wstring songIdFromUrl(std::wstring_view value) const;

private:
    struct State;
    std::unique_ptr<State> state_;
};

}
