#pragma once

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <ctime>
#include <sstream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace pola::index {

inline std::string lowerAscii(std::string_view input) {
    std::string out(input);
    for (char& ch : out) {
        if (ch >= 'A' && ch <= 'Z') ch = static_cast<char>(ch + ('a' - 'A'));
    }
    return out;
}

inline std::string trimView(std::string_view s) {
    while (!s.empty() && static_cast<unsigned char>(s.front()) <= ' ') s.remove_prefix(1);
    while (!s.empty() && static_cast<unsigned char>(s.back()) <= ' ') s.remove_suffix(1);
    return std::string(s);
}

inline std::string extractYear4(std::string_view s) {
    int run = 0;
    std::size_t start = 0;
    for (std::size_t i = 0; i < s.size(); ++i) {
        if (s[i] >= '0' && s[i] <= '9') {
            if (run == 0) start = i;
            ++run;
            if (run == 4) return std::string(s.substr(start, 4));
        } else {
            run = 0;
        }
    }
    return {};
}

inline int parseIntPrefix(std::string_view s) {
    int val = 0;
    bool seen = false;
    for (char ch : s) {
        if (ch >= '0' && ch <= '9') {
            seen = true;
            val = val * 10 + (ch - '0');
            if (val > 100000) break;
        } else if (seen) {
            break;
        } else if (ch != ' ' && ch != '\t') {
            break;
        }
    }
    return seen ? val : 0;
}

inline bool isLovedTagValue(std::string_view raw, std::string_view matchValue = {}) {
    const auto trimmed = trimView(raw);
    if (trimmed.empty() || trimmed == "?") return false;
    if (!matchValue.empty()) {
        return lowerAscii(trimmed) == lowerAscii(matchValue);
    }
    const auto low = lowerAscii(trimmed);
    return low != "0" && low != "false";
}

inline std::int64_t parseTimestampMs(std::string_view raw) {
    const auto s = trimView(raw);
    if (s.empty() || s == "?") return 0;
    if (s.size() >= 10 &&
        s[4] == '-' && s[7] == '-' &&
        std::isdigit(static_cast<unsigned char>(s[0])) &&
        std::isdigit(static_cast<unsigned char>(s[1])) &&
        std::isdigit(static_cast<unsigned char>(s[2])) &&
        std::isdigit(static_cast<unsigned char>(s[3]))) {
        auto two = [&](std::size_t off) -> int {
            if (off + 2 > s.size()) return 0;
            if (!std::isdigit(static_cast<unsigned char>(s[off])) || !std::isdigit(static_cast<unsigned char>(s[off + 1]))) return 0;
            return (s[off] - '0') * 10 + (s[off + 1] - '0');
        };
        int year = (s[0] - '0') * 1000 + (s[1] - '0') * 100 + (s[2] - '0') * 10 + (s[3] - '0');
        int mon = two(5);
        int day = two(8);
        int hr = (s.size() >= 13 && (s[10] == ' ' || s[10] == 'T')) ? two(11) : 0;
        int min = (s.size() >= 16 && s[13] == ':') ? two(14) : 0;
        int sec = (s.size() >= 19 && s[16] == ':') ? two(17) : 0;
        if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
            std::tm tm{};
            tm.tm_year = year - 1900;
            tm.tm_mon = mon - 1;
            tm.tm_mday = day;
            tm.tm_hour = hr;
            tm.tm_min = min;
            tm.tm_sec = sec;
            tm.tm_isdst = -1;
            std::time_t tt = std::mktime(&tm);
            if (tt > 0) return static_cast<std::int64_t>(tt) * 1000;
        }
    }
    return 0;
}

inline std::int64_t currentEpochMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

struct PlayStat {
    std::int64_t count = 0;
    std::int64_t lastPlayed = 0;
};

struct StatsStore {
    bool importedPlaycount = false;
    std::unordered_map<std::string, PlayStat> tracks;
    std::unordered_map<std::string, PlayStat> albums;

    static void appendEscaped(std::string& out, std::string_view s) {
        out.push_back('"');
        for (unsigned char c : s) {
            switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char buf[7];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out.push_back(static_cast<char>(c));
                }
            }
        }
        out.push_back('"');
    }

    std::string serialize() const {
        std::string out;
        out.reserve(64 + (tracks.size() + albums.size()) * 64);
        out += "{\"version\":1,\"importedPlaycount\":";
        out += (importedPlaycount ? "true" : "false");
        auto writeMap = [&](const char* key, std::unordered_map<std::string, PlayStat> const& map) {
            out += ",\"";
            out += key;
            out += "\":{";
            bool first = true;
            for (auto const& [k, v] : map) {
                if (!first) out.push_back(',');
                first = false;
                appendEscaped(out, k);
                out += ":{\"count\":";
                out += std::to_string(v.count);
                out += ",\"lastPlayed\":";
                out += std::to_string(v.lastPlayed);
                out.push_back('}');
            }
            out.push_back('}');
        };
        writeMap("tracks", tracks);
        writeMap("albums", albums);
        out.push_back('}');
        return out;
    }

    static bool deserialize(std::string_view json, StatsStore& outStore) {
        std::size_t pos = 0;
        auto skipWs = [&] {
            while (pos < json.size() && static_cast<unsigned char>(json[pos]) <= ' ') ++pos;
        };
        auto consume = [&](char ch) -> bool {
            skipWs();
            if (pos < json.size() && json[pos] == ch) { ++pos; return true; }
            return false;
        };
        auto readString = [&](std::string& s) -> bool {
            skipWs();
            if (pos >= json.size() || json[pos] != '"') return false;
            ++pos;
            s.clear();
            while (pos < json.size()) {
                char c = json[pos++];
                if (c == '"') return true;
                if (c == '\\') {
                    if (pos >= json.size()) return false;
                    char esc = json[pos++];
                    switch (esc) {
                    case '"': case '\\': case '/': s.push_back(esc); break;
                    case 'b': s.push_back('\b'); break;
                    case 'f': s.push_back('\f'); break;
                    case 'n': s.push_back('\n'); break;
                    case 'r': s.push_back('\r'); break;
                    case 't': s.push_back('\t'); break;
                    case 'u':
                        if (pos + 4 <= json.size()) {
                            unsigned code = 0;
                            for (int i = 0; i < 4; ++i) {
                                char h = json[pos + i];
                                code <<= 4;
                                if (h >= '0' && h <= '9') code |= static_cast<unsigned>(h - '0');
                                else if (h >= 'a' && h <= 'f') code |= static_cast<unsigned>(h - 'a' + 10);
                                else if (h >= 'A' && h <= 'F') code |= static_cast<unsigned>(h - 'A' + 10);
                            }
                            pos += 4;
                            if (code < 0x80) s.push_back(static_cast<char>(code));
                        }
                        break;
                    default: s.push_back(esc); break;
                    }
                } else {
                    s.push_back(c);
                }
            }
            return false;
        };
        auto readInt = [&](std::int64_t& val) -> bool {
            skipWs();
            bool neg = false;
            if (pos < json.size() && json[pos] == '-') { neg = true; ++pos; }
            if (pos >= json.size() || !std::isdigit(static_cast<unsigned char>(json[pos]))) return false;
            std::int64_t acc = 0;
            while (pos < json.size() && std::isdigit(static_cast<unsigned char>(json[pos]))) {
                acc = acc * 10 + (json[pos++] - '0');
            }
            if (pos < json.size() && json[pos] == '.') {
                ++pos;
                while (pos < json.size() && std::isdigit(static_cast<unsigned char>(json[pos]))) ++pos;
            }
            val = neg ? -acc : acc;
            return true;
        };
        auto skipValue = [&](auto& self) -> bool {
            skipWs();
            if (pos >= json.size()) return false;
            char c = json[pos];
            if (c == '"') { std::string dummy; return readString(dummy); }
            if (c == '{') {
                ++pos;
                if (consume('}')) return true;
                while (true) {
                    std::string k;
                    if (!readString(k) || !consume(':') || !self(self)) return false;
                    if (consume('}')) return true;
                    if (!consume(',')) return false;
                }
            }
            if (c == '[') {
                ++pos;
                if (consume(']')) return true;
                while (true) {
                    if (!self(self)) return false;
                    if (consume(']')) return true;
                    if (!consume(',')) return false;
                }
            }
            while (pos < json.size() && json[pos] != ',' && json[pos] != '}' && json[pos] != ']') ++pos;
            return true;
        };
        auto readStatMap = [&](std::unordered_map<std::string, PlayStat>& dst) -> bool {
            if (!consume('{')) return false;
            if (consume('}')) return true;
            while (true) {
                std::string mapKey;
                if (!readString(mapKey) || !consume(':') || !consume('{')) return false;
                PlayStat st{};
                if (!consume('}')) {
                    while (true) {
                        std::string fk;
                        if (!readString(fk) || !consume(':')) return false;
                        if (fk == "count") { if (!readInt(st.count)) return false; }
                        else if (fk == "lastPlayed") { if (!readInt(st.lastPlayed)) return false; }
                        else { if (!skipValue(skipValue)) return false; }
                        if (consume('}')) break;
                        if (!consume(',')) return false;
                    }
                }
                if (!mapKey.empty()) dst[std::move(mapKey)] = st;
                if (consume('}')) return true;
                if (!consume(',')) return false;
            }
        };

        outStore = StatsStore{};
        if (!consume('{')) return false;
        if (consume('}')) return true;
        while (true) {
            std::string rootKey;
            if (!readString(rootKey) || !consume(':')) return false;
            if (rootKey == "importedPlaycount") {
                skipWs();
                if (json.substr(pos, 4) == "true") { outStore.importedPlaycount = true; pos += 4; }
                else if (json.substr(pos, 5) == "false") { outStore.importedPlaycount = false; pos += 5; }
                else return false;
            } else if (rootKey == "tracks") {
                if (!readStatMap(outStore.tracks)) return false;
            } else if (rootKey == "albums") {
                if (!readStatMap(outStore.albums)) return false;
            } else {
                if (!skipValue(skipValue)) return false;
            }
            if (consume('}')) return true;
            if (!consume(',')) return false;
        }
    }
};

} // namespace pola::index
