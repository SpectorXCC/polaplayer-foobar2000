#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <shobjidl.h>
#include <foobar2000/SDK/foobar2000.h>

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <functional>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace pola::drop {

inline std::string canonicalDedupKey(metadb_handle_ptr const& h) {
    if (!h.is_valid()) return {};
    const char* path = h->get_path();
    if (!path) return {};
    std::string key = std::string(path) + "#" + std::to_string(h->get_subsong_index());
    for (char& ch : key) {
        ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    }
    return key;
}

inline std::wstring suggestPlaylistNameFromPaths(std::vector<std::wstring> const& paths) {
    namespace fs = std::filesystem;
    if (paths.empty()) return {};
    const fs::path first(paths.front());
    std::error_code ec;
    if (fs::is_directory(first, ec)) {
        auto fname = first.filename().wstring();
        if (!fname.empty()) return fname;
    }
    auto stem = first.stem().wstring();
    if (!stem.empty()) return stem;
    auto fname = first.filename().wstring();
    return fname;
}

inline std::vector<std::wstring> pickOpenPathsDialog(HWND owner, bool folder) {
    std::vector<std::wstring> out;
    IFileOpenDialog* dlg = nullptr;
    HRESULT hr = CoCreateInstance(
        CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dlg));
    if (FAILED(hr) || !dlg) return out;

    DWORD opts = 0;
    if (SUCCEEDED(dlg->GetOptions(&opts))) {
        opts |= FOS_FORCEFILESYSTEM | FOS_ALLOWMULTISELECT | FOS_PATHMUSTEXIST;
        if (folder) opts |= FOS_PICKFOLDERS;
        else opts |= FOS_FILEMUSTEXIST;
        dlg->SetOptions(opts);
    }

    if (!folder) {
        const COMDLG_FILTERSPEC filters[] = {
            {L"Audio & Playlist Files",
             L"*.mp3;*.flac;*.wav;*.m4a;*.aac;*.ogg;*.opus;*.wma;*.alac;*.ape;*.wv;*.aiff;*.dsf;*.dff;*.m3u;*.m3u8;*.pls;*.cue"},
            {L"All Files", L"*.*"}
        };
        dlg->SetFileTypes(ARRAYSIZE(filters), filters);
        dlg->SetFileTypeIndex(1);
    }

    if (SUCCEEDED(dlg->Show(owner))) {
        IShellItemArray* items = nullptr;
        if (SUCCEEDED(dlg->GetResults(&items)) && items) {
            DWORD count = 0;
            items->GetCount(&count);
            for (DWORD i = 0; i < count; ++i) {
                IShellItem* item = nullptr;
                if (SUCCEEDED(items->GetItemAt(i, &item)) && item) {
                    PWSTR path = nullptr;
                    if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path)) && path) {
                        if (*path) out.emplace_back(path);
                        CoTaskMemFree(path);
                    }
                    item->Release();
                }
            }
            items->Release();
        }
    }
    dlg->Release();
    return out;
}

inline void resolveLocationsAsync(
    HWND owner,
    std::vector<std::wstring> const& paths,
    std::shared_ptr<bool> alive,
    std::function<void(metadb_handle_list_cref)> callback) {
    if (paths.empty() || !callback) return;

    pfc::list_t<pfc::string8> u8Storage;
    pfc::list_t<const char*> ptrs;
    for (auto const& wp : paths) {
        if (wp.empty()) continue;
        pfc::string8 u8;
        u8.set_string(pfc::stringcvt::string_utf8_from_wide(wp.c_str()));
        u8Storage.add_item(u8);
    }
    if (u8Storage.get_count() == 0) return;
    for (t_size i = 0; i < u8Storage.get_count(); ++i) {
        ptrs.add_item(u8Storage[i].get_ptr());
    }

    auto notify = process_locations_notify::create([alive = std::move(alive), cb = std::move(callback)](metadb_handle_list_cref items) {
        if (!alive || !*alive) return;
        cb(items);
    });

    if (auto filter = playlist_incoming_item_filter_v2::tryGet(); filter.is_valid()) {
        filter->process_locations_async(
            ptrs,
            playlist_incoming_item_filter_v2::op_flag_delay_ui,
            nullptr,
            nullptr,
            owner,
            notify);
    }
}

} // namespace pola::drop
