#pragma once

#include <foobar2000/SDK/foobar2000.h>
#include "navidrome_native.hpp"
#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace pola {

class ArtServer {
public:
    ArtServer();
    ~ArtServer();
    ArtServer(ArtServer const&) = delete;
    ArtServer& operator=(ArtServer const&) = delete;

    void initialize(HWND notifyHwnd, UINT notifyMsg, std::filesystem::path cacheDir);
    void shutdown();

    void setNavConfig(nav::Config const& config);

    // Registers handles on the main thread so worker threads can serve art on demand.
    std::string registerTrack(metadb_handle_ptr const& track);
    void registerPlaylistCandidates(std::string const& playlistId, std::uint64_t revision, std::vector<metadb_handle_ptr> candidates);
    void registerArtistCandidates(std::string const& artistKey, std::uint64_t revision, std::vector<metadb_handle_ptr> candidates);
    void registerLibraryCandidates(std::uint64_t revision, std::vector<metadb_handle_ptr> candidates);

    // URL builders exposed to frontend metadata payloads.
    static std::string trackArtUrl(std::string const& hash, int sizePx = 400);
    static std::string playlistArtUrl(std::string const& playlistId, std::uint64_t revision, int sizePx = 400);
    static std::string artistArtUrl(std::string const& artistKey, std::uint64_t revision, int sizePx = 360);
    static std::string libraryArtUrl(std::uint64_t revision, int sizePx = 400);
    static std::string navArtUrl(std::wstring const& serverKeyHex, std::wstring const& coverId, int sizePx = 500);

    // Returns cached "#rrggbb" dominant hue if already computed.
    std::string cachedHue(std::string const& artKey) const;

    // Drains ready hue notifications { key, hue } discovered during background decoding.
    struct HueEvent {
        std::string key;
        std::string hue;
    };
    std::vector<HueEvent> drainHues();

    // Must be called on the UI STA thread when notifyMsg is received.
    void flushCompletedResponses();

    // WebView2 WvResourceHandlerFn hook.
    static bool handleWebResource(void* ctx, const wchar_t* uri, void* envPtr, void* argsPtr);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace pola
