#include "../local_lyrics.hpp"

#include <cassert>

int main() {
    const auto timed = pola::parseLocalLyrics(
        L"\uFEFF[ar:Artist]\r\n[00:42.125]\n[00:01.10][01:01.2]第一句\n"
        L"[00:01.10]First line\n[00:00.010]开场\n[offset:+50]\n");
    assert(timed.synced && timed.lines.size() == 5);
    assert(timed.lines[0].timeMs == 0 && timed.lines[0].text == L"开场");
    assert(timed.lines[1].timeMs == 1050 && timed.lines[1].text == L"第一句");
    assert(timed.lines[2].timeMs == 1050 && timed.lines[2].text == L"First line");
    assert(timed.lines[3].timeMs == 42075 && timed.lines[3].text.empty());
    assert(timed.lines[4].timeMs == 61150 && timed.lines[4].text == L"第一句");

    const auto shifted = pola::parseLocalLyrics(L"[00:01:25]line\n[offset:-75]");
    assert(shifted.synced && shifted.lines.front().timeMs == 1325);

    const auto plain = pola::parseLocalLyrics(L"[ti:Ignored]\n第一句\n\nNext line\r[Chorus: repeat]");
    assert(!plain.synced && plain.lines.size() == 3);
    assert(plain.lines[0].text == L"第一句" && plain.lines[2].text == L"[Chorus: repeat]");
    assert(!pola::lrcTimestamp(L"00:60.00") && !pola::lrcTimestamp(L"00:10.1234"));
    assert(!pola::parseLocalLyrics(L"[00:30]").synced);
    assert(pola::parseLocalLyrics(std::wstring(pola::lyricsTextLimit + 1, L'a')).lines.empty());

    std::wstring repeated;
    for (unsigned i = 0; i < 50; ++i) repeated += L"[00:00.01]";
    repeated.append(pola::lyricsTextLimit / 4, L'a');
    const auto bounded = pola::parseLocalLyrics(repeated);
    assert(bounded.synced && bounded.lines.size() == 4);
}
