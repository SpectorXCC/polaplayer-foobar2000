#pragma once

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstring>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace pola::nav::pure {

struct FooServerRecord {
    std::string name;
    std::string url;
    std::string user;
    std::string password;
};

inline std::string trimAscii(std::string_view s) {
    while (!s.empty() && static_cast<unsigned char>(s.front()) <= ' ') s.remove_prefix(1);
    while (!s.empty() && static_cast<unsigned char>(s.back()) <= ' ') s.remove_suffix(1);
    return std::string(s);
}

inline std::string decodeQueryVal(std::string_view raw) {
    std::string out;
    out.reserve(raw.size());
    auto hex = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    };
    for (std::size_t i = 0; i < raw.size(); ++i) {
        if (raw[i] == '%' && i + 2 < raw.size()) {
            int hi = hex(raw[i + 1]);
            int lo = hex(raw[i + 2]);
            if (hi >= 0 && lo >= 0) {
                out.push_back(static_cast<char>((hi << 4) | lo));
                i += 2;
                continue;
            }
        }
        out.push_back(raw[i] == '+' ? ' ' : raw[i]);
    }
    return out;
}

inline std::unordered_map<std::string, std::string> parseQueryString(std::string_view qs) {
    std::unordered_map<std::string, std::string> out;
    while (!qs.empty()) {
        const auto amp = qs.find('&');
        const auto seg = qs.substr(0, amp);
        const auto eq = seg.find('=');
        if (eq != seg.npos && eq > 0) {
            auto k = trimAscii(decodeQueryVal(seg.substr(0, eq)));
            if (!k.empty()) out[k] = decodeQueryVal(seg.substr(eq + 1));
        }
        if (amp == qs.npos) break;
        qs.remove_prefix(amp + 1);
    }
    return out;
}

inline std::string stripTrailingSlash(std::string url) {
    url = trimAscii(url);
    while (!url.empty() && url.back() == '/') url.pop_back();
    if (url.ends_with("/rest")) url.resize(url.size() - 5);
    while (!url.empty() && url.back() == '/') url.pop_back();
    return url;
}

inline bool isHttpUrl(std::string_view url) {
    if (url.size() < 8) return false;
    auto hasPrefix = [&](std::string_view p) {
        if (url.size() < p.size()) return false;
        for (std::size_t i = 0; i < p.size(); ++i) {
            char a = static_cast<char>(std::tolower(static_cast<unsigned char>(url[i])));
            if (a != p[i]) return false;
        }
        return true;
    };
    return hasPrefix("http://") || hasPrefix("https://");
}

inline std::vector<FooServerRecord> parseFooServerList(
    std::string_view rawList,
    std::string_view fallbackUrl = {},
    std::string_view fallbackUser = {},
    std::string_view fallbackPass = {}) {
    std::vector<FooServerRecord> out;
    std::size_t pos = 0;
    while (pos <= rawList.size()) {
        auto nl = rawList.find('\n', pos);
        auto line = trimAscii(rawList.substr(pos, nl == rawList.npos ? nl : nl - pos));
        if (!line.empty()) {
            auto row = parseQueryString(line);
            auto url = stripTrailingSlash(row["url"]);
            auto user = trimAscii(row["user"]);
            if (isHttpUrl(url) && !user.empty()) {
                FooServerRecord rec;
                rec.name = trimAscii(row["name"]);
                if (rec.name.empty()) rec.name = url;
                rec.url = std::move(url);
                rec.user = std::move(user);
                rec.password = row["pass"];
                out.push_back(std::move(rec));
            }
        }
        if (nl == rawList.npos) break;
        pos = nl + 1;
    }

    auto fUrl = stripTrailingSlash(std::string(fallbackUrl));
    auto fUser = trimAscii(fallbackUser);
    if (out.empty() && isHttpUrl(fUrl) && !fUser.empty()) {
        out.push_back({"Default", std::move(fUrl), std::move(fUser), std::string(fallbackPass)});
    }
    return out;
}

// Scrobble once >= min(duration * 0.5, 240s), matching Navidrome/Verdant rules.
inline bool shouldScrobble(double playedSec, double durationSec) {
    if (playedSec < 5.0) return false;
    if (durationSec <= 0.0) return playedSec >= 30.0;
    const double threshold = std::max(5.0, std::min(durationSec * 0.5, 240.0));
    return playedSec >= threshold;
}

// Lightweight read-only SQLite3 B-Tree extractor for configStrings table in foobar2000 config.sqlite.
inline std::unordered_map<std::string, std::string> extractSqliteConfigStrings(
    std::vector<unsigned char> const& b,
    std::vector<std::string> const& wantedKeys) {
    std::unordered_map<std::string, std::string> out;
    if (b.size() < 100 || std::memcmp(b.data(), "SQLite format 3", 15) != 0) return out;

    auto u16 = [&](std::size_t p) -> std::uint32_t {
        return (static_cast<std::uint32_t>(b[p]) << 8) | b[p + 1];
    };
    auto u32 = [&](std::size_t p) -> std::uint32_t {
        return (static_cast<std::uint32_t>(b[p]) << 24) |
            (static_cast<std::uint32_t>(b[p + 1]) << 16) |
            (static_cast<std::uint32_t>(b[p + 2]) << 8) |
            b[p + 3];
    };

    std::uint32_t pageSize = u16(16);
    if (pageSize == 1) pageSize = 65536;
    if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) != 0) return out;
    const std::uint32_t encoding = u32(56);
    if (encoding != 1) return out; // UTF-8 only
    const std::uint32_t usable = pageSize - b[20];
    if (usable < 48) return out;

    struct VintRes { std::uint64_t val = 0; std::size_t next = 0; bool ok = false; };
    auto readVint = [](unsigned char const* buf, std::size_t len, std::size_t p) -> VintRes {
        std::uint64_t n = 0;
        for (int j = 0; j < 9; ++j) {
            if (p + j >= len) return {};
            unsigned char c = buf[p + j];
            n = (j == 8) ? (n * 256 + c) : (n * 128 + (c & 127));
            if (j == 8 || c < 128) return {n, p + j + 1, true};
        }
        return {};
    };

    auto readPayload = [&](std::size_t pos, std::uint64_t n) -> std::vector<unsigned char> {
        if (n > 1000000) return {};
        const std::uint32_t maxLocal = usable - 35;
        const std::uint32_t minLocal = ((usable - 12) * 32 / 255) - 23;
        std::uint32_t local = static_cast<std::uint32_t>(n);
        if (n > maxLocal) {
            local = minLocal + static_cast<std::uint32_t>((n - minLocal) % (usable - 4));
            if (local > maxLocal) local = minLocal;
        }
        if (pos + local > b.size()) return {};
        std::vector<unsigned char> payload(static_cast<std::size_t>(n));
        std::memcpy(payload.data(), b.data() + pos, local);
        std::size_t copied = local;
        std::uint32_t nextPage = (n > local && pos + local + 4 <= b.size()) ? u32(pos + local) : 0;
        std::vector<bool> seenPage;
        int steps = 0;
        while (copied < n && nextPage >= 1 && steps++ < 400) {
            std::size_t start = static_cast<std::size_t>(nextPage - 1) * pageSize;
            std::size_t take = std::min<std::size_t>(n - copied, usable - 4);
            if (start + 4 + take > b.size()) return {};
            std::memcpy(payload.data() + copied, b.data() + start + 4, take);
            copied += take;
            nextPage = u32(start);
        }
        if (copied < n) return {};
        return payload;
    };

    struct ColVal { bool isStr = false; std::string str; std::int64_t num = 0; };
    auto parseRecord = [&](std::vector<unsigned char> const& a) -> std::vector<ColVal> {
        std::vector<ColVal> cols;
        auto h = readVint(a.data(), a.size(), 0);
        if (!h.ok || h.val > a.size()) return cols;
        std::size_t pos = h.next;
        std::vector<std::uint64_t> types;
        while (pos < h.val) {
            auto t = readVint(a.data(), a.size(), pos);
            if (!t.ok) return {};
            types.push_back(t.val);
            pos = t.next;
        }
        pos = static_cast<std::size_t>(h.val);
        for (auto type : types) {
            std::uint64_t size = 0;
            if (type >= 12) size = (type - 12) / 2;
            else if (type == 0 || type == 8 || type == 9) size = 0;
            else if (type >= 1 && type <= 4) size = type;
            else if (type == 5) size = 6;
            else if (type == 6 || type == 7) size = 8;
            else return {};
            if (pos + size > a.size()) return {};
            ColVal cv;
            if (type >= 13 && (type % 2) == 1) {
                cv.isStr = true;
                cv.str.assign(reinterpret_cast<const char*>(a.data() + pos), static_cast<std::size_t>(size));
            } else if (type == 8 || type == 9) {
                cv.num = static_cast<std::int64_t>(type - 8);
            } else if (type > 0 && type < 7) {
                std::int64_t v = 0;
                for (std::size_t k = 0; k < size; ++k) v = (v * 256) + a[pos + k];
                cv.num = v;
            }
            cols.push_back(std::move(cv));
            pos += static_cast<std::size_t>(size);
        }
        return cols;
    };

    auto visitTable = [&](std::uint32_t rootPage, auto visitor) {
        std::vector<std::uint32_t> stack{rootPage};
        std::vector<std::uint32_t> visited;
        int limit = 0;
        while (!stack.empty() && ++limit <= 2000) {
            std::uint32_t page = stack.back();
            stack.pop_back();
            if (page < 1 || std::find(visited.begin(), visited.end(), page) != visited.end()) continue;
            visited.push_back(page);
            std::size_t base = static_cast<std::size_t>(page - 1) * pageSize;
            std::size_t start = base + (page == 1 ? 100 : 0);
            if (start + 12 > b.size()) return;
            unsigned char kind = b[start];
            std::uint32_t count = u16(start + 3);
            std::size_t header = (kind == 5) ? 12 : 8;
            if ((kind != 5 && kind != 13) || count * 2 + header > usable) return;
            if (kind == 5) stack.push_back(u32(start + 8));
            for (std::uint32_t j = 0; j < count; ++j) {
                std::size_t ptr = start + header + j * 2;
                if (ptr + 2 > b.size()) return;
                std::size_t cell = base + u16(ptr);
                if (cell + 4 > b.size()) return;
                if (kind == 5) {
                    stack.push_back(u32(cell));
                    continue;
                }
                auto n = readVint(b.data(), b.size(), cell);
                if (!n.ok) continue;
                auto row = readVint(b.data(), b.size(), n.next);
                if (!row.ok) continue;
                auto pl = readPayload(row.next, n.val);
                if (pl.empty()) continue;
                auto cols = parseRecord(pl);
                if (!visitor(cols)) return;
            }
        }
    };

    std::uint32_t configRoot = 0;
    visitTable(1, [&](std::vector<ColVal> const& cols) -> bool {
        if (cols.size() >= 4 && cols[0].isStr && cols[0].str == "table" && cols[1].str == "configStrings") {
            configRoot = static_cast<std::uint32_t>(cols[3].num);
            return false;
        }
        return true;
    });
    if (configRoot == 0) return out;

    visitTable(configRoot, [&](std::vector<ColVal> const& cols) -> bool {
        if (cols.size() >= 2 && cols[0].isStr) {
            if (std::find(wantedKeys.begin(), wantedKeys.end(), cols[0].str) != wantedKeys.end()) {
                out[cols[0].str] = cols[1].str;
            }
        }
        return true;
    });
    return out;
}

} // namespace pola::nav::pure
