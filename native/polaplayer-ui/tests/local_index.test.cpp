#include "local_index_pure.hpp"
#include <cassert>
#include <iostream>

using namespace pola::index;

int main() {
    // 1. lowerAscii & trimView
    assert(lowerAscii("AbC-123_XYZ") == "abc-123_xyz");
    assert(trimView("  hello \t\n") == "hello");

    // 2. extractYear4 & parseIntPrefix
    assert(extractYear4("2024-05-19") == "2024");
    assert(extractYear4("Released in 1998.") == "1998");
    assert(extractYear4("99") == "");
    assert(parseIntPrefix("03/12") == 3);
    assert(parseIntPrefix(" 14 ") == 14);
    assert(parseIntPrefix("abc") == 0);

    // 3. isLovedTagValue (default + explicit match)
    assert(isLovedTagValue("1"));
    assert(isLovedTagValue("true"));
    assert(isLovedTagValue("yes"));
    assert(!isLovedTagValue(""));
    assert(!isLovedTagValue("?"));
    assert(!isLovedTagValue("0"));
    assert(!isLovedTagValue("false"));
    assert(!isLovedTagValue("FALSE"));
    assert(isLovedTagValue("Heart", "heart"));
    assert(!isLovedTagValue("1", "heart"));

    // 4. parseTimestampMs
    const auto ts1 = parseTimestampMs("2025-11-20 14:30:05");
    const auto ts2 = parseTimestampMs("2025-11-20");
    assert(ts1 > ts2);
    assert(ts2 > 0);
    assert(parseTimestampMs("?") == 0);
    assert(parseTimestampMs("") == 0);

    // 5. StatsStore JSON serialize / deserialize roundtrip
    StatsStore store;
    store.importedPlaycount = true;
    store.tracks["c:\\music\\a\\track \"1\".flac"] = {7, 1763649000123LL};
    store.albums["Artist \\ Name - Album"] = {15, 1763649005000LL};

    const std::string encoded = store.serialize();
    StatsStore decoded;
    assert(StatsStore::deserialize(encoded, decoded));
    assert(decoded.importedPlaycount == true);
    assert(decoded.tracks.at("c:\\music\\a\\track \"1\".flac").count == 7);
    assert(decoded.tracks.at("c:\\music\\a\\track \"1\".flac").lastPlayed == 1763649000123LL);
    assert(decoded.albums.at("Artist \\ Name - Album").count == 15);
    assert(decoded.albums.at("Artist \\ Name - Album").lastPlayed == 1763649005000LL);

    std::cout << "local_index.test passed!" << std::endl;
    return 0;
}
