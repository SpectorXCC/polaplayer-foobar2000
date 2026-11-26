#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#include <windows.h>
#include <objbase.h>
#include <oleauto.h>
#include <EventToken.h>
#include "WebView2.h"
#include "webview_host.hpp"

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <deque>
#include <mutex>
#include <string>

namespace {

typedef HRESULT(STDAPICALLTYPE* PFN_CreateCoreWebView2EnvironmentWithOptions)(
    PCWSTR browserExecutableFolder,
    PCWSTR userDataFolder,
    ICoreWebView2EnvironmentOptions* environmentOptions,
    ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler* environmentCreatedHandler);

typedef HRESULT(STDAPICALLTYPE* PFN_GetAvailableCoreWebView2BrowserVersionString)(
    PCWSTR browserExecutableFolder,
    LPWSTR* versionInfo);

static const wchar_t* HOST_WND_CLASS = L"VerdantWebViewHostWindow";
static const size_t MAX_INBOX_MESSAGES = 256;

struct WebViewState {
    HMODULE loaderMod = nullptr;
    PFN_CreateCoreWebView2EnvironmentWithOptions fnCreateEnv = nullptr;
    PFN_GetAvailableCoreWebView2BrowserVersionString fnGetVer = nullptr;
    bool loaderChecked = false;
    bool runtimeAvailable = false;

    uint64_t gen = 1;
    HWND mainHwnd = nullptr;
    HWND hostHwnd = nullptr;
    HBRUSH bgBrush = nullptr;
    COLORREF backdropColor = RGB(18, 18, 18);
    RECT insets{0, 0, 0, 0};
    bool captureSpace = true;
    bool captureEscape = true;
    bool hostClassRegistered = false;

    bool initializing = false;
    bool failed = false;
    bool ready = false;
    bool wantVisible = false;

    std::wstring appDir;
    std::wstring cacheDir;
    std::wstring dataDir;

    std::wstring resourceFilter;
    WvResourceHandlerFn resourceHandler = nullptr;
    void* resourceCtx = nullptr;

    ICoreWebView2Environment* env = nullptr;
    ICoreWebView2Controller* controller = nullptr;
    ICoreWebView2* webview = nullptr;
    EventRegistrationToken msgToken{};
    EventRegistrationToken accelToken{};
    EventRegistrationToken resourceToken{};
    bool hasMsgToken = false;
    bool hasAccelToken = false;
    bool hasResourceToken = false;

    std::mutex inboxMutex;
    std::deque<std::wstring> inbox;
};

static WebViewState g_wv;

static std::wstring GetModuleDirectory(HMODULE mod) {
    wchar_t buf[MAX_PATH * 2] = {};
    DWORD len = GetModuleFileNameW(mod, buf, static_cast<DWORD>(sizeof(buf) / sizeof(buf[0])));
    if (len == 0 || len >= sizeof(buf) / sizeof(buf[0])) return L"";
    std::wstring full(buf, len);
    size_t pos = full.find_last_of(L"\\/");
    return (pos == std::wstring::npos) ? L"" : full.substr(0, pos);
}

static std::wstring TrimTrailingSlashes(const std::wstring& path) {
    size_t end = path.size();
    while (end > 3 && (path[end - 1] == L'\\' || path[end - 1] == L'/')) {
        --end;
    }
    return path.substr(0, end);
}

static bool FileExistsW(const std::wstring& path) {
    if (path.empty()) return false;
    DWORD attr = GetFileAttributesW(path.c_str());
    return attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

static void EnsureDirRecursive(const std::wstring& dir) {
    if (dir.empty()) return;
    DWORD attr = GetFileAttributesW(dir.c_str());
    if (attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY) != 0) return;
    size_t pos = dir.find_last_of(L"\\/");
    if (pos != std::wstring::npos && pos > 2) {
        EnsureDirRecursive(dir.substr(0, pos));
    }
    CreateDirectoryW(dir.c_str(), nullptr);
}

static void ComputeHostRect(HWND mainHwnd, int& x, int& y, int& w, int& h) {
    RECT crc{};
    GetClientRect(mainHwnd, &crc);
    x = (std::max)(0L, g_wv.insets.left);
    y = (std::max)(0L, g_wv.insets.top);
    int right = (std::max)(static_cast<LONG>(x + 1), crc.right - g_wv.insets.right);
    int bottom = (std::max)(static_cast<LONG>(y + 1), crc.bottom - g_wv.insets.bottom);
    w = (std::max)(1, right - x);
    h = (std::max)(1, bottom - y);
}

static void ApplyControllerBackdrop() {
    if (!g_wv.controller) return;
    ICoreWebView2Controller2* ctrl2 = nullptr;
    if (SUCCEEDED(g_wv.controller->QueryInterface(IID_ICoreWebView2Controller2, reinterpret_cast<void**>(&ctrl2))) && ctrl2) {
        COREWEBVIEW2_COLOR bg = {
            255,
            GetRValue(g_wv.backdropColor),
            GetGValue(g_wv.backdropColor),
            GetBValue(g_wv.backdropColor)
        };
        ctrl2->put_DefaultBackgroundColor(bg);
        ctrl2->Release();
    }
}

static void EnqueueMessage(std::wstring&& json) {
    if (json.empty()) return;
    std::lock_guard<std::mutex> lock(g_wv.inboxMutex);
    if (g_wv.inbox.size() >= MAX_INBOX_MESSAGES) {
        g_wv.inbox.pop_front();
    }
    g_wv.inbox.push_back(std::move(json));
}

static bool EnsureLoader(HMODULE selfModule) {
    if (g_wv.loaderChecked) return g_wv.runtimeAvailable;
    g_wv.loaderChecked = true;

    std::wstring dir = GetModuleDirectory(selfModule);
    if (!dir.empty()) {
        std::wstring loaderPath = dir + L"\\WebView2Loader.dll";
        g_wv.loaderMod = LoadLibraryW(loaderPath.c_str());
    }
    if (!g_wv.loaderMod) {
        g_wv.loaderMod = LoadLibraryW(L"WebView2Loader.dll");
    }
    if (!g_wv.loaderMod) {
        g_wv.runtimeAvailable = false;
        return false;
    }

    g_wv.fnCreateEnv = reinterpret_cast<PFN_CreateCoreWebView2EnvironmentWithOptions>(
        reinterpret_cast<void*>(GetProcAddress(g_wv.loaderMod, "CreateCoreWebView2EnvironmentWithOptions")));
    g_wv.fnGetVer = reinterpret_cast<PFN_GetAvailableCoreWebView2BrowserVersionString>(
        reinterpret_cast<void*>(GetProcAddress(g_wv.loaderMod, "GetAvailableCoreWebView2BrowserVersionString")));

    if (!g_wv.fnCreateEnv || !g_wv.fnGetVer) {
        g_wv.runtimeAvailable = false;
        return false;
    }

    LPWSTR ver = nullptr;
    HRESULT hr = g_wv.fnGetVer(nullptr, &ver);
    bool hasVer = SUCCEEDED(hr) && ver != nullptr && ver[0] != L'\0';
    if (ver) CoTaskMemFree(ver);
    g_wv.runtimeAvailable = hasVer;
    return g_wv.runtimeAvailable;
}

static LRESULT CALLBACK HostWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
        case WM_ERASEBKGND: {
            HDC hdc = reinterpret_cast<HDC>(wParam);
            RECT rc{};
            if (hdc && GetClientRect(hwnd, &rc)) {
                if (!g_wv.bgBrush) g_wv.bgBrush = CreateSolidBrush(g_wv.backdropColor);
                if (g_wv.bgBrush) {
                    FillRect(hdc, &rc, g_wv.bgBrush);
                    return 1;
                }
            }
            return 1;
        }
        case WM_SIZE: {
            if (g_wv.controller) {
                RECT rc = {0, 0, LOWORD(lParam), HIWORD(lParam)};
                g_wv.controller->put_Bounds(rc);
            }
            return 0;
        }
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

static bool EnsureHostWindow(HWND mainHwnd, HMODULE selfModule) {
    if (!mainHwnd || !IsWindow(mainHwnd)) return false;
    if (!g_wv.hostClassRegistered) {
        WNDCLASSEXW wc{};
        wc.cbSize = sizeof(wc);
        wc.style = CS_HREDRAW | CS_VREDRAW;
        wc.lpfnWndProc = HostWndProc;
        wc.hInstance = selfModule;
        wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        wc.lpszClassName = HOST_WND_CLASS;
        if (RegisterClassExW(&wc) != 0 || GetLastError() == ERROR_CLASS_ALREADY_EXISTS) {
            g_wv.hostClassRegistered = true;
        }
    }
    if (!g_wv.hostClassRegistered) return false;

    if (g_wv.hostHwnd && IsWindow(g_wv.hostHwnd)) {
        if (GetParent(g_wv.hostHwnd) != mainHwnd) {
            SetParent(g_wv.hostHwnd, mainHwnd);
        }
        return true;
    }

    int x = 0, y = 0, w = 1, h = 1;
    ComputeHostRect(mainHwnd, x, y, w, h);
    g_wv.hostHwnd = CreateWindowExW(
        0,
        HOST_WND_CLASS,
        L"",
        WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
        x, y, w, h,
        mainHwnd,
        nullptr,
        selfModule,
        nullptr);
    return g_wv.hostHwnd != nullptr;
}

static std::wstring EscapeJsonStringW(const wchar_t* src) {
    std::wstring out;
    if (!src) return out;
    for (const wchar_t* p = src; *p; ++p) {
        const wchar_t c = *p;
        if (c == L'"' || c == L'\\') {
            out.push_back(L'\\');
            out.push_back(c);
        } else if (c == L'\r') {
            out += L"\\r";
        } else if (c == L'\n') {
            out += L"\\n";
        } else if (c == L'\t') {
            out += L"\\t";
        } else if (c >= 0x20) {
            out.push_back(c);
        }
    }
    return out;
}

class WebMsgHandler final : public ICoreWebView2WebMessageReceivedEventHandler {
    std::atomic<ULONG> m_ref{1};
    uint64_t m_gen;
public:
    explicit WebMsgHandler(uint64_t gen) : m_gen(gen) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == IID_ICoreWebView2WebMessageReceivedEventHandler) {
            *ppv = static_cast<ICoreWebView2WebMessageReceivedEventHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++m_ref; }
    ULONG STDMETHODCALLTYPE Release() override {
        ULONG r = --m_ref;
        if (r == 0) delete this;
        return r;
    }
    HRESULT STDMETHODCALLTYPE Invoke(ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) override {
        if (m_gen != g_wv.gen || !args) return S_OK;
        LPWSTR raw = nullptr;
        if (SUCCEEDED(args->get_WebMessageAsJson(&raw)) && raw) {
            std::wstring s(raw);
            CoTaskMemFree(raw);

            ICoreWebView2WebMessageReceivedEventArgs2* args2 = nullptr;
            if (SUCCEEDED(args->QueryInterface(IID_ICoreWebView2WebMessageReceivedEventArgs2, reinterpret_cast<void**>(&args2))) && args2) {
                ICoreWebView2ObjectCollectionView* objs = nullptr;
                if (SUCCEEDED(args2->get_AdditionalObjects(&objs)) && objs) {
                    UINT count = 0;
                    if (SUCCEEDED(objs->get_Count(&count)) && count > 0) {
                        std::wstring pathsJson = L"\"droppedPaths\":[";
                        bool anyPath = false;
                        for (UINT i = 0; i < count; ++i) {
                            IUnknown* item = nullptr;
                            if (SUCCEEDED(objs->GetValueAtIndex(i, &item)) && item) {
                                ICoreWebView2File* wvFile = nullptr;
                                if (SUCCEEDED(item->QueryInterface(IID_ICoreWebView2File, reinterpret_cast<void**>(&wvFile))) && wvFile) {
                                    LPWSTR wpath = nullptr;
                                    if (SUCCEEDED(wvFile->get_Path(&wpath)) && wpath) {
                                        if (anyPath) pathsJson.push_back(L',');
                                        pathsJson.push_back(L'"');
                                        pathsJson += EscapeJsonStringW(wpath);
                                        pathsJson.push_back(L'"');
                                        anyPath = true;
                                        CoTaskMemFree(wpath);
                                    }
                                    wvFile->Release();
                                }
                                item->Release();
                            }
                        }
                        pathsJson.push_back(L']');
                        if (anyPath) {
                            const auto closeBrace = s.rfind(L'}');
                            if (closeBrace != std::wstring::npos && s.find(L'{') != std::wstring::npos) {
                                s.insert(closeBrace, L"," + pathsJson);
                            }
                        }
                    }
                    objs->Release();
                }
                args2->Release();
            }

            if (s.find(L"\"type\":\"ready\"") != std::wstring::npos) {
                g_wv.ready = true;
            }
            EnqueueMessage(std::move(s));
        }
        return S_OK;
    }
};

class WebResourceHandler final : public ICoreWebView2WebResourceRequestedEventHandler {
    std::atomic<ULONG> m_ref{1};
    uint64_t m_gen;
public:
    explicit WebResourceHandler(uint64_t gen) : m_gen(gen) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == IID_ICoreWebView2WebResourceRequestedEventHandler) {
            *ppv = static_cast<ICoreWebView2WebResourceRequestedEventHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++m_ref; }
    ULONG STDMETHODCALLTYPE Release() override {
        ULONG r = --m_ref;
        if (r == 0) delete this;
        return r;
    }
    HRESULT STDMETHODCALLTYPE Invoke(ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args) override {
        if (m_gen != g_wv.gen || !args || !g_wv.resourceHandler || !g_wv.env) return S_OK;
        ICoreWebView2WebResourceRequest* req = nullptr;
        if (FAILED(args->get_Request(&req)) || !req) return S_OK;
        LPWSTR uri = nullptr;
        HRESULT hr = req->get_Uri(&uri);
        req->Release();
        if (FAILED(hr) || !uri) return S_OK;
        g_wv.resourceHandler(g_wv.resourceCtx, uri, g_wv.env, args);
        CoTaskMemFree(uri);
        return S_OK;
    }
};

static void AttachResourceFilterIfReady() {
    if (!g_wv.webview || !g_wv.resourceHandler || g_wv.resourceFilter.empty()) return;
    if (g_wv.hasResourceToken) {
        g_wv.webview->remove_WebResourceRequested(g_wv.resourceToken);
        g_wv.hasResourceToken = false;
    }
    g_wv.webview->AddWebResourceRequestedFilter(
        g_wv.resourceFilter.c_str(),
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
    auto* resHandler = new WebResourceHandler(g_wv.gen);
    if (SUCCEEDED(g_wv.webview->add_WebResourceRequested(resHandler, &g_wv.resourceToken))) {
        g_wv.hasResourceToken = true;
    }
    resHandler->Release();
}

class AccelKeyHandler final : public ICoreWebView2AcceleratorKeyPressedEventHandler {
    std::atomic<ULONG> m_ref{1};
    uint64_t m_gen;
public:
    explicit AccelKeyHandler(uint64_t gen) : m_gen(gen) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == IID_ICoreWebView2AcceleratorKeyPressedEventHandler) {
            *ppv = static_cast<ICoreWebView2AcceleratorKeyPressedEventHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++m_ref; }
    ULONG STDMETHODCALLTYPE Release() override {
        ULONG r = --m_ref;
        if (r == 0) delete this;
        return r;
    }
    HRESULT STDMETHODCALLTYPE Invoke(ICoreWebView2Controller*, ICoreWebView2AcceleratorKeyPressedEventArgs* args) override {
        if (m_gen != g_wv.gen || !args) return S_OK;
        COREWEBVIEW2_KEY_EVENT_KIND kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
        args->get_KeyEventKind(&kind);
        UINT vk = 0;
        args->get_VirtualKey(&vk);

        bool wantCapture = (vk == VK_ESCAPE && g_wv.captureEscape) ||
            (vk == VK_SPACE && g_wv.captureSpace &&
             (GetKeyState(VK_CONTROL) & 0x8000) == 0 &&
             (GetKeyState(VK_MENU) & 0x8000) == 0);

        if (wantCapture) {
            args->put_Handled(TRUE);
            if (kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN) {
                COREWEBVIEW2_PHYSICAL_KEY_STATUS st{};
                args->get_PhysicalKeyStatus(&st);
                if (!st.WasKeyDown) {
                    EnqueueMessage(vk == VK_ESCAPE ? L"{\"type\":\"key\",\"code\":27}" : L"{\"type\":\"key\",\"code\":32}");
                }
            }
            return S_OK;
        }

        // Suppress browser reload, print, find, zoom, fullscreen, and devtools shortcuts inside the desktop shell.
        bool ctrl = (GetKeyState(VK_CONTROL) & 0x8000) != 0;
        if (vk == VK_F11) {
            args->put_Handled(TRUE);
            if (kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN) {
                COREWEBVIEW2_PHYSICAL_KEY_STATUS st{};
                args->get_PhysicalKeyStatus(&st);
                if (!st.WasKeyDown) EnqueueMessage(L"{\"type\":\"key\",\"code\":122}");
            }
            return S_OK;
        }
        if (vk == VK_F5 || vk == VK_F12 || vk == VK_BROWSER_BACK || vk == VK_BROWSER_FORWARD || vk == VK_BROWSER_REFRESH ||
            (ctrl && (vk == 'R' || vk == 'F' || vk == 'P' || vk == 'G' || vk == 'U' || vk == 'J' ||
                      vk == VK_OEM_PLUS || vk == VK_OEM_MINUS || vk == VK_ADD || vk == VK_SUBTRACT || vk == '0'))) {
            args->put_Handled(TRUE);
            return S_OK;
        }
        return S_OK;
    }
};

class ControllerCompletedHandler final : public ICoreWebView2CreateCoreWebView2ControllerCompletedHandler {
    std::atomic<ULONG> m_ref{1};
    uint64_t m_gen;
public:
    explicit ControllerCompletedHandler(uint64_t gen) : m_gen(gen) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == IID_ICoreWebView2CreateCoreWebView2ControllerCompletedHandler) {
            *ppv = static_cast<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++m_ref; }
    ULONG STDMETHODCALLTYPE Release() override {
        ULONG r = --m_ref;
        if (r == 0) delete this;
        return r;
    }
    HRESULT STDMETHODCALLTYPE Invoke(HRESULT errorCode, ICoreWebView2Controller* ctrl) override {
        if (m_gen != g_wv.gen) {
            if (ctrl) ctrl->Close();
            return S_OK;
        }
        g_wv.initializing = false;
        if (FAILED(errorCode) || !ctrl || !g_wv.hostHwnd || !IsWindow(g_wv.hostHwnd)) {
            g_wv.failed = true;
            if (ctrl) ctrl->Close();
            return S_OK;
        }

        g_wv.controller = ctrl;
        ctrl->AddRef();

        ApplyControllerBackdrop();

        RECT rc{};
        GetClientRect(g_wv.hostHwnd, &rc);
        ctrl->put_Bounds(rc);
        ctrl->put_IsVisible(g_wv.wantVisible ? TRUE : FALSE);

        auto* accelHandler = new AccelKeyHandler(m_gen);
        if (SUCCEEDED(ctrl->add_AcceleratorKeyPressed(accelHandler, &g_wv.accelToken))) {
            g_wv.hasAccelToken = true;
        }
        accelHandler->Release();

        ICoreWebView2* wv = nullptr;
        if (FAILED(ctrl->get_CoreWebView2(&wv)) || !wv) {
            g_wv.failed = true;
            return S_OK;
        }
        g_wv.webview = wv;

        ICoreWebView2Settings* settings = nullptr;
        if (SUCCEEDED(wv->get_Settings(&settings)) && settings) {
            settings->put_AreDefaultContextMenusEnabled(FALSE);
            settings->put_AreDevToolsEnabled(FALSE);
            settings->put_IsStatusBarEnabled(FALSE);
            settings->put_IsZoomControlEnabled(FALSE);
            settings->put_IsBuiltInErrorPageEnabled(FALSE);
            ICoreWebView2Settings3* settings3 = nullptr;
            if (SUCCEEDED(settings->QueryInterface(IID_ICoreWebView2Settings3, reinterpret_cast<void**>(&settings3))) && settings3) {
                settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
                settings3->Release();
            }
            ICoreWebView2Settings9* settings9 = nullptr;
            if (SUCCEEDED(settings->QueryInterface(IID_ICoreWebView2Settings9, reinterpret_cast<void**>(&settings9))) && settings9) {
                settings9->put_IsNonClientRegionSupportEnabled(TRUE);
                settings9->Release();
            }
            settings->Release();
        }

        ICoreWebView2_3* wv3 = nullptr;
        if (SUCCEEDED(wv->QueryInterface(IID_ICoreWebView2_3, reinterpret_cast<void**>(&wv3))) && wv3) {
            if (!g_wv.appDir.empty()) {
                wv3->SetVirtualHostNameToFolderMapping(
                    L"app.verdant.local",
                    g_wv.appDir.c_str(),
                    COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
            }
            if (!g_wv.cacheDir.empty()) {
                wv3->SetVirtualHostNameToFolderMapping(
                    L"cache.verdant.local",
                    g_wv.cacheDir.c_str(),
                    COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
            }
            wv3->Release();
        }

        AttachResourceFilterIfReady();

        auto* msgHandler = new WebMsgHandler(m_gen);
        if (SUCCEEDED(wv->add_WebMessageReceived(msgHandler, &g_wv.msgToken))) {
            g_wv.hasMsgToken = true;
        }
        msgHandler->Release();

        wv->Navigate(L"https://app.verdant.local/index.html");
        return S_OK;
    }
};

class EnvCompletedHandler final : public ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler {
    std::atomic<ULONG> m_ref{1};
    uint64_t m_gen;
public:
    explicit EnvCompletedHandler(uint64_t gen) : m_gen(gen) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == IID_ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler) {
            *ppv = static_cast<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++m_ref; }
    ULONG STDMETHODCALLTYPE Release() override {
        ULONG r = --m_ref;
        if (r == 0) delete this;
        return r;
    }
    HRESULT STDMETHODCALLTYPE Invoke(HRESULT errorCode, ICoreWebView2Environment* env) override {
        if (m_gen != g_wv.gen) return S_OK;
        if (FAILED(errorCode) || !env || !g_wv.hostHwnd || !IsWindow(g_wv.hostHwnd)) {
            g_wv.initializing = false;
            g_wv.failed = true;
            return S_OK;
        }
        g_wv.env = env;
        env->AddRef();

        auto* ctrlHandler = new ControllerCompletedHandler(m_gen);
        HRESULT hr = env->CreateCoreWebView2Controller(g_wv.hostHwnd, ctrlHandler);
        ctrlHandler->Release();
        if (FAILED(hr)) {
            g_wv.initializing = false;
            g_wv.failed = true;
        }
        return S_OK;
    }
};

} // namespace

bool WvIsAvailable(HMODULE selfModule) {
    return EnsureLoader(selfModule);
}

bool WvIsReady() {
    return g_wv.ready && g_wv.webview != nullptr && g_wv.controller != nullptr;
}

bool WvInit(HWND mainHwnd, HMODULE selfModule, const wchar_t* appDirIn, const wchar_t* cacheDirIn, const wchar_t* dataDirIn) {
    if (!mainHwnd || !IsWindow(mainHwnd)) return false;
    if (!EnsureLoader(selfModule)) return false;

    std::wstring resolvedApp = (appDirIn && appDirIn[0]) ? TrimTrailingSlashes(appDirIn) : L"";
    if (resolvedApp.empty() || !FileExistsW(resolvedApp + L"\\index.html")) {
        std::wstring dllDir = GetModuleDirectory(selfModule);
        if (!dllDir.empty()) {
            size_t parentPos = dllDir.find_last_of(L"\\/");
            std::wstring rootDir = (parentPos == std::wstring::npos) ? dllDir : dllDir.substr(0, parentPos);
            std::wstring cand = rootDir + L"\\fullscreen-web\\dist";
            if (FileExistsW(cand + L"\\index.html")) {
                resolvedApp = cand;
            }
        }
    }
    if (resolvedApp.empty() || !FileExistsW(resolvedApp + L"\\index.html")) {
        return false;
    }

    std::wstring resolvedCache = (cacheDirIn && cacheDirIn[0]) ? TrimTrailingSlashes(cacheDirIn) : L"";
    if (!resolvedCache.empty()) EnsureDirRecursive(resolvedCache);

    std::wstring resolvedData = (dataDirIn && dataDirIn[0]) ? TrimTrailingSlashes(dataDirIn) : L"";
    if (resolvedData.empty() && !resolvedCache.empty()) {
        resolvedData = resolvedCache + L"\\webview2-data";
    }
    if (!resolvedData.empty()) EnsureDirRecursive(resolvedData);

    g_wv.mainHwnd = mainHwnd;

    if (g_wv.webview && g_wv.controller && g_wv.hostHwnd && IsWindow(g_wv.hostHwnd)) {
        if (GetParent(g_wv.hostHwnd) != mainHwnd) {
            SetParent(g_wv.hostHwnd, mainHwnd);
        }
        if (!resolvedCache.empty() && resolvedCache != g_wv.cacheDir) {
            g_wv.cacheDir = resolvedCache;
            ICoreWebView2_3* wv3 = nullptr;
            if (SUCCEEDED(g_wv.webview->QueryInterface(IID_ICoreWebView2_3, reinterpret_cast<void**>(&wv3))) && wv3) {
                wv3->SetVirtualHostNameToFolderMapping(
                    L"cache.verdant.local",
                    g_wv.cacheDir.c_str(),
                    COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
                wv3->Release();
            }
        }
        return true;
    }

    if (g_wv.initializing) return true;
    if (g_wv.failed) return false;

    if (!EnsureHostWindow(mainHwnd, selfModule)) return false;

    g_wv.appDir = resolvedApp;
    g_wv.cacheDir = resolvedCache;
    g_wv.dataDir = resolvedData;
    g_wv.initializing = true;
    g_wv.ready = false;

    const uint64_t curGen = g_wv.gen;
    auto* envHandler = new EnvCompletedHandler(curGen);
    HRESULT hr = g_wv.fnCreateEnv(
        nullptr,
        g_wv.dataDir.empty() ? nullptr : g_wv.dataDir.c_str(),
        nullptr,
        envHandler);
    envHandler->Release();

    if (FAILED(hr)) {
        g_wv.initializing = false;
        g_wv.failed = true;
        return false;
    }
    return true;
}

void WvSyncBounds(HWND mainHwnd) {
    if (!mainHwnd || !IsWindow(mainHwnd) || !g_wv.hostHwnd || !IsWindow(g_wv.hostHwnd)) return;
    int x = 0, y = 0, w = 1, h = 1;
    ComputeHostRect(mainHwnd, x, y, w, h);
    UINT flags = SWP_NOACTIVATE | (g_wv.wantVisible ? SWP_SHOWWINDOW : 0);
    SetWindowPos(g_wv.hostHwnd, g_wv.wantVisible ? HWND_TOP : nullptr,
                 x, y, w, h,
                 flags | (g_wv.wantVisible ? 0 : SWP_NOZORDER));
    if (g_wv.controller) {
        RECT b = {0, 0, w, h};
        g_wv.controller->put_Bounds(b);
    }
}

void WvSetInsets(int left, int top, int right, int bottom) {
    g_wv.insets = {left, top, right, bottom};
    if (g_wv.mainHwnd && IsWindow(g_wv.mainHwnd)) {
        WvSyncBounds(g_wv.mainHwnd);
    }
}

void WvSetBackdropColor(COLORREF color) {
    if (g_wv.backdropColor == color && g_wv.bgBrush) return;
    g_wv.backdropColor = color;
    if (g_wv.bgBrush) {
        DeleteObject(g_wv.bgBrush);
        g_wv.bgBrush = nullptr;
    }
    g_wv.bgBrush = CreateSolidBrush(color);
    ApplyControllerBackdrop();
    if (g_wv.hostHwnd && IsWindow(g_wv.hostHwnd)) {
        InvalidateRect(g_wv.hostHwnd, nullptr, TRUE);
    }
}

void WvSetAcceleratorMode(bool captureSpace, bool captureEscape) {
    g_wv.captureSpace = captureSpace;
    g_wv.captureEscape = captureEscape;
}

void WvSetResourceHandler(const wchar_t* uriFilter, WvResourceHandlerFn handler, void* ctx) {
    g_wv.resourceFilter = uriFilter ? uriFilter : L"";
    g_wv.resourceHandler = handler;
    g_wv.resourceCtx = ctx;
    AttachResourceFilterIfReady();
}

void WvSetVisible(bool visible) {
    g_wv.wantVisible = visible;
    if (!g_wv.hostHwnd || !IsWindow(g_wv.hostHwnd)) return;

    if (visible) {
        if (g_wv.mainHwnd && IsWindow(g_wv.mainHwnd)) {
            int x = 0, y = 0, w = 1, h = 1;
            ComputeHostRect(g_wv.mainHwnd, x, y, w, h);
            SetWindowPos(g_wv.hostHwnd, HWND_TOP, x, y, w, h, SWP_SHOWWINDOW);
            if (g_wv.controller) {
                RECT b = {0, 0, w, h};
                g_wv.controller->put_Bounds(b);
            }
        } else {
            ShowWindow(g_wv.hostHwnd, SW_SHOW);
        }
        if (g_wv.controller) {
            g_wv.controller->put_IsVisible(TRUE);
            g_wv.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        }
    } else {
        if (g_wv.controller) {
            g_wv.controller->put_IsVisible(FALSE);
        }
        ShowWindow(g_wv.hostHwnd, SW_HIDE);
        if (g_wv.mainHwnd && IsWindow(g_wv.mainHwnd) && GetForegroundWindow() == g_wv.mainHwnd) {
            SetFocus(g_wv.mainHwnd);
        }
    }
}

bool WvPostJson(const wchar_t* json) {
    if (!json || !json[0] || !g_wv.webview) return false;
    return SUCCEEDED(g_wv.webview->PostWebMessageAsJson(json));
}

BSTR WvDrainMessagesJson() {
    std::wstring joined;
    {
        std::lock_guard<std::mutex> lock(g_wv.inboxMutex);
        if (g_wv.inbox.empty()) {
            return SysAllocString(L"");
        }
        size_t total = 2;
        for (const auto& item : g_wv.inbox) total += item.size() + 1;
        joined.reserve(total);
        joined.push_back(L'[');
        bool first = true;
        while (!g_wv.inbox.empty()) {
            if (!first) joined.push_back(L',');
            first = false;
            joined.append(g_wv.inbox.front());
            g_wv.inbox.pop_front();
        }
        joined.push_back(L']');
    }
    return SysAllocStringLen(joined.data(), static_cast<UINT>(joined.size()));
}

void WvDestroy() {
    ++g_wv.gen;
    g_wv.initializing = false;
    g_wv.ready = false;
    g_wv.wantVisible = false;
    g_wv.failed = false;

    {
        std::lock_guard<std::mutex> lock(g_wv.inboxMutex);
        g_wv.inbox.clear();
    }

    if (g_wv.webview) {
        if (g_wv.hasResourceToken) {
            g_wv.webview->remove_WebResourceRequested(g_wv.resourceToken);
            g_wv.hasResourceToken = false;
        }
        if (g_wv.hasMsgToken) {
            g_wv.webview->remove_WebMessageReceived(g_wv.msgToken);
            g_wv.hasMsgToken = false;
        }
        g_wv.webview->Release();
        g_wv.webview = nullptr;
    }

    if (g_wv.controller) {
        if (g_wv.hasAccelToken) {
            g_wv.controller->remove_AcceleratorKeyPressed(g_wv.accelToken);
            g_wv.hasAccelToken = false;
        }
        g_wv.controller->Close();
        g_wv.controller->Release();
        g_wv.controller = nullptr;
    }

    if (g_wv.env) {
        g_wv.env->Release();
        g_wv.env = nullptr;
    }

    if (g_wv.hostHwnd) {
        if (IsWindow(g_wv.hostHwnd)) DestroyWindow(g_wv.hostHwnd);
        g_wv.hostHwnd = nullptr;
    }
    g_wv.mainHwnd = nullptr;

    if (g_wv.bgBrush) {
        DeleteObject(g_wv.bgBrush);
        g_wv.bgBrush = nullptr;
    }
}

bool WvOwnsWindow(HWND hwnd) {
    if (!hwnd || !g_wv.hostHwnd || !IsWindow(g_wv.hostHwnd)) return false;
    return hwnd == g_wv.hostHwnd || IsChild(g_wv.hostHwnd, hwnd) != FALSE;
}
