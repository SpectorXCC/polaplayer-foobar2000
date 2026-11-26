#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace pola {
constexpr std::size_t lyricsTextLimit = 256 * 1024;
constexpr std::size_t lyricsLineLimit = 4096;

struct LyricLine {
    std::int64_t timeMs = 0;
    std::wstring text;
};

struct Lyrics {
    bool synced = false;
    std::vector<LyricLine> lines;
};

inline std::wstring_view trimLyric(std::wstring_view text) {
    constexpr std::wstring_view space = L" \t\r\n";
    const auto first = text.find_first_not_of(space);
    if (first == text.npos) return {};
    return text.substr(first, text.find_last_not_of(space) - first + 1);
}

inline std::optional<unsigned> lyricNumber(std::wstring_view text, std::size_t maxDigits) {
    if (text.empty() || text.size() > maxDigits) return std::nullopt;
    unsigned number = 0;
    for (auto ch : text) {
        if (ch < L'0' || ch > L'9') return std::nullopt;
        number = 10 * number + (ch - L'0');
    }
    return number;
}

inline std::optional<std::int64_t> lrcTimestamp(std::wstring_view tag) {
    const auto colon = tag.find(L':');
    if (colon == tag.npos) return std::nullopt;
    const auto minutes = lyricNumber(tag.substr(0, colon), 4);
    auto secondsText = tag.substr(colon + 1);
    const auto separator = secondsText.find_first_of(L".:");
    const auto seconds = lyricNumber(secondsText.substr(0, separator), 2);
    if (!minutes || !seconds || *seconds >= 60) return std::nullopt;
    unsigned millis = 0;
    if (separator != secondsText.npos) {
        const auto fraction = secondsText.substr(separator + 1);
        const auto value = lyricNumber(fraction, 3);
        if (!value) return std::nullopt;
        constexpr unsigned multiples[] = {100, 10, 1};
        millis = *value * multiples[fraction.size() - 1];
    }
    return (std::int64_t(*minutes) * 60 + *seconds) * 1000 + millis;
}

inline std::optional<std::int64_t> lrcOffset(std::wstring_view tag) {
    if (!tag.starts_with(L"offset:")) return std::nullopt;
    auto value = trimLyric(tag.substr(7));
    const bool negative = value.starts_with(L'-');
    if (negative || value.starts_with(L'+')) value.remove_prefix(1);
    const auto magnitude = lyricNumber(value, 8);
    if (!magnitude) return std::nullopt;
    return negative ? -std::int64_t(*magnitude) : std::int64_t(*magnitude);
}

inline bool lrcMetadata(std::wstring_view tag) {
    const auto name = tag.substr(0, tag.find(L':'));
    return name != tag && (name == L"ar" || name == L"al" || name == L"ti" ||
        name == L"au" || name == L"by" || name == L"length" || name == L"re" ||
        name == L"ve" || name == L"offset");
}

inline Lyrics parseLocalLyrics(std::wstring_view text) {
    Lyrics timed{true, {}}, plain;
    if (text.size() > lyricsTextLimit) return plain;
    if (text.starts_with(L'\uFEFF')) text.remove_prefix(1);
    std::int64_t offset = 0;
    std::size_t expandedTextSize = 0;
    std::vector<std::int64_t> times;
    while (!text.empty() && timed.lines.size() < lyricsLineLimit && plain.lines.size() < lyricsLineLimit) {
        const auto end = text.find_first_of(L"\n\r");
        auto line = trimLyric(text.substr(0, end));
        text = end == text.npos ? std::wstring_view{} : text.substr(end + 1);
        if (line.empty()) continue;

        times.clear();
        bool metadata = false;
        while (line.starts_with(L'[') && timed.lines.size() + times.size() < lyricsLineLimit) {
            const auto close = line.find(L']');
            if (close == line.npos) break;
            const auto tag = trimLyric(line.substr(1, close - 1));
            if (auto time = lrcTimestamp(tag)) {
                times.push_back(*time);
            } else if (times.empty() && lrcMetadata(tag)) {
                if (auto value = lrcOffset(tag)) offset = *value;
                metadata = true;
            } else {
                break;
            }
            line = trimLyric(line.substr(close + 1));
        }
        for (auto time : times) {
            if (line.size() > lyricsTextLimit - expandedTextSize) break;
            timed.lines.push_back({time, std::wstring(line)});
            expandedTextSize += line.size();
        }
        if (times.empty() && !metadata && !line.empty()) plain.lines.push_back({0, std::wstring(line)});
    }
    if (timed.lines.empty() || std::none_of(timed.lines.begin(), timed.lines.end(),
            [](const auto& line) { return !line.text.empty(); })) return plain;
    for (auto& line : timed.lines) line.timeMs = std::max<std::int64_t>(0, line.timeMs - offset);
    std::stable_sort(timed.lines.begin(), timed.lines.end(),
        [](const auto& left, const auto& right) { return left.timeMs < right.timeMs; });
    return timed;
}
}
