#pragma once

#include "local_lyrics.hpp"
#include <foobar2000/SDK/threadsLite.h>
#include <filesystem>
#include <fstream>
#include <initializer_list>
#include <memory>
#include <mutex>
#include <utility>
#include <vector>

namespace pola {
namespace local_media {
inline std::wstring decodeLyrics(std::string_view bytes, bool localCodePage) {
    if (bytes.empty() || bytes.size() > lyricsTextLimit * 2) return {};
    if (bytes.starts_with("\xFF\xFE") || bytes.starts_with("\xFE\xFF")) {
        const bool littleEndian = bytes.starts_with("\xFF\xFE");
        if (bytes.size() % 2 != 0) return {};
        bytes.remove_prefix(2);
        std::wstring text;
        text.reserve(bytes.size() / 2);
        for (std::size_t i = 0; i < bytes.size(); i += 2) {
            const auto low = static_cast<unsigned char>(bytes[i + (littleEndian ? 0 : 1)]);
            const auto high = static_cast<unsigned char>(bytes[i + (littleEndian ? 1 : 0)]);
            if (low == 0 && high == 0) return {};
            text.push_back(static_cast<wchar_t>((high << 8) | low));
        }
        return text;
    }
    if (bytes.starts_with("\xEF\xBB\xBF")) bytes.remove_prefix(3);
    if (bytes.find('\0') != bytes.npos) return {};
    const auto byteCount = static_cast<int>(bytes.size());
    auto page = CP_UTF8;
    DWORD flags = MB_ERR_INVALID_CHARS;
    auto count = MultiByteToWideChar(page, flags, bytes.data(), byteCount, nullptr, 0);
    if (count == 0 && localCodePage) {
        page = CP_ACP;
        flags = 0;
        count = MultiByteToWideChar(page, flags, bytes.data(), byteCount, nullptr, 0);
    }
    if (count <= 0) return {};
    std::wstring text(count, L'\0');
    if (!MultiByteToWideChar(page, flags, bytes.data(), byteCount, text.data(), count)) return {};
    return text;
}

inline Lyrics readSidecar(const metadb_handle_ptr& track, abort_callback& abort) {
    pfc::string8 nativePath;
    if (!filesystem::g_get_native_path(track->get_path(), nativePath, abort)) return {};
    auto path = std::filesystem::u8path(nativePath.c_str());
    path.replace_extension(L".lrc");
    const auto utf8 = path.u8string();
    pfc::string8 canonical;
    filesystem::g_get_canonical_path(reinterpret_cast<const char*>(utf8.c_str()), canonical);
    try {
        file::ptr source;
        filesystem::g_open_read(source, canonical.c_str(), abort);
        const auto size = source->get_size(abort);
        if (!size || size > lyricsTextLimit * 2) return {};
        std::string bytes(static_cast<std::size_t>(size), '\0');
        source->read_object(bytes.data(), bytes.size(), abort);
        return parseLocalLyrics(decodeLyrics(bytes, true));
    } catch (const exception_io&) {
        return {};
    }
}

inline Lyrics readLyrics(const metadb_handle_ptr& track, abort_callback& abort) {
    Lyrics embedded;
    file_info_impl info;
    if (track->get_info(info)) {
        constexpr const char* tags[] = {"SYNCED LYRICS", "LYRICS", "UNSYNCED LYRICS"};
        for (const auto tag : tags) {
            const auto count = std::min<std::size_t>(info.meta_get_count_by_name(tag), 8);
            for (std::size_t i = 0; i < count; ++i) {
                auto lyric = parseLocalLyrics(decodeLyrics(info.meta_get(tag, i), false));
                if (lyric.synced) return lyric;
                if (embedded.lines.empty()) embedded = std::move(lyric);
            }
        }
    }
    auto sidecar = readSidecar(track, abort);
    if (sidecar.synced || embedded.lines.empty()) return sidecar;
    return embedded;
}

inline const wchar_t* coverExtension(const album_art_data& art) {
    const auto* bytes = static_cast<const unsigned char*>(art.data());
    const auto matches = [&](std::initializer_list<unsigned char> prefix, std::size_t start = 0) {
        return art.size() >= start + prefix.size() && std::equal(prefix.begin(), prefix.end(), bytes + start);
    };
    if (matches({0xFF, 0xD8, 0xFF})) return L".jpg";
    if (matches({0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A})) return L".png";
    if (matches({'G', 'I', 'F', '8'})) return L".gif";
    if (matches({'R', 'I', 'F', 'F'}) && matches({'W', 'E', 'B', 'P'}, 8)) return L".webp";
    if (matches({'B', 'M'})) return L".bmp";
    return nullptr;
}

inline std::wstring writeCover(const void* data, std::size_t size, std::wstring_view extension,
        const std::filesystem::path& directory, std::wstring_view revision, std::size_t key, abort_callback& abort) {
    if (directory.empty() || !size) return {};
    abort.check();

    const auto slot = L"cover-" + std::to_wstring(key % 2);
    auto filename = slot;
    filename.append(extension);
    const auto pending = directory / (slot + L".tmp");
    {
        std::ofstream file(pending, std::ios::binary | std::ios::trunc);
        if (file) file.write(static_cast<const char*>(data), static_cast<std::streamsize>(size));
        file.close();
        if (!file) {
            DeleteFileW(pending.c_str());
            return {};
        }
    }
    if (abort.is_aborting() ||
            !MoveFileExW(pending.c_str(), (directory / filename).c_str(), MOVEFILE_REPLACE_EXISTING)) {
        DeleteFileW(pending.c_str());
        return {};
    }
    constexpr std::wstring_view extensions[] = {L".jpg", L".png", L".gif", L".webp", L".bmp"};
    for (auto other : extensions) {
        if (other != extension) DeleteFileW((directory / (slot + std::wstring(other))).c_str());
    }
    return L"https://cache.verdant.local/" + filename + L"?v=" +
        std::wstring(revision) + L"-" + std::to_wstring(key);
}

inline std::wstring exportCover(const metadb_handle_ptr& track, const std::filesystem::path& directory,
        std::wstring_view revision, std::size_t key, abort_callback& abort) {
    if (directory.empty()) return {};
    const auto ids = pfc::list_single_ref_t<GUID>(album_art_ids::cover_front);
    const auto items = pfc::list_single_ref_t<metadb_handle_ptr>(track);
    auto art = album_art_manager_v2::get()->open(items, ids, abort)->query(album_art_ids::cover_front, abort);
    constexpr std::size_t coverLimit = 16 * 1024 * 1024;
    if (art.is_empty() || !art->size() || art->size() > coverLimit) return {};
    const auto extension = coverExtension(*art.get_ptr());
    return extension ? writeCover(art->data(), art->size(), extension, directory, revision, key, abort)
        : std::wstring{};
}
}

class LocalMedia {
public:
    struct Update {
        std::optional<Lyrics> lyrics;
        std::optional<std::wstring> cover;
    };

    ~LocalMedia() { cancel(); }

    void setDirectory(std::filesystem::path directory) {
        std::lock_guard lock(state_->mutex);
        state_->directory = std::move(directory);
    }

    void request(std::size_t key, const metadb_handle_ptr& track) {
        schedule(key,track.is_valid()?std::make_shared<Job>(key,track):nullptr);
    }

    void requestCover(std::size_t key, std::vector<unsigned char> bytes, std::wstring suffix) {
        if (bytes.empty() || (suffix!=L"jpg" && suffix!=L"png" && suffix!=L"webp" && suffix!=L"gif")) return;
        auto job=std::make_shared<Job>(key,metadb_handle_ptr{});
        job->bytes=std::move(bytes);
        job->extension=L"."+suffix;
        schedule(key,std::move(job));
    }

    Update take(std::size_t key) {
        std::lock_guard lock(state_->mutex);
        return state_->key == key ? std::exchange(state_->update, {}) : Update{};
    }

    void cancel() {
        std::shared_ptr<Job> active;
        {
            std::lock_guard lock(state_->mutex);
            state_->pending.reset();
            state_->update = {};
            state_->canceled = true;
            active = state_->active;
        }
        if (active) active->abort.abort();
    }

private:
    struct Job {
        Job(std::size_t id, const metadb_handle_ptr& handle) : key(id), track(handle) {}
        std::size_t key;
        metadb_handle_ptr track;
        std::vector<unsigned char> bytes;
        std::wstring extension;
        abort_callback_impl abort;
    };

    void schedule(std::size_t key, std::shared_ptr<Job> job) {
        auto state = state_;
        std::shared_ptr<Job> obsolete;
        bool launch = false;
        {
            std::lock_guard lock(state->mutex);
            state->key = key;
            state->canceled = false;
            state->update = {};
            obsolete = state->active;
            state->pending = std::move(job);
            if (state->pending && !state->running) {
                state->running = true;
                launch = true;
            }
        }
        if (obsolete) obsolete->abort.abort();
        if (launch) fb2k::splitTask([state] { run(state); });
    }

    struct State {
        std::mutex mutex;
        std::filesystem::path directory;
        std::wstring revision = std::to_wstring(GetTickCount64());
        std::shared_ptr<Job> pending, active;
        std::size_t key = 0;
        Update update;
        bool running = false, canceled = false;
    };

    std::shared_ptr<State> state_ = std::make_shared<State>();

    static void run(const std::shared_ptr<State>& state) {
        while (true) {
            std::shared_ptr<Job> job;
            std::filesystem::path directory;
            {
                std::lock_guard lock(state->mutex);
                state->active = std::move(state->pending);
                job = state->active;
                if (!job) {
                    state->running = false;
                    return;
                }
                directory = state->directory;
            }
            const auto canceled = [&] { return job->abort.is_aborting() || fb2k::mainAborter().is_aborting(); };
            fb2k::abort_notify shutdown(fb2k::mainAborter(), [&] { job->abort.abort(); });
            if (job->track.is_valid()) {
                Lyrics lyrics;
                try {
                    if (!canceled()) lyrics = local_media::readLyrics(job->track, job->abort);
                } catch (const std::exception&) {}
                std::lock_guard lock(state->mutex);
                if (state->key == job->key && !state->canceled && !canceled())
                    state->update.lyrics = std::move(lyrics);
            }

            std::wstring cover;
            try {
                if (!canceled()) {
                    if (job->track.is_valid())
                        cover = local_media::exportCover(job->track,directory,state->revision,job->key,job->abort);
                    else cover = local_media::writeCover(job->bytes.data(),job->bytes.size(),job->extension,
                        directory,state->revision,job->key,job->abort);
                }
            } catch (const std::exception&) {}
            {
                std::lock_guard lock(state->mutex);
                if (state->key == job->key && !state->canceled && !canceled())
                    state->update.cover = std::move(cover);
            }
        }
    }
};
}
