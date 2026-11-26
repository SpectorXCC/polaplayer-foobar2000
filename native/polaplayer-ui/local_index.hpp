#pragma once

#include <foobar2000/SDK/foobar2000.h>
#include "art_server.hpp"
#include "local_index_pure.hpp"
#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace pola::index {

struct LocalTrackEntry {
    metadb_handle_ptr handle;
    std::string trackId;     // lowercase-stable ID: path#subsong (or path when subsong == 0)
    std::string trackIdLower;
    std::string artHash;
    std::string title;
    std::string artist;
    std::string albumArtist;
    std::string album;
    std::string albumKey;
    std::string year;
    int trackNo = 0;
    int discNo = 0;
    double duration = 0;
    std::uint64_t addedOrder = 0;
    bool loved = false;
    bool hasReplayGain = false;
    std::string kTitle;
    std::string kArtist;
    std::string kAlbumArtist;
    std::string kAlbum;
    std::string kSearch;
};

struct LocalAlbumEntry {
    std::string id; // albumKey
    std::string name;
    std::string artist;
    std::string artistId;
    std::string year;
    double duration = 0;
    std::string coverHash;
    std::uint64_t newestOrder = 0;
    std::string kName;
    std::vector<std::size_t> trackIndices;
};

struct LocalArtistEntry {
    std::string id; // albumArtist
    std::string name;
    std::string kName;
    std::vector<std::size_t> albumIndices;
    std::vector<std::size_t> trackIndices;
};

struct AllSongsRow {
    enum class Kind { Group1Artist, Group1Album, Group2Album, Track };
    Kind kind = Kind::Track;
    std::size_t trackIndex = 0;
    std::size_t groupAlbumIdx = 0;
    std::size_t groupArtistIdx = 0;
    int numInGroup = 0;
    int songCount = 0;
    int albumCount = 0;
    std::string label;
    std::string sub;
    std::string coverUrl;
};

struct LocalSearchResult {
    std::vector<std::size_t> artistIndices;
    std::vector<std::size_t> albumIndices;
    std::vector<std::size_t> trackIndices;
};

class LocalLibraryIndex {
public:
    void initialize(std::filesystem::path profileDir, pola::ArtServer* artServer);
    void shutdown();

    void invalidateLibrary();
    void invalidateStatsDisplay() { ++statsRev_; }
    void invalidateLovedCache() { ++lovedRev_; }

    std::uint64_t revision() const { return rev_; }
    std::uint64_t statsRevision() const { return statsRev_; }
    std::uint64_t lovedRevision() const { return lovedRev_; }
    bool isBuilt() const { return built_ && !dirty_; }

    void ensureBuilt();

    std::vector<LocalTrackEntry> const& tracks() const { return tracks_; }
    std::vector<LocalAlbumEntry> const& albums() const { return albums_; }
    std::vector<LocalArtistEntry> const& artists() const { return artists_; }

    LocalAlbumEntry const* findAlbum(std::string const& id) const;
    LocalArtistEntry const* findArtist(std::string const& id) const;
    std::size_t findTrackIndex(metadb_handle_ptr const& h) const;
    metadb_handle_ptr findHandleByTrackId(std::string const& id) const;

    std::size_t rgTotalCount() const { return tracks_.size(); }
    std::size_t rgScannedCount() const { return rgScannedCount_; }
    metadb_handle_list rgMissingHandles() const;

    std::vector<std::size_t> const& albumOrderForTab(std::string_view tab, bool forceReshuffle);
    std::vector<std::size_t> const& artistOrderSorted() const { return sortedArtistIndices_; }
    std::vector<std::size_t> artistTopTracks(LocalArtistEntry const& artist, std::size_t limit = 10) const;

    std::vector<std::size_t> lovedTrackIndices() const;
    bool isHandleLoved(metadb_handle_ptr const& h) const;

    std::vector<std::size_t> randomBatch(bool rebatch, std::size_t count = 80);
    std::vector<std::size_t> randomMore(std::size_t count = 40);
    std::vector<std::size_t> const& currentRandomMix() const { return randomMixIndices_; }

    LocalSearchResult search(std::string_view query) const;

    std::vector<AllSongsRow> const& allSongsRows(std::string_view group, double& totalDurationOut);
    std::vector<std::size_t> const& allSongsTrackIndices() const { return allSongsFlatOrder_; }

    // Play stats & persistence
    void recordPlay(metadb_handle_ptr const& h);
    PlayStat albumStat(std::string const& albumKey) const;
    std::int64_t trackPlayCount(metadb_handle_ptr const& h) const;
    void saveStatsIfDue();
    void flushStats();

    // Optimistic LOVED writes with read-only verification/rollback
    struct OptimisticLoved {
        metadb_handle_ptr handle;
        bool prevLoved = false;
        bool targetLoved = false;
    };
    void setOptimisticLoved(metadb_handle_ptr const& h, bool targetLoved);
    std::optional<OptimisticLoved> takeOptimisticLoved(std::string const& trackId);

    std::string trackCoverUrl(LocalTrackEntry const& t, int sizePx = 128) const;
    std::string albumCoverUrl(LocalAlbumEntry const& a, int sizePx = 400) const;
    std::string artistCoverUrl(LocalArtistEntry const& ar, int sizePx = 360) const;
    std::string trackHue(LocalTrackEntry const& t) const;
    std::string albumHue(LocalAlbumEntry const& a) const;
    std::string artistHue(LocalArtistEntry const& ar) const;

    static std::string canonicalTrackId(metadb_handle_ptr const& h);
    static std::vector<std::size_t> sortPlaylistPermutation(
        playlist_manager::ptr const& pm, size_t plIndex, std::string_view sortKey, bool asc);

private:
    std::filesystem::path statsFile_;
    pola::ArtServer* artServer_ = nullptr;
    StatsStore stats_;
    bool statsLoaded_ = false;
    bool statsDirty_ = false;
    std::uint64_t nextSaveAtMs_ = 0;

    bool built_ = false;
    bool dirty_ = true;
    std::uint64_t rev_ = 1;
    std::uint64_t statsRev_ = 1;
    std::uint64_t lovedRev_ = 1;
    std::size_t rgScannedCount_ = 0;

    std::vector<LocalTrackEntry> tracks_;
    std::vector<LocalAlbumEntry> albums_;
    std::vector<LocalArtistEntry> artists_;
    std::unordered_map<std::string, std::size_t> albumMap_;
    std::unordered_map<std::string, std::size_t> artistMap_;
    std::unordered_map<std::string, std::size_t> trackIdMap_;

    std::vector<std::size_t> sortedArtistIndices_;
    std::unordered_map<std::string, std::vector<std::size_t>> albumTabCache_;
    std::uint64_t albumTabStatsVer_ = 0;

    std::vector<std::size_t> randomMixIndices_;

    std::string allSongsGroupCached_;
    std::uint64_t allSongsRevCached_ = 0;
    std::vector<AllSongsRow> allSongsRows_;
    std::vector<std::size_t> allSongsFlatOrder_;
    double allSongsTotalDuration_ = 0;

    std::unordered_map<std::string, OptimisticLoved> optimisticLoved_;

    void loadStats();
    void importFooPlaycountIfNeeded();
};

} // namespace pola::index
