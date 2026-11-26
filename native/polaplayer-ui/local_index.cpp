#include "local_index.hpp"

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <numeric>
#include <random>
#include <unordered_set>

namespace pola::index {
namespace {

namespace fs = std::filesystem;

std::string filenameStem(std::string_view path) {
    const auto slash = path.find_last_of("/\\");
    std::string_view name = (slash == path.npos) ? path : path.substr(slash + 1);
    const auto dot = name.rfind('.');
    if (dot != name.npos && dot > 0) name = name.substr(0, dot);
    return std::string(name);
}

std::string safeMetaStr(file_info const& info, const char* field) {
    const t_size count = info.meta_get_count_by_name(field);
    if (count == 0) return {};
    if (count == 1) {
        const char* val = info.meta_get(field, 0);
        return val ? trimView(val) : std::string{};
    }
    std::string out;
    for (t_size i = 0; i < count; ++i) {
        const char* val = info.meta_get(field, i);
        if (!val || !*val) continue;
        if (!out.empty()) out += ", ";
        out += trimView(val);
    }
    return out;
}

std::mt19937_64& sharedRng() {
    thread_local std::mt19937_64 rng{std::random_device{}()};
    return rng;
}

} // namespace

std::string LocalLibraryIndex::canonicalTrackId(metadb_handle_ptr const& h) {
    if (!h.is_valid()) return {};
    const char* p = h->get_path();
    std::string id = p ? std::string(p) : std::string{};
    const auto ss = h->get_subsong_index();
    if (ss > 0) {
        id.push_back('#');
        id += std::to_string(ss);
    }
    return id;
}

void LocalLibraryIndex::initialize(fs::path profileDir, pola::ArtServer* artServer) {
    artServer_ = artServer;
    const auto cacheDir = profileDir / L"polaplayer-cover-cache";
    std::error_code ec;
    fs::create_directories(cacheDir, ec);
    statsFile_ = cacheDir / L"local-stats.json";
    loadStats();
}

void LocalLibraryIndex::shutdown() {
    flushStats();
}

void LocalLibraryIndex::invalidateLibrary() {
    dirty_ = true;
    ++rev_;
    albumTabCache_.clear();
}

void LocalLibraryIndex::loadStats() {
    if (statsLoaded_) return;
    statsLoaded_ = true;
    std::error_code ec;
    if (!fs::exists(statsFile_, ec)) return;
    std::ifstream in(statsFile_, std::ios::binary);
    if (!in) return;
    std::string raw((std::istreambuf_iterator<char>(in)), {});
    if (raw.size() > 16 * 1024 * 1024) return;
    StatsStore parsed;
    if (StatsStore::deserialize(raw, parsed)) {
        stats_ = std::move(parsed);
    }
}

void LocalLibraryIndex::saveStatsIfDue() {
    if (!statsDirty_) return;
    const auto now = GetTickCount64();
    if (now >= nextSaveAtMs_) flushStats();
}

void LocalLibraryIndex::flushStats() {
    if (!statsDirty_ || statsFile_.empty()) return;
    const auto data = stats_.serialize();
    const auto tmp = fs::path(statsFile_).replace_extension(L".tmp");
    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
    if (out) {
        out.write(data.data(), static_cast<std::streamsize>(data.size()));
        out.close();
        if (out) {
            MoveFileExW(tmp.c_str(), statsFile_.c_str(), MOVEFILE_REPLACE_EXISTING);
            statsDirty_ = false;
            return;
        }
    }
    DeleteFileW(tmp.c_str());
}

void LocalLibraryIndex::ensureBuilt() {
    if (built_ && !dirty_) return;
    dirty_ = false;
    built_ = true;
    ++rev_;

    tracks_.clear();
    albums_.clear();
    artists_.clear();
    albumMap_.clear();
    artistMap_.clear();
    trackIdMap_.clear();
    sortedArtistIndices_.clear();
    albumTabCache_.clear();
    allSongsRows_.clear();
    allSongsFlatOrder_.clear();
    allSongsGroupCached_.clear();
    rgScannedCount_ = 0;

    metadb_handle_list lib;
    library_manager::get()->get_all_items(lib);
    const std::size_t n = lib.get_count();
    if (n == 0) return;

    struct RawRec {
        bool valid = false;
        std::string title, artist, albumArtist, album, year, addedStr, playCountStr, lastPlayedStr;
        int trackNo = 0, discNo = 0;
        double duration = 0;
        std::uint64_t filestamp = 0;
        bool loved = false;
        bool hasReplayGain = false;
    };

    std::vector<RawRec> recs(n);
    auto extractRec = [&](std::size_t idx, file_info const& info, metadb_handle_ptr const& h) {
        auto& r = recs[idx];
        r.valid = true;
        r.title = safeMetaStr(info, "TITLE");
        r.artist = safeMetaStr(info, "ARTIST");
        r.albumArtist = safeMetaStr(info, "ALBUM ARTIST");
        r.album = safeMetaStr(info, "ALBUM");
        r.year = extractYear4(safeMetaStr(info, "DATE"));
        r.trackNo = parseIntPrefix(safeMetaStr(info, "TRACKNUMBER"));
        r.discNo = parseIntPrefix(safeMetaStr(info, "DISCNUMBER"));
        r.duration = info.get_length();
        if (r.duration <= 0) r.duration = h->get_length();
        r.addedStr = safeMetaStr(info, "ADDED");
        r.filestamp = static_cast<std::uint64_t>(h->get_filestats().m_timestamp);
        r.loved = isLovedTagValue(safeMetaStr(info, "LOVED"));
        r.hasReplayGain = info.get_replaygain().is_track_gain_present();
        if (!stats_.importedPlaycount) {
            r.playCountStr = safeMetaStr(info, "PLAY_COUNT");
            r.lastPlayedStr = safeMetaStr(info, "LAST_PLAYED");
        }
    };

    if (auto mv2 = metadb_v2::tryGet(); mv2.is_valid()) {
        mv2->queryMultiParallel_(lib, [&](std::size_t idx, const metadb_v2_rec_t& rec) {
            if (idx >= n || !lib[idx].is_valid()) return;
            if (rec.info.is_valid()) {
                extractRec(idx, rec.info->info(), lib[idx]);
            } else {
                file_info_impl emptyInfo;
                extractRec(idx, emptyInfo, lib[idx]);
            }
        });
    } else {
        for (std::size_t i = 0; i < n; ++i) {
            auto h = lib[i];
            if (!h.is_valid()) continue;
            metadb_info_container::ptr ic;
            if (h->get_info_ref(ic) && ic.is_valid()) extractRec(i, ic->info(), h);
            else {
                file_info_impl emptyInfo;
                extractRec(i, emptyInfo, h);
            }
        }
    }

    tracks_.reserve(n);
    for (std::size_t i = 0; i < n; ++i) {
        auto h = lib[i];
        if (!h.is_valid() || !recs[i].valid) continue;
        // Skip any accidental remote polanav streams in library
        const char* path = h->get_path();
        if (path && std::string_view(path).starts_with("polanav://")) continue;

        auto const& rr = recs[i];
        LocalTrackEntry tr;
        tr.handle = h;
        tr.trackId = canonicalTrackId(h);
        tr.trackIdLower = lowerAscii(tr.trackId);
        tr.artHash = artServer_ ? artServer_->registerTrack(h) : std::string{};
        tr.title = !rr.title.empty() ? rr.title : filenameStem(path ? path : "");
        if (tr.title.empty()) tr.title = "Unknown Track";
        tr.artist = rr.artist;
        tr.albumArtist = !rr.albumArtist.empty() ? rr.albumArtist : (!rr.artist.empty() ? rr.artist : "Unknown Artist");
        tr.album = !rr.album.empty() ? rr.album : "Unknown Album";
        tr.albumKey = tr.albumArtist + " - " + tr.album;
        tr.year = rr.year;
        tr.trackNo = rr.trackNo;
        tr.discNo = rr.discNo;
        tr.duration = rr.duration > 0 ? rr.duration : 0.0;
        tr.loved = rr.loved;
        tr.hasReplayGain = rr.hasReplayGain;
        if (tr.hasReplayGain) ++rgScannedCount_;
        if (auto it = optimisticLoved_.find(tr.trackId); it != optimisticLoved_.end()) {
            tr.loved = it->second.targetLoved;
        }
        const auto addedMs = parseTimestampMs(rr.addedStr);
        if (addedMs > 0) tr.addedOrder = static_cast<std::uint64_t>(addedMs) * 10000ULL;
        else tr.addedOrder = rr.filestamp;

        tr.kTitle = lowerAscii(tr.title);
        tr.kArtist = lowerAscii(tr.artist);
        tr.kAlbumArtist = lowerAscii(tr.albumArtist);
        tr.kAlbum = lowerAscii(tr.album);
        tr.kSearch = tr.kTitle + " " + tr.kArtist + " " + tr.kAlbum;

        const std::size_t trackIdx = tracks_.size();
        trackIdMap_.try_emplace(tr.trackId, trackIdx);
        tracks_.push_back(std::move(tr));

        auto const& insertedTrack = tracks_.back();

        // Album bucket
        auto [albIt, albCreated] = albumMap_.try_emplace(insertedTrack.albumKey, albums_.size());
        if (albCreated) {
            LocalAlbumEntry alb;
            alb.id = insertedTrack.albumKey;
            alb.name = insertedTrack.album;
            alb.artist = insertedTrack.albumArtist;
            alb.artistId = insertedTrack.albumArtist;
            alb.year = insertedTrack.year;
            alb.coverHash = insertedTrack.artHash;
            alb.newestOrder = insertedTrack.addedOrder;
            alb.kName = insertedTrack.kAlbum;
            albums_.push_back(std::move(alb));
        }
        auto& albRef = albums_[albIt->second];
        albRef.trackIndices.push_back(trackIdx);
        albRef.duration += insertedTrack.duration;
        if (albRef.year.empty() && !insertedTrack.year.empty()) albRef.year = insertedTrack.year;
        if (insertedTrack.addedOrder > albRef.newestOrder) albRef.newestOrder = insertedTrack.addedOrder;

        // Artist bucket
        auto [artIt, artCreated] = artistMap_.try_emplace(insertedTrack.albumArtist, artists_.size());
        if (artCreated) {
            LocalArtistEntry art;
            art.id = insertedTrack.albumArtist;
            art.name = insertedTrack.albumArtist;
            art.kName = insertedTrack.kAlbumArtist;
            artists_.push_back(std::move(art));
        }
        auto& artRef = artists_[artIt->second];
        artRef.trackIndices.push_back(trackIdx);
        const std::size_t albIdx = albIt->second;
        if (std::find(artRef.albumIndices.begin(), artRef.albumIndices.end(), albIdx) == artRef.albumIndices.end()) {
            artRef.albumIndices.push_back(albIdx);
        }

        // One-time foo_playcount import
        if (!stats_.importedPlaycount && (!rr.playCountStr.empty() || !rr.lastPlayedStr.empty())) {
            const std::int64_t pc = parseIntPrefix(rr.playCountStr);
            const std::int64_t lp = parseTimestampMs(rr.lastPlayedStr);
            if (pc > 0 || lp > 0) {
                auto& ts = stats_.tracks[insertedTrack.trackIdLower];
                ts.count = std::max(ts.count, pc);
                ts.lastPlayed = std::max(ts.lastPlayed, lp);
                auto& as = stats_.albums[insertedTrack.albumKey];
                as.count += pc;
                as.lastPlayed = std::max(as.lastPlayed, lp);
                statsDirty_ = true;
            }
        }
    }

    if (!stats_.importedPlaycount) {
        stats_.importedPlaycount = true;
        statsDirty_ = true;
        nextSaveAtMs_ = GetTickCount64() + 4000;
    }

    // Sort tracks inside each album by (discNo, trackNo, kTitle)
    for (auto& alb : albums_) {
        std::sort(alb.trackIndices.begin(), alb.trackIndices.end(), [&](std::size_t a, std::size_t b) {
            auto const& ta = tracks_[a];
            auto const& tb = tracks_[b];
            if (ta.discNo != tb.discNo) return ta.discNo < tb.discNo;
            if (ta.trackNo != tb.trackNo) return ta.trackNo < tb.trackNo;
            if (ta.kTitle != tb.kTitle) return ta.kTitle < tb.kTitle;
            return a < b;
        });
    }

    // Register artist candidate handles (one track per distinct album, max 6 per artist)
    if (artServer_) {
        for (auto const& art : artists_) {
            std::vector<metadb_handle_ptr> cands;
            for (std::size_t ai : art.albumIndices) {
                if (cands.size() >= 6) break;
                if (!albums_[ai].trackIndices.empty()) {
                    cands.push_back(tracks_[albums_[ai].trackIndices.front()].handle);
                }
            }
            artServer_->registerArtistCandidates(art.id, rev_, std::move(cands));
        }
    }

    sortedArtistIndices_.resize(artists_.size());
    std::iota(sortedArtistIndices_.begin(), sortedArtistIndices_.end(), 0);
    std::sort(sortedArtistIndices_.begin(), sortedArtistIndices_.end(), [&](std::size_t a, std::size_t b) {
        if (artists_[a].kName != artists_[b].kName) return artists_[a].kName < artists_[b].kName;
        return a < b;
    });
}

LocalAlbumEntry const* LocalLibraryIndex::findAlbum(std::string const& id) const {
    auto it = albumMap_.find(id);
    return it == albumMap_.end() ? nullptr : &albums_[it->second];
}

LocalArtistEntry const* LocalLibraryIndex::findArtist(std::string const& id) const {
    auto it = artistMap_.find(id);
    return it == artistMap_.end() ? nullptr : &artists_[it->second];
}

std::size_t LocalLibraryIndex::findTrackIndex(metadb_handle_ptr const& h) const {
    if (!h.is_valid()) return SIZE_MAX;
    const auto id = canonicalTrackId(h);
    auto it = trackIdMap_.find(id);
    return it == trackIdMap_.end() ? SIZE_MAX : it->second;
}

metadb_handle_ptr LocalLibraryIndex::findHandleByTrackId(std::string const& id) const {
    if (id.empty()) return {};
    auto it = trackIdMap_.find(id);
    if (it != trackIdMap_.end() && it->second < tracks_.size()) return tracks_[it->second].handle;
    return {};
}

metadb_handle_list LocalLibraryIndex::rgMissingHandles() const {
    metadb_handle_list out;
    for (auto const& tr : tracks_) {
        if (!tr.hasReplayGain && tr.handle.is_valid()) out.add_item(tr.handle);
    }
    return out;
}

std::vector<std::size_t> const& LocalLibraryIndex::albumOrderForTab(std::string_view tab, bool forceReshuffle) {
    if (albumTabStatsVer_ != statsRev_) {
        albumTabCache_.erase("recent");
        albumTabCache_.erase("frequent");
        albumTabStatsVer_ = statsRev_;
    }

    std::string key = tab.empty() ? "recent" : std::string(tab);
    if (key == "random" && forceReshuffle) {
        albumTabCache_.erase("random");
    }

    if (auto it = albumTabCache_.find(key); it != albumTabCache_.end()) {
        return it->second;
    }

    std::vector<std::size_t> list;
    list.reserve(albums_.size());

    if (key == "newest") {
        list.resize(albums_.size());
        std::iota(list.begin(), list.end(), 0);
        std::sort(list.begin(), list.end(), [&](std::size_t a, std::size_t b) {
            if (albums_[a].newestOrder != albums_[b].newestOrder) return albums_[a].newestOrder > albums_[b].newestOrder;
            if (albums_[a].kName != albums_[b].kName) return albums_[a].kName < albums_[b].kName;
            return a < b;
        });
    } else if (key == "alphabeticalByName") {
        list.resize(albums_.size());
        std::iota(list.begin(), list.end(), 0);
        std::sort(list.begin(), list.end(), [&](std::size_t a, std::size_t b) {
            if (albums_[a].kName != albums_[b].kName) return albums_[a].kName < albums_[b].kName;
            return a < b;
        });
    } else if (key == "random") {
        list.resize(albums_.size());
        std::iota(list.begin(), list.end(), 0);
        std::shuffle(list.begin(), list.end(), sharedRng());
    } else if (key == "recent") {
        for (std::size_t i = 0; i < albums_.size(); ++i) {
            if (albumStat(albums_[i].id).lastPlayed > 0) list.push_back(i);
        }
        if (!list.empty()) {
            std::sort(list.begin(), list.end(), [&](std::size_t a, std::size_t b) {
                return albumStat(albums_[a].id).lastPlayed > albumStat(albums_[b].id).lastPlayed;
            });
        } else {
            list = albumOrderForTab("newest", false);
        }
    } else if (key == "frequent") {
        for (std::size_t i = 0; i < albums_.size(); ++i) {
            if (albumStat(albums_[i].id).count > 0) list.push_back(i);
        }
        if (!list.empty()) {
            std::sort(list.begin(), list.end(), [&](std::size_t a, std::size_t b) {
                const auto sa = albumStat(albums_[a].id);
                const auto sb = albumStat(albums_[b].id);
                if (sa.count != sb.count) return sa.count > sb.count;
                return sa.lastPlayed > sb.lastPlayed;
            });
        } else {
            list = albumOrderForTab("alphabeticalByName", false);
        }
    } else {
        return albumOrderForTab("recent", false);
    }

    auto [ins, _] = albumTabCache_.emplace(std::move(key), std::move(list));
    return ins->second;
}

std::vector<std::size_t> LocalLibraryIndex::artistTopTracks(LocalArtistEntry const& artist, std::size_t limit) const {
    struct Ranked { std::size_t idx; std::int64_t count; };
    std::vector<Ranked> played;
    for (std::size_t ti : artist.trackIndices) {
        auto const& tr = tracks_[ti];
        auto it = stats_.tracks.find(tr.trackIdLower);
        const std::int64_t cnt = (it != stats_.tracks.end()) ? it->second.count : 0;
        if (cnt > 0) played.push_back({ti, cnt});
    }
    std::sort(played.begin(), played.end(), [](Ranked const& a, Ranked const& b) {
        if (a.count != b.count) return a.count > b.count;
        return a.idx < b.idx;
    });
    std::vector<std::size_t> out;
    const std::size_t take = std::min(limit, played.size());
    out.reserve(take);
    for (std::size_t i = 0; i < take; ++i) out.push_back(played[i].idx);
    return out;
}

bool LocalLibraryIndex::isHandleLoved(metadb_handle_ptr const& h) const {
    if (!h.is_valid()) return false;
    const auto id = canonicalTrackId(h);
    if (auto optIt = optimisticLoved_.find(id); optIt != optimisticLoved_.end()) {
        return optIt->second.targetLoved;
    }
    if (auto it = trackIdMap_.find(id); it != trackIdMap_.end()) {
        return tracks_[it->second].loved;
    }
    metadb_info_container::ptr ic;
    if (h->get_info_ref(ic) && ic.is_valid()) {
        return isLovedTagValue(safeMetaStr(ic->info(), "LOVED"));
    }
    return false;
}

std::vector<std::size_t> LocalLibraryIndex::lovedTrackIndices() const {
    std::vector<std::size_t> out;
    for (std::size_t i = 0; i < tracks_.size(); ++i) {
        bool lv = tracks_[i].loved;
        if (auto it = optimisticLoved_.find(tracks_[i].trackId); it != optimisticLoved_.end()) {
            lv = it->second.targetLoved;
        }
        if (lv) out.push_back(i);
    }
    return out;
}

std::vector<std::size_t> LocalLibraryIndex::randomBatch(bool rebatch, std::size_t count) {
    if (!rebatch && !randomMixIndices_.empty()) return randomMixIndices_;
    std::vector<std::size_t> pool(tracks_.size());
    std::iota(pool.begin(), pool.end(), 0);
    std::shuffle(pool.begin(), pool.end(), sharedRng());
    const std::size_t take = std::min(count, pool.size());
    pool.resize(take);
    randomMixIndices_ = std::move(pool);
    return randomMixIndices_;
}

std::vector<std::size_t> LocalLibraryIndex::randomMore(std::size_t count) {
    const std::size_t n = tracks_.size();
    if (n == 0) return {};
    std::size_t take = std::min(count, n);
    std::unordered_set<std::size_t> avoid;
    const std::size_t tailStart = randomMixIndices_.size() > 80 ? randomMixIndices_.size() - 80 : 0;
    for (std::size_t i = tailStart; i < randomMixIndices_.size(); ++i) {
        avoid.insert(randomMixIndices_[i]);
    }
    std::vector<std::size_t> pool;
    pool.reserve(n);
    for (std::size_t i = 0; i < n; ++i) {
        if (!avoid.contains(i)) pool.push_back(i);
    }
    if (pool.size() < take) {
        pool.resize(n);
        std::iota(pool.begin(), pool.end(), 0);
    }
    std::shuffle(pool.begin(), pool.end(), sharedRng());
    pool.resize(take);
    randomMixIndices_.insert(randomMixIndices_.end(), pool.begin(), pool.end());
    return pool;
}

LocalSearchResult LocalLibraryIndex::search(std::string_view query) const {
    LocalSearchResult res;
    const auto ql = lowerAscii(trimView(query));
    if (ql.empty()) return res;

    for (std::size_t ai : sortedArtistIndices_) {
        if (artists_[ai].kName.find(ql) != std::string::npos) {
            res.artistIndices.push_back(ai);
            if (res.artistIndices.size() >= 24) break;
        }
    }
    for (std::size_t i = 0; i < albums_.size(); ++i) {
        auto const& al = albums_[i];
        if (al.kName.find(ql) != std::string::npos || lowerAscii(al.artist).find(ql) != std::string::npos) {
            res.albumIndices.push_back(i);
            if (res.albumIndices.size() >= 30) break;
        }
    }
    for (std::size_t i = 0; i < tracks_.size(); ++i) {
        if (tracks_[i].kSearch.find(ql) != std::string::npos) {
            res.trackIndices.push_back(i);
            if (res.trackIndices.size() >= 300) break;
        }
    }
    return res;
}

std::vector<AllSongsRow> const& LocalLibraryIndex::allSongsRows(std::string_view group, double& totalDurationOut) {
    std::string g = (group == "artist" || group == "album" || group == "both") ? std::string(group) : std::string("none");
    if (allSongsRevCached_ == rev_ && allSongsGroupCached_ == g) {
        totalDurationOut = allSongsTotalDuration_;
        return allSongsRows_;
    }

    allSongsRevCached_ = rev_;
    allSongsGroupCached_ = g;
    allSongsRows_.clear();
    allSongsFlatOrder_.clear();
    allSongsTotalDuration_ = 0;

    if (tracks_.empty()) {
        totalDurationOut = 0;
        return allSongsRows_;
    }

    std::vector<std::size_t> order(tracks_.size());
    std::iota(order.begin(), order.end(), 0);
    for (auto const& t : tracks_) allSongsTotalDuration_ += t.duration;

    auto cmpTrack = [&](std::size_t a, std::size_t b) {
        auto const& ta = tracks_[a];
        auto const& tb = tracks_[b];
        if (ta.discNo != tb.discNo) return ta.discNo < tb.discNo;
        if (ta.trackNo != tb.trackNo) return ta.trackNo < tb.trackNo;
        if (ta.kTitle != tb.kTitle) return ta.kTitle < tb.kTitle;
        return a < b;
    };

    if (g == "artist" || g == "both") {
        std::sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
            auto const& ta = tracks_[a];
            auto const& tb = tracks_[b];
            if (ta.kAlbumArtist != tb.kAlbumArtist) return ta.kAlbumArtist < tb.kAlbumArtist;
            if (ta.kAlbum != tb.kAlbum) return ta.kAlbum < tb.kAlbum;
            if (ta.albumKey != tb.albumKey) return ta.albumKey < tb.albumKey;
            return cmpTrack(a, b);
        });
    } else if (g == "album") {
        std::sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
            auto const& ta = tracks_[a];
            auto const& tb = tracks_[b];
            if (ta.kAlbum != tb.kAlbum) return ta.kAlbum < tb.kAlbum;
            if (ta.albumKey != tb.albumKey) return ta.albumKey < tb.albumKey;
            return cmpTrack(a, b);
        });
    } else {
        std::sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
            auto const& ta = tracks_[a];
            auto const& tb = tracks_[b];
            if (ta.kTitle != tb.kTitle) return ta.kTitle < tb.kTitle;
            if (ta.kArtist != tb.kArtist) return ta.kArtist < tb.kArtist;
            return a < b;
        });
    }

    allSongsFlatOrder_ = std::move(order);

    if (g == "none") {
        allSongsRows_.reserve(allSongsFlatOrder_.size());
        for (std::size_t i = 0; i < allSongsFlatOrder_.size(); ++i) {
            AllSongsRow row;
            row.kind = AllSongsRow::Kind::Track;
            row.trackIndex = allSongsFlatOrder_[i];
            row.numInGroup = static_cast<int>(i + 1);
            allSongsRows_.push_back(row);
        }
        totalDurationOut = allSongsTotalDuration_;
        return allSongsRows_;
    }

    std::string curArtist;
    std::string curAlbumKey;
    std::size_t g1Idx = SIZE_MAX;
    std::size_t g2Idx = SIZE_MAX;
    int numInGrp = 0;

    for (std::size_t idx : allSongsFlatOrder_) {
        auto const& tr = tracks_[idx];
        if (g == "artist") {
            if (tr.albumArtist != curArtist || g1Idx == SIZE_MAX) {
                curArtist = tr.albumArtist;
                numInGrp = 0;
                AllSongsRow hdr;
                hdr.kind = AllSongsRow::Kind::Group1Artist;
                hdr.label = tr.albumArtist;
                auto artIt = artistMap_.find(tr.albumArtist);
                if (artIt != artistMap_.end()) {
                    hdr.groupArtistIdx = artIt->second;
                    hdr.albumCount = static_cast<int>(artists_[artIt->second].albumIndices.size());
                    hdr.coverUrl = artistCoverUrl(artists_[artIt->second], 128);
                }
                g1Idx = allSongsRows_.size();
                allSongsRows_.push_back(std::move(hdr));
            }
        } else if (g == "album") {
            if (tr.albumKey != curAlbumKey || g1Idx == SIZE_MAX) {
                curAlbumKey = tr.albumKey;
                numInGrp = 0;
                AllSongsRow hdr;
                hdr.kind = AllSongsRow::Kind::Group1Album;
                hdr.label = tr.album;
                hdr.sub = tr.year.empty() ? tr.albumArtist : (tr.albumArtist + " · " + tr.year);
                auto albIt = albumMap_.find(tr.albumKey);
                if (albIt != albumMap_.end()) {
                    hdr.groupAlbumIdx = albIt->second;
                    hdr.coverUrl = albumCoverUrl(albums_[albIt->second], 128);
                }
                g1Idx = allSongsRows_.size();
                allSongsRows_.push_back(std::move(hdr));
            }
        } else { // "both"
            if (tr.albumArtist != curArtist || g1Idx == SIZE_MAX) {
                curArtist = tr.albumArtist;
                curAlbumKey.clear();
                g2Idx = SIZE_MAX;
                AllSongsRow hdr;
                hdr.kind = AllSongsRow::Kind::Group1Artist;
                hdr.label = tr.albumArtist;
                auto artIt = artistMap_.find(tr.albumArtist);
                if (artIt != artistMap_.end()) {
                    hdr.groupArtistIdx = artIt->second;
                    hdr.albumCount = static_cast<int>(artists_[artIt->second].albumIndices.size());
                    hdr.coverUrl = artistCoverUrl(artists_[artIt->second], 128);
                }
                g1Idx = allSongsRows_.size();
                allSongsRows_.push_back(std::move(hdr));
            }
            if (tr.albumKey != curAlbumKey || g2Idx == SIZE_MAX) {
                curAlbumKey = tr.albumKey;
                numInGrp = 0;
                AllSongsRow subHdr;
                subHdr.kind = AllSongsRow::Kind::Group2Album;
                subHdr.label = tr.album;
                subHdr.sub = tr.year;
                auto albIt = albumMap_.find(tr.albumKey);
                if (albIt != albumMap_.end()) {
                    subHdr.groupAlbumIdx = albIt->second;
                    subHdr.coverUrl = albumCoverUrl(albums_[albIt->second], 128);
                }
                g2Idx = allSongsRows_.size();
                allSongsRows_.push_back(std::move(subHdr));
            }
        }

        ++numInGrp;
        AllSongsRow tRow;
        tRow.kind = AllSongsRow::Kind::Track;
        tRow.trackIndex = idx;
        tRow.numInGroup = numInGrp;
        allSongsRows_.push_back(std::move(tRow));
        if (g1Idx < allSongsRows_.size()) allSongsRows_[g1Idx].songCount++;
        if (g2Idx < allSongsRows_.size()) allSongsRows_[g2Idx].songCount++;
    }

    totalDurationOut = allSongsTotalDuration_;
    return allSongsRows_;
}

void LocalLibraryIndex::recordPlay(metadb_handle_ptr const& h) {
    if (!h.is_valid()) return;
    const char* p = h->get_path();
    if (p && std::string_view(p).starts_with("polanav://")) return;

    const auto idLow = lowerAscii(canonicalTrackId(h));
    if (idLow.empty()) return;
    const auto now = currentEpochMs();
    auto& ts = stats_.tracks[idLow];
    ts.count += 1;
    ts.lastPlayed = std::max(ts.lastPlayed, now);

    std::string albKey;
    const auto idx = findTrackIndex(h);
    if (idx != SIZE_MAX) {
        albKey = tracks_[idx].albumKey;
    } else {
        metadb_info_container::ptr ic;
        if (h->get_info_ref(ic) && ic.is_valid()) {
            auto aa = safeMetaStr(ic->info(), "ALBUM ARTIST");
            if (aa.empty()) aa = safeMetaStr(ic->info(), "ARTIST");
            if (aa.empty()) aa = "Unknown Artist";
            auto al = safeMetaStr(ic->info(), "ALBUM");
            if (al.empty()) al = "Unknown Album";
            albKey = aa + " - " + al;
        }
    }
    if (!albKey.empty()) {
        auto& as = stats_.albums[albKey];
        as.count += 1;
        as.lastPlayed = std::max(as.lastPlayed, now);
    }

    ++statsRev_;
    statsDirty_ = true;
    nextSaveAtMs_ = GetTickCount64() + 5000;
}

PlayStat LocalLibraryIndex::albumStat(std::string const& albumKey) const {
    auto it = stats_.albums.find(albumKey);
    return it == stats_.albums.end() ? PlayStat{} : it->second;
}

std::int64_t LocalLibraryIndex::trackPlayCount(metadb_handle_ptr const& h) const {
    if (!h.is_valid()) return 0;
    const auto idLow = lowerAscii(canonicalTrackId(h));
    auto it = stats_.tracks.find(idLow);
    return it == stats_.tracks.end() ? 0 : it->second.count;
}

void LocalLibraryIndex::setOptimisticLoved(metadb_handle_ptr const& h, bool targetLoved) {
    if (!h.is_valid()) return;
    const auto id = canonicalTrackId(h);
    bool prev = isHandleLoved(h);
    optimisticLoved_[id] = OptimisticLoved{h, prev, targetLoved};
    if (auto it = trackIdMap_.find(id); it != trackIdMap_.end()) {
        tracks_[it->second].loved = targetLoved;
    }
    ++lovedRev_;
}

std::optional<LocalLibraryIndex::OptimisticLoved> LocalLibraryIndex::takeOptimisticLoved(std::string const& trackId) {
    auto it = optimisticLoved_.find(trackId);
    if (it == optimisticLoved_.end()) return std::nullopt;
    auto entry = std::move(it->second);
    optimisticLoved_.erase(it);
    return entry;
}

std::string LocalLibraryIndex::trackCoverUrl(LocalTrackEntry const& t, int sizePx) const {
    return t.artHash.empty() ? std::string{} : pola::ArtServer::trackArtUrl(t.artHash, sizePx);
}

std::string LocalLibraryIndex::albumCoverUrl(LocalAlbumEntry const& a, int sizePx) const {
    return a.coverHash.empty() ? std::string{} : pola::ArtServer::trackArtUrl(a.coverHash, sizePx);
}

std::string LocalLibraryIndex::artistCoverUrl(LocalArtistEntry const& ar, int sizePx) const {
    return pola::ArtServer::artistArtUrl(ar.id, rev_, sizePx);
}

std::string LocalLibraryIndex::trackHue(LocalTrackEntry const& t) const {
    return (artServer_ && !t.artHash.empty()) ? artServer_->cachedHue("track:" + t.artHash) : std::string{};
}

std::string LocalLibraryIndex::albumHue(LocalAlbumEntry const& a) const {
    return (artServer_ && !a.coverHash.empty()) ? artServer_->cachedHue("track:" + a.coverHash) : std::string{};
}

std::string LocalLibraryIndex::artistHue(LocalArtistEntry const& ar) const {
    return artServer_ ? artServer_->cachedHue("ar:" + ar.id) : std::string{};
}

std::vector<std::size_t> LocalLibraryIndex::sortPlaylistPermutation(
    playlist_manager::ptr const& pm, size_t plIndex, std::string_view sortKey, bool asc) {
    const size_t cnt = (plIndex < pm->get_playlist_count()) ? pm->playlist_get_item_count(plIndex) : 0;
    std::vector<std::size_t> perm(cnt);
    std::iota(perm.begin(), perm.end(), 0);
    if (cnt <= 1) return perm;
    if (sortKey.empty() || sortKey == "default") {
        if (!asc) std::reverse(perm.begin(), perm.end());
        return perm;
    }

    struct SortItem {
        std::size_t idx = 0;
        std::string key;
        double dur = 0;
    };
    std::vector<SortItem> items(cnt);
    for (size_t i = 0; i < cnt; ++i) {
        items[i].idx = i;
        auto h = pm->playlist_get_item_handle(plIndex, i);
        if (!h.is_valid()) continue;
        if (sortKey == "dur") {
            items[i].dur = h->get_length();
            continue;
        }
        metadb_info_container::ptr ic;
        if (h->get_info_ref(ic) && ic.is_valid()) {
            auto const& info = ic->info();
            if (sortKey == "title") items[i].key = lowerAscii(safeMetaStr(info, "TITLE"));
            else if (sortKey == "artist") items[i].key = lowerAscii(safeMetaStr(info, "ARTIST"));
            else if (sortKey == "album") items[i].key = lowerAscii(safeMetaStr(info, "ALBUM"));
        }
    }

    std::sort(items.begin(), items.end(), [&](SortItem const& a, SortItem const& b) {
        if (sortKey == "dur") {
            if (a.dur != b.dur) return asc ? (a.dur < b.dur) : (a.dur > b.dur);
            return a.idx < b.idx;
        }
        if (a.key != b.key) return asc ? (a.key < b.key) : (a.key > b.key);
        return a.idx < b.idx;
    });

    for (size_t i = 0; i < cnt; ++i) perm[i] = items[i].idx;
    return perm;
}

} // namespace pola::index
