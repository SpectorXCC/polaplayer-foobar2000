#include "navidrome_native.hpp"
#include "navidrome_pure.hpp"
#include <windows.h>
#include <winhttp.h>
#include <bcrypt.h>
#include <wincrypt.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Data.Json.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <condition_variable>
#include <cstring>
#include <deque>
#include <fstream>
#include <mutex>
#include <span>
#include <thread>
#include <unordered_set>
#include <utility>

namespace pola::nav {
namespace {

using namespace winrt::Windows::Data::Json;
constexpr size_t maxResponseSize = 24 * 1024 * 1024;
constexpr size_t maxCoverSize = 4 * 1024 * 1024;
constexpr wchar_t configFilename[] = L"polaplayer-navidrome.dat";

struct Failure {
    std::wstring message;
};

struct Endpoint {
    std::wstring host, path;
    INTERNET_PORT port;
    bool secure;
};

std::wstring_view trim(std::wstring_view value) {
    constexpr std::wstring_view whitespace = L" \t\r\n";
    auto first = value.find_first_not_of(whitespace);
    if (first == std::wstring_view::npos) return {};
    return value.substr(first, value.find_last_not_of(whitespace) - first + 1);
}

std::optional<Endpoint> endpoint(std::wstring const& server) {
    if (server.empty() || server.size() > 2048 ||
        std::any_of(server.begin(), server.end(), [](wchar_t c) { return c <= 32 || c == '\\'; }) ||
        server.find_first_of(L"?#") != std::wstring::npos) return {};
    URL_COMPONENTS parts{};
    parts.dwStructSize = sizeof(parts);
    parts.dwHostNameLength = parts.dwUrlPathLength = parts.dwUserNameLength =
        parts.dwPasswordLength = static_cast<DWORD>(-1);
    if (!WinHttpCrackUrl(server.c_str(), static_cast<DWORD>(server.size()), 0, &parts) ||
        !parts.dwHostNameLength || parts.dwUserNameLength || parts.dwPasswordLength ||
        (parts.nScheme != INTERNET_SCHEME_HTTP && parts.nScheme != INTERNET_SCHEME_HTTPS)) return {};
    auto slash = server.find(L'/', server.find(L"://") + 3);
    if (server.substr(0, slash).find(L'@') != std::wstring::npos) return {};
    return Endpoint{
        std::wstring(parts.lpszHostName, parts.dwHostNameLength),
        parts.dwUrlPathLength ? std::wstring(parts.lpszUrlPath, parts.dwUrlPathLength) : L"",
        parts.nPort,
        parts.nScheme == INTERNET_SCHEME_HTTPS
    };
}

bool normalize(Config& config) {
    config.server = trim(config.server);
    config.user = trim(config.user);
    while (config.server.ends_with(L'/')) config.server.pop_back();
    if (config.server.ends_with(L"/rest")) config.server.resize(config.server.size() - 5);
    if (config.server.empty() && config.user.empty() && config.password.empty()) return true;
    return endpoint(config.server).has_value() && !config.user.empty() && !config.password.empty() &&
        config.user.size() <= 256 && config.password.size() <= 4096 &&
        config.user.find(L'\0') == std::wstring::npos && config.password.find(L'\0') == std::wstring::npos;
}

std::wstring hex(std::span<const unsigned char> bytes) {
    constexpr wchar_t digits[] = L"0123456789abcdef";
    std::wstring out;
    out.reserve(bytes.size() * 2);
    for (const auto byte : bytes) {
        out += digits[byte >> 4];
        out += digits[byte & 15];
    }
    return out;
}

std::wstring encode(std::wstring_view value) {
    const auto bytes = winrt::to_string(value);
    constexpr wchar_t digits[] = L"0123456789ABCDEF";
    std::wstring out;
    for (unsigned char c : bytes) {
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') {
            out += static_cast<wchar_t>(c);
        } else {
            out += L'%';
            out += digits[c >> 4];
            out += digits[c & 15];
        }
    }
    return out;
}

int nibble(wchar_t c) {
    if (c >= L'0' && c <= L'9') return c - L'0';
    if (c >= L'a' && c <= L'f') return c - L'a' + 10;
    if (c >= L'A' && c <= L'F') return c - L'A' + 10;
    return -1;
}

std::wstring decode(std::wstring_view value) {
    std::string bytes;
    for (size_t i = 0; i < value.size(); ++i) {
        if (value[i] == L'%') {
            if (i + 2 >= value.size()) return {};
            int hi = nibble(value[i + 1]), lo = nibble(value[i + 2]);
            if (hi < 0 || lo < 0) return {};
            bytes += static_cast<char>(hi << 4 | lo);
            i += 2;
        } else if (value[i] < 128) bytes += static_cast<char>(value[i]);
        else return {};
    }
    return std::wstring(winrt::to_hstring(bytes));
}

using Params = std::vector<std::pair<std::wstring_view, std::wstring_view>>;

std::wstring query(Config const& config, Params const& params) {
    std::array<unsigned char, 12> salt{};
    if (BCryptGenRandom(nullptr, salt.data(), static_cast<ULONG>(salt.size()),
        BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0) throw Failure{L"Navidrome authentication could not initialize."};
    const auto saltHex = hex(salt);
    auto secret = winrt::to_string(config.password);
    secret += winrt::to_string(saltHex);
    std::array<unsigned char, 16> hash{};
    BCRYPT_ALG_HANDLE algorithm{};
    const auto opened = BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_MD5_ALGORITHM, nullptr, 0);
    const auto hashed = opened < 0 ? opened : BCryptHash(algorithm, nullptr, 0,
        reinterpret_cast<PUCHAR>(secret.data()), static_cast<ULONG>(secret.size()),
        hash.data(), static_cast<ULONG>(hash.size()));
    SecureZeroMemory(secret.data(), secret.size());
    if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
    if (hashed < 0) throw Failure{L"Navidrome authentication could not initialize."};
    std::wstring out = L"?c=PolaPlayer&v=1.16.1&f=json&u=" + encode(config.user) +
        L"&t=" + hex(hash) + L"&s=" + saltHex;
    for (auto const& [key, value] : params) {
        if (!value.empty()) out += L"&" + std::wstring(key) + L"=" + encode(value);
    }
    return out;
}

class HttpHandle {
public:
    explicit HttpHandle(HINTERNET value) : handle_(value) {}
    ~HttpHandle() { if (handle_) WinHttpCloseHandle(handle_); }
    HttpHandle(HttpHandle const&) = delete;
    operator HINTERNET() const { return handle_; }
private:
    HINTERNET handle_;
};

std::string requestBody(Config const& config, std::wstring_view method, Params const& params,
    std::stop_token stop, size_t byteLimit) {
    auto address = endpoint(config.server);
    if (!address) throw Failure{L"Add a Navidrome server in Settings first."};
    const auto path = address->path + L"/rest/" + std::wstring(method) + L".view" + query(config, params);
    HttpHandle session(WinHttpOpen(L"PolaPlayer/1.0", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
    if (!session || !WinHttpSetTimeouts(session, 2500, 3500, 4500, 8000))
        throw Failure{L"The Navidrome connection could not start."};
    HttpHandle connect(WinHttpConnect(session, address->host.c_str(), address->port, 0));
    if (!connect) throw Failure{L"Could not connect to the Navidrome server."};
    HttpHandle request(WinHttpOpenRequest(connect, L"GET", path.c_str(), nullptr,
        WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, address->secure ? WINHTTP_FLAG_SECURE : 0));
    DWORD redirectPolicy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
    if (!request || !WinHttpSetOption(request, WINHTTP_OPTION_REDIRECT_POLICY, &redirectPolicy, sizeof(redirectPolicy)) ||
        stop.stop_requested() || !WinHttpSendRequest(request, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
            WINHTTP_NO_REQUEST_DATA, 0, 0, 0) || !WinHttpReceiveResponse(request, nullptr)) {
        throw Failure{L"Could not connect to the Navidrome server."};
    }
    DWORD status = 0, statusSize = sizeof(status);
    if (!WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_HEADER_NAME_BY_INDEX, &status, &statusSize, WINHTTP_NO_HEADER_INDEX)) {
        throw Failure{L"The Navidrome response could not be read."};
    }
    if (status == 401 || status == 403) throw Failure{L"Navidrome rejected the account or operation."};
    if (status >= 300 && status < 400) throw Failure{L"Use the final Navidrome server address."};
    if (status != 200) throw Failure{L"The Navidrome server rejected the request."};
    DWORD contentLength = 0, contentLengthSize = sizeof(contentLength);
    if (WinHttpQueryHeaders(request, WINHTTP_QUERY_CONTENT_LENGTH | WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_HEADER_NAME_BY_INDEX, &contentLength, &contentLengthSize, WINHTTP_NO_HEADER_INDEX) &&
        contentLength > byteLimit) throw Failure{L"The Navidrome response is too large."};
    std::string body;
    std::array<char, 16384> buffer{};
    while (true) {
        DWORD count = 0;
        if (stop.stop_requested() || !WinHttpReadData(request, buffer.data(), static_cast<DWORD>(buffer.size()), &count))
            throw Failure{L"The Navidrome response could not be read."};
        if (!count) break;
        if (body.size() + count > byteLimit) throw Failure{L"The Navidrome response is too large."};
        body.append(buffer.data(), count);
    }
    return body;
}

JsonObject api(Config const& config, std::wstring_view method, Params const& params, std::stop_token stop) {
    const auto body = requestBody(config, method, params, stop, maxResponseSize);
    JsonObject response;
    auto json = std::string_view(body);
    if (json.starts_with("\xEF\xBB\xBF")) json.remove_prefix(3);
    if (!JsonObject::TryParse(winrt::to_hstring(json), response))
        throw Failure{L"The Navidrome response is not valid JSON."};
    const auto result = response.GetNamedObject(L"subsonic-response", nullptr);
    if (!result) throw Failure{L"The response was not a Subsonic API response."};
    if (result.GetNamedString(L"status", L"") != L"ok") {
        const auto error = result.GetNamedObject(L"error", nullptr);
        const double code = error ? error.GetNamedNumber(L"code", 0) : 0;
        if (code == 40 || code == 41 || code == 50) throw Failure{L"Navidrome rejected the account or operation."};
        if (code == 70) throw Failure{L"The item no longer exists on the Navidrome server."};
        throw Failure{L"The Navidrome server rejected the request."};
    }
    return result;
}

std::wstring coverSuffix(std::string_view body) {
    if (body.size() >= 24 && body.starts_with("\x89PNG\r\n\x1A\n") && body.substr(12, 4) == "IHDR")
        return L"png";
    if (body.size() >= 4 && body.starts_with("\xFF\xD8\xFF")) return L"jpg";
    if (body.size() >= 13 && (body.starts_with("GIF87a") || body.starts_with("GIF89a"))) return L"gif";
    if (body.size() >= 16 && body.starts_with("RIFF") && body.substr(8, 4) == "WEBP" &&
        (body.substr(12, 4) == "VP8 " || body.substr(12, 4) == "VP8L" || body.substr(12, 4) == "VP8X"))
        return L"webp";
    return {};
}

std::wstring field(JsonObject const& object, wchar_t const* key) {
    if (!object || !object.HasKey(key)) return L"";
    const auto val = object.GetNamedValue(key);
    if (val.ValueType() == JsonValueType::String) return std::wstring(val.GetString());
    if (val.ValueType() == JsonValueType::Number) {
        const double n = val.GetNumber();
        if (std::isfinite(n)) return std::to_wstring(static_cast<long long>(std::llround(n)));
    }
    return L"";
}

bool hasNonEmptyField(JsonObject const& object, wchar_t const* key) {
    return object && object.HasKey(key) && object.GetNamedValue(key).ValueType() != JsonValueType::Null;
}

std::wstring fileSuffix(JsonObject const& song) {
    auto suffix = field(song, L"suffix");
    if (!suffix.empty() && suffix.size() <= 12 && std::all_of(suffix.begin(), suffix.end(), [](wchar_t c) {
        return (c >= L'a' && c <= L'z') || (c >= L'A' && c <= L'Z') || (c >= L'0' && c <= L'9');
    })) return suffix;
    const auto format = field(song, L"contentType");
    if (format == L"audio/mpeg") return L"mp3";
    if (format == L"audio/flac" || format == L"audio/x-flac") return L"flac";
    if (format == L"audio/ogg" || format == L"application/ogg") return L"ogg";
    if (format == L"audio/opus") return L"opus";
    if (format == L"audio/mp4" || format == L"audio/x-m4a") return L"m4a";
    if (format == L"audio/wav" || format == L"audio/x-wav") return L"wav";
    if (format == L"audio/aac") return L"aac";
    if (format == L"audio/x-ms-wma") return L"wma";
    return {};
}

template<typename Fn>
void forEachObject(JsonObject const& parent, wchar_t const* name, Fn fn) {
    if (!parent || !parent.HasKey(name)) return;
    const auto value = parent.GetNamedValue(name);
    if (value.ValueType() == JsonValueType::Array) {
        for (const auto& item : value.GetArray()) {
            if (item.ValueType() == JsonValueType::Object) fn(item.GetObject());
        }
    } else if (value.ValueType() == JsonValueType::Object) {
        fn(value.GetObject());
    }
}

void readPlaylists(JsonObject const& payload, Config const& config, Result& result) {
    forEachObject(payload.GetNamedObject(L"playlists", nullptr), L"playlist", [&](auto const& p) {
        auto id = field(p, L"id");
        if (id.empty()) return;
        auto owner = field(p, L"owner");
        auto count = p.GetNamedNumber(L"songCount", 0);
        auto dur = std::max(0.0, p.GetNamedNumber(L"duration", 0));
        auto cov = field(p, L"coverArt");
        if (cov.empty()) cov = L"pl-" + id;
        result.playlists.push_back({std::move(id), field(p, L"name"), std::move(cov),
            static_cast<size_t>(std::clamp(count, 0.0, 1000000000.0)), dur,
            p.GetNamedBoolean(L"editable", owner.empty() || owner == config.user)});
    });
}

Album parseAlbumObj(JsonObject const& a) {
    Album alb;
    alb.id = field(a, L"id");
    alb.name = field(a, L"name");
    if (alb.name.empty()) alb.name = field(a, L"title");
    alb.artist = field(a, L"artist");
    alb.artistId = field(a, L"artistId");
    alb.year = field(a, L"year");
    alb.coverArt = field(a, L"coverArt");
    if (alb.coverArt.empty() && !alb.id.empty()) alb.coverArt = L"al-" + alb.id;
    alb.songCount = static_cast<size_t>(std::clamp(a.GetNamedNumber(L"songCount", 0), 0.0, 1000000000.0));
    alb.duration = std::max(0.0, a.GetNamedNumber(L"duration", 0));
    alb.starred = hasNonEmptyField(a, L"starred");
    return alb;
}

Artist parseArtistObj(JsonObject const& ar) {
    Artist out;
    out.id = field(ar, L"id");
    out.name = field(ar, L"name");
    out.coverArt = field(ar, L"coverArt");
    if (out.coverArt.empty() && !out.id.empty()) out.coverArt = L"ar-" + out.id;
    out.albumCount = static_cast<size_t>(std::clamp(ar.GetNamedNumber(L"albumCount", 0), 0.0, 1000000000.0));
    out.starred = hasNonEmptyField(ar, L"starred");
    return out;
}

std::vector<Song> readSongs(JsonObject const& parent, wchar_t const* key) {
    std::vector<Song> songs;
    forEachObject(parent, key, [&](auto const& entry) {
        auto id = field(entry, L"id");
        if (id.empty()) return;
        Song s;
        s.id = std::move(id);
        s.title = field(entry, L"title");
        s.artist = field(entry, L"artist");
        s.album = field(entry, L"album");
        s.albumId = field(entry, L"albumId");
        s.artistId = field(entry, L"artistId");
        s.coverArt = field(entry, L"coverArt");
        s.duration = std::max(0.0, entry.GetNamedNumber(L"duration", 0));
        s.discNumber = static_cast<int>(entry.GetNamedNumber(L"discNumber", 0));
        s.track = static_cast<int>(entry.GetNamedNumber(L"track", 0));
        s.playCount = static_cast<int>(entry.GetNamedNumber(L"playCount", 0));
        s.starred = hasNonEmptyField(entry, L"starred");
        s.suffix = fileSuffix(entry);
        songs.push_back(std::move(s));
    });
    return songs;
}

void sortLyrics(Result& result) {
    std::stable_sort(result.lyrics.begin(), result.lyrics.end(), [](const auto& a, const auto& b) {
        return a.time < b.time;
    });
}

bool structuredLyrics(JsonObject const& payload, Result& result) {
    forEachObject(payload.GetNamedObject(L"lyricsList", nullptr), L"structuredLyrics", [&](auto const& entry) {
        auto synced = entry.GetNamedBoolean(L"synced", false);
        if (!result.lyrics.empty() && (result.synced || !synced)) return;
        std::vector<LyricLine> rows;
        const auto offset = entry.GetNamedNumber(L"offset", 0);
        forEachObject(entry, L"line", [&](auto const& line) {
            if (rows.size() >= 5000) return;
            auto start = line.GetNamedNumber(L"start", -1);
            if (synced && start < 0) return;
            rows.push_back({synced ? std::max(0.0, (start - offset) / 1000.0) : -1, field(line, L"value")});
        });
        if (!rows.empty()) {
            result.lyrics = std::move(rows);
            result.synced = synced;
        }
    });
    if (result.synced) sortLyrics(result);
    return !result.lyrics.empty();
}

std::optional<double> lrcTime(std::wstring_view tag) {
    auto colon = tag.find(L':');
    if (!colon || colon == std::wstring_view::npos || colon + 1 == tag.size()) return {};
    double minutes = 0, seconds = 0, unit = 0;
    auto digits = [](wchar_t c) { return c >= L'0' && c <= L'9'; };
    for (auto c : tag.substr(0, colon)) {
        if (!digits(c)) return {};
        minutes = minutes * 10 + c - L'0';
    }
    if (!digits(tag[colon + 1])) return {};
    for (auto c : tag.substr(colon + 1)) {
        if (c == L'.' && unit == 0) unit = .1;
        else if (!digits(c)) return {};
        else if (unit > 0) { seconds += (c - L'0') * unit; unit *= .1; }
        else seconds = seconds * 10 + c - L'0';
    }
    if (seconds >= 60 || minutes > 100000) return {};
    return minutes * 60 + seconds;
}

void legacyLyrics(std::wstring const& text, Result& result) {
    if (text.empty()) return;
    std::wstring_view rest(text);
    std::vector<LyricLine> timed, plain;
    while (!rest.empty() && plain.size() < 5000 && timed.size() < 5000) {
        auto newline = rest.find(L'\n');
        auto line = trim(rest.substr(0, newline));
        rest = newline == std::wstring_view::npos ? std::wstring_view{} : rest.substr(newline + 1);
        plain.push_back({-1, std::wstring(line)});
        std::vector<double> timestamps;
        while (line.starts_with(L'[') && timestamps.size() < 20) {
            auto end = line.find(L']');
            if (end == std::wstring_view::npos) break;
            auto time = lrcTime(line.substr(1, end - 1));
            if (!time) break;
            timestamps.push_back(*time);
            line.remove_prefix(end + 1);
        }
        for (auto time : timestamps) timed.push_back({time, std::wstring(trim(line))});
    }
    result.synced = !timed.empty();
    result.lyrics = result.synced ? std::move(timed) : std::move(plain);
    if (result.synced) sortLyrics(result);
}

struct Work {
    std::uint64_t requestId = 0, generation = 0;
    Action action = Action::Ping;
    std::wstring id, query, songId;
    int index = -1;
    int extra = 0;
    std::int64_t timeMs = 0;
    std::optional<Config> draft;
    std::vector<SyncTrackSpec> syncSpecs;
};

Result perform(Work const& work, Config const& config, std::stop_token stop) {
    Result result;
    result.requestId = work.requestId;
    result.action = work.action;
    result.playlistId = work.id;
    result.tag = work.query;
    auto request = [&](std::wstring_view method, Params const& params = {}) {
        return api(config, method, params, stop);
    };
    auto playlist = [&] { return request(L"getPlaylist", {{L"id", work.id}}).GetNamedObject(L"playlist"); };
    try {
        switch (work.action) {
        case Action::Ping: request(L"ping"); break;
        case Action::Playlists: readPlaylists(request(L"getPlaylists"), config, result); break;
        case Action::Playlist: result.songs = readSongs(playlist(), L"entry"); break;
        case Action::Song:
            result.songs = readSongs(request(L"getSong", {{L"id", work.id}}), L"song");
            if (result.songs.size() != 1 || result.songs.front().id != work.id) {
                result.songs.clear();
                throw Failure{L"Navidrome did not return the requested song."};
            }
            break;
        case Action::Cover: {
            const auto body = requestBody(config, L"getCoverArt", {{L"id", work.id}, {L"size", L"1536"}}, stop, maxCoverSize);
            result.imageSuffix = coverSuffix(body);
            if (result.imageSuffix.empty()) throw Failure{L"Navidrome did not return a supported cover image."};
            result.imageBytes.assign(body.begin(), body.end());
            break;
        }
        case Action::Search:
            result.songs = readSongs(request(L"search3", {{L"query", work.query}, {L"songCount", L"200"},
                {L"artistCount", L"0"}, {L"albumCount", L"0"}}).GetNamedObject(L"searchResult3", nullptr), L"song");
            break;
        case Action::SearchAll: {
            const auto r3 = request(L"search3", {
                {L"query", work.query},
                {L"artistCount", L"24"},
                {L"albumCount", L"30"},
                {L"songCount", L"150"}
            }).GetNamedObject(L"searchResult3", nullptr);
            forEachObject(r3, L"artist", [&](auto const& ar) {
                auto parsed = parseArtistObj(ar);
                if (!parsed.id.empty()) result.artists.push_back(std::move(parsed));
            });
            forEachObject(r3, L"album", [&](auto const& al) {
                auto parsed = parseAlbumObj(al);
                if (!parsed.id.empty()) result.albums.push_back(std::move(parsed));
            });
            result.songs = readSongs(r3, L"song");
            break;
        }
        case Action::AlbumList: {
            const auto sizeW = std::to_wstring(std::clamp(work.extra > 0 ? work.extra : 60, 1, 200));
            const auto offsetW = std::to_wstring(std::max(0, work.index));
            const auto tabW = work.query.empty() ? L"recent" : work.query;
            const auto resp = request(L"getAlbumList2", {
                {L"type", tabW},
                {L"size", sizeW},
                {L"offset", offsetW}
            });
            forEachObject(resp.GetNamedObject(L"albumList2", nullptr), L"album", [&](auto const& al) {
                auto parsed = parseAlbumObj(al);
                if (!parsed.id.empty()) result.albums.push_back(std::move(parsed));
            });
            break;
        }
        case Action::AlbumDetail: {
            const auto obj = request(L"getAlbum", {{L"id", work.id}}).GetNamedObject(L"album", nullptr);
            if (!obj) throw Failure{L"Album not found on server."};
            result.albumMeta = parseAlbumObj(obj);
            result.songs = readSongs(obj, L"song");
            std::stable_sort(result.songs.begin(), result.songs.end(), [](Song const& a, Song const& b) {
                if (a.discNumber != b.discNumber) return a.discNumber < b.discNumber;
                return a.track < b.track;
            });
            break;
        }
        case Action::Artists: {
            const auto artistsObj = request(L"getArtists").GetNamedObject(L"artists", nullptr);
            forEachObject(artistsObj, L"index", [&](auto const& idxEntry) {
                forEachObject(idxEntry, L"artist", [&](auto const& ar) {
                    auto parsed = parseArtistObj(ar);
                    if (!parsed.id.empty()) result.artists.push_back(std::move(parsed));
                });
            });
            break;
        }
        case Action::ArtistDetail: {
            const auto arObj = request(L"getArtist", {{L"id", work.id}}).GetNamedObject(L"artist", nullptr);
            if (!arObj) throw Failure{L"Artist not found on server."};
            auto meta = parseArtistObj(arObj);
            forEachObject(arObj, L"album", [&](auto const& al) {
                auto parsed = parseAlbumObj(al);
                if (!parsed.id.empty()) result.albums.push_back(std::move(parsed));
            });
            std::stable_sort(result.albums.begin(), result.albums.end(), [](Album const& a, Album const& b) {
                auto yrVal = [](std::wstring const& s) -> int {
                    int v = 0;
                    for (wchar_t c : s) if (c >= L'0' && c <= L'9') v = v * 10 + (c - L'0');
                    return v;
                };
                return yrVal(a.year) > yrVal(b.year);
            });
            if (!meta.name.empty()) {
                try {
                    const auto topResp = request(L"getTopSongs", {{L"artist", meta.name}, {L"count", L"10"}});
                    result.songs = readSongs(topResp.GetNamedObject(L"topSongs", nullptr), L"song");
                } catch (...) {
                    // Server may not support getTopSongs; still return artist metadata + albums cleanly
                }
            }
            result.artistMeta = std::move(meta);
            break;
        }
        case Action::Starred: {
            const auto st2 = request(L"getStarred2").GetNamedObject(L"starred2", nullptr);
            result.songs = readSongs(st2, L"song");
            forEachObject(st2, L"album", [&](auto const& al) {
                auto parsed = parseAlbumObj(al);
                if (!parsed.id.empty()) result.albums.push_back(std::move(parsed));
            });
            forEachObject(st2, L"artist", [&](auto const& ar) {
                auto parsed = parseArtistObj(ar);
                if (!parsed.id.empty()) result.artists.push_back(std::move(parsed));
            });
            break;
        }
        case Action::RandomSongs: {
            const int reqCount = (work.extra > 0) ? work.extra : (work.index > 0 ? work.index : 80);
            const auto sizeW = std::to_wstring(std::clamp(reqCount, 1, 200));
            const auto rs = request(L"getRandomSongs", {{L"size", sizeW}}).GetNamedObject(L"randomSongs", nullptr);
            result.songs = readSongs(rs, L"song");
            break;
        }
        case Action::Star:
        case Action::Unstar: {
            const std::wstring_view method = (work.action == Action::Star) ? L"star" : L"unstar";
            const std::wstring_view paramName =
                (work.query == L"album") ? L"albumId" : (work.query == L"artist") ? L"artistId" : L"id";
            request(method, {{paramName, work.id}});
            break;
        }
        case Action::Scrobble: {
            const auto timeStr = std::to_wstring(work.timeMs);
            request(L"scrobble", {{L"id", work.id}, {L"submission", L"true"}, {L"time", timeStr}});
            break;
        }
        case Action::SyncLocalPlaylist: {
            auto lowerW = [](std::wstring_view s) {
                std::wstring out;
                out.reserve(s.size());
                for (wchar_t c : s) {
                    out.push_back((c >= L'A' && c <= L'Z') ? static_cast<wchar_t>(c + 32) : c);
                }
                return out;
            };
            result.totalCount = static_cast<int>(work.syncSpecs.size());
            std::vector<std::wstring> matchedIds;
            std::unordered_set<std::wstring> seenIds;
            for (auto const& sp : work.syncSpecs) {
                if (stop.stop_requested()) throw Failure{L"Cancelled"};
                if (sp.title.empty()) continue;
                const auto sr = request(L"search3", {
                    {L"query", sp.title},
                    {L"songCount", L"12"},
                    {L"artistCount", L"0"},
                    {L"albumCount", L"0"}
                }).GetNamedObject(L"searchResult3", nullptr);
                const auto candidates = readSongs(sr, L"song");
                if (candidates.empty()) continue;
                const auto wantT = lowerW(sp.title);
                const auto wantA = lowerW(sp.artist);
                std::wstring bestId;
                for (auto const& c : candidates) {
                    if (lowerW(c.title) == wantT && (wantA.empty() || lowerW(c.artist) == wantA)) {
                        bestId = c.id;
                        break;
                    }
                }
                if (bestId.empty()) {
                    for (auto const& c : candidates) {
                        if (lowerW(c.title) == wantT) {
                            bestId = c.id;
                            break;
                        }
                    }
                }
                if (bestId.empty()) bestId = candidates.front().id;
                if (!bestId.empty() && seenIds.insert(bestId).second) {
                    matchedIds.push_back(std::move(bestId));
                }
            }
            const auto created = request(L"createPlaylist", {{L"name", work.query}});
            result.playlistId = field(created.GetNamedObject(L"playlist", nullptr), L"id");
            if (result.playlistId.empty()) throw Failure{L"Could not create remote playlist."};
            for (size_t off = 0; off < matchedIds.size(); off += 25) {
                Params upParams;
                upParams.push_back({L"playlistId", result.playlistId});
                const size_t end = std::min(off + 25, matchedIds.size());
                for (size_t k = off; k < end; ++k) {
                    upParams.push_back({L"songIdToAdd", matchedIds[k]});
                }
                request(L"updatePlaylist", upParams);
            }
            result.matchedCount = static_cast<int>(matchedIds.size());
            break;
        }
        case Action::Lyrics: {
            try { structuredLyrics(request(L"getLyricsBySongId", {{L"id", work.id}}), result); }
            catch (Failure const&) { if (work.query.empty() || work.songId.empty()) throw; }
            if (result.lyrics.empty() && !work.query.empty() && !work.songId.empty()) {
                const auto response = request(L"getLyrics", {{L"artist", work.query}, {L"title", work.songId}});
                legacyLyrics(field(response.GetNamedObject(L"lyrics", nullptr), L"value"), result);
            }
            break;
        }
        case Action::CreatePlaylist: {
            const auto response = request(L"createPlaylist", {{L"name", work.query}});
            result.playlistId = field(response.GetNamedObject(L"playlist", nullptr), L"id");
            break;
        }
        case Action::RenamePlaylist: request(L"updatePlaylist", {{L"playlistId", work.id}, {L"name", work.query}}); break;
        case Action::DeletePlaylist: request(L"deletePlaylist", {{L"id", work.id}}); break;
        case Action::AddSong: {
            const auto songs = readSongs(playlist(), L"entry");
            if (std::any_of(songs.begin(), songs.end(), [&](auto const& song) { return song.id == work.songId; })) {
                result.duplicate = true;
                throw Failure{L"This song is already in the playlist."};
            }
            request(L"updatePlaylist", {{L"playlistId", work.id}, {L"songIdToAdd", work.songId}});
            break;
        }
        case Action::RemoveSong: {
            if (work.index < 0) throw Failure{L"The playlist position is invalid."};
            if (!work.songId.empty()) {
                const auto songs = readSongs(playlist(), L"entry");
                const auto index = static_cast<size_t>(work.index);
                if (index >= songs.size() || songs[index].id != work.songId)
                    throw Failure{L"The playlist changed. Refresh it before removing a song."};
            }
            const auto index = std::to_wstring(work.index);
            request(L"updatePlaylist", {{L"playlistId", work.id}, {L"songIndexToRemove", index}});
            break;
        }
        }
        result.ok = true;
    } catch (Failure const& error) {
        result.error = error.message;
    } catch (...) {
        result.error = L"The Navidrome request could not be completed.";
    }
    return result;
}

bool argumentsPresent(Action action, std::wstring const& id, std::wstring const& query, std::wstring const& songId) {
    switch (action) {
    case Action::Ping: case Action::Playlists: case Action::AlbumList:
    case Action::Artists: case Action::Starred: case Action::RandomSongs: return true;
    case Action::Search: case Action::SearchAll: case Action::CreatePlaylist:
    case Action::SyncLocalPlaylist: return !query.empty();
    case Action::RenamePlaylist: return !query.empty() && !id.empty();
    case Action::AddSong: return !songId.empty() && !id.empty();
    default: return !id.empty();
    }
}

std::wstring makeStreamUrl(Config const& config, std::wstring_view id) {
    if (id.empty() || config.server.empty()) return {};
    return config.server + L"/rest/stream.view" + query(config, {{L"id", id}, {L"format", L"raw"}});
}

std::optional<std::wstring> unprotectDpapiText(std::filesystem::path const& path) {
    if (!std::filesystem::exists(path)) return std::nullopt;
    if (std::filesystem::file_size(path) > 256 * 1024) return std::nullopt;
    std::ifstream file(path, std::ios::binary);
    if (!file) return std::nullopt;
    std::string protectedBytes((std::istreambuf_iterator<char>(file)), {});
    DATA_BLOB input{static_cast<DWORD>(protectedBytes.size()), reinterpret_cast<BYTE*>(protectedBytes.data())};
    DATA_BLOB output{};
    if (!CryptUnprotectData(&input, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output))
        return std::nullopt;
    std::wstring text;
    if (output.cbData % sizeof(wchar_t) == 0) {
        text.resize(output.cbData / sizeof(wchar_t));
        std::memcpy(text.data(), output.pbData, output.cbData);
    }
    SecureZeroMemory(output.pbData, output.cbData);
    LocalFree(output.pbData);
    return text;
}

bool protectDpapiText(std::filesystem::path const& profile, std::wstring& text) {
    DATA_BLOB input{static_cast<DWORD>(text.size() * sizeof(wchar_t)), reinterpret_cast<BYTE*>(text.data())};
    DATA_BLOB output{};
    const bool protectedOk = !!CryptProtectData(&input, L"PolaPlayer Navidrome", nullptr, nullptr,
        nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output);
    SecureZeroMemory(text.data(), text.size() * sizeof(wchar_t));
    if (!protectedOk) return false;
    const auto path = profile / configFilename;
    const auto temporary = profile / L"polaplayer-navidrome.dat.tmp";
    std::ofstream file(temporary, std::ios::binary | std::ios::trunc);
    file.write(reinterpret_cast<const char*>(output.pbData), output.cbData);
    file.close();
    LocalFree(output.pbData);
    if (!file) return false;
    return !!MoveFileExW(temporary.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);
}

} // namespace

MultiConfig loadMultiConfig(std::filesystem::path const& profile) {
    MultiConfig mc;
    if (profile.empty()) return mc;
    try {
        auto textOpt = unprotectDpapiText(profile / configFilename);
        if (!textOpt) return mc;
        JsonObject json;
        const bool parsed = JsonObject::TryParse(winrt::hstring(*textOpt), json);
        SecureZeroMemory(textOpt->data(), textOpt->size() * sizeof(wchar_t));
        if (!parsed) return mc;

        if (json.HasKey(L"servers")) {
            mc.activeId = field(json, L"activeId");
            forEachObject(json, L"servers", [&](auto const& sObj) {
                ServerEntry se{
                    field(sObj, L"id"),
                    field(sObj, L"name"),
                    field(sObj, L"server"),
                    field(sObj, L"user"),
                    field(sObj, L"password")
                };
                Config c{se.server, se.user, se.password};
                if (!c.server.empty() && !c.user.empty() && !c.password.empty() && normalize(c)) {
                    se.server = std::move(c.server);
                    se.user = std::move(c.user);
                    se.password = std::move(c.password);
                    if (se.id.empty()) se.id = L"srv-" + std::to_wstring(mc.servers.size() + 1);
                    if (se.name.empty()) se.name = se.server;
                    mc.servers.push_back(std::move(se));
                }
            });
            if (mc.activeId.empty() && !mc.servers.empty()) mc.activeId = mc.servers.front().id;
            return mc;
        }

        // Legacy v1 single-server migration
        Config c{field(json, L"server"), field(json, L"user"), field(json, L"password")};
        if (!c.server.empty() && !c.user.empty() && !c.password.empty() && normalize(c)) {
            mc.activeId = L"srv-1";
            mc.servers.push_back({L"srv-1", L"Default", std::move(c.server), std::move(c.user), std::move(c.password)});
        }
    } catch (...) {}
    return mc;
}

bool saveMultiConfig(std::filesystem::path const& profile, MultiConfig const& cfg) {
    if (profile.empty()) return false;
    try {
        JsonObject root;
        root.Insert(L"version", JsonValue::CreateNumberValue(2));
        root.Insert(L"activeId", JsonValue::CreateStringValue(cfg.activeId));
        JsonArray arr;
        for (auto const& se : cfg.servers) {
            Config c{se.server, se.user, se.password};
            if (c.server.empty() || c.user.empty() || c.password.empty() || !normalize(c)) continue;
            JsonObject o;
            o.Insert(L"id", JsonValue::CreateStringValue(se.id));
            o.Insert(L"name", JsonValue::CreateStringValue(se.name));
            o.Insert(L"server", JsonValue::CreateStringValue(c.server));
            o.Insert(L"user", JsonValue::CreateStringValue(c.user));
            o.Insert(L"password", JsonValue::CreateStringValue(c.password));
            arr.Append(o);
        }
        root.Insert(L"servers", arr);
        auto text = std::wstring(root.Stringify());
        return protectDpapiText(profile, text);
    } catch (...) { return false; }
}

std::optional<Config> loadConfig(std::filesystem::path const& profile) {
    const auto mc = loadMultiConfig(profile);
    for (auto const& s : mc.servers) {
        if (s.id == mc.activeId) return Config{s.server, s.user, s.password};
    }
    if (!mc.servers.empty()) {
        auto const& f = mc.servers.front();
        return Config{f.server, f.user, f.password};
    }
    return std::nullopt;
}

bool saveConfig(std::filesystem::path const& profile, Config const& settings) {
    if (profile.empty()) return false;
    Config c = settings;
    if (!normalize(c) || c.server.empty() || c.user.empty() || c.password.empty()) return false;
    MultiConfig mc = loadMultiConfig(profile);
    if (mc.servers.empty()) {
        mc.activeId = L"srv-1";
        mc.servers.push_back({L"srv-1", L"Default", std::move(c.server), std::move(c.user), std::move(c.password)});
    } else {
        bool updated = false;
        for (auto& s : mc.servers) {
            if (s.id == mc.activeId) {
                s.server = std::move(c.server);
                s.user = std::move(c.user);
                s.password = std::move(c.password);
                updated = true;
                break;
            }
        }
        if (!updated) {
            mc.activeId = mc.servers.front().id;
            mc.servers.front().server = std::move(c.server);
            mc.servers.front().user = std::move(c.user);
            mc.servers.front().password = std::move(c.password);
        }
    }
    return saveMultiConfig(profile, mc);
}

std::vector<ServerEntry> importFooNavidromeServers(std::filesystem::path const& profile) {
    std::vector<ServerEntry> out;
    if (profile.empty()) return out;
    const auto dbPath = profile / L"config.sqlite";
    std::error_code ec;
    if (!std::filesystem::exists(dbPath, ec)) return out;
    std::ifstream in(dbPath, std::ios::binary);
    if (!in) return out;
    std::vector<unsigned char> bytes((std::istreambuf_iterator<char>(in)), {});
    if (bytes.size() < 100) return out;

    const std::string pfx = "cfg_var.A1B2C3D4-1111-2222-AABB-CCDDEEFF";
    std::vector<std::string> keys = {pfx + "011B", pfx + "0101", pfx + "0102", pfx + "0103"};
    auto kv = pure::extractSqliteConfigStrings(bytes, keys);
    auto records = pure::parseFooServerList(
        kv[pfx + "011B"],
        kv[pfx + "0101"],
        kv[pfx + "0102"],
        kv[pfx + "0103"]);
    int idx = 1;
    for (auto const& r : records) {
        if (r.password.empty()) continue;
        ServerEntry se;
        se.id = L"foo-" + std::to_wstring(idx++);
        se.name = std::wstring(winrt::to_hstring(r.name));
        se.server = std::wstring(winrt::to_hstring(r.url));
        se.user = std::wstring(winrt::to_hstring(r.user));
        se.password = std::wstring(winrt::to_hstring(r.password));
        out.push_back(std::move(se));
    }
    return out;
}

std::optional<CoverBlob> fetchCoverSync(Config const& config, std::wstring_view coverArtId, int sizePx) {
    if (config.server.empty() || coverArtId.empty()) return std::nullopt;
    try {
        const auto sz = std::to_wstring(std::clamp(sizePx, 64, 2048));
        std::stop_source unused;
        const auto body = requestBody(config, L"getCoverArt", {{L"id", coverArtId}, {L"size", sz}}, unused.get_token(), maxCoverSize);
        const auto suffix = coverSuffix(body);
        if (suffix.empty()) return std::nullopt;
        CoverBlob blob;
        blob.bytes.assign(body.begin(), body.end());
        blob.suffix = suffix;
        return blob;
    } catch (...) {
        return std::nullopt;
    }
}

struct Client::State {
    mutable std::mutex mutex;
    std::condition_variable_any event;
    Config config;
    std::deque<Work> waiting;
    std::deque<Result> finished;
    std::uint64_t nextId = 1, generation = 0;
    std::jthread worker;

    void start() {
        if (worker.joinable()) return;
        worker = std::jthread([this](std::stop_token stop) {
            try { winrt::init_apartment(winrt::apartment_type::multi_threaded); }
            catch (...) { return; }
            while (!stop.stop_requested()) {
                Work work;
                Config connection;
                {
                    std::unique_lock lock(mutex);
                    if (!event.wait(lock, stop, [&] { return !waiting.empty(); })) break;
                    work = std::move(waiting.front());
                    waiting.pop_front();
                    connection = work.draft ? *work.draft : config;
                }
                auto result = perform(work, connection, stop);
                std::lock_guard lock(mutex);
                if (work.generation == generation && !stop.stop_requested()) finished.push_back(std::move(result));
            }
            winrt::uninit_apartment();
        });
    }

    std::uint64_t enqueue(Work work) {
        std::lock_guard lock(mutex);
        if (waiting.size() + finished.size() >= 64) return 0;
        if (work.action == Action::Search || work.action == Action::SearchAll ||
            work.action == Action::Lyrics || work.action == Action::Playlist) {
            std::erase_if(waiting, [&](auto const& pending) { return pending.action == work.action; });
        }
        work.requestId = nextId++;
        work.generation = generation;
        auto result = work.requestId;
        waiting.push_back(std::move(work));
        start();
        event.notify_one();
        return result;
    }
};

Client::Client() : state_(std::make_unique<State>()) {}
Client::~Client() = default;

bool Client::configure(Config config) {
    if (!normalize(config)) return false;
    std::lock_guard lock(state_->mutex);
    state_->config = std::move(config);
    ++state_->generation;
    state_->waiting.clear();
    state_->finished.clear();
    return true;
}

Config Client::configuration() const {
    std::lock_guard lock(state_->mutex);
    return state_->config;
}

std::uint64_t Client::request(Action action, std::wstring id, std::wstring text, std::wstring songId, int index) {
    if (!argumentsPresent(action, id, text, songId)) return 0;
    Work w;
    w.action = action;
    w.id = std::move(id);
    w.query = std::move(text);
    w.songId = std::move(songId);
    w.index = index;
    return state_->enqueue(std::move(w));
}

std::uint64_t Client::requestAlbumList(std::wstring tabType, int size, int offset) {
    Work w;
    w.action = Action::AlbumList;
    w.query = std::move(tabType);
    w.extra = size;
    w.index = offset;
    return state_->enqueue(std::move(w));
}

std::uint64_t Client::requestStar(bool star, std::wstring kind, std::wstring targetId) {
    if (targetId.empty()) return 0;
    Work w;
    w.action = star ? Action::Star : Action::Unstar;
    w.query = std::move(kind);
    w.id = std::move(targetId);
    return state_->enqueue(std::move(w));
}

std::uint64_t Client::requestScrobble(std::wstring songId, std::int64_t timeMs) {
    if (songId.empty()) return 0;
    Work w;
    w.action = Action::Scrobble;
    w.id = std::move(songId);
    w.timeMs = timeMs;
    return state_->enqueue(std::move(w));
}

std::uint64_t Client::requestSyncPlaylist(std::wstring name, std::vector<SyncTrackSpec> specs) {
    if (name.empty()) return 0;
    Work w;
    w.action = Action::SyncLocalPlaylist;
    w.query = std::move(name);
    w.syncSpecs = std::move(specs);
    return state_->enqueue(std::move(w));
}

std::uint64_t Client::requestPing(Config draft) {
    if (!normalize(draft) || draft.server.empty()) return 0;
    Work work;
    work.draft = std::move(draft);
    return state_->enqueue(std::move(work));
}

std::optional<Result> Client::poll() {
    std::lock_guard lock(state_->mutex);
    if (state_->finished.empty()) return {};
    auto result = std::move(state_->finished.front());
    state_->finished.pop_front();
    return result;
}

std::wstring Client::streamUrl(std::wstring_view songId) const {
    try {
        return makeStreamUrl(configuration(), songId);
    } catch (...) { return {}; }
}

std::wstring Client::streamUrl(std::wstring_view songId, Config const& expected) const {
    try {
        auto config = configuration();
        if (config.server != expected.server || config.user != expected.user || config.password != expected.password) return {};
        return makeStreamUrl(config, songId);
    } catch (...) { return {}; }
}

std::wstring Client::streamUrl(std::wstring_view songId, std::wstring_view expectedServer, std::wstring_view expectedUser) const {
    try {
        auto config = configuration();
        if (config.server != expectedServer || config.user != expectedUser) return {};
        return makeStreamUrl(config, songId);
    } catch (...) { return {}; }
}

std::wstring Client::songIdFromUrl(std::wstring_view value) const {
    const auto rest = value.find(L"/rest/stream");
    const auto queryStart = value.find(L'?');
    if (rest == value.npos || queryStart == value.npos) return {};
    auto base = value.substr(0, rest);
    const auto config = configuration();
    if (base != config.server) return {};
    std::wstring_view qs = value.substr(queryStart + 1);
    while (!qs.empty()) {
        const auto amp = qs.find(L'&');
        const auto param = qs.substr(0, amp);
        if (param.starts_with(L"id=")) return decode(param.substr(3));
        if (amp == qs.npos) break;
        qs.remove_prefix(amp + 1);
    }
    return {};
}

} // namespace pola::nav
