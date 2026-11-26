#include "../navidrome_pure.hpp"

#include <cassert>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

using namespace pola::nav::pure;

namespace {

void appendVarint(std::vector<unsigned char>& dst, std::uint64_t v) {
    if (v <= 0x7f) {
        dst.push_back(static_cast<unsigned char>(v));
        return;
    }
    unsigned char buf[9]{};
    int len = 0;
    while (v > 0 && len < 8) {
        buf[len++] = static_cast<unsigned char>(v & 0x7f);
        v >>= 7;
    }
    for (int i = len - 1; i >= 0; --i) {
        dst.push_back(static_cast<unsigned char>(buf[i] | (i > 0 ? 0x80 : 0)));
    }
}

std::vector<unsigned char> buildRecord(std::vector<std::pair<bool, std::string>> const& fields, std::int64_t intVal = 0) {
    // Only supports string fields or single integer field when isStr == false.
    std::vector<unsigned char> hdr;
    std::vector<unsigned char> body;
    std::vector<unsigned char> types;
    for (auto const& f : fields) {
        if (f.first) {
            const std::uint64_t t = 13 + 2 * f.second.size();
            appendVarint(types, t);
            body.insert(body.end(), f.second.begin(), f.second.end());
        } else {
            if (intVal == 0 || intVal == 1) {
                appendVarint(types, static_cast<std::uint64_t>(8 + intVal));
            } else {
                appendVarint(types, 1);
                body.push_back(static_cast<unsigned char>(intVal & 0xff));
            }
        }
    }
    // Header size includes its own varint (1 byte here).
    hdr.push_back(static_cast<unsigned char>(1 + types.size()));
    hdr.insert(hdr.end(), types.begin(), types.end());
    hdr.insert(hdr.end(), body.begin(), body.end());
    return hdr;
}

std::vector<unsigned char> makeSyntheticConfigSqlite(std::vector<std::pair<std::string, std::string>> const& kv) {
    constexpr std::uint32_t pageSize = 1024;
    std::vector<unsigned char> db(pageSize * 2, 0);

    // 100-byte SQLite header on page 1
    std::memcpy(db.data(), "SQLite format 3\0", 16);
    db[16] = static_cast<unsigned char>((pageSize >> 8) & 0xff);
    db[17] = static_cast<unsigned char>(pageSize & 0xff);
    db[18] = 1; db[19] = 1; db[20] = 0; // usable = 1024
    db[56] = 0; db[57] = 0; db[58] = 0; db[59] = 1; // UTF-8 encoding = 1

    // Page 1 B-tree leaf table header at offset 100
    auto recMaster = buildRecord({
        {true, "table"},
        {true, "configStrings"},
        {true, "configStrings"},
        {false, ""}, // rootpage = 2
        {true, "CREATE TABLE configStrings(name TEXT PRIMARY KEY, value TEXT)"}
    }, 2);

    std::size_t cellOff = pageSize - (recMaster.size() + 2);
    {
        std::vector<unsigned char> cell;
        appendVarint(cell, recMaster.size());
        appendVarint(cell, 1); // rowid = 1
        cell.insert(cell.end(), recMaster.begin(), recMaster.end());
        cellOff = pageSize - cell.size();
        std::memcpy(db.data() + cellOff, cell.data(), cell.size());
    }
    db[100] = 13; // leaf table page
    db[103] = 0; db[104] = 1; // 1 cell
    db[108] = static_cast<unsigned char>((cellOff >> 8) & 0xff);
    db[109] = static_cast<unsigned char>(cellOff & 0xff);

    // Page 2 leaf table with KV entries
    const std::size_t p2 = pageSize;
    db[p2 + 0] = 13; // leaf table
    db[p2 + 3] = static_cast<unsigned char>((kv.size() >> 8) & 0xff);
    db[p2 + 4] = static_cast<unsigned char>(kv.size() & 0xff);
    std::size_t cursor = pageSize * 2;
    for (std::size_t i = 0; i < kv.size(); ++i) {
        auto rec = buildRecord({{true, kv[i].first}, {true, kv[i].second}});
        std::vector<unsigned char> cell;
        appendVarint(cell, rec.size());
        appendVarint(cell, static_cast<std::uint64_t>(i + 1));
        cell.insert(cell.end(), rec.begin(), rec.end());
        cursor -= cell.size();
        std::memcpy(db.data() + cursor, cell.data(), cell.size());
        const std::size_t rel = cursor - p2;
        db[p2 + 8 + i * 2] = static_cast<unsigned char>((rel >> 8) & 0xff);
        db[p2 + 8 + i * 2 + 1] = static_cast<unsigned char>(rel & 0xff);
    }
    return db;
}

void testFooServerList() {
    assert(stripTrailingSlash("https://music.example.com/rest/") == "https://music.example.com");
    assert(stripTrailingSlash("  http://nas:4533///  ") == "http://nas:4533");

    const std::string raw =
        "name=Home+Nas&url=https%3A%2F%2Fhome.local%2Frest%2F&user=alice&pass=s%40cret\n"
        "url=ftp://ignored&user=bad\n"
        "name=&url=http://192.168.1.10:4533/&user=bob&pass=p%20w";
    auto list = parseFooServerList(raw);
    assert(list.size() == 2);
    assert(list[0].name == "Home Nas");
    assert(list[0].url == "https://home.local");
    assert(list[0].user == "alice");
    assert(list[0].password == "s@cret");
    assert(list[1].name == "http://192.168.1.10:4533");
    assert(list[1].user == "bob");
    assert(list[1].password == "p w");

    auto fb = parseFooServerList("", "https://fb.local/rest/", "spector", "1234");
    assert(fb.size() == 1);
    assert(fb[0].url == "https://fb.local");
    assert(fb[0].user == "spector");
    assert(fb[0].password == "1234");
}

void testScrobbleThreshold() {
    assert(!shouldScrobble(4.9, 100.0));
    assert(shouldScrobble(5.0, 8.0));
    assert(!shouldScrobble(49.0, 100.0));
    assert(shouldScrobble(50.0, 100.0));
    // Long track capped at 240s
    assert(!shouldScrobble(239.0, 700.0));
    assert(shouldScrobble(240.0, 700.0));
    // Unknown duration uses 30s
    assert(!shouldScrobble(29.0, 0.0));
    assert(shouldScrobble(30.0, 0.0));
}

void testSqliteExtractor() {
    auto db = makeSyntheticConfigSqlite({
        {"cfg_var.OTHER", "skip"},
        {"cfg_var.A1B2C3D4-1111-2222-AABB-CCDDEEFF011B", "name=Office&url=https%3A%2F%2Fnav.work&user=ed&pass=pw"},
        {"cfg_var.A1B2C3D4-1111-2222-AABB-CCDDEEFF0101", "https://fallback.url"}
    });
    auto found = extractSqliteConfigStrings(db, {
        "cfg_var.A1B2C3D4-1111-2222-AABB-CCDDEEFF011B",
        "cfg_var.A1B2C3D4-1111-2222-AABB-CCDDEEFF0101",
        "cfg_var.MISSING"
    });
    assert(found.size() == 2);
    assert(found["cfg_var.A1B2C3D4-1111-2222-AABB-CCDDEEFF0101"] == "https://fallback.url");
    auto parsed = parseFooServerList(found["cfg_var.A1B2C3D4-1111-2222-AABB-CCDDEEFF011B"]);
    assert(parsed.size() == 1);
    assert(parsed[0].name == "Office");
    assert(parsed[0].url == "https://nav.work");
    assert(parsed[0].user == "ed");
    assert(parsed[0].password == "pw");
}

} // namespace

int main() {
    testFooServerList();
    testScrobbleThreshold();
    testSqliteExtractor();
    std::cout << "navidrome_parser.test passed!" << std::endl;
    return 0;
}
