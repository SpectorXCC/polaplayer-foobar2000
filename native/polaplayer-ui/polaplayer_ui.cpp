#include <foobar2000/SDK/foobar2000.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Data.Json.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <unordered_set>
#include <utility>
#include <vector>

#include "webview_host.hpp"
#include "navidrome_native.hpp"
#include "navidrome_pure.hpp"
#include "local_media.hpp"
#include "art_server.hpp"
#include "local_index.hpp"
#include "frameless_chrome.hpp"
#include "drop_target.hpp"
#include "fft_stream.hpp"

DECLARE_COMPONENT_VERSION("PolaPlayer Native UI", "1.0.0", "Spotify-style WebView2 interface backed by foobar2000 SDK services.");
VALIDATE_COMPONENT_FILENAME("foo_ui_polaplayer.dll");

namespace {
using namespace winrt;
using namespace Windows::Data::Json;
namespace fs = std::filesystem;
namespace nv = pola::nav;

constexpr wchar_t windowClass[] = L"PolaPlayerNativeUI";
constexpr UINT WM_APP_ART_READY = WM_APP + 11;

constexpr GUID themeId{0x29af684e,0x7eb2,0x4efe,{0x8e,0x33,0x77,0xe6,0x7a,0x27,0xf4,0xbd}};
constexpr GUID langId{0x9271e72c,0xf07f,0x4135,{0x91,0xea,0x4c,0x66,0x83,0x83,0x94,0xd4}};
constexpr GUID sourcesId{0xb6dab021,0x9750,0x490f,{0x82,0x12,0x18,0x4e,0xb8,0x6f,0x25,0x18}};
constexpr GUID placementId{0x2ea14078,0x248f,0x4e07,{0x8a,0x97,0x67,0x86,0x36,0x96,0x63,0x2f}};
constexpr GUID remoteRouteId{0x0f5f04f6,0x656a,0x4782,{0xb2,0x45,0x78,0x34,0x41,0xdc,0xa2,0x70}};
constexpr GUID localRouteId{0x5a73b0d4,0x40bc,0x4f99,{0x9b,0x22,0x91,0x51,0x6e,0x8c,0xd0,0x33}};
constexpr GUID rightTabId{0x8a37c41d,0x1e21,0x4935,{0x89,0xc1,0x41,0x3a,0x0b,0x21,0x5f,0x91}};
constexpr GUID lovedConfirmedId{0xc48e2a10,0x73f1,0x4c18,{0xa4,0x19,0x62,0x1e,0x3b,0x9a,0x17,0xe2}};
constexpr GUID onboardingDoneId{0xe9b71c44,0x2a85,0x4f12,{0x9c,0x33,0x81,0x4d,0x2f,0x6e,0xa0,0x19}};
constexpr GUID activeSourceRemoteId{0x6d4a91f3,0x3c12,0x489a,{0x8b,0x27,0x5e,0x14,0x90,0xc3,0x7f,0x48}};

cfg_var_modern::cfg_int themeSetting(themeId, 0);
cfg_var_modern::cfg_string languageSetting(langId, "auto");
cfg_var_modern::cfg_bool remoteEnabled(sourcesId, false);
cfg_var_modern::cfg_struct_t<WINDOWPLACEMENT> placementSetting(placementId);
cfg_var_modern::cfg_guid remoteRouteSetting(remoteRouteId, pfc::guid_null);
cfg_var_modern::cfg_guid localRouteSetting(localRouteId, pfc::guid_null);
cfg_var_modern::cfg_string rightTabSetting(rightTabId, "lyrics");
cfg_var_modern::cfg_bool lovedConfirmedSetting(lovedConfirmedId, false);
cfg_var_modern::cfg_bool onboardingDoneSetting(onboardingDoneId, false);
cfg_var_modern::cfg_bool activeSourceRemoteSetting(activeSourceRemoteId, false);

std::atomic<uint64_t> g_queueRevision{1};

class RgWatch : public replaygain_core_settings_notify {
public:
    explicit RgWatch(bool& dirty) : dirty_(dirty) {}
    void on_changed(t_replaygain_config const&) override { dirty_ = true; }
private:
    bool& dirty_;
};

class QueueWatch : public playback_queue_callback {
public:
    void on_changed(t_change_origin) override {
        g_queueRevision.fetch_add(1, std::memory_order_relaxed);
    }
};
static service_factory_single_t<QueueWatch> g_queueWatch;

hstring languageMode() {
    const auto mode = languageSetting.get();
    return winrt::to_hstring(mode.c_str());
}

hstring language() {
    const auto mode = languageMode();
    if (mode != L"auto") return mode;
    return PRIMARYLANGID(GetUserDefaultUILanguage()) == LANG_CHINESE ? L"zh-CN" : L"en";
}

bool lightTheme() {
    const auto theme = themeSetting.get();
    if (theme != 0) return theme == 2;
    DWORD useLight = 0, size = sizeof(useLight);
    return RegGetValueW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
        L"AppsUseLightTheme", RRF_RT_REG_DWORD, nullptr, &useLight, &size) == ERROR_SUCCESS && useLight != 0;
}

fs::path profileDirectory() {
    auto path = std::wstring(winrt::to_hstring(core_api::get_profile_path()));
    if (path.starts_with(L"file://")) path.erase(0, 7);
    return fs::path(path);
}

nv::Client& navClient() {
    static nv::Client client;
    static std::once_flag loaded;
    std::call_once(loaded, [&] {
        if (auto config = nv::loadConfig(profileDirectory())) client.configure(*config);
    });
    return client;
}

bool configured(nv::Config const& config) {
    return !config.server.empty() && !config.user.empty();
}

constexpr std::string_view navScheme = "polanav://";

std::string hexEncode(std::string_view data) {
    constexpr char hex[] = "0123456789abcdef";
    std::string result;
    result.reserve(data.size() * 2);
    for (const unsigned char ch : data) {
        result.push_back(hex[ch >> 4]);
        result.push_back(hex[ch & 15]);
    }
    return result;
}

std::string serverKey(nv::Config const& config) {
    uint64_t hash = 14695981039346656037ull;
    for (wchar_t c : config.server + L"\n" + config.user) {
        hash ^= static_cast<uint16_t>(c);
        hash *= 1099511628211ull;
    }
    char buffer[17]{};
    std::snprintf(buffer, sizeof(buffer), "%016llx", static_cast<unsigned long long>(hash));
    return buffer;
}

std::wstring serverKeyW(nv::Config const& config) {
    const auto k = serverKey(config);
    return std::wstring(k.begin(), k.end());
}

struct StreamRef { std::string server; std::wstring id; };

std::optional<StreamRef> streamRef(std::string_view path) {
    if (!path.starts_with(navScheme)) return std::nullopt;
    path.remove_prefix(navScheme.size());
    const auto dot = path.find('.');
    if (dot == path.npos || dot < 19 || dot > 529 || path[16] != '-') return std::nullopt;
    const auto suffix = path.substr(dot + 1);
    if (suffix.empty() || suffix.size() > 10 || suffix.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789") != suffix.npos) return std::nullopt;
    const auto server = path.substr(0, 16);
    if (server.find_first_not_of("0123456789abcdef") != server.npos) return std::nullopt;
    path = path.substr(17, dot - 17);
    if (path.size() % 2) return std::nullopt;
    constexpr std::string_view digits = "0123456789abcdef";
    std::string decoded;
    for (size_t i = 0; i < path.size(); i += 2) {
        const auto high = digits.find(path[i]), low = digits.find(path[i + 1]);
        if (high == digits.npos || low == digits.npos) return std::nullopt;
        const auto byte = static_cast<char>(high * 16 + low);
        if (!byte) return std::nullopt;
        decoded.push_back(byte);
    }
    try { return StreamRef{std::string(server), std::wstring(to_hstring(decoded))}; }
    catch (...) { return std::nullopt; }
}

std::string streamPath(nv::Song const& song) {
    auto id = to_string(song.id);
    if (id.empty() || id.size() > 256) return {};
    auto suffix = to_string(song.suffix);
    for (auto& c : suffix) if (c >= 'A' && c <= 'Z') c += char('a' - 'A');
    if (suffix.empty() || suffix.size() > 10 || suffix.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789") != suffix.npos)
        suffix = "mp3";
    return std::string(navScheme) + serverKey(navClient().configuration()) + "-" + hexEncode(id) + "." + suffix;
}

class NavFilesystem : public filesystem {
public:
    bool is_our_path(const char* path) override { return path && std::string_view(path).starts_with(navScheme); }
    bool get_canonical_path(const char* path, pfc::string_base& out) override {
        if (!is_our_path(path)) return false;
        out = path;
        return true;
    }
    bool get_display_path(const char* path, pfc::string_base& out) override {
        if (!is_our_path(path)) return false;
        out = "Navidrome";
        return true;
    }
    void open(file::ptr& out, const char* path, t_open_mode mode, abort_callback& abort) override {
        if ((mode & open_mode_mask) != open_mode_read) throw exception_io_denied();
        auto ref = streamRef(path);
        if (!ref || !remoteEnabled.get()) throw exception_io_not_found();
        auto& client = navClient();
        const auto config = client.configuration();
        if (serverKey(config) != ref->server) throw exception_io_not_found();
        const auto url = client.streamUrl(ref->id, config);
        if (url.empty()) throw exception_io_not_found();
        try { filesystem::g_open_read(out, to_string(url).c_str(), abort); }
        catch (exception_aborted const&) { throw; }
        catch (...) { throw exception_io("Navidrome stream could not be opened"); }
    }
    bool is_remote(const char*) override { return true; }
    bool supports_content_types() override { return true; }
    void get_stats(const char*, t_filestats& stats, bool& writable, abort_callback&) override {
        stats = filestats_invalid;
        writable = false;
    }
    void remove(const char*, abort_callback&) override { throw exception_io_denied(); }
    void move(const char*, const char*, abort_callback&) override { throw exception_io_denied(); }
    void create_directory(const char*, abort_callback&) override { throw exception_io_denied(); }
    void list_directory(const char*, directory_callback&, abort_callback&) override { throw exception_io_not_found(); }
};
static service_factory_single_t<NavFilesystem> navFilesystem;

enum class RowKind { Song, Manual, Next };

struct QueueRow {
    metadb_handle_ptr handle;
    size_t playlist = SIZE_MAX;
    size_t index = SIZE_MAX;
    RowKind kind = RowKind::Next;

    bool operator==(QueueRow const& other) const {
        return handle.get_ptr() == other.handle.get_ptr() &&
            playlist == other.playlist && index == other.index && kind == other.kind;
    }
};

HMODULE moduleHandle() {
    HMODULE handle = nullptr;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
        GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
        reinterpret_cast<LPCWSTR>(&moduleHandle), &handle);
    return handle;
}

fs::path componentDirectory() {
    wchar_t path[32768];
    const auto size = GetModuleFileNameW(moduleHandle(), path, ARRAYSIZE(path));
    if (!size || size == ARRAYSIZE(path)) throw std::runtime_error("Cannot locate component folder");
    return fs::path(std::wstring(path, size)).parent_path();
}

hstring utf8(const char* text) {
    return text ? to_hstring(std::string_view(text)) : hstring{};
}

hstring utf8(std::string const& text) {
    return to_hstring(std::string_view(text));
}

void put(JsonObject const& obj, wchar_t const* key, hstring const& value) {
    obj.Insert(key, JsonValue::CreateStringValue(value));
}
void put(JsonObject const& obj, wchar_t const* key, std::string const& value) {
    obj.Insert(key, JsonValue::CreateStringValue(utf8(value)));
}
void put(JsonObject const& obj, wchar_t const* key, std::wstring const& value) {
    obj.Insert(key, JsonValue::CreateStringValue(hstring(value)));
}
void put(JsonObject const& obj, wchar_t const* key, double value) {
    obj.Insert(key, JsonValue::CreateNumberValue(std::isfinite(value) ? value : 0));
}
void put(JsonObject const& obj, wchar_t const* key, bool value) {
    obj.Insert(key, JsonValue::CreateBooleanValue(value));
}
void put(JsonObject const& obj, wchar_t const* key, wchar_t const* value) {
    put(obj, key, hstring(value));
}

bool postEvent(wchar_t const* eventName, JsonObject const& data) {
    JsonObject envelope;
    put(envelope, L"type", L"event");
    put(envelope, L"event", eventName);
    envelope.Insert(L"data", data);
    return WvPostJson(envelope.Stringify().c_str());
}

void postRpcSuccess(double id, JsonObject const& data) {
    JsonObject envelope;
    put(envelope, L"type", L"rpc-res");
    put(envelope, L"id", id);
    put(envelope, L"ok", true);
    envelope.Insert(L"data", data);
    WvPostJson(envelope.Stringify().c_str());
}

void postRpcError(double id, wchar_t const* messageText) {
    JsonObject envelope;
    put(envelope, L"type", L"rpc-res");
    put(envelope, L"id", id);
    put(envelope, L"ok", false);
    put(envelope, L"error", messageText ? messageText : L"Request failed");
    WvPostJson(envelope.Stringify().c_str());
}

size_t indexValue(JsonObject const& msg, wchar_t const* key) {
    const auto value = msg.GetNamedNumber(key, -1);
    if (!std::isfinite(value) || value < 0 || value > 0xffffffffu || value != std::floor(value)) return SIZE_MAX;
    return static_cast<size_t>(value);
}

std::string playlistGuidId(playlist_manager::ptr const& pm, size_t index) {
    if (index >= pm->get_playlist_count()) return {};
    playlist_manager_v5::ptr pm5;
    if (pm->service_query_t(pm5)) {
        const auto g = pm5->playlist_get_guid(index);
        const auto s = pfc::print_guid(g);
        return std::string(s.c_str());
    }
    return "pl-" + std::to_string(index);
}

size_t findPlaylistById(playlist_manager::ptr const& pm, std::wstring_view idW) {
    if (idW.empty()) return SIZE_MAX;
    const auto idUtf8 = to_string(idW);
    for (size_t i = 0; i < pm->get_playlist_count(); ++i) {
        if (playlistGuidId(pm, i) == idUtf8) return i;
    }
    return SIZE_MAX;
}

class ListWatch final : public playlist_callback_impl_base {
public:
    ListWatch(size_t& listRev, uint64_t& queueRev, bool& playbackDirty)
        : playlist_callback_impl_base(
            flag_on_items_added | flag_on_items_reordered | flag_on_items_removed |
            flag_on_items_modified | flag_on_items_replaced | flag_on_playlist_activate |
            flag_on_playlist_created | flag_on_playlists_reorder | flag_on_playlists_removed |
            flag_on_playlist_renamed | flag_on_playlist_locked | flag_on_playback_order_changed),
          listRev_(listRev), queueRev_(queueRev), playbackDirty_(playbackDirty) {}
    void on_items_added(t_size, t_size, metadb_handle_list_cref, const bit_array&) noexcept override { ++listRev_; ++queueRev_; }
    void on_items_reordered(t_size, const t_size*, t_size) noexcept override { ++listRev_; ++queueRev_; }
    void on_items_removed(t_size, const bit_array&, t_size, t_size) noexcept override { ++listRev_; ++queueRev_; }
    void on_items_modified(t_size, const bit_array&) noexcept override { ++listRev_; ++queueRev_; }
    void on_items_replaced(t_size, const bit_array&, const pfc::list_base_const_t<t_on_items_replaced_entry>&) noexcept override { ++listRev_; ++queueRev_; }
    void on_playlist_activate(t_size, t_size) noexcept override { ++listRev_; }
    void on_playlist_created(t_size, const char*, t_size) noexcept override { ++listRev_; }
    void on_playlists_reorder(const t_size*, t_size) noexcept override { ++listRev_; }
    void on_playlists_removed(const bit_array&, t_size, t_size) noexcept override { ++listRev_; ++queueRev_; }
    void on_playlist_renamed(t_size, const char*, t_size) noexcept override { ++listRev_; }
    void on_playlist_locked(t_size, bool) noexcept override { ++listRev_; }
    void on_playback_order_changed(t_size) noexcept override { ++queueRev_; playbackDirty_ = true; }
private:
    size_t& listRev_;
    uint64_t& queueRev_;
    bool& playbackDirty_;
};

class PlaybackWatch final : public play_callback_impl_base {
public:
    PlaybackWatch(bool& refresh, bool& seek, uint64_t& queueRev)
        : play_callback_impl_base(flag_on_playback_new_track | flag_on_playback_stop |
            flag_on_playback_seek | flag_on_playback_pause | flag_on_volume_change),
          refresh_(refresh), seek_(seek), queueRev_(queueRev) {}
    void on_playback_new_track(metadb_handle_ptr) noexcept override { refresh_ = seek_ = true; ++queueRev_; }
    void on_playback_stop(play_control::t_stop_reason) noexcept override { refresh_ = seek_ = true; ++queueRev_; }
    void on_playback_seek(double) noexcept override { refresh_ = seek_ = true; }
    void on_playback_pause(bool) noexcept override { refresh_ = true; }
    void on_volume_change(float) noexcept override { refresh_ = true; }
private:
    bool &refresh_, &seek_;
    uint64_t& queueRev_;
};

class LibraryWatch final : public library_callback_dynamic_impl_base {
public:
    explicit LibraryWatch(size_t& revision) : revision_(revision) {}
    void on_items_added(metadb_handle_list_cref) noexcept override { ++revision_; }
    void on_items_removed(metadb_handle_list_cref) noexcept override { ++revision_; }
    void on_items_modified(metadb_handle_list_cref) noexcept override { ++revision_; }
private:
    size_t& revision_;
};

class LovedCompletion : public completion_notify {
public:
    using Fn = std::function<void(unsigned)>;
    void setup(Fn fn) { fn_ = std::move(fn); }
    void on_completion(unsigned code) override {
        if (fn_) fn_(code);
    }
private:
    Fn fn_;
};

class MetadbTagWatch final : public metadb_io_callback_dynamic_impl_base {
public:
    MetadbTagWatch(bool& dirtyFlag, std::function<void(metadb_handle_list_cref)> cb)
        : dirtyFlag_(dirtyFlag), cb_(std::move(cb)) {}
    void on_changed_sorted(metadb_handle_list_cref p_items, bool) noexcept override {
        dirtyFlag_ = true;
        if (cb_) cb_(p_items);
    }
private:
    bool& dirtyFlag_;
    std::function<void(metadb_handle_list_cref)> cb_;
};

class PolaUi : public user_interface {
public:
    const char* get_name() override { return "PolaPlayer Native"; }
    GUID get_guid() override { return {0xfba4368d,0x3c6a,0x4594,{0xa8,0xdd,0x8a,0xd7,0x83,0xfc,0x1b,0x05}}; }

    HWND init(HookProc_t hook) override {
        hook_ = hook;
        WNDCLASSW wc{};
        wc.hInstance = moduleHandle();
        wc.lpszClassName = windowClass;
        wc.lpfnWndProc = dispatch;
        wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        wc.hbrBackground = nullptr;
        if (!RegisterClassW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS)
            throw std::runtime_error("RegisterClass failed");

        constexpr DWORD style = WS_OVERLAPPED | WS_THICKFRAME | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_CLIPCHILDREN;
        wnd_ = CreateWindowExW(WS_EX_APPWINDOW, windowClass, L"PolaPlayer",
            style, CW_USEDEFAULT, CW_USEDEFAULT, 1280, 820,
            nullptr, nullptr, moduleHandle(), this);
        if (!wnd_) throw std::runtime_error("Cannot create PolaPlayer window");

        applyThemeToWindow(false);
        WINDOWPLACEMENT stored = placementSetting.get();
        const bool valid = stored.length == sizeof(stored) &&
            stored.rcNormalPosition.right - stored.rcNormalPosition.left >= 360 &&
            stored.rcNormalPosition.bottom - stored.rcNormalPosition.top >= 320 &&
            MonitorFromRect(&stored.rcNormalPosition, MONITOR_DEFAULTTONULL);
        if (valid) {
            stored.showCmd = stored.showCmd == SW_SHOWMAXIMIZED ? SW_SHOWMAXIMIZED : SW_SHOWNORMAL;
            SetWindowPlacement(wnd_, &stored);
            ShowWindow(wnd_, stored.showCmd);
        } else {
            ShowWindow(wnd_, SW_SHOW);
        }
        pola::chrome::syncWebViewInsets(wnd_, fullscreen_);
        SetWindowPos(wnd_, nullptr, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);

        SetTimer(wnd_, 1, 35, nullptr);
        return wnd_;
    }

    void shutdown() override {
        if (!wnd_) return;
        WINDOWPLACEMENT placement{sizeof(WINDOWPLACEMENT)};
        if (fullscreen_ && restorePlacement_.length == sizeof(restorePlacement_)) placementSetting.set(restorePlacement_);
        else if (GetWindowPlacement(wnd_, &placement)) placementSetting.set(placement);
        KillTimer(wnd_, 1);
        listWatch_.reset();
        playbackWatch_.reset();
        libraryWatch_.reset();
        metadbWatch_.reset();
        fftStream_.release();
        if (rgWatch_) {
            if (auto rg2 = replaygain_manager_v2::tryGet(); rg2.is_valid()) rg2->remove_notify(rgWatch_.get());
            rgWatch_.reset();
        }
        if (alive_) *alive_ = false;
        localIndex_.shutdown();
        media_.cancel();
        artServer_.shutdown();
        WvSetResourceHandler(nullptr, nullptr, nullptr);
        WvDestroy();
        if (canvasBrush_) {
            DeleteObject(canvasBrush_);
            canvasBrush_ = nullptr;
        }
        DestroyWindow(wnd_);
        wnd_ = nullptr;
        UnregisterClassW(windowClass, moduleHandle());
        if (ownsCom_) { CoUninitialize(); ownsCom_ = false; }
    }

    void activate() override {
        if (!wnd_) return;
        ShowWindow(wnd_, IsIconic(wnd_) ? SW_RESTORE : SW_SHOW);
        SetForegroundWindow(wnd_);
    }
    void hide() override { if (wnd_) ShowWindow(wnd_, SW_MINIMIZE); }
    bool is_visible() override { return wnd_ && IsWindowVisible(wnd_) && !IsIconic(wnd_); }
    void override_statusbar_text(const char*) override {}
    void revert_statusbar_text() override {}
    void show_now_playing() override { activate(); if (ready_) enterFullscreen(L"lyrics"); }

private:
    HWND wnd_ = nullptr;
    HBRUSH canvasBrush_ = nullptr;
    COLORREF canvasColor_ = RGB(0, 0, 0);
    WINDOWPLACEMENT restorePlacement_{sizeof(WINDOWPLACEMENT)};
    bool wasZoomedBeforeFs_ = false;
    HookProc_t hook_ = nullptr;

    bool ready_ = false, started_ = false, failed_ = false, ownsCom_ = false;
    bool fullscreen_ = false;
    std::wstring fsView_ = L"lyrics";
    bool lastLight_ = false;
    bool lastZoomed_ = false;

    size_t catalogRev_ = 1, seenCatalogRev_ = 0, listRev_ = 1, sentListRev_ = 0, libRev_ = 1, seenLibRev_ = 1, trackKey_ = 0, sentTrackKey_ = 0;
    uint64_t queueRev_ = 1, sentQueueRev_ = 0, lastGlobalQueueRev_ = 0;
    uint64_t deadline_ = 0, nextSnapshot_ = 0;
    uint64_t statsTrackKey_ = 0, statsAccumMs_ = 0, statsLastTickMs_ = 0;
    bool statsRecorded_ = false;
    bool radioMixActive_ = false;
    std::string browseContextName_;
    bool localDirtyFlag_ = false;

    metadb_handle_ptr current_;
    titleformat_object::ptr title_, artist_, album_, albKeyTf_;
    pola::LocalMedia media_;
    pola::ArtServer artServer_;
    pola::index::LocalLibraryIndex localIndex_;
    std::optional<pola::Lyrics> localLyrics_;
    std::wstring localCoverUrl_;

    std::shared_ptr<bool> alive_ = std::make_shared<bool>(true);
    std::unique_ptr<ListWatch> listWatch_;
    std::unique_ptr<PlaybackWatch> playbackWatch_;
    std::unique_ptr<LibraryWatch> libraryWatch_;
    std::unique_ptr<MetadbTagWatch> metadbWatch_;
    std::unique_ptr<RgWatch> rgWatch_;
    pola::fft::FftStream fftStream_;
    uint64_t lastVizTickMs_ = 0;
    UINT timerIntervalMs_ = 35;
    bool rgDirty_ = false;
    bool refreshPlayback_ = false, explicitSeek_ = false;

    struct PendingDupPrompt {
        std::wstring pid, name;
        metadb_handle_list allItems, uniqueItems;
    };
    std::optional<PendingDupPrompt> pendingDupPrompt_;

    // Search state
    hstring query_;
    std::vector<metadb_handle_ptr> searchCandidates_, searchResults_;
    search_filter::ptr searchFilter_;
    size_t searchCursor_ = 0;
    size_t searchRev_ = 1, sentSearchRev_ = 0;
    bool searchActive_ = false, searchFailed_ = false;

    // Queue snapshot
    std::vector<QueueRow> queue_;
    std::string queueSourceName_;
    bool queueRepeatingTrack_ = false;

    // Navidrome state
    nv::MultiConfig multiConfig_;
    bool remoteView_ = false, catalogFailed_ = false, remoteRowsFailed_ = false;
    bool scrobbled_ = false, remoteRandomToppingUp_ = false;
    std::wstring remotePlaylist_;
    std::vector<nv::Playlist> remotePlaylists_;
    std::vector<nv::Song> remoteSongs_;
    std::map<std::wstring, nv::Song> remoteMetadata_;
    std::unordered_map<std::wstring, std::vector<nv::Album>> remoteAlbumsByTab_;
    std::unordered_map<std::wstring, bool> remoteAlbumsHasMore_;
    struct RemoteAlbumCache { nv::Album meta; std::vector<nv::Song> songs; };
    std::unordered_map<std::wstring, RemoteAlbumCache> remoteAlbumDetails_;
    std::vector<nv::Artist> remoteArtists_;
    bool remoteArtistsLoaded_ = false;
    struct RemoteArtistCache { nv::Artist meta; std::vector<nv::Album> albums; std::vector<nv::Song> topSongs; };
    std::unordered_map<std::wstring, RemoteArtistCache> remoteArtistDetails_;
    struct RemoteStarredCache {
        bool loaded = false;
        std::vector<nv::Song> songs;
        std::vector<nv::Album> albums;
        std::vector<nv::Artist> artists;
    } remoteStarred_;
    std::unordered_set<std::wstring> starredSongIds_, starredAlbumIds_, starredArtistIds_;
    std::vector<nv::Song> remoteRandomSongs_;
    std::wstring remoteLastSearchQuery_;
    std::vector<nv::Artist> remoteLastSearchArtists_;
    std::vector<nv::Album> remoteLastSearchAlbums_;
    std::vector<nv::Song> remoteLastSearchSongs_;

    uint64_t catalogRequest_ = 0, rowsRequest_ = 0, lyricsRequest_ = 0;
    uint64_t songRequest_ = 0, coverRequest_ = 0;
    uint64_t pingRequest_ = 0;
    uint64_t randomTopUpReq_ = 0;
    struct PendingMutation { uint64_t navReqId = 0; double rpcId = 0; };
    struct PendingStar { uint64_t navReqId = 0; double rpcId = 0; std::wstring kind, targetId; bool prevStarred = false; };
    struct PendingRemoteRpc {
        uint64_t navReqId = 0;
        double rpcId = 0;
        std::wstring kind, arg1;
        size_t offset = 0, limit = 60;
        bool append = false;
        std::wstring arg2;
        bool flag = true;
    };
    std::vector<PendingMutation> pendingMutations_;
    std::vector<PendingStar> pendingStars_;
    std::vector<PendingRemoteRpc> pendingRemoteRpcs_;
    double pendingSearchRpc_ = 0;
    double pendingPlaylistRpc_ = 0;
    std::wstring pendingPlaylistRpcId_;
    std::wstring pendingPlaylistRpcSort_ = L"default";
    bool pendingPlaylistRpcAsc_ = true;
    size_t pendingPlaylistRpcOffset_ = 0;
    size_t pendingPlaylistRpcLimit_ = 250;

    std::vector<nv::LyricLine> remoteLyrics_;
    bool remoteLyricsSynced_ = false, remoteLyricsFailed_ = false;
    size_t remoteLyricsTrack_ = 0;

    static LRESULT CALLBACK dispatch(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
        if (msg == WM_NCCREATE) {
            auto cs = reinterpret_cast<CREATESTRUCTW*>(lp);
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(cs->lpCreateParams));
        }
        auto self = reinterpret_cast<PolaUi*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
        return self ? self->windowProc(hwnd, msg, wp, lp) : DefWindowProcW(hwnd, msg, wp, lp);
    }

    void applyThemeToWindow(bool notifyWeb) {
        const bool light = lightTheme();
        lastLight_ = light;
        const COLORREF canvas = fullscreen_ ? RGB(18, 18, 18) : (light ? RGB(232, 232, 236) : RGB(0, 0, 0));
        if (!canvasBrush_ || canvasColor_ != canvas) {
            if (canvasBrush_) DeleteObject(canvasBrush_);
            canvasBrush_ = CreateSolidBrush(canvas);
            canvasColor_ = canvas;
        }
        WvSetBackdropColor(canvas);
        pola::chrome::applyDwmTheme(wnd_, light, fullscreen_);
        if (wnd_) InvalidateRect(wnd_, nullptr, FALSE);
        if (notifyWeb && ready_) sendSettings();
    }

    LRESULT windowProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
        LRESULT result = 0;
        if (hook_ && hook_(hwnd, msg, wp, lp, &result)) return result;
        switch (msg) {
        case WM_NCCALCSIZE:
            return pola::chrome::handleNcCalcSize(hwnd, wp, lp, fullscreen_);
        case WM_NCHITTEST: {
            const LRESULT ht = pola::chrome::hitTestEdges(hwnd, {GET_X_LPARAM(lp), GET_Y_LPARAM(lp)}, fullscreen_);
            if (ht != HTCLIENT) return ht;
            break;
        }
        case WM_NCACTIVATE:
            if (!IsIconic(hwnd)) return TRUE;
            break;
        case WM_NCPAINT:
            if (!IsIconic(hwnd)) return 0;
            break;
        case WM_ERASEBKGND: {
            HDC hdc = reinterpret_cast<HDC>(wp);
            RECT rc{};
            if (hdc && GetClientRect(hwnd, &rc) && canvasBrush_) {
                FillRect(hdc, &rc, canvasBrush_);
                return 1;
            }
            break;
        }
        case WM_DWMCOMPOSITIONCHANGED:
            applyThemeToWindow(false);
            break;
        case WM_SETTINGCHANGE:
            if (lp && wcscmp(reinterpret_cast<const wchar_t*>(lp), L"ImmersiveColorSet") == 0) {
                if (lightTheme() != lastLight_) applyThemeToWindow(true);
            }
            break;
        case WM_SIZE: {
            pola::chrome::syncWebViewInsets(hwnd, fullscreen_);
            WvSyncBounds(hwnd);
            const bool zoomed = IsZoomed(hwnd) != FALSE;
            if (zoomed != lastZoomed_) {
                lastZoomed_ = zoomed;
                if (ready_) sendWindowState();
            }
            break;
        }
        case WM_GETMINMAXINFO: {
            const int dpi = pola::chrome::windowDpi(hwnd);
            auto* mmi = reinterpret_cast<MINMAXINFO*>(lp);
            mmi->ptMinTrackSize = {pola::chrome::scaleDpi(360, dpi), pola::chrome::scaleDpi(320, dpi)};
            return 0;
        }
        case WM_NCRBUTTONUP:
            if (wp == HTCAPTION && !fullscreen_) {
                pola::chrome::showSystemMenuAt(hwnd, {GET_X_LPARAM(lp), GET_Y_LPARAM(lp)});
                return 0;
            }
            break;
        case WM_APP_ART_READY:
            artServer_.flushCompletedResponses();
            flushHueEvents();
            return 0;
        case WM_TIMER:
            try { tick(); }
            catch (...) { fail(L"PolaPlayer could not initialize the interface."); }
            return 0;
        case WM_CLOSE:
            standard_commands::main_exit();
            return 0;
        case WM_PAINT: {
            PAINTSTRUCT ps{};
            auto dc = BeginPaint(hwnd, &ps);
            RECT r{}; GetClientRect(hwnd, &r); InflateRect(&r, -24, 0);
            SetBkMode(dc, TRANSPARENT);
            SetTextColor(dc, lastLight_ ? RGB(60, 60, 66) : RGB(190, 190, 196));
            DrawTextW(dc, failed_ ? L"WebView2 could not start. Use Preferences to switch interfaces." :
                L"Loading PolaPlayer...", -1, &r, DT_SINGLELINE | DT_CENTER | DT_VCENTER);
            EndPaint(hwnd, &ps);
            return 0;
        }
        }
        return DefWindowProcW(hwnd, msg, wp, lp);
    }

    void fail(wchar_t const* reason) {
        if (failed_) return;
        failed_ = true;
        ready_ = false;
        WvDestroy();
        if (wnd_) {
            KillTimer(wnd_, 1);
            InvalidateRect(wnd_, nullptr, TRUE);
        }
        console::info(winrt::to_string(reason).c_str());
    }

    void start() {
        started_ = true;
        const auto hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
        if (FAILED(hr)) throw std::runtime_error("COM apartment is unavailable");
        ownsCom_ = true;

        auto tf = titleformat_compiler::get();
        tf->compile_safe(title_, "%title%");
        tf->compile_safe(artist_, "$if2(%artist%,)");
        tf->compile_safe(album_, "$if2(%album%,)");
        tf->compile_safe(albKeyTf_, "$if2(%album artist%,%artist%)'|'$if2(%album%,)");

        listWatch_ = std::make_unique<ListWatch>(catalogRev_, queueRev_, refreshPlayback_);
        playbackWatch_ = std::make_unique<PlaybackWatch>(refreshPlayback_, explicitSeek_, queueRev_);
        libraryWatch_ = std::make_unique<LibraryWatch>(libRev_);

        auto data = profileDirectory() / L"polaplayer-webview";
        const auto coverCache = profileDirectory() / L"polaplayer-cover-cache";
        std::error_code cacheError;
        fs::create_directories(coverCache, cacheError);
        if (!cacheError) media_.setDirectory(coverCache);

        artServer_.initialize(wnd_, WM_APP_ART_READY, coverCache);
        multiConfig_ = nv::loadMultiConfig(profileDirectory());
        if (auto cfg = activeMultiConfig()) {
            if (configured(*cfg)) navClient().configure(*cfg);
        }
        artServer_.setNavConfig(navClient().configuration());
        localIndex_.initialize(profileDirectory(), &artServer_);
        remoteView_ = remoteEnabled.get() && activeSourceRemoteSetting.get();
        if (remoteEnabled.get() && configured(navClient().configuration())) {
            navClient().request(nv::Action::Starred);
            if (remoteView_) refreshRemoteCatalog();
        } else if (remoteView_) {
            catalogFailed_ = true;
        }

        metadbWatch_ = std::make_unique<MetadbTagWatch>(localDirtyFlag_, [this](metadb_handle_list_cref items) {
            bool touchedCurrent = false;
            bool needNotify = false;
            for (t_size i = 0; i < items.get_count(); ++i) {
                auto h = items[i];
                if (!h.is_valid()) continue;
                const auto tid = pola::index::LocalLibraryIndex::canonicalTrackId(h);
                if (auto opt = localIndex_.takeOptimisticLoved(tid)) {
                    needNotify = true;
                }
                if (current_.is_valid() && h.get_ptr() == current_.get_ptr()) touchedCurrent = true;
            }
            localIndex_.invalidateLibrary();
            rgDirty_ = true;
            if (touchedCurrent || needNotify) {
                if (ready_) {
                    if (touchedCurrent) postEvent(L"track", buildTrack());
                    sendBrowseUpdated(L"loved");
                }
            }
        });
        rgWatch_ = std::make_unique<RgWatch>(rgDirty_);
        if (auto rg2 = replaygain_manager_v2::tryGet(); rg2.is_valid()) rg2->add_notify(rgWatch_.get());

        WvSetAcceleratorMode(false, false);
        WvSetResourceHandler(L"https://art.verdant.local/*", &pola::ArtServer::handleWebResource, &artServer_);
        WvSetBackdropColor(canvasColor_);

        const auto app = componentDirectory() / L"web";
        if (!WvInit(wnd_, moduleHandle(), app.c_str(), cacheError ? L"" : coverCache.c_str(), data.c_str())) {
            fail(L"PolaPlayer: WebView2 initialization failed");
            return;
        }
        pola::chrome::syncWebViewInsets(wnd_, fullscreen_);
        deadline_ = GetTickCount64() + 10000;
    }

    void flushHueEvents() {
        if (!ready_) return;
        for (auto const& ev : artServer_.drainHues()) {
            JsonObject d;
            put(d, L"key", ev.key);
            put(d, L"hue", ev.hue);
            postEvent(L"art.hue", d);
        }
    }

    void tick() {
        if (!started_) start();
        if (failed_) return;
        if (!ready_ && GetTickCount64() >= deadline_) {
            fail(L"PolaPlayer: WebView2 ready timeout");
            return;
        }

        const auto curGlobalQ = g_queueRevision.load(std::memory_order_relaxed);
        if (curGlobalQ != lastGlobalQueueRev_) {
            lastGlobalQueueRev_ = curGlobalQ;
            ++queueRev_;
        }
        if (rgDirty_ && ready_) {
            rgDirty_ = false;
            postEvent(L"replaygain", buildReplayGainState());
        }

        if (ready_) {
            if (seenLibRev_ != libRev_) {
                seenLibRev_ = libRev_;
                localIndex_.invalidateLibrary();
                ++listRev_;
                if (searchActive_ && !remoteView_) startSearch();
                sendPlaylists();
                sendBrowseUpdated(L"library");
            }
            updateTrack();
            pollNav();
            flushHueEvents();
            updatePlayStatsAndTopUp();
            if (seenCatalogRev_ != catalogRev_) {
                seenCatalogRev_ = catalogRev_;
                ++listRev_;
                if (searchActive_ && !remoteView_) startSearch();
                sendPlaylists();
            }
            if (sentQueueRev_ != queueRev_) {
                refreshQueue();
                sendQueue();
            }
            if (searchActive_ && !remoteView_) {
                advanceSearch();
            }
        }

        JsonArray incoming;
        const hstring raw = drain();
        if (!raw.empty() && JsonArray::TryParse(raw, incoming)) {
            for (auto const& item : incoming) {
                if (item.ValueType() != JsonValueType::Object) continue;
                try { handleMessage(item.GetObject()); }
                catch (std::exception const& e) { console::info(e.what()); }
                catch (hresult_error const&) {}
            }
        }

        if (ready_ && (refreshPlayback_ || GetTickCount64() >= nextSnapshot_)) {
            refreshPlayback_ = false;
            nextSnapshot_ = GetTickCount64() + 250;
            const auto seek = std::exchange(explicitSeek_, false);
            sendPlayback(seek);
            if (lastLight_ != lightTheme()) applyThemeToWindow(true);
        }

        syncVizTimerAndStream();
        if (ready_ && fftStream_.active()) {
            const uint64_t now = GetTickCount64();
            const double dtSec = (lastVizTickMs_ > 0 && now >= lastVizTickMs_)
                ? static_cast<double>(now - lastVizTickMs_) / 1000.0
                : 0.033;
            lastVizTickMs_ = now;
            auto ctl = play_control::get();
            const bool isPlayingActive = ctl->is_playing() && !ctl->is_paused();
            const bool visOk = IsWindowVisible(wnd_) && !IsIconic(wnd_);
            if (fftStream_.sample(visOk, isPlayingActive, dtSec)) {
                JsonObject vf;
                put(vf, L"bass", static_cast<double>(fftStream_.analyzer().bass()));
                JsonArray bandsArr;
                for (float v : fftStream_.analyzer().bands()) {
                    bandsArr.Append(JsonValue::CreateNumberValue(static_cast<double>(v)));
                }
                vf.Insert(L"bands", bandsArr);
                postEvent(L"viz.frame", vf);
            }
        } else {
            lastVizTickMs_ = 0;
        }
    }

    static std::wstring normalizeFsView(std::wstring_view v) {
        if (v == L"default") return L"default";
        if (v == L"viz") return L"viz";
        return L"lyrics";
    }

    void syncVizTimerAndStream() {
        const bool wantViz = fullscreen_ && (fsView_ == L"viz") && wnd_ && IsWindowVisible(wnd_) && !IsIconic(wnd_);
        fftStream_.setActive(wantViz);
        const UINT desired = wantViz ? 16 : 35;
        if (desired != timerIntervalMs_ && wnd_) {
            timerIntervalMs_ = desired;
            SetTimer(wnd_, 1, desired, nullptr);
        }
    }

    static hstring drain() {
        BSTR raw = WvDrainMessagesJson();
        hstring result{std::wstring_view(raw ? raw : L"", raw ? SysStringLen(raw) : 0)};
        SysFreeString(raw);
        return result;
    }

    static hstring metadata(metadb_handle_ptr const& h, titleformat_object::ptr const& fmt) {
        pfc::string8 result;
        if (h.is_valid()) h->format_title(nullptr, result, fmt, nullptr);
        return utf8(result.c_str());
    }

    static std::string albumKeyStr(metadb_handle_ptr const& h, titleformat_object::ptr const& fmt) {
        pfc::string8 result;
        if (h.is_valid()) h->format_title(nullptr, result, fmt, nullptr);
        return std::string(result.c_str());
    }

    std::optional<StreamRef> currentStream() const {
        return current_.is_valid() ? streamRef(current_->get_path()) : std::nullopt;
    }

    nv::Song const* streamMetadata(metadb_handle_ptr const& h) const {
        if (!h.is_valid()) return nullptr;
        const auto ref = streamRef(h->get_path());
        if (!ref || ref->server != serverKey(navClient().configuration())) return nullptr;
        const auto it = remoteMetadata_.find(ref->id);
        return it == remoteMetadata_.end() ? nullptr : &it->second;
    }

    hstring displayMetadata(metadb_handle_ptr const& h, titleformat_object::ptr const& fmt) const {
        const auto song = streamMetadata(h);
        if (!song) return metadata(h, fmt);
        if (fmt.get_ptr() == title_.get_ptr()) return hstring(song->title);
        if (fmt.get_ptr() == artist_.get_ptr()) return hstring(song->artist);
        return hstring(song->album);
    }

    double trackDuration(metadb_handle_ptr const& h) const {
        if (!h.is_valid()) return 0;
        const auto length = h->get_length();
        if (length > 0) return length;
        const auto song = streamMetadata(h);
        return song ? song->duration : 0;
    }

    std::string artUrlForHandle(metadb_handle_ptr const& h, int sizePx = 200) {
        if (!h.is_valid()) return {};
        if (const auto song = streamMetadata(h)) {
            if (!song->coverArt.empty()) {
                return pola::ArtServer::navArtUrl(serverKeyW(navClient().configuration()), song->coverArt, sizePx);
            }
            return {};
        }
        const auto hash = artServer_.registerTrack(h);
        return pola::ArtServer::trackArtUrl(hash, sizePx);
    }

    std::string hueForHandle(metadb_handle_ptr const& h) {
        if (!h.is_valid()) return {};
        if (const auto song = streamMetadata(h)) {
            if (!song->coverArt.empty()) return artServer_.cachedHue("nv:" + to_string(song->coverArt));
            return {};
        }
        const auto hash = artServer_.registerTrack(h);
        return artServer_.cachedHue("track:" + hash);
    }

    JsonObject buildWindowState() const {
        JsonObject o;
        put(o, L"maximized", IsZoomed(wnd_) != FALSE);
        put(o, L"fullscreen", fullscreen_);
        put(o, L"fsView", fsView_);
        return o;
    }

    void sendWindowState() {
        postEvent(L"windowState", buildWindowState());
    }

    JsonObject buildReplayGainState() const {
        JsonObject rg;
        int mode = 0;
        if (auto rm = replaygain_manager::tryGet(); rm.is_valid()) {
            const auto cfg = rm->get_core_settings();
            mode = static_cast<int>(cfg.m_source_mode);
        }
        const bool built = localIndex_.isBuilt();
        const size_t total = built ? localIndex_.rgTotalCount() : 0;
        const size_t scanned = built ? localIndex_.rgScannedCount() : 0;
        const size_t missing = total >= scanned ? total - scanned : 0;
        const bool active = built && total > 0 && missing == 0 && mode != 0;
        put(rg, L"total", static_cast<double>(total));
        put(rg, L"scanned", static_cast<double>(scanned));
        put(rg, L"missingCount", static_cast<double>(missing));
        put(rg, L"mode", static_cast<double>(mode));
        put(rg, L"active", active);
        return rg;
    }

    metadb_handle_ptr resolveLocalTrackHandle(JsonObject const& params) {
        const auto pid = params.GetNamedString(L"playlistId", L"");
        const size_t idx = indexValue(params, L"index");
        if (!pid.empty() && idx != SIZE_MAX) {
            auto pm = playlist_manager::get();
            const size_t pl = findPlaylistById(pm, pid);
            if (pl < pm->get_playlist_count() && idx < pm->playlist_get_item_count(pl)) {
                auto h = pm->playlist_get_item_handle(pl, idx);
                if (h.is_valid()) return h;
            }
        }
        const auto tid = to_string(params.GetNamedString(L"trackId", L""));
        if (!tid.empty()) {
            localIndex_.ensureBuilt();
            if (auto h = localIndex_.findHandleByTrackId(tid); h.is_valid()) return h;
            auto pm = playlist_manager::get();
            const size_t activePl = pm->get_active_playlist();
            if (activePl < pm->get_playlist_count()) {
                const size_t cnt = pm->playlist_get_item_count(activePl);
                for (size_t i = 0; i < cnt; ++i) {
                    auto h = pm->playlist_get_item_handle(activePl, i);
                    if (h.is_valid() && pola::index::LocalLibraryIndex::canonicalTrackId(h) == tid) return h;
                }
            }
            if (current_.is_valid() && pola::index::LocalLibraryIndex::canonicalTrackId(current_) == tid)
                return current_;
        }
        return current_;
    }

    metadb_handle_ptr resolveAnyTrackHandle(JsonObject const& params) {
        if (!remoteView_) return resolveLocalTrackHandle(params);
        const auto tidW = std::wstring(params.GetNamedString(L"trackId", L""));
        if (!tidW.empty()) {
            if (const auto it = remoteMetadata_.find(tidW); it != remoteMetadata_.end()) {
                auto h = navHandle(it->second);
                if (h.is_valid()) return h;
            }
        }
        const size_t idx = indexValue(params, L"index");
        if (idx < remoteSongs_.size()) {
            auto h = navHandle(remoteSongs_[idx]);
            if (h.is_valid()) return h;
        }
        return current_;
    }

    void insertResolvedLocalItems(
        size_t pl,
        metadb_handle_list const& incoming,
        std::wstring const& targetPid,
        std::wstring const& playlistName,
        bool checkDup,
        std::wstring_view forceMode) {
        auto pm = playlist_manager::get();
        if (pl >= pm->get_playlist_count() || pm->playlist_lock_is_present(pl) || incoming.get_count() == 0) return;

        std::unordered_set<std::string> seen;
        const size_t existingCount = pm->playlist_get_item_count(pl);
        for (size_t i = 0; i < existingCount; ++i) {
            const auto key = pola::drop::canonicalDedupKey(pm->playlist_get_item_handle(pl, i));
            if (!key.empty()) seen.insert(key);
        }

        metadb_handle_list uniqueItems;
        JsonArray dupPreview;
        size_t dupCount = 0;
        for (t_size i = 0; i < incoming.get_count(); ++i) {
            auto h = incoming[i];
            if (!h.is_valid()) continue;
            const auto key = pola::drop::canonicalDedupKey(h);
            if (!key.empty() && !seen.insert(key).second) {
                ++dupCount;
                if (dupPreview.Size() < 6) {
                    JsonObject r;
                    put(r, L"title", displayMetadata(h, title_));
                    put(r, L"artist", displayMetadata(h, artist_));
                    dupPreview.Append(r);
                }
            } else {
                uniqueItems.add_item(h);
            }
        }

        if (checkDup && dupCount > 0) {
            pendingDupPrompt_ = PendingDupPrompt{targetPid, playlistName, incoming, uniqueItems};
            JsonObject ev;
            put(ev, L"kind", L"local");
            put(ev, L"playlistId", hstring(targetPid));
            put(ev, L"playlistName", hstring(playlistName));
            put(ev, L"dupCount", static_cast<double>(dupCount));
            put(ev, L"totalCount", static_cast<double>(incoming.get_count()));
            put(ev, L"uniqueCount", static_cast<double>(uniqueItems.get_count()));
            ev.Insert(L"rows", dupPreview);
            postEvent(L"dup.prompt", ev);
            return;
        }

        metadb_handle_list const& toInsert = (forceMode == L"skip") ? uniqueItems : incoming;
        if (toInsert.get_count() > 0) {
            pm->playlist_insert_items(pl, pm->playlist_get_item_count(pl), toInsert, pfc::bit_array_false());
            ++listRev_;
            ++queueRev_;
            sendPlaylists();
            sendBrowseUpdated(L"all");
        }
    }

    void addOsPathsToLocalPlaylist(
        std::vector<std::wstring> paths,
        std::wstring targetKind,
        std::wstring playlistId) {
        if (paths.empty()) return;
        pola::drop::resolveLocationsAsync(wnd_, paths, alive_,
            [this, paths = std::move(paths), targetKind = std::move(targetKind), playlistId = std::move(playlistId)](metadb_handle_list_cref resolved) {
                if (resolved.get_count() == 0) return;
                auto pm = playlist_manager::get();
                size_t pl = SIZE_MAX;
                std::wstring pid = playlistId;
                std::wstring plName;

                if (targetKind == L"new" || pid.empty()) {
                    std::wstring base = pola::drop::suggestPlaylistNameFromPaths(paths);
                    if (base.empty()) base = L"New Playlist";
                    auto u8 = to_string(base.substr(0, 160));
                    pl = pm->create_playlist(u8.c_str(), u8.size(), SIZE_MAX);
                    if (pl >= pm->get_playlist_count()) return;
                    pm->set_active_playlist(pl);
                    const auto gidStr = playlistGuidId(pm, pl);
                    pid = std::wstring(to_hstring(gidStr));
                    plName = base;
                    sendPlaylists();
                    JsonObject openEv;
                    put(openEv, L"id", hstring(pid));
                    postEvent(L"playlist.open", openEv);
                } else {
                    pl = findPlaylistById(pm, pid);
                    if (pl >= pm->get_playlist_count() || pm->playlist_lock_is_present(pl)) {
                        sendToast(L"err.pl_locked", L"", L"error");
                        return;
                    }
                    pfc::string8 nm;
                    pm->playlist_get_name(pl, nm);
                    plName = std::wstring(to_hstring(nm.c_str()));
                }
                insertResolvedLocalItems(pl, resolved, pid, plName, true, L"check");
            });
    }

    JsonObject buildSettings() const {
        JsonObject m;
        put(m, L"language", language());
        put(m, L"languageMode", languageMode());
        put(m, L"themeMode", static_cast<double>(themeSetting.get()));
        put(m, L"light", lightTheme());
        put(m, L"sources", remoteEnabled.get() ? L"both" : L"local");
        put(m, L"activeSource", remoteView_ ? L"navidrome" : L"local");
        const auto rt = rightTabSetting.get();
        put(m, L"rightTab", (std::string_view(rt.c_str()) == "queue") ? L"queue" : L"lyrics");
        const auto config = navClient().configuration();
        put(m, L"server", hstring(config.server));
        put(m, L"user", hstring(config.user));
        put(m, L"configured", configured(config));
        put(m, L"lovedConfirmed", lovedConfirmedSetting.get());
        put(m, L"onboardingNeeded", !onboardingDoneSetting.get());
        put(m, L"activeServerId", hstring(multiConfig_.activeId));
        m.Insert(L"replaygain", buildReplayGainState());

        JsonArray srvArr;
        for (auto const& se : multiConfig_.servers) {
            JsonObject so;
            put(so, L"id", hstring(se.id));
            put(so, L"name", hstring(se.name));
            put(so, L"server", hstring(se.server));
            put(so, L"user", hstring(se.user));
            srvArr.Append(so);
        }
        m.Insert(L"servers", srvArr);

        JsonObject caps;
        JsonArray albTabs;
        albTabs.Append(JsonValue::CreateStringValue(L"recent"));
        albTabs.Append(JsonValue::CreateStringValue(L"newest"));
        albTabs.Append(JsonValue::CreateStringValue(L"frequent"));
        albTabs.Append(JsonValue::CreateStringValue(L"random"));
        albTabs.Append(JsonValue::CreateStringValue(L"alphabeticalByName"));
        caps.Insert(L"albumTabs", albTabs);
        put(caps, L"topSongs", true);
        JsonArray lovedKinds;
        lovedKinds.Append(JsonValue::CreateStringValue(L"song"));
        if (remoteView_) {
            lovedKinds.Append(JsonValue::CreateStringValue(L"album"));
            lovedKinds.Append(JsonValue::CreateStringValue(L"artist"));
        }
        caps.Insert(L"lovedKinds", lovedKinds);
        put(caps, L"randomMix", true);
        put(caps, L"allSongs", !remoteView_);
        put(caps, L"playlistEdit", remoteView_ ? L"navidrome" : L"foobar");
        m.Insert(L"caps", caps);
        return m;
    }

    void sendSettings() {
        postEvent(L"settings", buildSettings());
    }

    void sendBrowseUpdated(wchar_t const* scope = L"all") {
        if (!ready_) return;
        JsonObject ev;
        put(ev, L"scope", scope);
        put(ev, L"libRev", static_cast<double>(localIndex_.revision()));
        put(ev, L"statsRev", static_cast<double>(localIndex_.statsRevision()));
        put(ev, L"lovedRev", static_cast<double>(localIndex_.lovedRevision()));
        postEvent(L"browse.updated", ev);
    }

    void sendToast(wchar_t const* messageKey, wchar_t const* arg = L"", wchar_t const* kind = L"info") {
        if (!ready_) return;
        JsonObject ev;
        put(ev, L"messageKey", messageKey);
        put(ev, L"arg", arg);
        put(ev, L"kind", kind);
        postEvent(L"toast", ev);
    }

    JsonObject buildTrack() {
        JsonObject state;
        const auto ref = currentStream();
        const bool isRemote = ref.has_value();
        put(state, L"key", static_cast<double>(trackKey_));
        if (isRemote) put(state, L"id", hstring(ref->id));
        else put(state, L"id", current_.is_valid() ? pola::index::LocalLibraryIndex::canonicalTrackId(current_) : std::string{});
        put(state, L"source", isRemote ? L"navidrome" : L"local");
        put(state, L"title", displayMetadata(current_, title_));
        put(state, L"artist", displayMetadata(current_, artist_));
        put(state, L"album", displayMetadata(current_, album_));
        std::string artUrl = current_.is_valid() ? artUrlForHandle(current_, 1200) : std::string{};
        if (artUrl.empty() && !localCoverUrl_.empty()) artUrl = to_string(localCoverUrl_);
        put(state, L"coverUrl", artUrl);
        put(state, L"hue", current_.is_valid() ? hueForHandle(current_) : std::string{});
        put(state, L"length", trackDuration(current_));
        put(state, L"loved", isRemote ? starredSongIds_.contains(ref->id) : (current_.is_valid() && localIndex_.isHandleLoved(current_)));
        return state;
    }

    JsonObject buildPlayback(bool seek) const {
        auto ctl = play_control::get();
        const auto pm = playlist_manager::get();
        const std::string_view order = pm->playback_order_get_name(pm->playback_order_get_active());
        JsonObject state;
        put(state, L"playing", ctl->is_playing());
        put(state, L"paused", ctl->is_paused());
        put(state, L"time", ctl->playback_get_position());
        const auto length = ctl->playback_get_length();
        put(state, L"length", length > 0 ? length : trackDuration(current_));
        put(state, L"volume", std::clamp((static_cast<double>(ctl->get_volume()) + 60.0) / 60.0, 0.0, 1.0));
        put(state, L"shuffle", order.starts_with("Shuffle") || order == "Random");
        put(state, L"repeat", order == "Repeat (track)" ? 2.0 : order == "Repeat (playlist)" ? 1.0 : 0.0);
        put(state, L"seek", seek);
        return state;
    }

    JsonObject buildLyrics() {
        if (currentStream()) return navLyrics();
        return localLyricsInfo();
    }

    void sendPlayback(bool seek) {
        updateTrack();
        postEvent(L"playback", buildPlayback(seek));
    }

    void updateTrack() {
        metadb_handle_ptr track;
        play_control::get()->get_now_playing(track);
        if (current_.get_ptr() != track.get_ptr()) {
            current_ = track;
            ++trackKey_;
            remoteLyrics_.clear();
            remoteLyricsFailed_ = remoteLyricsSynced_ = false;
            lyricsRequest_ = songRequest_ = coverRequest_ = 0;
            remoteLyricsTrack_ = 0;
            localLyrics_.reset();
            localCoverUrl_.clear();
            media_.request(trackKey_, currentStream() ? metadb_handle_ptr{} : current_);
            if (currentStream()) requestRemoteMedia();
            const auto name = displayMetadata(current_, title_);
            const auto caption = name.empty() ? std::wstring(L"PolaPlayer") : (std::wstring(name) + L" \u2014 PolaPlayer");
            SetWindowTextW(wnd_, caption.c_str());
        }
        if (ready_ && sentTrackKey_ != trackKey_) {
            sentTrackKey_ = trackKey_;
            postEvent(L"track", buildTrack());
            postEvent(L"lyrics", buildLyrics());
        }
        auto update = media_.take(trackKey_);
        if (update.lyrics) {
            localLyrics_ = std::move(update.lyrics);
            postEvent(L"lyrics", buildLyrics());
        }
        if (update.cover) {
            localCoverUrl_ = std::move(*update.cover);
            postEvent(L"track", buildTrack());
        }
    }

    std::vector<metadb_handle_ptr> collectPlaylistCoverCands(playlist_manager::ptr const& pm, size_t pl) {
        std::vector<metadb_handle_ptr> cands;
        if (pl >= pm->get_playlist_count()) return cands;
        const size_t cnt = pm->playlist_get_item_count(pl);
        const size_t cap = std::min<size_t>(cnt, 60);
        std::unordered_set<std::string> seen;
        for (size_t i = 0; i < cap && cands.size() < 10; ++i) {
            auto h = pm->playlist_get_item_handle(pl, i);
            if (!h.is_valid()) continue;
            auto k = albumKeyStr(h, albKeyTf_);
            if (seen.insert(std::move(k)).second) cands.push_back(std::move(h));
        }
        return cands;
    }

    std::vector<metadb_handle_ptr> collectLibraryCoverCands(size_t& outLibCount) {
        std::vector<metadb_handle_ptr> cands;
        metadb_handle_list library;
        library_manager::get()->get_all_items(library);
        outLibCount = library.get_count();
        if (outLibCount == 0) return cands;
        const size_t step = std::max<size_t>(1, outLibCount / 400);
        std::unordered_set<std::string> seen;
        for (size_t i = 0; i < outLibCount && cands.size() < 10; i += step) {
            auto h = library[i];
            if (!h.is_valid()) continue;
            auto k = albumKeyStr(h, albKeyTf_);
            if (seen.insert(std::move(k)).second) cands.push_back(std::move(h));
        }
        return cands;
    }

    static bool isInternalRoutePlaylist(playlist_manager::ptr const& pm, size_t pl) {
        if (pl >= pm->get_playlist_count()) return false;
        playlist_manager_v5::ptr pm5;
        if (pm->service_query_t(pm5)) {
            const auto g = pm5->playlist_get_guid(pl);
            if (g != pfc::guid_null && (g == remoteRouteSetting.get() || g == localRouteSetting.get())) return true;
        }
        pfc::string8 name;
        pm->playlist_get_name(pl, name);
        const std::string_view sv(name.c_str(), name.get_length());
        if (sv == "__verdant_np__" || sv == "__verdant_shuffle__" ||
            sv.starts_with("__verdant_") || sv == "PolaPlayer Search Results") {
            return true;
        }
        return false;
    }

    JsonObject buildPlaylists() {
        JsonObject out;
        put(out, L"revision", static_cast<double>(listRev_));
        if (remoteView_) {
            put(out, L"source", L"navidrome");
            put(out, L"loading", catalogRequest_ != 0);
            put(out, L"error", catalogFailed_ ? L"Cannot reach server" : L"");
            if (remotePlaylist_.empty()) out.Insert(L"selected", JsonValue::CreateNullValue());
            else put(out, L"selected", hstring(remotePlaylist_));
            const auto srvK = serverKeyW(navClient().configuration());
            JsonArray arr;
            for (auto const& pl : remotePlaylists_) {
                JsonObject item;
                put(item, L"id", hstring(pl.id));
                put(item, L"name", hstring(pl.name));
                put(item, L"songCount", static_cast<double>(pl.songCount));
                put(item, L"duration", pl.duration);
                put(item, L"editable", pl.editable);
                const auto cov = pl.coverArt.empty() ? std::string{} : pola::ArtServer::navArtUrl(srvK, pl.coverArt, 240);
                put(item, L"coverUrl", cov);
                put(item, L"hue", pl.coverArt.empty() ? std::string{} : artServer_.cachedHue("nv:" + to_string(pl.coverArt)));
                arr.Append(item);
            }
            out.Insert(L"list", arr);
            put(out, L"libCount", 0.0);
            put(out, L"libCoverUrl", L"");
            put(out, L"libHue", L"");
            return out;
        }

        auto pm = playlist_manager::get();
        const auto selected = pm->get_active_playlist();
        const auto total = pm->get_playlist_count();
        size_t libCount = 0;
        auto libCands = collectLibraryCoverCands(libCount);
        artServer_.registerLibraryCandidates(libRev_, std::move(libCands));

        put(out, L"source", L"local");
        put(out, L"loading", false);
        put(out, L"error", L"");
        if (selected < total && !isInternalRoutePlaylist(pm, selected)) put(out, L"selected", playlistGuidId(pm, selected));
        else out.Insert(L"selected", JsonValue::CreateNullValue());

        JsonArray arr;
        for (size_t i = 0; i < total; ++i) {
            if (isInternalRoutePlaylist(pm, i)) continue;
            pfc::string8 name;
            pm->playlist_get_name(i, name);
            const auto gid = playlistGuidId(pm, i);
            auto cands = collectPlaylistCoverCands(pm, i);
            artServer_.registerPlaylistCandidates(gid, listRev_, std::move(cands));

            JsonObject item;
            put(item, L"id", gid);
            put(item, L"name", utf8(name.c_str()));
            put(item, L"songCount", static_cast<double>(pm->playlist_get_item_count(i)));
            put(item, L"duration", 0.0);
            put(item, L"editable", !pm->playlist_lock_is_present(i));
            put(item, L"coverUrl", pola::ArtServer::playlistArtUrl(gid, listRev_, 240));
            put(item, L"hue", artServer_.cachedHue("pl:" + gid));
            arr.Append(item);
        }
        out.Insert(L"list", arr);
        put(out, L"libCount", static_cast<double>(libCount));
        put(out, L"libCoverUrl", pola::ArtServer::libraryArtUrl(libRev_, 240));
        put(out, L"libHue", artServer_.cachedHue("lib"));
        return out;
    }

    void sendPlaylists() {
        const auto payload = buildPlaylists();
        if (postEvent(L"playlists", payload)) sentListRev_ = listRev_;
    }

    void refreshQueue() {
        auto pm = playlist_manager::get();
        pfc::list_t<t_playback_queue_item> manual;
        pm->queue_get_contents(manual);
        std::vector<QueueRow> next;
        for (size_t i = 0; i < manual.get_count(); ++i) {
            if (manual[i].m_handle.is_valid()) {
                next.push_back({manual[i].m_handle, manual[i].m_playlist, i, RowKind::Manual});
            }
        }
        const std::string_view order = pm->playback_order_get_name(pm->playback_order_get_active());
        queueRepeatingTrack_ = (order == "Repeat (track)");
        size_t pl = pm->get_active_playlist(), index = 0, playing = 0, position = 0;
        if (pm->get_playing_item_location(&playing, &position)) {
            pl = playing;
            index = position + 1;
        }
        queueSourceName_.clear();
        if (pl < pm->get_playlist_count()) {
            pfc::string8 pname;
            pm->playlist_get_name(pl, pname);
            playlist_manager_v5::ptr pm5;
            if ((pm->service_query_t(pm5)) &&
                (pm5->playlist_get_guid(pl) == localRouteSetting.get() || pm5->playlist_get_guid(pl) == remoteRouteSetting.get()) &&
                !browseContextName_.empty()) {
                queueSourceName_ = browseContextName_;
            } else {
                queueSourceName_ = pname.c_str();
            }
            if (!queueRepeatingTrack_ && (order == "Default" || order == "Repeat (playlist)")) {
                const auto last = std::min(index + 40, pm->playlist_get_item_count(pl));
                for (auto i = index; i < last; ++i) {
                    auto h = pm->playlist_get_item_handle(pl, i);
                    if (h.is_valid()) next.push_back({h, pl, i, RowKind::Next});
                }
            }
        }
        queue_ = std::move(next);
    }

    JsonObject buildQueue() {
        JsonObject out;
        put(out, L"sourceName", queueSourceName_);
        put(out, L"repeatingTrack", queueRepeatingTrack_);
        JsonArray manualArr, nextArr;
        for (size_t i = 0; i < queue_.size(); ++i) {
            auto const& row = queue_[i];
            JsonObject item;
            put(item, L"index", static_cast<double>(row.index));
            put(item, L"kind", row.kind == RowKind::Manual ? L"manual" : L"next");
            put(item, L"playlistIndex", static_cast<double>(row.playlist));
            put(item, L"itemIndex", static_cast<double>(row.index));
            put(item, L"title", displayMetadata(row.handle, title_));
            put(item, L"artist", displayMetadata(row.handle, artist_));
            put(item, L"album", displayMetadata(row.handle, album_));
            put(item, L"coverUrl", artUrlForHandle(row.handle, 128));
            put(item, L"duration", trackDuration(row.handle));
            if (row.kind == RowKind::Manual) manualArr.Append(item);
            else nextArr.Append(item);
        }
        out.Insert(L"manual", manualArr);
        out.Insert(L"next", nextArr);
        return out;
    }

    void sendQueue() {
        if (postEvent(L"queue", buildQueue())) sentQueueRev_ = queueRev_;
    }

    JsonObject localLyricsInfo() const {
        JsonObject info;
        put(info, L"key", static_cast<double>(trackKey_));
        put(info, L"heading", L"LYRICS");
        put(info, L"remote", false);
        put(info, L"status", current_.is_valid() && !localLyrics_ ? L"loading" : L"ready");
        if (localLyrics_ && !localLyrics_->lines.empty()) {
            JsonArray lines;
            for (const auto& lyric : localLyrics_->lines) {
                JsonObject line;
                put(line, L"text", hstring(lyric.text));
                if (localLyrics_->synced) put(line, L"t", double(lyric.timeMs) / 1000.0);
                lines.Append(line);
            }
            JsonObject model;
            put(model, L"synced", localLyrics_->synced);
            model.Insert(L"lines", lines);
            info.Insert(L"model", model);
        } else {
            info.Insert(L"model", JsonValue::CreateNullValue());
        }
        return info;
    }

    JsonObject navLyrics() {
        const auto ref = currentStream();
        if (ref && !songRequest_ && remoteLyricsTrack_ != trackKey_) {
            remoteLyricsTrack_ = trackKey_;
            const auto song = streamMetadata(current_);
            if (ref->server == serverKey(navClient().configuration()))
                lyricsRequest_ = navClient().request(nv::Action::Lyrics, ref->id, song ? song->artist : L"", song ? song->title : L"");
        }
        JsonObject info;
        put(info, L"key", static_cast<double>(trackKey_));
        put(info, L"heading", L"NAVIDROME LYRICS");
        put(info, L"remote", true);
        put(info, L"status", lyricsRequest_ || songRequest_ ? L"loading" : remoteLyricsFailed_ ? L"error" : L"ready");
        if (remoteLyrics_.empty()) {
            info.Insert(L"model", JsonValue::CreateNullValue());
        } else {
            JsonObject model;
            put(model, L"synced", remoteLyricsSynced_);
            JsonArray rows;
            for (const auto& row : remoteLyrics_) {
                JsonObject line;
                if (remoteLyricsSynced_ && row.time >= 0) put(line, L"t", row.time);
                put(line, L"text", hstring(row.text));
                rows.Append(line);
            }
            model.Insert(L"lines", rows);
            info.Insert(L"model", model);
        }
        return info;
    }

    metadb_handle_ptr navHandle(nv::Song const& song) {
        const auto path = streamPath(song);
        if (path.empty()) return {};
        rememberSong(song);
        return metadb::get()->handle_create(path.c_str(), 0);
    }

    void rememberSong(nv::Song const& song) {
        if (remoteMetadata_.size() >= 8192 && !remoteMetadata_.contains(song.id))
            remoteMetadata_.erase(remoteMetadata_.begin());
        remoteMetadata_.insert_or_assign(song.id, song);
    }

    void requestRemoteMedia() {
        const auto ref = currentStream();
        if (!ref || ref->server != serverKey(navClient().configuration()) || !remoteEnabled.get()) return;
        if (const auto song = streamMetadata(current_)) {
            if (!song->coverArt.empty()) coverRequest_ = navClient().request(nv::Action::Cover, song->coverArt);
        } else {
            songRequest_ = navClient().request(nv::Action::Song, ref->id);
        }
    }

    bool playRemoteList(std::vector<nv::Song> const& songs, size_t index, std::string const& contextName = {}, bool isRandom = false) {
        metadb_handle_list items;
        size_t selected = SIZE_MAX;
        for (size_t i = 0; i < songs.size(); ++i) {
            const auto h = navHandle(songs[i]);
            if (h.is_valid()) {
                if (i == index) selected = items.get_count();
                items.add_item(h);
            }
        }
        if (selected == SIZE_MAX) return false;
        auto pm = playlist_manager_v5::get();
        auto pl = pm->find_playlist_by_guid(remoteRouteSetting.get());
        if (pl < pm->get_playlist_count()) {
            metadb_handle_list existing;
            pm->playlist_get_all_items(pl, existing);
            for (size_t i = 0; i < existing.get_count(); ++i) {
                if (!streamRef(existing[i]->get_path())) { pl = SIZE_MAX; break; }
            }
        }
        if (pl >= pm->get_playlist_count() || pm->playlist_lock_is_present(pl)) {
            pl = pm->create_playlist("PolaPlayer Navidrome", SIZE_MAX, SIZE_MAX);
            if (pl >= pm->get_playlist_count()) return false;
            remoteRouteSetting.set(pm->playlist_get_guid(pl));
        }
        browseContextName_ = contextName;
        radioMixActive_ = isRandom;
        const auto oldCount = pm->playlist_get_item_count(pl);
        const auto start = pm->playlist_insert_items(pl, oldCount, items, pfc::bit_array_false());
        if (start == SIZE_MAX) return false;
        if (oldCount && start == oldCount) {
            pfc::bit_array_bittable remove(pm->playlist_get_item_count(pl));
            for (size_t i = 0; i < oldCount; ++i) remove.set(i, true);
            if (pm->playlist_remove_items(pl, remove)) {
                ++queueRev_;
                return pm->playlist_execute_default_action(pl, selected);
            }
        }
        ++queueRev_;
        return pm->playlist_execute_default_action(pl, start + selected);
    }

    void appendRemoteRandomSongs(std::vector<nv::Song> const& batch) {
        if (batch.empty()) return;
        std::unordered_set<std::wstring> existingIds;
        for (auto const& s : remoteRandomSongs_) existingIds.insert(s.id);
        metadb_handle_list add;
        for (auto const& s : batch) {
            if (!existingIds.insert(s.id).second) continue;
            remoteRandomSongs_.push_back(s);
            auto h = navHandle(s);
            if (h.is_valid()) add.add_item(h);
        }
        if (add.get_count() == 0) return;
        auto pm = playlist_manager_v5::get();
        auto pl = pm->find_playlist_by_guid(remoteRouteSetting.get());
        if (pl < pm->get_playlist_count() && !pm->playlist_lock_is_present(pl)) {
            pm->playlist_insert_items(pl, pm->playlist_get_item_count(pl), add, pfc::bit_array_false());
            ++queueRev_;
        }
    }

    static bool playLibraryTrack(playlist_manager::ptr const& pm, metadb_handle_ptr const& handle) {
        if (!handle.is_valid()) return false;
        const auto pl = pm->find_or_create_playlist_unlocked("PolaPlayer Search Results");
        if (pl >= pm->get_playlist_count()) return false;
        auto index = pm->playlist_get_item_count(pl);
        for (size_t i = 0; i < index; ++i) {
            if (pm->playlist_get_item_handle(pl, i).get_ptr() == handle.get_ptr())
                return pm->playlist_execute_default_action(pl, i);
        }
        metadb_handle_list add;
        add.add_item(handle);
        if (!pm->playlist_add_items(pl, add, pfc::bit_array_false())) return false;
        return pm->playlist_execute_default_action(pl, index);
    }

    void refreshRemoteCatalog() {
        catalogFailed_ = false;
        catalogRequest_ = 0;
        if (configured(navClient().configuration()))
            catalogRequest_ = navClient().request(nv::Action::Playlists);
        else catalogFailed_ = true;
        ++listRev_;
        sendPlaylists();
    }

    void selectSource(bool remote) {
        const bool next = remote && remoteEnabled.get();
        activeSourceRemoteSetting.set(next);
        if (next == remoteView_) return;
        remoteView_ = next;
        searchFilter_.release();
        searchCandidates_.clear();
        searchResults_.clear();
        rowsRequest_ = 0;
        ++searchRev_;
        ++listRev_;
        if (remoteView_) refreshRemoteCatalog();
        else sendPlaylists();
        sendSettings();
    }

    JsonObject buildPlaylistTracksResponse(
        std::wstring_view plIdW, size_t offset, size_t limit,
        std::wstring_view sortKey = L"default", bool asc = true) {
        JsonObject out;
        limit = std::clamp<size_t>(limit, 1, 500);
        if (remoteView_) {
            const auto plIt = std::find_if(remotePlaylists_.begin(), remotePlaylists_.end(),
                [&](auto const& p) { return p.id == plIdW; });
            JsonObject meta;
            put(meta, L"id", std::wstring(plIdW));
            put(meta, L"name", plIt != remotePlaylists_.end() ? hstring(plIt->name) : hstring(L"Playlist"));
            put(meta, L"songCount", plIt != remotePlaylists_.end() ? static_cast<double>(plIt->songCount) : 0.0);
            put(meta, L"duration", plIt != remotePlaylists_.end() ? plIt->duration : 0.0);
            put(meta, L"editable", plIt != remotePlaylists_.end() && plIt->editable);
            const auto srvK = serverKeyW(navClient().configuration());
            std::string cov = (plIt != remotePlaylists_.end() && !plIt->coverArt.empty())
                ? pola::ArtServer::navArtUrl(srvK, plIt->coverArt, 400) : std::string{};
            put(meta, L"coverUrl", cov);
            put(meta, L"hue", (plIt != remotePlaylists_.end() && !plIt->coverArt.empty())
                ? artServer_.cachedHue("nv:" + to_string(plIt->coverArt)) : std::string{});

            put(out, L"id", std::wstring(plIdW));
            put(out, L"revision", static_cast<double>(listRev_));
            put(out, L"status", rowsRequest_ ? L"loading" : remoteRowsFailed_ ? L"error" : L"ready");
            put(out, L"error", remoteRowsFailed_ ? L"Failed to load playlist" : L"");
            put(out, L"total", static_cast<double>(remoteSongs_.size()));
            put(out, L"offset", static_cast<double>(offset));
            out.Insert(L"meta", meta);

            const auto perm = sortRemotePermutation(remoteSongs_, sortKey, asc);
            JsonArray rows;
            const auto end = std::min(offset + limit, perm.size());
            for (size_t i = offset; i < end; ++i) {
                const size_t orig = perm[i];
                JsonObject row = navTrackJson(remoteSongs_[orig], i, srvK);
                put(row, L"origIndex", static_cast<double>(orig));
                rows.Append(row);
            }
            out.Insert(L"rows", rows);
            return out;
        }

        localIndex_.ensureBuilt();
        auto pm = playlist_manager::get();
        size_t pl = findPlaylistById(pm, plIdW);
        if (pl >= pm->get_playlist_count()) pl = pm->get_active_playlist();
        if (pl >= pm->get_playlist_count()) {
            put(out, L"id", std::wstring(plIdW));
            put(out, L"revision", static_cast<double>(listRev_));
            put(out, L"status", L"ready");
            put(out, L"total", 0.0);
            put(out, L"offset", 0.0);
            out.Insert(L"rows", JsonArray{});
            return out;
        }
        pfc::string8 pname;
        pm->playlist_get_name(pl, pname);
        const auto gid = playlistGuidId(pm, pl);
        const auto cnt = pm->playlist_get_item_count(pl);
        double totalDur = 0;
        for (size_t i = 0; i < cnt; ++i) totalDur += trackDuration(pm->playlist_get_item_handle(pl, i));

        JsonObject meta;
        put(meta, L"id", gid);
        put(meta, L"name", utf8(pname.c_str()));
        put(meta, L"songCount", static_cast<double>(cnt));
        put(meta, L"duration", totalDur);
        put(meta, L"editable", !pm->playlist_lock_is_present(pl));
        put(meta, L"coverUrl", pola::ArtServer::playlistArtUrl(gid, listRev_, 400));
        put(meta, L"hue", artServer_.cachedHue("pl:" + gid));

        put(out, L"id", gid);
        put(out, L"revision", static_cast<double>(listRev_));
        put(out, L"status", L"ready");
        put(out, L"error", L"");
        put(out, L"total", static_cast<double>(cnt));
        put(out, L"offset", static_cast<double>(offset));
        out.Insert(L"meta", meta);

        const auto perm = pola::index::LocalLibraryIndex::sortPlaylistPermutation(pm, pl, to_string(sortKey), asc);
        JsonArray rows;
        const auto end = std::min(offset + limit, perm.size());
        for (size_t i = offset; i < end; ++i) {
            const size_t origIdx = perm[i];
            auto h = pm->playlist_get_item_handle(pl, origIdx);
            if (!h.is_valid()) continue;
            const auto libIdx = localIndex_.findTrackIndex(h);
            JsonObject row;
            put(row, L"index", static_cast<double>(i));
            put(row, L"origIndex", static_cast<double>(origIdx));
            put(row, L"id", pola::index::LocalLibraryIndex::canonicalTrackId(h));
            if (libIdx != SIZE_MAX) {
                auto const& tr = localIndex_.tracks()[libIdx];
                put(row, L"title", tr.title);
                put(row, L"artist", tr.artist);
                put(row, L"album", tr.album);
                put(row, L"albumId", tr.albumKey);
                put(row, L"artistId", tr.albumArtist);
                put(row, L"duration", tr.duration);
                put(row, L"coverUrl", localIndex_.trackCoverUrl(tr, 128));
                put(row, L"hueKey", tr.artHash.empty() ? std::string{} : ("track:" + tr.artHash));
                put(row, L"loved", localIndex_.isHandleLoved(h));
                put(row, L"playCount", static_cast<double>(localIndex_.trackPlayCount(h)));
            } else {
                put(row, L"title", displayMetadata(h, title_));
                put(row, L"artist", displayMetadata(h, artist_));
                put(row, L"album", displayMetadata(h, album_));
                put(row, L"albumId", L"");
                put(row, L"artistId", L"");
                put(row, L"duration", trackDuration(h));
                put(row, L"coverUrl", artUrlForHandle(h, 128));
                put(row, L"hueKey", L"");
                put(row, L"loved", localIndex_.isHandleLoved(h));
                put(row, L"playCount", static_cast<double>(localIndex_.trackPlayCount(h)));
            }
            rows.Append(row);
        }
        out.Insert(L"rows", rows);
        return out;
    }

    JsonObject localTrackJson(std::size_t libIdx, std::size_t displayIdx) {
        auto const& tr = localIndex_.tracks()[libIdx];
        JsonObject row;
        put(row, L"index", static_cast<double>(displayIdx));
        put(row, L"origIndex", static_cast<double>(libIdx));
        put(row, L"id", tr.trackId);
        put(row, L"title", tr.title);
        put(row, L"artist", tr.artist);
        put(row, L"album", tr.album);
        put(row, L"albumId", tr.albumKey);
        put(row, L"artistId", tr.albumArtist);
        put(row, L"duration", tr.duration);
        put(row, L"coverUrl", localIndex_.trackCoverUrl(tr, 128));
        put(row, L"hueKey", tr.artHash.empty() ? std::string{} : ("track:" + tr.artHash));
        put(row, L"loved", localIndex_.isHandleLoved(tr.handle));
        put(row, L"playCount", static_cast<double>(localIndex_.trackPlayCount(tr.handle)));
        return row;
    }

    JsonObject localAlbumJson(std::size_t albIdx, int artSize = 400) {
        auto const& a = localIndex_.albums()[albIdx];
        JsonObject obj;
        put(obj, L"id", a.id);
        put(obj, L"name", a.name);
        put(obj, L"artist", a.artist);
        put(obj, L"artistId", a.artistId);
        put(obj, L"year", a.year);
        put(obj, L"songCount", static_cast<double>(a.trackIndices.size()));
        put(obj, L"duration", a.duration);
        put(obj, L"coverUrl", localIndex_.albumCoverUrl(a, artSize));
        put(obj, L"hue", localIndex_.albumHue(a));
        put(obj, L"hueKey", a.coverHash.empty() ? std::string{} : ("track:" + a.coverHash));
        put(obj, L"loved", false);
        return obj;
    }

    JsonObject localArtistJson(std::size_t artIdx, int artSize = 360) {
        auto const& ar = localIndex_.artists()[artIdx];
        JsonObject obj;
        put(obj, L"id", ar.id);
        put(obj, L"name", ar.name);
        put(obj, L"albumCount", static_cast<double>(ar.albumIndices.size()));
        put(obj, L"songCount", static_cast<double>(ar.trackIndices.size()));
        put(obj, L"coverUrl", localIndex_.artistCoverUrl(ar, artSize));
        put(obj, L"hue", localIndex_.artistHue(ar));
        put(obj, L"hueKey", "ar:" + ar.id);
        put(obj, L"loved", false);
        return obj;
    }

    bool playLocalHandles(metadb_handle_list const& items, size_t startIndex, std::string const& contextName, bool isRandomMix) {
        if (items.get_count() == 0) return false;
        if (startIndex >= items.get_count()) startIndex = 0;
        auto pm = playlist_manager_v5::get();
        auto pl = pm->find_playlist_by_guid(localRouteSetting.get());
        if (pl >= pm->get_playlist_count() || pm->playlist_lock_is_present(pl)) {
            pl = pm->create_playlist("PolaPlayer Playback", SIZE_MAX, SIZE_MAX);
            if (pl >= pm->get_playlist_count()) return false;
            localRouteSetting.set(pm->playlist_get_guid(pl));
        }
        const auto oldCount = pm->playlist_get_item_count(pl);
        const auto start = pm->playlist_insert_items(pl, oldCount, items, pfc::bit_array_false());
        if (start == SIZE_MAX) return false;
        browseContextName_ = contextName;
        radioMixActive_ = isRandomMix;
        bool okPlay = false;
        if (oldCount && start == oldCount) {
            pfc::bit_array_bittable remove(pm->playlist_get_item_count(pl));
            for (size_t i = 0; i < oldCount; ++i) remove.set(i, true);
            if (pm->playlist_remove_items(pl, remove)) {
                okPlay = pm->playlist_execute_default_action(pl, startIndex);
                ++queueRev_;
                return okPlay;
            }
        }
        okPlay = pm->playlist_execute_default_action(pl, start + startIndex);
        ++queueRev_;
        return okPlay;
    }

    void appendLocalHandlesToRoute(std::vector<std::size_t> const& trackIndices) {
        if (trackIndices.empty()) return;
        auto pm = playlist_manager_v5::get();
        auto pl = pm->find_playlist_by_guid(localRouteSetting.get());
        if (pl >= pm->get_playlist_count() || pm->playlist_lock_is_present(pl)) return;
        metadb_handle_list items;
        auto const& all = localIndex_.tracks();
        for (std::size_t ti : trackIndices) {
            if (ti < all.size() && all[ti].handle.is_valid()) items.add_item(all[ti].handle);
        }
        if (items.get_count() > 0) {
            pm->playlist_insert_items(pl, pm->playlist_get_item_count(pl), items, pfc::bit_array_false());
            ++queueRev_;
        }
    }

    void maybeTopUpRandomMix() {
        if (!radioMixActive_) return;
        auto pm = playlist_manager_v5::get();
        size_t playingPl = 0, pos = 0;
        if (!pm->get_playing_item_location(&playingPl, &pos)) return;
        if (playingPl >= pm->get_playlist_count()) return;
        playlist_manager_v5::ptr pm5;
        if (!(pm->service_query_t(pm5))) return;
        const auto plGuid = pm5->playlist_get_guid(playingPl);
        const size_t cnt = pm->playlist_get_item_count(playingPl);
        if (pos + 1 + 5 < cnt) return;

        if (!currentStream() && !remoteView_ && plGuid == localRouteSetting.get()) {
            localIndex_.ensureBuilt();
            auto extra = localIndex_.randomMore(40);
            if (!extra.empty()) {
                appendLocalHandlesToRoute(extra);
                sendBrowseUpdated(L"random");
            }
        } else if (currentStream() && !remoteRandomToppingUp_ && plGuid == remoteRouteSetting.get()) {
            remoteRandomToppingUp_ = true;
            randomTopUpReq_ = navClient().request(nv::Action::RandomSongs, L"append", {}, {}, 40);
        }
    }

    void updatePlayStatsAndTopUp() {
        const uint64_t now = GetTickCount64();
        if (statsTrackKey_ != trackKey_) {
            statsTrackKey_ = trackKey_;
            statsAccumMs_ = 0;
            statsRecorded_ = false;
            scrobbled_ = false;
            statsLastTickMs_ = now;
        }
        auto ctl = play_control::get();
        if (ctl->is_playing() && !ctl->is_paused() && trackKey_ > 0 && current_.is_valid()) {
            const uint64_t dt = (statsLastTickMs_ > 0 && now >= statsLastTickMs_)
                ? std::min<uint64_t>(now - statsLastTickMs_, 1000) : 0;
            statsAccumMs_ += dt;
            if (const auto ref = currentStream()) {
                if (!scrobbled_) {
                    const double len = ctl->playback_get_length() > 0 ? ctl->playback_get_length() : trackDuration(current_);
                    if (pola::nav::pure::shouldScrobble(static_cast<double>(statsAccumMs_) / 1000.0, len)) {
                        scrobbled_ = true;
                        navClient().requestScrobble(ref->id, pola::index::currentEpochMs());
                    }
                }
            } else if (!statsRecorded_ && statsAccumMs_ >= 30000) {
                statsRecorded_ = true;
                localIndex_.ensureBuilt();
                localIndex_.recordPlay(current_);
                sendBrowseUpdated(L"stats");
            }
            maybeTopUpRandomMix();
        }
        statsLastTickMs_ = now;
        localIndex_.saveStatsIfDue();
    }

    static bool isWritableTrackPath(const char* p) {
        if (!p || !*p) return false;
        std::string_view sv(p);
        if (sv.starts_with("polanav://") || sv.starts_with("http://") || sv.starts_with("https://") || sv.starts_with("cdda://"))
            return false;
        return true;
    }

    JsonObject startToggleLocalLoved(metadb_handle_ptr const& h, bool confirmed) {
        JsonObject res;
        if (!h.is_valid() || !isWritableTrackPath(h->get_path())) {
            put(res, L"ok", false);
            put(res, L"needsConfirm", false);
            sendToast(L"err.loved_write_failed", L"LOVED", L"error");
            return res;
        }
        if (!lovedConfirmedSetting.get() && !confirmed) {
            put(res, L"ok", false);
            put(res, L"needsConfirm", true);
            return res;
        }
        if (confirmed && !lovedConfirmedSetting.get()) {
            lovedConfirmedSetting.set(true);
            sendSettings();
        }

        const bool targetLoved = !localIndex_.isHandleLoved(h);
        localIndex_.setOptimisticLoved(h, targetLoved);
        if (current_.is_valid() && current_.get_ptr() == h.get_ptr()) {
            postEvent(L"track", buildTrack());
        }
        sendBrowseUpdated(L"loved");

        auto filter = file_info_filter::create([targetLoved](trackRef, t_filestats, file_info& info) -> bool {
            if (targetLoved) info.meta_set("LOVED", "1");
            else info.meta_remove_field("LOVED");
            return true;
        });

        auto alive = alive_;
        const std::string trackId = pola::index::LocalLibraryIndex::canonicalTrackId(h);
        auto notify = fb2k::service_new<LovedCompletion>();
        notify->setup([this, alive, h, trackId](unsigned code) {
            if (!alive || !*alive) return;
            if (code != metadb_io::update_info_success) {
                auto opt = localIndex_.takeOptimisticLoved(trackId);
                if (opt) {
                    localIndex_.invalidateLibrary();
                    localIndex_.ensureBuilt();
                    sendToast(L"err.loved_write_failed", L"LOVED", L"error");
                    if (current_.is_valid() && current_.get_ptr() == h.get_ptr()) postEvent(L"track", buildTrack());
                    sendBrowseUpdated(L"loved");
                }
            }
        });

        metadb_handle_list list;
        list.add_item(h);
        metadb_io_v2::get()->update_info_async(
            list, filter, wnd_,
            metadb_io_v2::op_flag_silent | metadb_io_v2::op_flag_no_errors,
            notify);

        put(res, L"ok", true);
        put(res, L"needsConfirm", false);
        put(res, L"loved", targetLoved);
        return res;
    }

    void startSearch() {
        searchFailed_ = false;
        searchCandidates_.clear();
        searchResults_.clear();
        searchCursor_ = 0;
        searchFilter_.release();
        ++searchRev_;
        if (query_.empty()) {
            sendSearchStatus();
            return;
        }
        try {
            const auto filter = to_string(query_);
            searchFilter_ = search_filter_manager::get()->create(filter.c_str());
            auto pm = playlist_manager::get();
            const auto pl = pm->get_active_playlist();
            std::unordered_set<const void*> seen;
            if (pl < pm->get_playlist_count()) {
                metadb_handle_list active;
                pm->playlist_get_all_items(pl, active);
                for (size_t i = 0; i < active.get_count(); ++i) {
                    const auto h = active[i];
                    if (h.is_valid() && seen.insert(h.get_ptr()).second) searchCandidates_.push_back(h);
                }
            }
            metadb_handle_list library;
            library_manager::get()->get_all_items(library);
            for (size_t i = 0; i < library.get_count(); ++i) {
                const auto h = library[i];
                if (h.is_valid() && seen.insert(h.get_ptr()).second) searchCandidates_.push_back(h);
            }
        } catch (...) {
            searchFailed_ = true;
            searchFilter_.release();
        }
        sendSearchStatus();
    }

    void advanceSearch() {
        if (!searchFilter_.is_valid()) return;
        constexpr size_t batchSize = 512;
        const auto last = std::min(searchCursor_ + batchSize, searchCandidates_.size());
        try {
            metadb_handle_list batch;
            for (auto i = searchCursor_; i < last; ++i) batch.add_item(searchCandidates_[i]);
            bool matches[batchSize]{};
            if (batch.get_count()) searchFilter_->test_multi(batch, matches);
            for (auto i = searchCursor_; i < last; ++i) {
                if (matches[i - searchCursor_]) searchResults_.push_back(searchCandidates_[i]);
            }
            searchCursor_ = last;
            if (last == searchCandidates_.size()) {
                searchFilter_.release();
                searchCandidates_.clear();
                ++searchRev_;
                sendSearchStatus();
            }
        } catch (...) {
            searchFilter_.release();
            searchCandidates_.clear();
            searchResults_.clear();
            searchFailed_ = true;
            ++searchRev_;
            sendSearchStatus();
        }
    }

    void sendSearchStatus() {
        JsonObject m;
        put(m, L"source", remoteView_ ? L"navidrome" : L"local");
        put(m, L"query", query_);
        put(m, L"revision", static_cast<double>(searchRev_));
        if (remoteView_) {
            put(m, L"status", query_.empty() ? L"idle" : rowsRequest_ ? L"loading" : remoteRowsFailed_ ? L"error" : L"ready");
            put(m, L"count", static_cast<double>(remoteSongs_.size()));
        } else {
            put(m, L"status", query_.empty() ? L"idle" : searchFailed_ ? L"error" : searchFilter_.is_valid() ? L"loading" : L"ready");
            put(m, L"count", static_cast<double>(searchFilter_.is_valid() ? 0 : searchResults_.size()));
        }
        postEvent(L"search.updated", m);
    }

    JsonObject buildSearchPage(size_t offset, size_t limit) {
        JsonObject out;
        limit = std::clamp<size_t>(limit, 1, 300);
        put(out, L"revision", static_cast<double>(searchRev_));
        put(out, L"offset", static_cast<double>(offset));
        JsonArray rows;
        const auto srvK = serverKeyW(navClient().configuration());
        if (remoteView_) {
            const auto end = std::min(offset + limit, remoteSongs_.size());
            put(out, L"total", static_cast<double>(remoteSongs_.size()));
            for (size_t i = offset; i < end; ++i) rows.Append(navTrackJson(remoteSongs_[i], i, srvK));
        } else {
            const auto end = std::min(offset + limit, searchResults_.size());
            put(out, L"total", static_cast<double>(searchResults_.size()));
            for (size_t i = offset; i < end; ++i) {
                auto const& h = searchResults_[i];
                JsonObject row;
                put(row, L"index", static_cast<double>(i));
                put(row, L"id", artServer_.registerTrack(h));
                put(row, L"title", displayMetadata(h, title_));
                put(row, L"artist", displayMetadata(h, artist_));
                put(row, L"album", displayMetadata(h, album_));
                put(row, L"duration", trackDuration(h));
                put(row, L"coverUrl", artUrlForHandle(h, 128));
                put(row, L"loved", false);
                rows.Append(row);
            }
        }
        out.Insert(L"rows", rows);
        return out;
    }

    static std::vector<size_t> sortRemotePermutation(std::vector<nv::Song> const& list, std::wstring_view sortKey, bool asc) {
        std::vector<size_t> perm(list.size());
        for (size_t i = 0; i < list.size(); ++i) perm[i] = i;
        if (sortKey != L"default") {
            auto keyOf = [&](nv::Song const& s) -> std::string {
                if (sortKey == L"title") return pola::index::lowerAscii(to_string(s.title));
                if (sortKey == L"artist") return pola::index::lowerAscii(to_string(s.artist));
                if (sortKey == L"album") return pola::index::lowerAscii(to_string(s.album));
                return {};
            };
            std::stable_sort(perm.begin(), perm.end(), [&](size_t a, size_t b) {
                if (sortKey == L"dur") return list[a].duration < list[b].duration;
                const auto ka = keyOf(list[a]);
                const auto kb = keyOf(list[b]);
                if (ka != kb) return ka < kb;
                return a < b;
            });
        }
        if (!asc) std::reverse(perm.begin(), perm.end());
        return perm;
    }

    static nv::Config serverEntryToConfig(nv::ServerEntry const& se) {
        return {se.server, se.user, se.password};
    }

    std::optional<nv::Config> activeMultiConfig() const {
        if (multiConfig_.servers.empty()) return std::nullopt;
        for (auto const& s : multiConfig_.servers) {
            if (!multiConfig_.activeId.empty() && s.id == multiConfig_.activeId)
                return serverEntryToConfig(s);
        }
        return serverEntryToConfig(multiConfig_.servers.front());
    }

    bool isNavStarred(std::wstring_view kind, std::wstring const& id, bool itemFlag) const {
        if (kind == L"song") return starredSongIds_.contains(id) || (!remoteStarred_.loaded && itemFlag);
        if (kind == L"album") return starredAlbumIds_.contains(id) || (!remoteStarred_.loaded && itemFlag);
        if (kind == L"artist") return starredArtistIds_.contains(id) || (!remoteStarred_.loaded && itemFlag);
        return itemFlag;
    }

    void setLocalStarredCache(std::wstring_view kind, std::wstring const& targetId, bool starred) {
        auto updateSet = [&](std::unordered_set<std::wstring>& set) {
            if (starred) set.insert(targetId);
            else set.erase(targetId);
        };
        if (kind == L"song") {
            updateSet(starredSongIds_);
            if (auto it = remoteMetadata_.find(targetId); it != remoteMetadata_.end()) it->second.starred = starred;
            for (auto& s : remoteSongs_) if (s.id == targetId) s.starred = starred;
            for (auto& s : remoteRandomSongs_) if (s.id == targetId) s.starred = starred;
            for (auto& s : remoteLastSearchSongs_) if (s.id == targetId) s.starred = starred;
            for (auto& [k, alb] : remoteAlbumDetails_) {
                for (auto& s : alb.songs) if (s.id == targetId) s.starred = starred;
            }
            for (auto& [k, art] : remoteArtistDetails_) {
                for (auto& s : art.topSongs) if (s.id == targetId) s.starred = starred;
            }
        } else if (kind == L"album") {
            updateSet(starredAlbumIds_);
            for (auto& [k, vec] : remoteAlbumsByTab_) {
                for (auto& a : vec) if (a.id == targetId) a.starred = starred;
            }
            if (auto it = remoteAlbumDetails_.find(targetId); it != remoteAlbumDetails_.end())
                it->second.meta.starred = starred;
            for (auto& a : remoteLastSearchAlbums_) if (a.id == targetId) a.starred = starred;
            for (auto& [k, art] : remoteArtistDetails_) {
                for (auto& a : art.albums) if (a.id == targetId) a.starred = starred;
            }
        } else if (kind == L"artist") {
            updateSet(starredArtistIds_);
            for (auto& ar : remoteArtists_) if (ar.id == targetId) ar.starred = starred;
            if (auto it = remoteArtistDetails_.find(targetId); it != remoteArtistDetails_.end())
                it->second.meta.starred = starred;
            for (auto& ar : remoteLastSearchArtists_) if (ar.id == targetId) ar.starred = starred;
        }
    }

    JsonObject navTrackJson(nv::Song const& s, size_t idx, std::wstring const& srvK) {
        JsonObject row;
        put(row, L"index", static_cast<double>(idx));
        put(row, L"origIndex", static_cast<double>(idx));
        put(row, L"id", hstring(s.id));
        put(row, L"title", hstring(s.title));
        put(row, L"artist", hstring(s.artist));
        put(row, L"album", hstring(s.album));
        put(row, L"albumId", hstring(s.albumId));
        put(row, L"artistId", hstring(s.artistId));
        put(row, L"duration", s.duration);
        put(row, L"coverUrl", s.coverArt.empty() ? std::string{} : pola::ArtServer::navArtUrl(srvK, s.coverArt, 128));
        put(row, L"hueKey", s.coverArt.empty() ? std::string{} : ("nv:" + to_string(s.coverArt)));
        put(row, L"loved", isNavStarred(L"song", s.id, s.starred));
        put(row, L"playCount", static_cast<double>(s.playCount));
        return row;
    }

    JsonObject navAlbumJson(nv::Album const& a, int artSize, std::wstring const& srvK) {
        JsonObject obj;
        put(obj, L"id", hstring(a.id));
        put(obj, L"name", hstring(a.name));
        put(obj, L"artist", hstring(a.artist));
        put(obj, L"artistId", hstring(a.artistId));
        put(obj, L"year", hstring(a.year));
        put(obj, L"songCount", static_cast<double>(a.songCount));
        put(obj, L"duration", a.duration);
        put(obj, L"coverUrl", a.coverArt.empty() ? std::string{} : pola::ArtServer::navArtUrl(srvK, a.coverArt, artSize));
        put(obj, L"hue", a.coverArt.empty() ? std::string{} : artServer_.cachedHue("nv:" + to_string(a.coverArt)));
        put(obj, L"hueKey", a.coverArt.empty() ? std::string{} : ("nv:" + to_string(a.coverArt)));
        put(obj, L"loved", isNavStarred(L"album", a.id, a.starred));
        return obj;
    }

    JsonObject navArtistJson(nv::Artist const& ar, int artSize, std::wstring const& srvK) {
        JsonObject obj;
        put(obj, L"id", hstring(ar.id));
        put(obj, L"name", hstring(ar.name));
        put(obj, L"albumCount", static_cast<double>(ar.albumCount));
        put(obj, L"songCount", 0.0);
        put(obj, L"coverUrl", ar.coverArt.empty() ? std::string{} : pola::ArtServer::navArtUrl(srvK, ar.coverArt, artSize));
        put(obj, L"hue", ar.coverArt.empty() ? std::string{} : artServer_.cachedHue("nv:" + to_string(ar.coverArt)));
        put(obj, L"hueKey", ar.coverArt.empty() ? std::string{} : ("nv:" + to_string(ar.coverArt)));
        put(obj, L"loved", isNavStarred(L"artist", ar.id, ar.starred));
        return obj;
    }

    JsonObject navHomeJson() {
        const auto srvK = serverKeyW(navClient().configuration());
        JsonObject ok;
        JsonArray albumsArr, artArr;
        if (const auto it = remoteAlbumsByTab_.find(L"recent"); it != remoteAlbumsByTab_.end()) {
            const size_t cap = std::min<size_t>(12, it->second.size());
            for (size_t i = 0; i < cap; ++i) albumsArr.Append(navAlbumJson(it->second[i], 360, srvK));
        }
        const size_t artCap = std::min<size_t>(12, remoteArtists_.size());
        for (size_t i = 0; i < artCap; ++i) artArr.Append(navArtistJson(remoteArtists_[i], 280, srvK));
        ok.Insert(L"recentAlbums", albumsArr);
        ok.Insert(L"artists", artArr);
        put(ok, L"totalAlbums", static_cast<double>(remoteAlbumsByTab_[L"recent"].size()));
        put(ok, L"totalArtists", static_cast<double>(remoteArtists_.size()));
        put(ok, L"totalSongs", 0.0);
        return ok;
    }

    JsonObject navAlbumsJson(std::wstring const& tab, size_t offset, size_t limit) {
        const auto srvK = serverKeyW(navClient().configuration());
        JsonObject ok;
        JsonArray arr;
        auto const& list = remoteAlbumsByTab_[tab];
        const size_t end = std::min(offset + limit, list.size());
        for (size_t i = offset; i < end; ++i) arr.Append(navAlbumJson(list[i], 360, srvK));
        const bool hasMore = end < list.size() || remoteAlbumsHasMore_[tab];
        put(ok, L"tab", hstring(tab));
        put(ok, L"offset", static_cast<double>(offset));
        put(ok, L"total", static_cast<double>(list.size()));
        put(ok, L"hasMore", hasMore);
        ok.Insert(L"items", arr);
        return ok;
    }

    JsonObject navAlbumDetailJson(std::wstring const& albumId) {
        const auto srvK = serverKeyW(navClient().configuration());
        JsonObject ok;
        if (const auto it = remoteAlbumDetails_.find(albumId); it != remoteAlbumDetails_.end()) {
            ok.Insert(L"meta", navAlbumJson(it->second.meta, 480, srvK));
            JsonArray rows;
            for (size_t i = 0; i < it->second.songs.size(); ++i)
                rows.Append(navTrackJson(it->second.songs[i], i, srvK));
            ok.Insert(L"rows", rows);
            put(ok, L"total", static_cast<double>(it->second.songs.size()));
            put(ok, L"found", true);
        } else {
            ok.Insert(L"rows", JsonArray{});
            put(ok, L"total", 0.0);
            put(ok, L"found", false);
        }
        return ok;
    }

    JsonObject navArtistsJson(size_t offset, size_t limit) {
        const auto srvK = serverKeyW(navClient().configuration());
        JsonObject ok;
        JsonArray arr;
        const size_t total = remoteArtists_.size();
        const size_t end = std::min(offset + limit, total);
        for (size_t i = offset; i < end; ++i) arr.Append(navArtistJson(remoteArtists_[i], 320, srvK));
        put(ok, L"offset", static_cast<double>(offset));
        put(ok, L"total", static_cast<double>(total));
        put(ok, L"hasMore", end < total);
        ok.Insert(L"items", arr);
        return ok;
    }

    JsonObject navArtistDetailJson(std::wstring const& artistId) {
        const auto srvK = serverKeyW(navClient().configuration());
        JsonObject ok;
        if (const auto it = remoteArtistDetails_.find(artistId); it != remoteArtistDetails_.end()) {
            ok.Insert(L"meta", navArtistJson(it->second.meta, 480, srvK));
            JsonArray albArr, topArr;
            for (auto const& al : it->second.albums) albArr.Append(navAlbumJson(al, 360, srvK));
            for (size_t i = 0; i < it->second.topSongs.size(); ++i)
                topArr.Append(navTrackJson(it->second.topSongs[i], i, srvK));
            ok.Insert(L"albums", albArr);
            ok.Insert(L"topRows", topArr);
            put(ok, L"found", true);
        } else {
            ok.Insert(L"albums", JsonArray{});
            ok.Insert(L"topRows", JsonArray{});
            put(ok, L"found", false);
        }
        return ok;
    }

    JsonObject navLovedJson() {
        const auto srvK = serverKeyW(navClient().configuration());
        JsonObject ok;
        JsonArray songsArr, albumsArr, artistsArr;
        size_t songIdx = 0;
        for (auto const& s : remoteStarred_.songs) {
            if (!starredSongIds_.contains(s.id)) continue;
            songsArr.Append(navTrackJson(s, songIdx++, srvK));
        }
        for (auto const& al : remoteStarred_.albums) {
            if (!starredAlbumIds_.contains(al.id)) continue;
            albumsArr.Append(navAlbumJson(al, 360, srvK));
        }
        for (auto const& ar : remoteStarred_.artists) {
            if (!starredArtistIds_.contains(ar.id)) continue;
            artistsArr.Append(navArtistJson(ar, 320, srvK));
        }
        ok.Insert(L"songs", songsArr);
        ok.Insert(L"albums", albumsArr);
        ok.Insert(L"artists", artistsArr);
        put(ok, L"total", static_cast<double>(songIdx));
        return ok;
    }

    JsonObject navRandomJson() {
        const auto srvK = serverKeyW(navClient().configuration());
        JsonObject ok;
        JsonArray rows;
        for (size_t i = 0; i < remoteRandomSongs_.size(); ++i)
            rows.Append(navTrackJson(remoteRandomSongs_[i], i, srvK));
        put(ok, L"total", static_cast<double>(remoteRandomSongs_.size()));
        ok.Insert(L"rows", rows);
        return ok;
    }

    JsonObject navSearchFullJson(std::wstring const& qW, size_t offset, size_t limit) {
        const auto srvK = serverKeyW(navClient().configuration());
        JsonObject ok;
        JsonArray artArr, albArr, songArr;
        for (auto const& ar : remoteLastSearchArtists_) artArr.Append(navArtistJson(ar, 240, srvK));
        for (auto const& al : remoteLastSearchAlbums_) albArr.Append(navAlbumJson(al, 240, srvK));
        const size_t total = remoteLastSearchSongs_.size();
        const size_t end = std::min(offset + limit, total);
        for (size_t i = offset; i < end; ++i) songArr.Append(navTrackJson(remoteLastSearchSongs_[i], i, srvK));
        put(ok, L"query", hstring(qW));
        put(ok, L"offset", static_cast<double>(offset));
        put(ok, L"songTotal", static_cast<double>(total));
        ok.Insert(L"artists", artArr);
        ok.Insert(L"albums", albArr);
        ok.Insert(L"songs", songArr);
        return ok;
    }

    void clearRemoteCaches() {
        catalogRequest_ = rowsRequest_ = lyricsRequest_ = pingRequest_ = songRequest_ = coverRequest_ = randomTopUpReq_ = 0;
        remoteRandomToppingUp_ = false;
        pendingMutations_.clear();
        pendingStars_.clear();
        pendingRemoteRpcs_.clear();
        pendingPlaylistRpc_ = 0;
        pendingPlaylistRpcId_.clear();
        pendingSearchRpc_ = 0;
        remotePlaylists_.clear();
        remotePlaylist_.clear();
        remoteSongs_.clear();
        remoteMetadata_.clear();
        remoteAlbumsByTab_.clear();
        remoteAlbumsHasMore_.clear();
        remoteAlbumDetails_.clear();
        remoteArtists_.clear();
        remoteArtistsLoaded_ = false;
        remoteArtistDetails_.clear();
        remoteStarred_ = {};
        starredSongIds_.clear();
        starredAlbumIds_.clear();
        starredArtistIds_.clear();
        remoteRandomSongs_.clear();
        remoteLastSearchQuery_.clear();
        remoteLastSearchArtists_.clear();
        remoteLastSearchAlbums_.clear();
        remoteLastSearchSongs_.clear();
        remoteLyrics_.clear();
        remoteLyricsTrack_ = 0;
        ++listRev_;
        ++searchRev_;
    }

    bool applyActiveMultiServer(bool reload) {
        auto cfgOpt = activeMultiConfig();
        if (!cfgOpt || !configured(*cfgOpt)) return false;
        if (!navClient().configure(*cfgOpt)) return false;
        artServer_.setNavConfig(navClient().configuration());
        clearRemoteCaches();
        if (reload) {
            if (currentStream()) {
                localCoverUrl_.clear();
                media_.request(trackKey_, {});
                requestRemoteMedia();
            }
            if (remoteEnabled.get()) navClient().request(nv::Action::Starred);
            if (remoteView_) refreshRemoteCatalog();
            if (ready_) {
                sendSettings();
                sendBrowseUpdated(L"all");
            }
        }
        return true;
    }

    bool parseServersArray(JsonObject const& params, nv::MultiConfig& next) const {
        if (!params.HasKey(L"servers") || params.GetNamedValue(L"servers").ValueType() != JsonValueType::Array)
            return false;
        next.activeId = std::wstring(params.GetNamedString(L"activeId", L""));
        auto arr = params.GetNamedArray(L"servers");
        for (uint32_t i = 0; i < arr.Size(); ++i) {
            if (arr.GetAt(i).ValueType() != JsonValueType::Object) continue;
            auto o = arr.GetAt(i).GetObject();
            nv::ServerEntry se;
            se.id = std::wstring(o.GetNamedString(L"id", L""));
            if (se.id.empty()) se.id = L"srv-" + std::to_wstring(i + 1);
            se.name = std::wstring(o.GetNamedString(L"name", L""));
            se.server = std::wstring(o.GetNamedString(L"server", L""));
            se.user = std::wstring(o.GetNamedString(L"user", L""));
            se.password = std::wstring(o.GetNamedString(L"password", L""));
            if (se.password.empty()) {
                for (auto const& existing : multiConfig_.servers) {
                    if (existing.id == se.id || (existing.server == se.server && existing.user == se.user)) {
                        se.password = existing.password;
                        break;
                    }
                }
            }
            if (se.server.empty() || se.user.empty()) continue;
            if (se.name.empty()) se.name = se.server;
            next.servers.push_back(std::move(se));
        }
        return true;
    }

    nv::Config readRemoteConfig(JsonObject const& msg) {
        const auto saved = navClient().configuration();
        if (!msg.HasKey(L"server") && !msg.HasKey(L"user")) return saved;
        nv::Config config{
            std::wstring(msg.GetNamedString(L"server", L"")),
            std::wstring(msg.GetNamedString(L"user", L"")),
            std::wstring(msg.GetNamedString(L"password", L""))
        };
        if (config.password.empty() && config.server == saved.server && config.user == saved.user)
            config.password = saved.password;
        return config;
    }

    bool saveRemoteConfig(JsonObject const& msg) {
        auto config = readRemoteConfig(msg);
        auto old = navClient().configuration();
        if (!configured(config) || !navClient().configure(config)) return false;
        const auto normalized = navClient().configuration();
        const auto prevMulti = multiConfig_;
        bool updated = false;
        for (auto& se : multiConfig_.servers) {
            if (se.id == multiConfig_.activeId || multiConfig_.activeId.empty()) {
                se.server = normalized.server;
                se.user = normalized.user;
                se.password = normalized.password;
                if (se.name.empty()) se.name = normalized.server;
                multiConfig_.activeId = se.id;
                updated = true;
                break;
            }
        }
        if (!updated) {
            multiConfig_.activeId = L"srv-1";
            multiConfig_.servers.push_back({L"srv-1", normalized.server, normalized.server, normalized.user, normalized.password});
        }
        if (!nv::saveMultiConfig(profileDirectory(), multiConfig_)) {
            multiConfig_ = prevMulti;
            navClient().configure(std::move(old));
            return false;
        }
        artServer_.setNavConfig(normalized);
        clearRemoteCaches();
        if (currentStream()) {
            localCoverUrl_.clear();
            media_.request(trackKey_, {});
            requestRemoteMedia();
        }
        if (remoteEnabled.get()) navClient().request(nv::Action::Starred);
        if (remoteView_) refreshRemoteCatalog();
        if (ready_) {
            sendSettings();
            sendBrowseUpdated(L"all");
        }
        return true;
    }

    void pollNav() {
        auto& client = navClient();
        auto takePendingRpc = [&](uint64_t reqId) -> std::optional<PendingRemoteRpc> {
            const auto it = std::find_if(pendingRemoteRpcs_.begin(), pendingRemoteRpcs_.end(),
                [&](auto const& p) { return p.navReqId == reqId; });
            if (it == pendingRemoteRpcs_.end()) return std::nullopt;
            PendingRemoteRpc copy = std::move(*it);
            pendingRemoteRpcs_.erase(it);
            return copy;
        };

        while (auto reply = client.poll()) {
            const auto id = reply->requestId;
            if (id == catalogRequest_) {
                catalogRequest_ = 0;
                catalogFailed_ = !reply->ok;
                if (reply->ok) {
                    remotePlaylists_ = std::move(reply->playlists);
                    const auto found = std::find_if(remotePlaylists_.begin(), remotePlaylists_.end(),
                        [&](auto const& p) { return p.id == remotePlaylist_; });
                    if (found == remotePlaylists_.end())
                        remotePlaylist_ = remotePlaylists_.empty() ? L"" : remotePlaylists_.front().id;
                }
                ++listRev_;
                sendPlaylists();
            } else if (id == rowsRequest_) {
                rowsRequest_ = 0;
                remoteRowsFailed_ = !reply->ok;
                if (reply->ok) {
                    remoteSongs_ = std::move(reply->songs);
                    for (auto const& s : remoteSongs_) rememberSong(s);
                }
                if (pendingPlaylistRpc_ > 0) {
                    const auto rpc = std::exchange(pendingPlaylistRpc_, 0);
                    const auto pid = std::exchange(pendingPlaylistRpcId_, {});
                    const auto sortKey = std::exchange(pendingPlaylistRpcSort_, L"default");
                    const bool asc = std::exchange(pendingPlaylistRpcAsc_, true);
                    const size_t off = std::exchange(pendingPlaylistRpcOffset_, 0);
                    const size_t lim = std::exchange(pendingPlaylistRpcLimit_, 250);
                    postRpcSuccess(rpc, buildPlaylistTracksResponse(pid, off, lim, sortKey, asc));
                } else if (reply->ok && remoteView_) {
                    sendBrowseUpdated(L"playlist");
                }
                if (pendingSearchRpc_ > 0) {
                    const auto rpc = std::exchange(pendingSearchRpc_, 0);
                    postRpcSuccess(rpc, buildSearchPage(0, 300));
                }
                sendSearchStatus();
            } else if (reply->action == nv::Action::Playlist) {
                if (const auto prpc = takePendingRpc(id)) {
                    bool started = false;
                    if (reply->ok && !reply->songs.empty()) {
                        for (auto const& s : reply->songs) rememberSong(s);
                        if (prpc->arg1 == remotePlaylist_) remoteSongs_ = reply->songs;
                        std::string ctx;
                        for (auto const& pl : remotePlaylists_) {
                            if (pl.id == prpc->arg1) { ctx = to_string(pl.name); break; }
                        }
                        const size_t targetIdx = prpc->offset < reply->songs.size() ? prpc->offset : 0;
                        if (prpc->arg2 == L"default" && prpc->flag) {
                            started = playRemoteList(reply->songs, targetIdx, ctx, false);
                        } else {
                            const auto perm = sortRemotePermutation(reply->songs, prpc->arg2, prpc->flag);
                            std::vector<nv::Song> ordered;
                            ordered.reserve(perm.size());
                            for (size_t orig : perm) ordered.push_back(reply->songs[orig]);
                            started = playRemoteList(ordered, targetIdx, ctx, false);
                        }
                    }
                    JsonObject r;
                    put(r, L"started", started);
                    postRpcSuccess(prpc->rpcId, r);
                }
            } else if (id == pingRequest_) {
                pingRequest_ = 0;
                JsonObject c;
                put(c, L"status", reply->ok ? L"connected" : L"failed");
                if (!reply->ok) put(c, L"error", reply->error);
                postEvent(L"nav.connection", c);
            } else if (id == songRequest_) {
                songRequest_ = 0;
                if (reply->ok && !reply->songs.empty()) {
                    const auto& song = reply->songs.front();
                    rememberSong(song);
                    if (!song.coverArt.empty()) coverRequest_ = client.request(nv::Action::Cover, song.coverArt);
                }
                if (ready_) {
                    postEvent(L"track", buildTrack());
                    postEvent(L"lyrics", buildLyrics());
                }
                refreshPlayback_ = true;
            } else if (id == coverRequest_) {
                coverRequest_ = 0;
                if (reply->ok) media_.requestCover(trackKey_, std::move(reply->imageBytes), std::move(reply->imageSuffix));
            } else if (id == lyricsRequest_) {
                lyricsRequest_ = 0;
                remoteLyricsFailed_ = !reply->ok;
                remoteLyricsSynced_ = reply->synced;
                remoteLyrics_ = std::move(reply->lyrics);
                if (remoteLyricsTrack_ == trackKey_) postEvent(L"lyrics", buildLyrics());
            } else if (id == randomTopUpReq_) {
                randomTopUpReq_ = 0;
                remoteRandomToppingUp_ = false;
                if (reply->ok && !reply->songs.empty()) {
                    appendRemoteRandomSongs(reply->songs);
                    sendBrowseUpdated(L"random");
                }
            } else if (reply->action == nv::Action::Star || reply->action == nv::Action::Unstar) {
                const auto starIt = std::find_if(pendingStars_.begin(), pendingStars_.end(),
                    [&](auto const& s) { return s.navReqId == id; });
                if (starIt != pendingStars_.end()) {
                    PendingStar ps = std::move(*starIt);
                    pendingStars_.erase(starIt);
                    const bool targetStarred = (reply->action == nv::Action::Star);
                    if (!reply->ok) {
                        setLocalStarredCache(ps.kind, ps.targetId, ps.prevStarred);
                        remoteStarred_.loaded = false;
                        sendToast(L"err.conn_failed", L"", L"error");
                        if (currentStream()) postEvent(L"track", buildTrack());
                        sendBrowseUpdated(L"loved");
                        if (ps.rpcId > 0) {
                            JsonObject r;
                            put(r, L"ok", false);
                            put(r, L"loved", ps.prevStarred);
                            postRpcSuccess(ps.rpcId, r);
                        }
                    } else {
                        remoteStarred_.loaded = false;
                        navClient().request(nv::Action::Starred);
                        if (currentStream()) postEvent(L"track", buildTrack());
                        sendBrowseUpdated(L"loved");
                        if (ps.rpcId > 0) {
                            JsonObject r;
                            put(r, L"ok", true);
                            put(r, L"loved", targetStarred);
                            postRpcSuccess(ps.rpcId, r);
                        }
                    }
                }
            } else if (reply->action == nv::Action::Starred) {
                const auto prpc = takePendingRpc(id);
                if (reply->ok) {
                    starredSongIds_.clear();
                    starredAlbumIds_.clear();
                    starredArtistIds_.clear();
                    for (auto const& s : reply->songs) {
                        starredSongIds_.insert(s.id);
                        rememberSong(s);
                    }
                    for (auto const& al : reply->albums) starredAlbumIds_.insert(al.id);
                    for (auto const& ar : reply->artists) starredArtistIds_.insert(ar.id);
                    remoteStarred_.loaded = true;
                    remoteStarred_.songs = std::move(reply->songs);
                    remoteStarred_.albums = std::move(reply->albums);
                    remoteStarred_.artists = std::move(reply->artists);
                    if (currentStream()) postEvent(L"track", buildTrack());
                }
                if (prpc) postRpcSuccess(prpc->rpcId, navLovedJson());
                // Also flush any other queued 'loved' RPCs.
                for (size_t i = pendingRemoteRpcs_.size(); i > 0; --i) {
                    if (pendingRemoteRpcs_[i - 1].kind == L"loved") {
                        const double rid = pendingRemoteRpcs_[i - 1].rpcId;
                        pendingRemoteRpcs_.erase(pendingRemoteRpcs_.begin() + static_cast<ptrdiff_t>(i - 1));
                        postRpcSuccess(rid, navLovedJson());
                    }
                }
                sendBrowseUpdated(L"loved");
            } else if (reply->action == nv::Action::AlbumList) {
                const auto prpc = takePendingRpc(id);
                const std::wstring tab = !reply->tag.empty() ? reply->tag : (prpc ? prpc->arg1 : L"recent");
                if (reply->ok) {
                    const size_t gotCount = reply->albums.size();
                    const size_t asked = prpc ? prpc->limit : 60;
                    auto& vec = remoteAlbumsByTab_[tab];
                    if (prpc && prpc->append) vec.insert(vec.end(), reply->albums.begin(), reply->albums.end());
                    else vec = std::move(reply->albums);
                    remoteAlbumsHasMore_[tab] = (asked > 0 && gotCount >= asked);
                }
                if (prpc) {
                    if (prpc->kind == L"home") postRpcSuccess(prpc->rpcId, navHomeJson());
                    else postRpcSuccess(prpc->rpcId, navAlbumsJson(tab, prpc->offset, prpc->limit));
                } else if (reply->ok) {
                    sendBrowseUpdated(L"albums");
                }
            } else if (reply->action == nv::Action::AlbumDetail) {
                const auto prpc = takePendingRpc(id);
                if (reply->ok && reply->albumMeta) {
                    for (auto const& s : reply->songs) rememberSong(s);
                    RemoteAlbumCache cache{*reply->albumMeta, std::move(reply->songs)};
                    const auto key = cache.meta.id;
                    remoteAlbumDetails_[key] = std::move(cache);
                }
                if (prpc) {
                    if (prpc->kind == L"play_album") {
                        bool started = false;
                        if (const auto it = remoteAlbumDetails_.find(prpc->arg1); it != remoteAlbumDetails_.end() && !it->second.songs.empty()) {
                            const size_t idx = prpc->offset < it->second.songs.size() ? prpc->offset : 0;
                            started = playRemoteList(it->second.songs, idx, to_string(it->second.meta.name), false);
                        }
                        JsonObject r;
                        put(r, L"started", started);
                        postRpcSuccess(prpc->rpcId, r);
                    } else {
                        postRpcSuccess(prpc->rpcId, navAlbumDetailJson(prpc->arg1));
                    }
                }
            } else if (reply->action == nv::Action::Artists) {
                const auto prpc = takePendingRpc(id);
                if (reply->ok) {
                    remoteArtists_ = std::move(reply->artists);
                    remoteArtistsLoaded_ = true;
                }
                if (prpc) {
                    if (prpc->kind == L"home") postRpcSuccess(prpc->rpcId, navHomeJson());
                    else postRpcSuccess(prpc->rpcId, navArtistsJson(prpc->offset, prpc->limit));
                } else if (reply->ok) {
                    sendBrowseUpdated(L"artists");
                }
            } else if (reply->action == nv::Action::ArtistDetail) {
                const auto prpc = takePendingRpc(id);
                if (reply->ok && reply->artistMeta) {
                    for (auto const& s : reply->songs) rememberSong(s);
                    RemoteArtistCache cache{*reply->artistMeta, std::move(reply->albums), std::move(reply->songs)};
                    const auto key = cache.meta.id;
                    remoteArtistDetails_[key] = std::move(cache);
                }
                if (prpc) {
                    if (prpc->kind == L"play_artist") {
                        bool started = false;
                        if (const auto it = remoteArtistDetails_.find(prpc->arg1); it != remoteArtistDetails_.end() && !it->second.topSongs.empty()) {
                            const size_t idx = prpc->offset < it->second.topSongs.size() ? prpc->offset : 0;
                            started = playRemoteList(it->second.topSongs, idx, to_string(it->second.meta.name), false);
                        }
                        JsonObject r;
                        put(r, L"started", started);
                        postRpcSuccess(prpc->rpcId, r);
                    } else {
                        postRpcSuccess(prpc->rpcId, navArtistDetailJson(prpc->arg1));
                    }
                }
            } else if (reply->action == nv::Action::RandomSongs) {
                const auto prpc = takePendingRpc(id);
                if (reply->ok) {
                    for (auto const& s : reply->songs) rememberSong(s);
                    if (prpc && prpc->arg1 == L"more") {
                        std::unordered_set<std::wstring> seen;
                        for (auto const& s : remoteRandomSongs_) seen.insert(s.id);
                        for (auto const& s : reply->songs) {
                            if (seen.insert(s.id).second) remoteRandomSongs_.push_back(s);
                        }
                    } else {
                        remoteRandomSongs_ = std::move(reply->songs);
                    }
                }
                if (prpc) postRpcSuccess(prpc->rpcId, navRandomJson());
            } else if (reply->action == nv::Action::SearchAll) {
                const auto prpc = takePendingRpc(id);
                if (reply->ok) {
                    for (auto const& s : reply->songs) rememberSong(s);
                    remoteLastSearchQuery_ = prpc ? prpc->arg1 : L"";
                    remoteLastSearchArtists_ = std::move(reply->artists);
                    remoteLastSearchAlbums_ = std::move(reply->albums);
                    remoteLastSearchSongs_ = std::move(reply->songs);
                }
                if (prpc) postRpcSuccess(prpc->rpcId, navSearchFullJson(prpc->arg1, prpc->offset, prpc->limit));
            } else if (reply->action == nv::Action::Scrobble) {
                // Background scrobble submission; no UI ack required.
            } else if (reply->action == nv::Action::SyncLocalPlaylist) {
                if (reply->ok) {
                    refreshRemoteCatalog();
                    const auto summary = reply->tag + L" (" +
                        std::to_wstring(reply->matchedCount) + L"/" +
                        std::to_wstring(reply->totalCount) + L")";
                    sendToast(L"toast.synced_pl", summary.c_str(), L"info");
                } else {
                    sendToast(L"err.conn_failed", L"", L"error");
                }
            } else {
                const auto mutIt = std::find_if(pendingMutations_.begin(), pendingMutations_.end(),
                    [&](auto const& m) { return m.navReqId == id; });
                if (mutIt != pendingMutations_.end()) {
                    const double rpcId = mutIt->rpcId;
                    pendingMutations_.erase(mutIt);
                    if (reply->ok) {
                        if (reply->action == nv::Action::CreatePlaylist && !reply->playlistId.empty())
                            remotePlaylist_ = reply->playlistId;
                        refreshRemoteCatalog();
                        if ((reply->action == nv::Action::AddSong || reply->action == nv::Action::RemoveSong) &&
                            !remotePlaylist_.empty() && reply->playlistId == remotePlaylist_) {
                            rowsRequest_ = navClient().request(nv::Action::Playlist, remotePlaylist_);
                        }
                        if (rpcId > 0) {
                            JsonObject r;
                            put(r, L"playlistId", hstring(reply->playlistId));
                            postRpcSuccess(rpcId, r);
                        }
                    } else if (rpcId > 0) {
                        postRpcError(rpcId, reply->duplicate ? L"duplicate" : reply->error.c_str());
                    }
                }
            }
        }
    }

    void enterFullscreen(std::wstring_view viewMode = L"lyrics") {
        fsView_ = normalizeFsView(viewMode);
        if (!fullscreen_) {
            restorePlacement_.length = sizeof(restorePlacement_);
            GetWindowPlacement(wnd_, &restorePlacement_);
            wasZoomedBeforeFs_ = IsZoomed(wnd_) != FALSE;
            MONITORINFO monitor{sizeof(monitor)};
            if (GetMonitorInfoW(MonitorFromWindow(wnd_, MONITOR_DEFAULTTONEAREST), &monitor)) {
                fullscreen_ = true;
                pola::chrome::syncWebViewInsets(wnd_, true);
                applyThemeToWindow(false);
                const RECT& bounds = monitor.rcMonitor;
                SetWindowPos(wnd_, HWND_TOP, bounds.left, bounds.top,
                    bounds.right - bounds.left, bounds.bottom - bounds.top,
                    SWP_FRAMECHANGED | SWP_NOOWNERZORDER);
                WvSyncBounds(wnd_);
            }
        }
        syncVizTimerAndStream();
        sendWindowState();
        updateTrack();
        JsonObject init;
        put(init, L"type", L"init");
        put(init, L"view", fsView_);
        put(init, L"visible", true);
        init.Insert(L"track", buildTrack());
        init.Insert(L"playback", buildPlayback(false));
        init.Insert(L"lyrics", buildLyrics());
        WvPostJson(init.Stringify().c_str());
    }

    void leaveFullscreen() {
        if (!fullscreen_) return;
        fullscreen_ = false;
        syncVizTimerAndStream();
        if (restorePlacement_.length == sizeof(restorePlacement_)) {
            SetWindowPlacement(wnd_, &restorePlacement_);
        }
        pola::chrome::syncWebViewInsets(wnd_, false);
        applyThemeToWindow(false);
        SetWindowPos(wnd_, nullptr, 0, 0, 0, 0,
            SWP_FRAMECHANGED | SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        WvSyncBounds(wnd_);
        sendWindowState();
    }

    static void setShuffleOrder(bool on) {
        auto pm = playlist_manager::get();
        const std::string_view cur = pm->playback_order_get_name(pm->playback_order_get_active());
        const bool isShuf = cur.starts_with("Shuffle") || cur == "Random";
        if (isShuf == on) return;
        const std::string_view target = on ? "Shuffle (tracks)" : "Default";
        for (size_t i = 0; i < pm->playback_order_get_count(); ++i) {
            if (target == pm->playback_order_get_name(i)) {
                pm->playback_order_set_active(i);
                break;
            }
        }
    }

    static void changeOrder(std::wstring_view action) {
        auto pm = playlist_manager::get();
        const std::string_view name = pm->playback_order_get_name(pm->playback_order_get_active());
        std::string_view wanted;
        if (action == L"shuffle") wanted = (name.starts_with("Shuffle") || name == "Random") ? "Default" : "Shuffle (tracks)";
        else wanted = name == "Repeat (playlist)" ? "Repeat (track)" : name == "Repeat (track)" ? "Default" : "Repeat (playlist)";
        for (size_t i = 0; i < pm->playback_order_get_count(); ++i) {
            if (wanted == pm->playback_order_get_name(i)) { pm->playback_order_set_active(i); break; }
        }
    }

    void openNativeMainMenu(std::wstring_view root, double cssX, double cssY) {
        GUID rootGuid{};
        if (root == L"file") rootGuid = mainmenu_groups::file;
        else if (root == L"library") rootGuid = mainmenu_groups::library;
        else if (root == L"help") rootGuid = mainmenu_groups::help;
        else return;

        auto mm = mainmenu_manager::get();
        mm->instantiate(rootGuid);
        HMENU hMenu = CreatePopupMenu();
        if (!hMenu) return;
        mm->generate_menu_win32(hMenu, 1, 1000, mainmenu_manager::flag_show_shortcuts);

        const int dpi = pola::chrome::windowDpi(wnd_);
        const int insetLeft = (fullscreen_ || IsZoomed(wnd_)) ? 0 : pola::chrome::scaleDpi(4, dpi);
        const int insetTop = (fullscreen_ || IsZoomed(wnd_)) ? 0 : pola::chrome::scaleDpi(3, dpi);
        POINT pt{
            insetLeft + pola::chrome::scaleDpi(static_cast<int>(std::lround(cssX)), dpi),
            insetTop + pola::chrome::scaleDpi(static_cast<int>(std::lround(cssY)), dpi)
        };
        ClientToScreen(wnd_, &pt);
        const UINT cmd = static_cast<UINT>(TrackPopupMenuEx(hMenu, TPM_RETURNCMD | TPM_RIGHTBUTTON, pt.x, pt.y, wnd_, nullptr));
        if (cmd > 0) mm->execute_command(cmd - 1);
        DestroyMenu(hMenu);
    }

    void handleMessage(JsonObject const& msg) {
        const auto type = msg.GetNamedString(L"type", L"");
        if (type == L"ready") {
            ready_ = true;
            sentTrackKey_ = 0;
            updateTrack();
            refreshQueue();
            sendWindowState();
            sendSettings();
            if (sentTrackKey_ != trackKey_ || trackKey_ == 0) {
                sentTrackKey_ = trackKey_;
                postEvent(L"track", buildTrack());
                postEvent(L"lyrics", buildLyrics());
            }
            postEvent(L"playback", buildPlayback(true));
            sendPlaylists();
            sendQueue();
            WvSetVisible(true);
            console::info("PolaPlayer native UI ready");
            return;
        }
        if (!ready_) return;
        if (type == L"rpc") {
            handleRpc(msg);
            return;
        }
        if (type == L"pola.drop") {
            if (remoteView_) {
                sendToast(L"err.drop_local_only", L"", L"info");
                return;
            }
            if (!msg.HasKey(L"droppedPaths") || msg.GetNamedValue(L"droppedPaths").ValueType() != JsonValueType::Array) return;
            std::vector<std::wstring> paths;
            auto arr = msg.GetNamedArray(L"droppedPaths");
            for (uint32_t i = 0; i < arr.Size(); ++i) {
                if (arr.GetAt(i).ValueType() != JsonValueType::String) continue;
                const auto s = std::wstring(arr.GetAt(i).GetString());
                if (!s.empty()) paths.push_back(s);
            }
            const auto targetKind = std::wstring(msg.GetNamedString(L"targetKind", L"playlist"));
            const auto plId = std::wstring(msg.GetNamedString(L"playlistId", L""));
            addOsPathsToLocalPlaylist(std::move(paths), targetKind, plId);
            return;
        }
        if (type == L"key") {
            const double code = msg.GetNamedNumber(L"code", -1);
            if (code == 27 && fullscreen_) leaveFullscreen();
            else if (code == 32 && fullscreen_) { play_control::get()->play_or_pause(); refreshPlayback_ = true; }
            else if (code == 122) {
                if (fullscreen_) leaveFullscreen();
                else enterFullscreen(fsView_);
            }
        } else if (type == L"fsAct") {
            const auto act = msg.GetNamedString(L"act", L"");
            if (act == L"exit") leaveFullscreen();
            else if (act == L"lyrics" || act == L"default" || act == L"viz") {
                fsView_ = normalizeFsView(act);
                syncVizTimerAndStream();
                sendWindowState();
            }
        }
    }

    void handleRpc(JsonObject const& msg) {
        const double id = msg.GetNamedNumber(L"id", 0);
        const auto method = msg.GetNamedString(L"method", L"");
        const auto params = msg.HasKey(L"params") && msg.GetNamedValue(L"params").ValueType() == JsonValueType::Object
            ? msg.GetNamedObject(L"params")
            : JsonObject{};
        JsonObject ok;

        if (method == L"chrome.minimize") {
            ShowWindow(wnd_, SW_MINIMIZE);
            postRpcSuccess(id, ok);
        } else if (method == L"chrome.toggleMaximize") {
            ShowWindow(wnd_, IsZoomed(wnd_) ? SW_RESTORE : SW_MAXIMIZE);
            postRpcSuccess(id, ok);
        } else if (method == L"chrome.close") {
            standard_commands::main_exit();
            postRpcSuccess(id, ok);
        } else if (method == L"chrome.dragStart") {
            if (!fullscreen_) {
                POINT pt{};
                GetCursorPos(&pt);
                ReleaseCapture();
                SendMessageW(wnd_, WM_NCLBUTTONDOWN, HTCAPTION, MAKELPARAM(pt.x, pt.y));
            }
            postRpcSuccess(id, ok);
        } else if (method == L"chrome.openMenu") {
            openNativeMainMenu(params.GetNamedString(L"root", L""),
                params.GetNamedNumber(L"x", 12), params.GetNamedNumber(L"y", 32));
            postRpcSuccess(id, ok);
        } else if (method == L"chrome.showSystemMenu") {
            POINT pt{};
            GetCursorPos(&pt);
            pola::chrome::showSystemMenuAt(wnd_, pt);
            postRpcSuccess(id, ok);
        } else if (method == L"chrome.snapPreset") {
            const auto preset = params.GetNamedString(L"preset", L"");
            pola::chrome::applySnapPreset(wnd_, preset.c_str());
            postRpcSuccess(id, ok);
        } else if (method == L"playback.ctrl") {
            auto ctl = play_control::get();
            const auto act = params.GetNamedString(L"act", L"play");
            if (act == L"play") ctl->play_or_pause();
            else if (act == L"prev") {
                if ((ctl->is_playing() || ctl->is_paused()) && ctl->playback_get_position() > 1.0)
                    ctl->playback_seek(0.0);
                else
                    ctl->previous();
            } else if (act == L"next") ctl->next();
            else if (act == L"shuffle" || act == L"repeat") changeOrder(act);
            refreshPlayback_ = true;
            postRpcSuccess(id, ok);
        } else if (method == L"playback.seek") {
            updateTrack();
            auto ctl = play_control::get();
            const double key = params.GetNamedNumber(L"key", -1);
            const double t = params.GetNamedNumber(L"time", -1);
            if (key == static_cast<double>(trackKey_) && ctl->playback_can_seek() && std::isfinite(t) && t >= 0) {
                const auto len = ctl->playback_get_length() > 0 ? ctl->playback_get_length() : trackDuration(current_);
                ctl->playback_seek(len > 0 ? std::min(t, len) : t);
                explicitSeek_ = true;
                refreshPlayback_ = true;
            }
            postRpcSuccess(id, ok);
        } else if (method == L"playback.volume") {
            const double pos = params.GetNamedNumber(L"pos", -1);
            if (std::isfinite(pos) && pos >= 0 && pos <= 1.0) {
                play_control::get()->set_volume(static_cast<float>(pos <= 0.001 ? -100.0 : pos * 60.0 - 60.0));
                refreshPlayback_ = true;
            }
            postRpcSuccess(id, ok);
        } else if (method == L"source.select") {
            selectSource(params.GetNamedString(L"source", L"") == L"navidrome");
            postRpcSuccess(id, ok);
        } else if (method == L"playlists.refresh") {
            if (remoteView_) {
                remoteAlbumsByTab_.clear();
                remoteAlbumDetails_.clear();
                remoteArtists_.clear();
                remoteArtistsLoaded_ = false;
                remoteArtistDetails_.clear();
                remoteStarred_.loaded = false;
                if (configured(navClient().configuration())) navClient().request(nv::Action::Starred);
                refreshRemoteCatalog();
                sendBrowseUpdated(L"all");
            } else {
                localIndex_.invalidateLibrary();
                ++listRev_;
                sendPlaylists();
                sendBrowseUpdated(L"all");
            }
            postRpcSuccess(id, ok);
        } else if (method == L"playlists.select") {
            const auto pid = params.GetNamedString(L"id", L"");
            if (remoteView_) {
                remotePlaylist_ = pid;
                remoteSongs_.clear();
                remoteRowsFailed_ = false;
                rowsRequest_ = pid.empty() ? 0 : navClient().request(nv::Action::Playlist, std::wstring(pid));
                ++listRev_;
                sendPlaylists();
            } else {
                auto pm = playlist_manager::get();
                const auto idx = findPlaylistById(pm, pid);
                if (idx < pm->get_playlist_count()) pm->set_active_playlist(idx);
                sendPlaylists();
            }
            postRpcSuccess(id, ok);
        } else if (method == L"playlists.tracks") {
            const auto pid = params.GetNamedString(L"id", L"");
            const auto offset = indexValue(params, L"offset");
            const auto limit = indexValue(params, L"limit");
            const auto sort = params.GetNamedString(L"sort", L"default");
            const bool asc = params.HasKey(L"asc") ? params.GetNamedBoolean(L"asc", true) : true;
            if (remoteView_) {
                if (pid != remotePlaylist_ || (remoteSongs_.empty() && !rowsRequest_ && !remoteRowsFailed_)) {
                    remotePlaylist_ = pid;
                    remoteSongs_.clear();
                    remoteRowsFailed_ = false;
                    rowsRequest_ = pid.empty() ? 0 : navClient().request(nv::Action::Playlist, std::wstring(pid));
                }
                if (rowsRequest_) {
                    pendingPlaylistRpc_ = id;
                    pendingPlaylistRpcId_ = pid;
                    pendingPlaylistRpcSort_ = sort;
                    pendingPlaylistRpcAsc_ = asc;
                    pendingPlaylistRpcOffset_ = offset == SIZE_MAX ? 0 : offset;
                    pendingPlaylistRpcLimit_ = limit == SIZE_MAX ? 200 : limit;
                    return;
                }
            }
            postRpcSuccess(id, buildPlaylistTracksResponse(
                pid, offset == SIZE_MAX ? 0 : offset, limit == SIZE_MAX ? 200 : limit, sort, asc));
        } else if (method == L"playlists.play") {
            const auto pid = params.GetNamedString(L"id", L"");
            const size_t idx = indexValue(params, L"index");
            const auto sort = params.GetNamedString(L"sort", L"default");
            const bool asc = params.HasKey(L"asc") ? params.GetNamedBoolean(L"asc", true) : true;
            if (params.HasKey(L"shuffle")) setShuffleOrder(params.GetNamedBoolean(L"shuffle", false));
            bool started = false;
            if (remoteView_) {
                const auto pidW = std::wstring(pid);
                const size_t targetIdx = idx == SIZE_MAX ? 0 : idx;
                if (!pidW.empty() && (pidW != remotePlaylist_ || remoteSongs_.empty() || rowsRequest_ != 0)) {
                    if (configured(navClient().configuration())) {
                        const uint64_t req = navClient().request(nv::Action::Playlist, pidW);
                        if (req) {
                            pendingRemoteRpcs_.push_back({req, id, L"play_playlist", pidW, targetIdx, 0, false, std::wstring(sort), asc});
                            return;
                        }
                    }
                } else if (targetIdx < remoteSongs_.size()) {
                    std::string ctx;
                    for (auto const& pl : remotePlaylists_) {
                        if (pl.id == pid) { ctx = to_string(pl.name); break; }
                    }
                    if (sort == L"default" && asc) {
                        started = playRemoteList(remoteSongs_, targetIdx, ctx, false);
                    } else {
                        const auto perm = sortRemotePermutation(remoteSongs_, sort, asc);
                        std::vector<nv::Song> ordered;
                        ordered.reserve(perm.size());
                        for (size_t orig : perm) ordered.push_back(remoteSongs_[orig]);
                        started = playRemoteList(ordered, targetIdx, ctx, false);
                    }
                }
            } else {
                auto pm = playlist_manager::get();
                size_t pl = findPlaylistById(pm, pid);
                if (pl >= pm->get_playlist_count()) pl = pm->get_active_playlist();
                if (pl < pm->get_playlist_count()) {
                    const size_t cnt = pm->playlist_get_item_count(pl);
                    size_t playIdx = (idx == SIZE_MAX) ? 0 : idx;
                    if (playIdx >= cnt) playIdx = 0;
                    if (cnt > 0) {
                        if (sort == L"default" && asc) {
                            radioMixActive_ = false;
                            browseContextName_.clear();
                            started = pm->playlist_execute_default_action(pl, playIdx);
                        } else {
                            pfc::string8 pname;
                            pm->playlist_get_name(pl, pname);
                            const auto perm = pola::index::LocalLibraryIndex::sortPlaylistPermutation(pm, pl, to_string(sort), asc);
                            metadb_handle_list sorted;
                            for (size_t orig : perm) {
                                auto h = pm->playlist_get_item_handle(pl, orig);
                                if (h.is_valid()) sorted.add_item(h);
                            }
                            started = playLocalHandles(sorted, playIdx, pname.c_str(), false);
                        }
                    }
                }
            }
            put(ok, L"started", started);
            postRpcSuccess(id, ok);
        } else if (method == L"playlists.create") {
            const auto name = std::wstring(params.GetNamedString(L"name", L""));
            if (name.find_first_not_of(L" \t\r\n") == std::wstring::npos) {
                postRpcError(id, L"empty-name");
                return;
            }
            if (remoteView_) {
                const auto req = navClient().request(nv::Action::CreatePlaylist, {}, name);
                if (req) { pendingMutations_.push_back({req, id}); return; }
                postRpcError(id, L"failed");
            } else {
                auto pm = playlist_manager::get();
                const auto u8 = to_string(hstring(std::wstring_view(name).substr(0, 160)));
                const auto created = pm->create_playlist(u8.c_str(), u8.size(), SIZE_MAX);
                if (created != SIZE_MAX) {
                    pm->set_active_playlist(created);
                    put(ok, L"id", playlistGuidId(pm, created));
                    sendPlaylists();
                    postRpcSuccess(id, ok);
                } else {
                    postRpcError(id, L"failed");
                }
            }
        } else if (method == L"playlists.rename") {
            const auto pid = std::wstring(params.GetNamedString(L"id", L""));
            const auto name = std::wstring(params.GetNamedString(L"name", L""));
            if (remoteView_) {
                const auto req = navClient().request(nv::Action::RenamePlaylist, pid, name);
                if (req) { pendingMutations_.push_back({req, id}); return; }
                postRpcError(id, L"failed");
            } else {
                auto pm = playlist_manager::get();
                const auto pl = findPlaylistById(pm, pid);
                const auto u8 = to_string(hstring(std::wstring_view(name).substr(0, 160)));
                if (pl < pm->get_playlist_count() && !pm->playlist_lock_is_present(pl) && pm->playlist_rename(pl, u8.c_str(), u8.size())) {
                    sendPlaylists();
                    postRpcSuccess(id, ok);
                } else {
                    postRpcError(id, L"locked");
                }
            }
        } else if (method == L"playlists.delete") {
            const auto pid = std::wstring(params.GetNamedString(L"id", L""));
            if (remoteView_) {
                const auto req = navClient().request(nv::Action::DeletePlaylist, pid);
                if (req) { pendingMutations_.push_back({req, id}); return; }
                postRpcError(id, L"failed");
            } else {
                auto pm = playlist_manager::get();
                const auto pl = findPlaylistById(pm, pid);
                if (pl < pm->get_playlist_count() && !pm->playlist_lock_is_present(pl) && pm->remove_playlist_switch(pl)) {
                    sendPlaylists();
                    postRpcSuccess(id, ok);
                } else {
                    postRpcError(id, L"locked");
                }
            }
        } else if (method == L"playlists.pickFiles") {
            if (remoteView_) {
                postRpcError(id, L"local-only");
                return;
            }
            const auto pid = std::wstring(params.GetNamedString(L"playlistId", L""));
            const bool folder = params.HasKey(L"folder") && params.GetNamedBoolean(L"folder", false);
            auto paths = pola::drop::pickOpenPathsDialog(wnd_, folder);
            const size_t picked = paths.size();
            if (!paths.empty()) {
                addOsPathsToLocalPlaylist(std::move(paths), pid.empty() ? L"new" : L"playlist", pid);
            }
            put(ok, L"picked", static_cast<double>(picked));
            postRpcSuccess(id, ok);
        } else if (method == L"playlists.dupResolve") {
            const auto action = params.GetNamedString(L"action", L"cancel");
            if (pendingDupPrompt_) {
                PendingDupPrompt pending = std::move(*pendingDupPrompt_);
                pendingDupPrompt_.reset();
                if (action == L"skip" || action == L"keep") {
                    auto pm = playlist_manager::get();
                    const size_t pl = findPlaylistById(pm, pending.pid);
                    if (pl < pm->get_playlist_count() && !pm->playlist_lock_is_present(pl)) {
                        insertResolvedLocalItems(
                            pl,
                            action == L"skip" ? pending.uniqueItems : pending.allItems,
                            pending.pid,
                            pending.name,
                            false,
                            action);
                    }
                }
            }
            postRpcSuccess(id, ok);
        } else if (method == L"playlists.addTracks") {
            const auto pid = std::wstring(params.GetNamedString(L"targetPlaylistId", L""));
            std::vector<std::wstring> trackIds;
            if (params.HasKey(L"trackIds") && params.GetNamedValue(L"trackIds").ValueType() == JsonValueType::Array) {
                auto arr = params.GetNamedArray(L"trackIds");
                for (uint32_t i = 0; i < arr.Size(); ++i) {
                    if (arr.GetAt(i).ValueType() == JsonValueType::String) {
                        trackIds.emplace_back(arr.GetAt(i).GetString());
                    }
                }
            } else if (params.HasKey(L"trackId")) {
                const auto single = std::wstring(params.GetNamedString(L"trackId", L""));
                if (!single.empty()) trackIds.push_back(single);
            }
            if (pid.empty() || trackIds.empty()) {
                postRpcError(id, L"invalid-args");
                return;
            }
            if (remoteView_) {
                uint64_t lastReq = 0;
                for (size_t i = 0; i < trackIds.size(); ++i) {
                    const uint64_t req = navClient().request(nv::Action::AddSong, pid, {}, trackIds[i]);
                    if (req) {
                        lastReq = req;
                        pendingMutations_.push_back({req, (i + 1 == trackIds.size()) ? id : 0.0});
                    }
                }
                if (lastReq) return;
                postRpcError(id, L"failed");
                return;
            }
            auto pm = playlist_manager::get();
            const size_t pl = findPlaylistById(pm, pid);
            if (pl >= pm->get_playlist_count() || pm->playlist_lock_is_present(pl)) {
                postRpcError(id, L"locked");
                return;
            }
            localIndex_.ensureBuilt();
            metadb_handle_list handles;
            for (auto const& tidW : trackIds) {
                const auto tid = to_string(tidW);
                auto h = localIndex_.findHandleByTrackId(tid);
                if (!h.is_valid() && current_.is_valid() && pola::index::LocalLibraryIndex::canonicalTrackId(current_) == tid)
                    h = current_;
                if (h.is_valid()) handles.add_item(h);
            }
            if (handles.get_count() == 0) {
                postRpcError(id, L"not-found");
                return;
            }
            pfc::string8 nm;
            pm->playlist_get_name(pl, nm);
            insertResolvedLocalItems(pl, handles, pid, std::wstring(to_hstring(nm.c_str())), true, L"check");
            put(ok, L"pending", pendingDupPrompt_.has_value());
            postRpcSuccess(id, ok);
        } else if (method == L"playlists.removeTrack") {
            const auto pid = std::wstring(params.GetNamedString(L"id", L""));
            const size_t idx = indexValue(params, L"index");
            const auto songIdW = std::wstring(params.GetNamedString(L"songId", L""));
            if (remoteView_) {
                if (pid.empty() || idx == SIZE_MAX) {
                    postRpcError(id, L"invalid-args");
                    return;
                }
                const uint64_t req = navClient().request(nv::Action::RemoveSong, pid, {}, songIdW, static_cast<int>(idx));
                if (req) {
                    pendingMutations_.push_back({req, id});
                    return;
                }
                postRpcError(id, L"failed");
                return;
            }
            auto pm = playlist_manager::get();
            const size_t pl = findPlaylistById(pm, pid);
            if (pl < pm->get_playlist_count() && !pm->playlist_lock_is_present(pl) && idx < pm->playlist_get_item_count(pl)) {
                pm->playlist_remove_items(pl, pfc::bit_array_one(idx));
                ++listRev_;
                ++queueRev_;
                sendPlaylists();
                sendBrowseUpdated(L"all");
                postRpcSuccess(id, ok);
            } else {
                postRpcError(id, L"locked");
            }
        } else if (method == L"playlists.syncToNavidrome") {
            const auto pid = std::wstring(params.GetNamedString(L"id", L""));
            if (!remoteEnabled.get() || !configured(navClient().configuration())) {
                postRpcError(id, L"not-configured");
                return;
            }
            auto pm = playlist_manager::get();
            const size_t pl = findPlaylistById(pm, pid);
            if (pl >= pm->get_playlist_count()) {
                postRpcError(id, L"not-found");
                return;
            }
            pfc::string8 pname;
            pm->playlist_get_name(pl, pname);
            std::vector<nv::SyncTrackSpec> specs;
            const size_t cnt = std::min<size_t>(pm->playlist_get_item_count(pl), 200);
            specs.reserve(cnt);
            for (size_t i = 0; i < cnt; ++i) {
                auto h = pm->playlist_get_item_handle(pl, i);
                if (!h.is_valid()) continue;
                specs.push_back({
                    std::wstring(displayMetadata(h, title_)),
                    std::wstring(displayMetadata(h, artist_))
                });
            }
            const auto req = navClient().requestSyncPlaylist(std::wstring(to_hstring(pname.c_str())), std::move(specs));
            put(ok, L"started", req != 0);
            postRpcSuccess(id, ok);
        } else if (method == L"queue.playManual") {
            const size_t qIdx = indexValue(params, L"index");
            auto pm = playlist_manager::get();
            pfc::list_t<t_playback_queue_item> items;
            pm->queue_get_contents(items);
            if (qIdx < items.get_count()) {
                const auto item = items[qIdx];
                pm->queue_remove_mask(pfc::bit_array_one(qIdx));
                if (item.m_playlist < pm->get_playlist_count() &&
                    item.m_item < pm->playlist_get_item_count(item.m_playlist) &&
                    pm->playlist_get_item_handle(item.m_playlist, item.m_item).get_ptr() == item.m_handle.get_ptr()) {
                    pm->playlist_execute_default_action(item.m_playlist, item.m_item);
                } else {
                    playLibraryTrack(pm, item.m_handle);
                }
                ++queueRev_;
            }
            postRpcSuccess(id, ok);
        } else if (method == L"queue.playNext") {
            const size_t plIdx = indexValue(params, L"playlistIndex");
            const size_t itemIdx = indexValue(params, L"itemIndex");
            auto pm = playlist_manager::get();
            if (plIdx < pm->get_playlist_count() && itemIdx < pm->playlist_get_item_count(plIdx)) {
                pm->playlist_execute_default_action(plIdx, itemIdx);
                ++queueRev_;
            }
            postRpcSuccess(id, ok);
        } else if (method == L"queue.removeManual") {
            const size_t qIdx = indexValue(params, L"index");
            auto pm = playlist_manager::get();
            if (qIdx < pm->queue_get_count()) {
                pm->queue_remove_mask(pfc::bit_array_one(qIdx));
                ++queueRev_;
            }
            postRpcSuccess(id, ok);
        } else if (method == L"queue.enqueue") {
            const auto scope = params.GetNamedString(L"scope", L"playlist");
            const size_t idx = indexValue(params, L"index");
            auto pm = playlist_manager::get();
            bool queued = false;
            if (scope == L"search") {
                if (remoteView_) {
                    auto const& src = !remoteLastSearchSongs_.empty() ? remoteLastSearchSongs_ : remoteSongs_;
                    if (idx < src.size()) {
                        auto h = navHandle(src[idx]);
                        if (h.is_valid()) { pm->queue_add_item(h); queued = true; }
                    }
                } else {
                    localIndex_.ensureBuilt();
                    const auto q = to_string(params.GetNamedString(L"query", query_));
                    auto sr = localIndex_.search(q);
                    if (idx < sr.trackIndices.size()) {
                        pm->queue_add_item(localIndex_.tracks()[sr.trackIndices[idx]].handle);
                        queued = true;
                    } else if (idx < searchResults_.size()) {
                        pm->queue_add_item(searchResults_[idx]);
                        queued = true;
                    }
                }
            } else {
                const auto pid = params.GetNamedString(L"playlistId", L"");
                if (remoteView_) {
                    if (idx < remoteSongs_.size()) {
                        auto h = navHandle(remoteSongs_[idx]);
                        if (h.is_valid()) { pm->queue_add_item(h); queued = true; }
                    }
                } else {
                    const size_t pl = findPlaylistById(pm, pid);
                    if (pl < pm->get_playlist_count() && idx < pm->playlist_get_item_count(pl)) {
                        pm->queue_add_item_playlist(pl, idx);
                        queued = true;
                    }
                }
            }
            if (queued) ++queueRev_;
            put(ok, L"queued", queued);
            postRpcSuccess(id, ok);
        } else if (method == L"browse.home") {
            if (!remoteView_) {
                localIndex_.ensureBuilt();
                auto const& recentIds = localIndex_.albumOrderForTab("recent", false);
                JsonArray albumsArr;
                const size_t albCap = std::min<size_t>(12, recentIds.size());
                for (size_t i = 0; i < albCap; ++i) albumsArr.Append(localAlbumJson(recentIds[i], 360));
                auto const& artIds = localIndex_.artistOrderSorted();
                JsonArray artArr;
                const size_t artCap = std::min<size_t>(12, artIds.size());
                for (size_t i = 0; i < artCap; ++i) artArr.Append(localArtistJson(artIds[i], 280));
                ok.Insert(L"recentAlbums", albumsArr);
                ok.Insert(L"artists", artArr);
                put(ok, L"totalAlbums", static_cast<double>(localIndex_.albums().size()));
                put(ok, L"totalArtists", static_cast<double>(localIndex_.artists().size()));
                put(ok, L"totalSongs", static_cast<double>(localIndex_.tracks().size()));
                postRpcSuccess(id, ok);
            } else if (!configured(navClient().configuration())) {
                postRpcSuccess(id, navHomeJson());
            } else {
                const bool needRecent = !remoteAlbumsByTab_.contains(L"recent");
                const bool needArtists = !remoteArtistsLoaded_;
                if (!needRecent && !needArtists) {
                    postRpcSuccess(id, navHomeJson());
                } else {
                    uint64_t waitReq = 0;
                    if (needRecent) waitReq = navClient().requestAlbumList(L"recent", 20, 0);
                    if (needArtists) {
                        const uint64_t artReq = navClient().request(nv::Action::Artists);
                        if (!waitReq) waitReq = artReq;
                    }
                    if (waitReq) pendingRemoteRpcs_.push_back({waitReq, id, L"home", L"recent", 0, 20, false});
                    else postRpcSuccess(id, navHomeJson());
                }
            }
        } else if (method == L"browse.albums") {
            const auto tabW = std::wstring(params.GetNamedString(L"tab", L"recent"));
            const auto tab = to_string(tabW);
            size_t offset = indexValue(params, L"offset");
            size_t limit = indexValue(params, L"limit");
            const bool force = params.HasKey(L"force") && params.GetNamedBoolean(L"force", false);
            if (offset == SIZE_MAX) offset = 0;
            limit = std::clamp<size_t>(limit == SIZE_MAX ? 60 : limit, 1, 200);
            if (!remoteView_) {
                JsonArray arr;
                if (force && tab != "random") localIndex_.invalidateLibrary();
                localIndex_.ensureBuilt();
                auto const& order = localIndex_.albumOrderForTab(tab, force);
                const size_t total = order.size();
                const size_t end = std::min(offset + limit, total);
                for (size_t i = offset; i < end; ++i) arr.Append(localAlbumJson(order[i], 360));
                put(ok, L"tab", utf8(tab));
                put(ok, L"offset", static_cast<double>(offset));
                put(ok, L"total", static_cast<double>(total));
                put(ok, L"hasMore", offset + arr.Size() < total);
                ok.Insert(L"items", arr);
                postRpcSuccess(id, ok);
            } else if (!configured(navClient().configuration())) {
                postRpcSuccess(id, navAlbumsJson(tabW, offset, limit));
            } else {
                const auto it = remoteAlbumsByTab_.find(tabW);
                const bool haveCached = !force && it != remoteAlbumsByTab_.end() &&
                    (offset < it->second.size() || !remoteAlbumsHasMore_[tabW]);
                if (haveCached) {
                    postRpcSuccess(id, navAlbumsJson(tabW, offset, limit));
                } else {
                    const uint64_t req = navClient().requestAlbumList(tabW, static_cast<int>(limit), static_cast<int>(offset));
                    if (req) {
                        pendingRemoteRpcs_.push_back({req, id, L"albums", tabW, offset, limit, offset > 0 && !force});
                    } else {
                        postRpcSuccess(id, navAlbumsJson(tabW, offset, limit));
                    }
                }
            }
        } else if (method == L"browse.album") {
            const auto albIdW = std::wstring(params.GetNamedString(L"id", L""));
            const auto albId = to_string(albIdW);
            const bool force = params.HasKey(L"force") && params.GetNamedBoolean(L"force", false);
            if (!remoteView_) {
                localIndex_.ensureBuilt();
                if (auto const* alb = localIndex_.findAlbum(albId)) {
                    const size_t albIdx = static_cast<size_t>(alb - localIndex_.albums().data());
                    ok.Insert(L"meta", localAlbumJson(albIdx, 480));
                    JsonArray rows;
                    for (size_t i = 0; i < alb->trackIndices.size(); ++i) {
                        rows.Append(localTrackJson(alb->trackIndices[i], i));
                    }
                    ok.Insert(L"rows", rows);
                    put(ok, L"total", static_cast<double>(alb->trackIndices.size()));
                    put(ok, L"found", true);
                    postRpcSuccess(id, ok);
                    return;
                }
                put(ok, L"found", false);
                ok.Insert(L"rows", JsonArray{});
                put(ok, L"total", 0.0);
                postRpcSuccess(id, ok);
            } else if (albIdW.empty() || !configured(navClient().configuration())) {
                postRpcSuccess(id, navAlbumDetailJson(albIdW));
            } else if (!force && remoteAlbumDetails_.contains(albIdW)) {
                postRpcSuccess(id, navAlbumDetailJson(albIdW));
            } else {
                const uint64_t req = navClient().request(nv::Action::AlbumDetail, albIdW);
                if (req) pendingRemoteRpcs_.push_back({req, id, L"album", albIdW, 0, 0, false});
                else postRpcSuccess(id, navAlbumDetailJson(albIdW));
            }
        } else if (method == L"browse.artists") {
            size_t offset = indexValue(params, L"offset");
            size_t limit = indexValue(params, L"limit");
            const bool force = params.HasKey(L"force") && params.GetNamedBoolean(L"force", false);
            if (offset == SIZE_MAX) offset = 0;
            limit = std::clamp<size_t>(limit == SIZE_MAX ? 120 : limit, 1, 500);
            if (!remoteView_) {
                JsonArray arr;
                if (force) localIndex_.invalidateLibrary();
                localIndex_.ensureBuilt();
                auto const& order = localIndex_.artistOrderSorted();
                const size_t total = order.size();
                const size_t end = std::min(offset + limit, total);
                for (size_t i = offset; i < end; ++i) arr.Append(localArtistJson(order[i], 320));
                put(ok, L"offset", static_cast<double>(offset));
                put(ok, L"total", static_cast<double>(total));
                put(ok, L"hasMore", offset + arr.Size() < total);
                ok.Insert(L"items", arr);
                postRpcSuccess(id, ok);
            } else if (!configured(navClient().configuration())) {
                postRpcSuccess(id, navArtistsJson(offset, limit));
            } else if (!force && remoteArtistsLoaded_) {
                postRpcSuccess(id, navArtistsJson(offset, limit));
            } else {
                const uint64_t req = navClient().request(nv::Action::Artists);
                if (req) pendingRemoteRpcs_.push_back({req, id, L"artists", L"", offset, limit, false});
                else postRpcSuccess(id, navArtistsJson(offset, limit));
            }
        } else if (method == L"browse.artist") {
            const auto artIdW = std::wstring(params.GetNamedString(L"id", L""));
            const auto artId = to_string(artIdW);
            const bool force = params.HasKey(L"force") && params.GetNamedBoolean(L"force", false);
            if (!remoteView_) {
                localIndex_.ensureBuilt();
                if (auto const* art = localIndex_.findArtist(artId)) {
                    const size_t artIdx = static_cast<size_t>(art - localIndex_.artists().data());
                    ok.Insert(L"meta", localArtistJson(artIdx, 480));
                    JsonArray albumsArr;
                    for (size_t albIdx : art->albumIndices) albumsArr.Append(localAlbumJson(albIdx, 360));
                    ok.Insert(L"albums", albumsArr);
                    auto topIdx = localIndex_.artistTopTracks(*art, 10);
                    JsonArray topArr;
                    for (size_t i = 0; i < topIdx.size(); ++i) topArr.Append(localTrackJson(topIdx[i], i));
                    ok.Insert(L"topRows", topArr);
                    put(ok, L"found", true);
                    postRpcSuccess(id, ok);
                    return;
                }
                put(ok, L"found", false);
                ok.Insert(L"albums", JsonArray{});
                ok.Insert(L"topRows", JsonArray{});
                postRpcSuccess(id, ok);
            } else if (artIdW.empty() || !configured(navClient().configuration())) {
                postRpcSuccess(id, navArtistDetailJson(artIdW));
            } else if (!force && remoteArtistDetails_.contains(artIdW)) {
                postRpcSuccess(id, navArtistDetailJson(artIdW));
            } else {
                const uint64_t req = navClient().request(nv::Action::ArtistDetail, artIdW);
                if (req) pendingRemoteRpcs_.push_back({req, id, L"artist", artIdW, 0, 0, false});
                else postRpcSuccess(id, navArtistDetailJson(artIdW));
            }
        } else if (method == L"browse.loved") {
            const bool force = params.HasKey(L"force") && params.GetNamedBoolean(L"force", false);
            if (!remoteView_) {
                if (force) localIndex_.invalidateLibrary();
                localIndex_.ensureBuilt();
                auto lovedIdx = localIndex_.lovedTrackIndices();
                JsonArray songs;
                for (size_t i = 0; i < lovedIdx.size(); ++i) songs.Append(localTrackJson(lovedIdx[i], i));
                ok.Insert(L"songs", songs);
                ok.Insert(L"albums", JsonArray{});
                ok.Insert(L"artists", JsonArray{});
                put(ok, L"total", static_cast<double>(lovedIdx.size()));
                postRpcSuccess(id, ok);
            } else if (!configured(navClient().configuration())) {
                postRpcSuccess(id, navLovedJson());
            } else if (!force && remoteStarred_.loaded) {
                postRpcSuccess(id, navLovedJson());
            } else {
                const uint64_t req = navClient().request(nv::Action::Starred);
                if (req) pendingRemoteRpcs_.push_back({req, id, L"loved", L"", 0, 0, false});
                else postRpcSuccess(id, navLovedJson());
            }
        } else if (method == L"browse.random") {
            const auto action = params.GetNamedString(L"action", L"get");
            size_t count = indexValue(params, L"count");
            if (count == SIZE_MAX) count = (action == L"more") ? 40 : 80;
            count = std::clamp<size_t>(count, 1, 200);
            if (!remoteView_) {
                JsonArray rows;
                localIndex_.ensureBuilt();
                if (action == L"more") localIndex_.randomMore(count);
                else localIndex_.randomBatch(action == L"rebatch", count);
                auto const& cur = localIndex_.currentRandomMix();
                for (size_t i = 0; i < cur.size(); ++i) rows.Append(localTrackJson(cur[i], i));
                put(ok, L"total", static_cast<double>(cur.size()));
                ok.Insert(L"rows", rows);
                postRpcSuccess(id, ok);
            } else if (!configured(navClient().configuration())) {
                postRpcSuccess(id, navRandomJson());
            } else if (action != L"rebatch" && action != L"more" && !remoteRandomSongs_.empty()) {
                postRpcSuccess(id, navRandomJson());
            } else {
                const uint64_t req = navClient().request(nv::Action::RandomSongs, std::wstring(action), {}, {}, static_cast<int>(count));
                if (req) pendingRemoteRpcs_.push_back({req, id, L"random", std::wstring(action), 0, count, action == L"more"});
                else postRpcSuccess(id, navRandomJson());
            }
        } else if (method == L"browse.allSongs") {
            const auto group = to_string(params.GetNamedString(L"group", L"none"));
            size_t offset = indexValue(params, L"offset");
            size_t limit = indexValue(params, L"limit");
            if (offset == SIZE_MAX) offset = 0;
            limit = std::clamp<size_t>(limit == SIZE_MAX ? 200 : limit, 1, 500);
            JsonArray rows;
            double totalDur = 0;
            size_t totalRows = 0;
            size_t totalSongs = 0;
            if (!remoteView_) {
                localIndex_.ensureBuilt();
                auto const& flat = localIndex_.allSongsRows(group, totalDur);
                totalRows = flat.size();
                totalSongs = localIndex_.tracks().size();
                const size_t end = std::min(offset + limit, totalRows);
                for (size_t i = offset; i < end; ++i) {
                    auto const& item = flat[i];
                    JsonObject obj;
                    put(obj, L"rowIndex", static_cast<double>(i));
                    if (item.kind == pola::index::AllSongsRow::Kind::Track) {
                        put(obj, L"kind", L"track");
                        JsonObject trObj = localTrackJson(item.trackIndex, item.numInGroup > 0 ? static_cast<size_t>(item.numInGroup - 1) : i);
                        put(trObj, L"flatIndex", static_cast<double>(i));
                        obj.Insert(L"track", trObj);
                    } else {
                        put(obj, L"kind",
                            item.kind == pola::index::AllSongsRow::Kind::Group1Artist ? L"g1_artist"
                            : item.kind == pola::index::AllSongsRow::Kind::Group1Album ? L"g1_album"
                            : L"g2_album");
                        put(obj, L"label", item.label);
                        put(obj, L"sub", item.sub);
                        put(obj, L"coverUrl", item.coverUrl);
                        put(obj, L"songCount", static_cast<double>(item.songCount));
                        put(obj, L"albumCount", static_cast<double>(item.albumCount));
                        if (item.kind == pola::index::AllSongsRow::Kind::Group1Artist &&
                            item.groupArtistIdx < localIndex_.artists().size()) {
                            put(obj, L"targetId", localIndex_.artists()[item.groupArtistIdx].id);
                        } else if (item.groupAlbumIdx < localIndex_.albums().size()) {
                            put(obj, L"targetId", localIndex_.albums()[item.groupAlbumIdx].id);
                        }
                    }
                    rows.Append(obj);
                }
            }
            put(ok, L"group", utf8(group));
            put(ok, L"offset", static_cast<double>(offset));
            put(ok, L"totalRows", static_cast<double>(totalRows));
            put(ok, L"totalSongs", static_cast<double>(totalSongs));
            put(ok, L"totalDuration", totalDur);
            ok.Insert(L"rows", rows);
            ok.Insert(L"replaygain", buildReplayGainState());
            postRpcSuccess(id, ok);
        } else if (method == L"browse.playList") {
            const auto kind = params.GetNamedString(L"kind", L"album");
            const auto targetIdW = std::wstring(params.GetNamedString(L"id", L""));
            const auto targetId = to_string(targetIdW);
            size_t idx = indexValue(params, L"index");
            if (idx == SIZE_MAX) idx = 0;
            if (params.HasKey(L"shuffle")) setShuffleOrder(params.GetNamedBoolean(L"shuffle", false));
            bool started = false;
            if (!remoteView_) {
                localIndex_.ensureBuilt();
                metadb_handle_list handles;
                std::string ctxName;
                bool isRand = false;
                auto const& all = localIndex_.tracks();
                auto appendIndices = [&](std::vector<std::size_t> const& v) {
                    for (std::size_t ti : v) {
                        if (ti < all.size() && all[ti].handle.is_valid()) handles.add_item(all[ti].handle);
                    }
                };
                if (kind == L"album") {
                    if (auto const* alb = localIndex_.findAlbum(targetId)) {
                        appendIndices(alb->trackIndices);
                        ctxName = alb->name;
                    }
                } else if (kind == L"artistTop") {
                    if (auto const* art = localIndex_.findArtist(targetId)) {
                        appendIndices(localIndex_.artistTopTracks(*art, 10));
                        ctxName = art->name;
                    }
                } else if (kind == L"loved") {
                    appendIndices(localIndex_.lovedTrackIndices());
                    ctxName = "Liked Songs";
                } else if (kind == L"random") {
                    localIndex_.randomBatch(false, 80);
                    appendIndices(localIndex_.currentRandomMix());
                    ctxName = "Radio Mix";
                    isRand = true;
                } else if (kind == L"allSongs") {
                    const auto group = to_string(params.GetNamedString(L"group", L"none"));
                    double dummyDur = 0;
                    auto const& flat = localIndex_.allSongsRows(group, dummyDur);
                    size_t trackOrdinal = 0;
                    if (idx < flat.size() && flat[idx].kind == pola::index::AllSongsRow::Kind::Track) {
                        for (size_t i = 0; i < flat.size(); ++i) {
                            if (flat[i].kind != pola::index::AllSongsRow::Kind::Track) continue;
                            if (i == idx) trackOrdinal = handles.get_count();
                            auto const& tr = all[flat[i].trackIndex];
                            if (tr.handle.is_valid()) handles.add_item(tr.handle);
                        }
                        idx = trackOrdinal;
                    } else {
                        appendIndices(localIndex_.allSongsTrackIndices());
                    }
                    ctxName = "All Songs";
                } else if (kind == L"search") {
                    const auto q = to_string(params.GetNamedString(L"query", query_));
                    auto sr = localIndex_.search(q);
                    appendIndices(sr.trackIndices);
                    ctxName = "Search";
                }
                started = playLocalHandles(handles, idx, ctxName, isRand);
            } else {
                std::vector<nv::Song> list;
                std::string ctxName;
                bool isRand = false;
                if (kind == L"album") {
                    if (const auto it = remoteAlbumDetails_.find(targetIdW); it != remoteAlbumDetails_.end()) {
                        list = it->second.songs;
                        ctxName = to_string(it->second.meta.name);
                    } else if (!targetIdW.empty() && configured(navClient().configuration())) {
                        const uint64_t req = navClient().request(nv::Action::AlbumDetail, targetIdW);
                        if (req) {
                            pendingRemoteRpcs_.push_back({req, id, L"play_album", targetIdW, idx, 0, false});
                            return;
                        }
                    }
                } else if (kind == L"artistTop") {
                    if (const auto it = remoteArtistDetails_.find(targetIdW); it != remoteArtistDetails_.end()) {
                        list = it->second.topSongs;
                        ctxName = to_string(it->second.meta.name);
                    } else if (!targetIdW.empty() && configured(navClient().configuration())) {
                        const uint64_t req = navClient().request(nv::Action::ArtistDetail, targetIdW);
                        if (req) {
                            pendingRemoteRpcs_.push_back({req, id, L"play_artist", targetIdW, idx, 0, false});
                            return;
                        }
                    }
                } else if (kind == L"loved") {
                    for (auto const& s : remoteStarred_.songs) {
                        if (starredSongIds_.contains(s.id)) list.push_back(s);
                    }
                    ctxName = "Liked Songs";
                } else if (kind == L"random") {
                    list = remoteRandomSongs_;
                    ctxName = "Radio Mix";
                    isRand = true;
                } else if (kind == L"search") {
                    list = remoteLastSearchSongs_;
                    ctxName = "Search";
                }
                if (!list.empty()) started = playRemoteList(list, idx < list.size() ? idx : 0, ctxName, isRand);
            }
            put(ok, L"started", started);
            postRpcSuccess(id, ok);
        } else if (method == L"browse.enqueueTrack") {
            const auto trackIdW = std::wstring(params.GetNamedString(L"trackId", L""));
            const auto trackId = to_string(trackIdW);
            bool queued = false;
            if (!remoteView_ && !trackId.empty()) {
                localIndex_.ensureBuilt();
                auto const& all = localIndex_.tracks();
                for (auto const& tr : all) {
                    if (tr.trackId == trackId && tr.handle.is_valid()) {
                        playlist_manager::get()->queue_add_item(tr.handle);
                        ++queueRev_;
                        queued = true;
                        break;
                    }
                }
            } else if (remoteView_ && !trackIdW.empty()) {
                if (const auto it = remoteMetadata_.find(trackIdW); it != remoteMetadata_.end()) {
                    auto h = navHandle(it->second);
                    if (h.is_valid()) {
                        playlist_manager::get()->queue_add_item(h);
                        ++queueRev_;
                        queued = true;
                    }
                }
            }
            put(ok, L"queued", queued);
            postRpcSuccess(id, ok);
        } else if (method == L"track.toggleLoved") {
            const auto kindW = std::wstring(params.GetNamedString(L"kind", L"song"));
            const auto trackIdW = std::wstring(params.GetNamedString(L"trackId", L""));
            const auto targetIdW = params.HasKey(L"id") ? std::wstring(params.GetNamedString(L"id", L"")) : trackIdW;
            const auto trackId = to_string(targetIdW);
            const bool confirmed = params.HasKey(L"confirmed") && params.GetNamedBoolean(L"confirmed", false);
            if (remoteView_ || (currentStream() && kindW == L"song" && targetIdW == (currentStream() ? currentStream()->id : L""))) {
                std::wstring effId = targetIdW;
                if (effId.empty() && kindW == L"song") {
                    if (auto ref = currentStream()) effId = ref->id;
                }
                if (effId.empty() || !configured(navClient().configuration())) {
                    put(ok, L"ok", false);
                    postRpcSuccess(id, ok);
                    return;
                }
                const bool prevStarred = isNavStarred(kindW, effId, false);
                const bool nextStarred = !prevStarred;
                setLocalStarredCache(kindW, effId, nextStarred);
                if (currentStream()) postEvent(L"track", buildTrack());
                sendBrowseUpdated(L"loved");
                const uint64_t req = navClient().requestStar(nextStarred, kindW, effId);
                if (req) {
                    pendingStars_.push_back({req, id, kindW, effId, prevStarred});
                } else {
                    setLocalStarredCache(kindW, effId, prevStarred);
                    put(ok, L"ok", false);
                    postRpcSuccess(id, ok);
                }
                return;
            }
            localIndex_.ensureBuilt();
            metadb_handle_ptr target;
            if (!trackId.empty()) {
                for (auto const& tr : localIndex_.tracks()) {
                    if (tr.trackId == trackId) { target = tr.handle; break; }
                }
                if (!target.is_valid() && current_.is_valid() &&
                    pola::index::LocalLibraryIndex::canonicalTrackId(current_) == trackId) {
                    target = current_;
                }
            } else {
                target = current_;
            }
            postRpcSuccess(id, startToggleLocalLoved(target, confirmed));
        } else if (method == L"search.full") {
            const auto qW = std::wstring(params.GetNamedString(L"query", L""));
            const auto qU8 = to_string(qW);
            size_t offset = indexValue(params, L"offset");
            size_t limit = indexValue(params, L"limit");
            if (offset == SIZE_MAX) offset = 0;
            limit = std::clamp<size_t>(limit == SIZE_MAX ? 150 : limit, 1, 300);
            if (!remoteView_) {
                JsonArray artArr, albArr, songArr;
                size_t songTotal = 0;
                if (!pola::index::trimView(qU8).empty()) {
                    localIndex_.ensureBuilt();
                    auto sr = localIndex_.search(qU8);
                    for (size_t ai : sr.artistIndices) artArr.Append(localArtistJson(ai, 240));
                    for (size_t albi : sr.albumIndices) albArr.Append(localAlbumJson(albi, 240));
                    songTotal = sr.trackIndices.size();
                    const size_t end = std::min(offset + limit, songTotal);
                    for (size_t i = offset; i < end; ++i) songArr.Append(localTrackJson(sr.trackIndices[i], i));
                }
                put(ok, L"query", hstring(qW));
                put(ok, L"offset", static_cast<double>(offset));
                put(ok, L"songTotal", static_cast<double>(songTotal));
                ok.Insert(L"artists", artArr);
                ok.Insert(L"albums", albArr);
                ok.Insert(L"songs", songArr);
                postRpcSuccess(id, ok);
            } else if (pola::index::trimView(qU8).empty() || !configured(navClient().configuration())) {
                put(ok, L"query", hstring(qW));
                put(ok, L"offset", static_cast<double>(offset));
                put(ok, L"songTotal", 0.0);
                ok.Insert(L"artists", JsonArray{});
                ok.Insert(L"albums", JsonArray{});
                ok.Insert(L"songs", JsonArray{});
                postRpcSuccess(id, ok);
            } else if (qW == remoteLastSearchQuery_) {
                postRpcSuccess(id, navSearchFullJson(qW, offset, limit));
            } else {
                const uint64_t req = navClient().request(nv::Action::SearchAll, {}, qW);
                if (req) pendingRemoteRpcs_.push_back({req, id, L"search", qW, offset, limit, false});
                else postRpcSuccess(id, navSearchFullJson(qW, offset, limit));
            }
        } else if (method == L"search.query") {
            const auto q = params.GetNamedString(L"query", L"");
            query_ = hstring(std::wstring_view(q).substr(0, 200));
            searchActive_ = !query_.empty();
            if (remoteView_) {
                remoteSongs_.clear();
                remoteRowsFailed_ = false;
                rowsRequest_ = searchActive_ ? navClient().request(nv::Action::Search, {}, std::wstring(query_)) : 0;
                ++searchRev_;
                sendSearchStatus();
            } else {
                startSearch();
            }
            postRpcSuccess(id, ok);
        } else if (method == L"search.page") {
            const auto offset = indexValue(params, L"offset");
            const auto limit = indexValue(params, L"limit");
            if (remoteView_ && rowsRequest_) {
                pendingSearchRpc_ = id;
                return;
            }
            postRpcSuccess(id, buildSearchPage(offset == SIZE_MAX ? 0 : offset, limit == SIZE_MAX ? 200 : limit));
        } else if (method == L"search.play") {
            const size_t idx = indexValue(params, L"index");
            bool started = false;
            if (remoteView_) {
                if (idx < remoteSongs_.size()) started = playRemoteList(remoteSongs_, idx);
            } else if (idx < searchResults_.size()) {
                started = playLibraryTrack(playlist_manager::get(), searchResults_[idx]);
            }
            put(ok, L"started", started);
            postRpcSuccess(id, ok);
        } else if (method == L"lyrics.retry") {
            if (currentStream()) {
                remoteLyricsTrack_ = 0;
                postEvent(L"lyrics", navLyrics());
            } else if (current_.is_valid()) {
                localLyrics_.reset();
                media_.request(trackKey_, current_);
                postEvent(L"lyrics", buildLyrics());
            }
            postRpcSuccess(id, ok);
        } else if (method == L"settings.saveRightTab") {
            const auto rt = params.GetNamedString(L"rightTab", L"lyrics");
            rightTabSetting.set(rt == L"queue" ? "queue" : "lyrics");
            sendSettings();
            postRpcSuccess(id, ok);
        } else if (method == L"settings.testServer") {
            auto config = readRemoteConfig(params);
            if (config.password.empty() && params.HasKey(L"id")) {
                const auto srvId = params.GetNamedString(L"id", L"");
                for (auto const& se : multiConfig_.servers) {
                    if (se.id == srvId && se.server == config.server && se.user == config.user) {
                        config.password = se.password;
                        break;
                    }
                }
            }
            pingRequest_ = configured(config) ? navClient().requestPing(std::move(config)) : 0;
            JsonObject c;
            put(c, L"status", pingRequest_ ? L"testing" : L"unconfigured");
            postEvent(L"nav.connection", c);
            postRpcSuccess(id, ok);
        } else if (method == L"settings.selectServer") {
            const auto srvId = std::wstring(params.GetNamedString(L"id", L""));
            bool found = false;
            for (auto const& se : multiConfig_.servers) {
                if (se.id == srvId) { found = true; break; }
            }
            if (!found) {
                postRpcError(id, L"server-not-found");
                return;
            }
            multiConfig_.activeId = srvId;
            nv::saveMultiConfig(profileDirectory(), multiConfig_);
            applyActiveMultiServer(true);
            postRpcSuccess(id, ok);
        } else if (method == L"settings.saveServers") {
            nv::MultiConfig next;
            if (!parseServersArray(params, next)) {
                postRpcError(id, L"invalid-servers");
                return;
            }
            if (next.servers.empty()) {
                multiConfig_ = std::move(next);
                nv::saveMultiConfig(profileDirectory(), multiConfig_);
                if (remoteView_) selectSource(false);
                remoteEnabled.set(false);
                activeSourceRemoteSetting.set(false);
                clearRemoteCaches();
                sendSettings();
                postRpcSuccess(id, ok);
                return;
            }
            const bool activePresent = std::any_of(next.servers.begin(), next.servers.end(),
                [&](auto const& s) { return s.id == next.activeId; });
            if (!activePresent) next.activeId = next.servers.front().id;
            multiConfig_ = std::move(next);
            nv::saveMultiConfig(profileDirectory(), multiConfig_);
            applyActiveMultiServer(true);
            postRpcSuccess(id, ok);
        } else if (method == L"settings.importFooNavidrome") {
            auto found = nv::importFooNavidromeServers(profileDirectory());
            size_t imported = 0;
            for (auto& se : found) {
                const bool dup = std::any_of(multiConfig_.servers.begin(), multiConfig_.servers.end(),
                    [&](auto const& ex) { return ex.server == se.server && ex.user == se.user; });
                if (dup) continue;
                se.id = L"foo-" + std::to_wstring(multiConfig_.servers.size() + 1);
                multiConfig_.servers.push_back(std::move(se));
                ++imported;
            }
            if (multiConfig_.activeId.empty() && !multiConfig_.servers.empty())
                multiConfig_.activeId = multiConfig_.servers.front().id;
            if (imported > 0) {
                nv::saveMultiConfig(profileDirectory(), multiConfig_);
                applyActiveMultiServer(true);
            } else {
                sendSettings();
            }
            put(ok, L"imported", static_cast<double>(imported));
            ok.Insert(L"settings", buildSettings());
            postRpcSuccess(id, ok);
        } else if (method == L"settings.save") {
            const auto theme = indexValue(params, L"themeMode");
            const auto lang = params.GetNamedString(L"languageMode", L"auto");
            const auto sources = params.GetNamedString(L"sources", L"local");
            if (theme > 2 || (lang != L"auto" && lang != L"en" && lang != L"zh-CN") ||
                (sources != L"local" && sources != L"both")) {
                postRpcError(id, L"invalid-settings");
                return;
            }
            if (sources == L"both") {
                nv::MultiConfig next;
                if (parseServersArray(params, next)) {
                    const bool activeOk = std::any_of(next.servers.begin(), next.servers.end(),
                        [&](auto const& s) { return s.id == next.activeId; });
                    if (!activeOk && !next.servers.empty()) next.activeId = next.servers.front().id;
                    if (next.servers.empty() || !nv::saveMultiConfig(profileDirectory(), next)) {
                        JsonObject c;
                        put(c, L"status", L"failed");
                        postEvent(L"nav.connection", c);
                        postRpcError(id, L"connection-failed");
                        return;
                    }
                    multiConfig_ = std::move(next);
                    if (!applyActiveMultiServer(true)) {
                        JsonObject c;
                        put(c, L"status", L"failed");
                        postEvent(L"nav.connection", c);
                        postRpcError(id, L"connection-failed");
                        return;
                    }
                } else {
                    const bool hasConn = params.HasKey(L"connection") &&
                        params.GetNamedValue(L"connection").ValueType() == JsonValueType::Object;
                    if (hasConn ? !saveRemoteConfig(params.GetNamedObject(L"connection")) : !configured(navClient().configuration())) {
                        JsonObject c;
                        put(c, L"status", L"failed");
                        postEvent(L"nav.connection", c);
                        postRpcError(id, L"connection-failed");
                        return;
                    }
                }
            }
            themeSetting.set(static_cast<int>(theme));
            languageSetting.set(to_string(lang).c_str());
            remoteEnabled.set(sources == L"both");
            if (!remoteEnabled.get()) {
                activeSourceRemoteSetting.set(false);
                if (remoteView_) selectSource(false);
            }
            applyThemeToWindow(true);
            sendPlaylists();
            postRpcSuccess(id, ok);
        } else if (method == L"track.playNext") {
            auto h = resolveAnyTrackHandle(params);
            bool queued = false;
            if (h.is_valid()) {
                auto pm = playlist_manager::get();
                pfc::list_t<t_playback_queue_item> existing;
                pm->queue_get_contents(existing);
                pm->queue_flush();
                pm->queue_add_item(h);
                for (t_size i = 0; i < existing.get_count(); ++i) {
                    if (existing[i].m_playlist < pm->get_playlist_count() &&
                        existing[i].m_item < pm->playlist_get_item_count(existing[i].m_playlist) &&
                        pm->playlist_get_item_handle(existing[i].m_playlist, existing[i].m_item).get_ptr() == existing[i].m_handle.get_ptr()) {
                        pm->queue_add_item_playlist(existing[i].m_playlist, existing[i].m_item);
                    } else if (existing[i].m_handle.is_valid()) {
                        pm->queue_add_item(existing[i].m_handle);
                    }
                }
                ++queueRev_;
                queued = true;
            }
            put(ok, L"queued", queued);
            postRpcSuccess(id, ok);
        } else if (method == L"track.showProperties") {
            if (!remoteView_) {
                auto h = resolveLocalTrackHandle(params);
                if (h.is_valid()) {
                    metadb_handle_list list;
                    list.add_item(h);
                    standard_commands::context_file_properties(list);
                }
            }
            postRpcSuccess(id, ok);
        } else if (method == L"track.openInFolder") {
            if (!remoteView_) {
                auto h = resolveLocalTrackHandle(params);
                if (h.is_valid()) {
                    metadb_handle_list list;
                    list.add_item(h);
                    standard_commands::context_file_open_directory(list);
                }
            }
            postRpcSuccess(id, ok);
        } else if (method == L"replaygain.state") {
            if (!remoteView_) localIndex_.ensureBuilt();
            postRpcSuccess(id, buildReplayGainState());
        } else if (method == L"replaygain.toggle") {
            localIndex_.ensureBuilt();
            auto rm = replaygain_manager::tryGet();
            if (!rm.is_valid() || localIndex_.rgTotalCount() == 0) {
                postRpcSuccess(id, buildReplayGainState());
                return;
            }
            auto cfg = rm->get_core_settings();
            const size_t total = localIndex_.rgTotalCount();
            const size_t scanned = localIndex_.rgScannedCount();
            const size_t missing = total >= scanned ? total - scanned : 0;
            const bool isOn = (cfg.m_source_mode != t_replaygain_config::source_mode_none);
            if (isOn && missing == 0) {
                cfg.m_source_mode = t_replaygain_config::source_mode_none;
                cfg.m_processing_mode = t_replaygain_config::processing_mode_none;
                rm->set_core_settings(cfg);
                rgDirty_ = true;
                auto st = buildReplayGainState();
                put(st, L"needsConfirm", false);
                postRpcSuccess(id, st);
            } else if (missing == 0) {
                cfg.m_source_mode = t_replaygain_config::source_mode_track;
                cfg.m_processing_mode = t_replaygain_config::processing_mode_gain_and_peak;
                rm->set_core_settings(cfg);
                rgDirty_ = true;
                auto st = buildReplayGainState();
                put(st, L"needsConfirm", false);
                postRpcSuccess(id, st);
            } else {
                auto st = buildReplayGainState();
                put(st, L"needsConfirm", true);
                postRpcSuccess(id, st);
            }
        } else if (method == L"replaygain.confirmScan") {
            localIndex_.ensureBuilt();
            if (auto rm = replaygain_manager::tryGet(); rm.is_valid()) {
                auto cfg = rm->get_core_settings();
                cfg.m_source_mode = t_replaygain_config::source_mode_track;
                cfg.m_processing_mode = t_replaygain_config::processing_mode_gain_and_peak;
                rm->set_core_settings(cfg);
            }
            auto miss = localIndex_.rgMissingHandles();
            bool started = false;
            if (miss.get_count() > 0) {
                started = standard_commands::context_rg_scan_track(miss);
            }
            rgDirty_ = true;
            auto st = buildReplayGainState();
            put(st, L"started", started);
            postRpcSuccess(id, st);
        } else if (method == L"settings.completeOnboarding") {
            onboardingDoneSetting.set(true);
            sendSettings();
            postRpcSuccess(id, ok);
        } else if (method == L"settings.openPreferences") {
            standard_commands::main_preferences();
            postRpcSuccess(id, ok);
        } else if (method == L"fullscreen.enter") {
            enterFullscreen(params.GetNamedString(L"view", L"lyrics"));
            postRpcSuccess(id, ok);
        } else if (method == L"fullscreen.exit") {
            leaveFullscreen();
            postRpcSuccess(id, ok);
        } else if (method == L"fullscreen.setView") {
            fsView_ = normalizeFsView(params.GetNamedString(L"view", L"lyrics"));
            syncVizTimerAndStream();
            sendWindowState();
            postRpcSuccess(id, ok);
        } else {
            postRpcError(id, L"unknown-method");
        }
    }
};

static user_interface_factory<PolaUi> factory;
} // namespace
