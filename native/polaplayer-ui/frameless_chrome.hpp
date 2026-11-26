#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <windowsx.h>
#include <dwmapi.h>
#include <shellapi.h>
#include "webview_host.hpp"

#ifndef DWMWA_USE_IMMERSIVE_DARK_MODE
#define DWMWA_USE_IMMERSIVE_DARK_MODE 20
#endif
#ifndef DWMWA_WINDOW_CORNER_PREFERENCE
#define DWMWA_WINDOW_CORNER_PREFERENCE 33
#endif
#ifndef DWMWCP_ROUND
#define DWMWCP_ROUND 2
#endif
#ifndef DWMWCP_DONOTROUND
#define DWMWCP_DONOTROUND 1
#endif
#ifndef DWMWA_BORDER_COLOR
#define DWMWA_BORDER_COLOR 34
#endif
#ifndef DWMWA_CAPTION_COLOR
#define DWMWA_CAPTION_COLOR 35
#endif
#ifndef DWMWA_COLOR_NONE
#define DWMWA_COLOR_NONE 0xFFFFFFFEu
#endif
#ifndef DWMWA_COLOR_DEFAULT
#define DWMWA_COLOR_DEFAULT 0xFFFFFFFFu
#endif

namespace pola::chrome {

inline int windowDpi(HWND hwnd) {
    using PfnGetDpiForWindow = UINT(WINAPI*)(HWND);
    static auto fn = reinterpret_cast<PfnGetDpiForWindow>(
        reinterpret_cast<void*>(GetProcAddress(GetModuleHandleW(L"user32.dll"), "GetDpiForWindow")));
    if (fn && hwnd) {
        UINT dpi = fn(hwnd);
        if (dpi > 0) return static_cast<int>(dpi);
    }
    return 96;
}

inline int scaleDpi(int dip, int dpi) {
    return MulDiv(dip, dpi, 96);
}

inline void applyDwmTheme(HWND hwnd, bool light, bool fullscreen) {
    if (!hwnd || !IsWindow(hwnd)) return;

    DWORD corner = fullscreen ? DWMWCP_DONOTROUND : DWMWCP_ROUND;
    DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &corner, sizeof(corner));

    BOOL dark = (light && !fullscreen) ? FALSE : TRUE;
    DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark, sizeof(dark));

    COLORREF canvasCol = (light && !fullscreen) ? RGB(232, 232, 236) : RGB(0, 0, 0);
    DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, &canvasCol, sizeof(canvasCol));

    DWORD borderVal = fullscreen
        ? DWMWA_COLOR_NONE
        : static_cast<DWORD>(light ? RGB(200, 200, 206) : RGB(42, 42, 42));
    DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, &borderVal, sizeof(borderVal));

    MARGINS m = {0, 0, 0, 0};
    DwmExtendFrameIntoClientArea(hwnd, &m);
}

inline void syncWebViewInsets(HWND hwnd, bool fullscreen) {
    if (!hwnd || !IsWindow(hwnd)) return;
    if (fullscreen || IsZoomed(hwnd)) {
        WvSetInsets(0, 0, 0, 0);
        return;
    }
    const int dpi = windowDpi(hwnd);
    const int side = scaleDpi(4, dpi);
    const int top = scaleDpi(3, dpi);
    WvSetInsets(side, top, side, side);
}

inline LRESULT handleNcCalcSize(HWND hwnd, WPARAM wParam, LPARAM lParam, bool fullscreen) {
    if (wParam == TRUE) {
        auto* params = reinterpret_cast<NCCALCSIZE_PARAMS*>(lParam);
        if (!fullscreen && IsZoomed(hwnd)) {
            HMONITOR mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            MONITORINFO mi{sizeof(mi)};
            if (GetMonitorInfoW(mon, &mi)) {
                RECT work = mi.rcWork;
                if (EqualRect(&mi.rcWork, &mi.rcMonitor)) {
                    APPBARDATA abd{sizeof(abd)};
                    if (SHAppBarMessage(ABM_GETSTATE, &abd) & ABS_AUTOHIDE) {
                        APPBARDATA pos{sizeof(pos)};
                        if (SHAppBarMessage(ABM_GETTASKBARPOS, &pos)) {
                            if (pos.uEdge == ABE_TOP) work.top += 1;
                            else if (pos.uEdge == ABE_LEFT) work.left += 1;
                            else if (pos.uEdge == ABE_RIGHT) work.right -= 1;
                            else work.bottom -= 1;
                        } else {
                            work.bottom -= 1;
                        }
                    }
                }
                params->rgrc[0] = work;
            }
        }
    }
    return 0;
}

inline LRESULT hitTestEdges(HWND hwnd, POINT screenPt, bool fullscreen) {
    if (fullscreen || IsZoomed(hwnd)) return HTCLIENT;
    POINT pt = screenPt;
    RECT rc{};
    if (!ScreenToClient(hwnd, &pt) || !GetClientRect(hwnd, &rc)) return HTCLIENT;
    const int dpi = windowDpi(hwnd);
    const int edge = scaleDpi(5, dpi);
    const int corner = scaleDpi(8, dpi);
    if (pt.y < edge) {
        if (pt.x < corner) return HTTOPLEFT;
        if (pt.x >= rc.right - corner) return HTTOPRIGHT;
        return HTTOP;
    }
    if (pt.y >= rc.bottom - edge) {
        if (pt.x < corner) return HTBOTTOMLEFT;
        if (pt.x >= rc.right - corner) return HTBOTTOMRIGHT;
        return HTBOTTOM;
    }
    if (pt.x < edge) {
        if (pt.y < corner) return HTTOPLEFT;
        if (pt.y >= rc.bottom - corner) return HTBOTTOMLEFT;
        return HTLEFT;
    }
    if (pt.x >= rc.right - edge) {
        if (pt.y < corner) return HTTOPRIGHT;
        if (pt.y >= rc.bottom - corner) return HTBOTTOMRIGHT;
        return HTRIGHT;
    }
    return HTCLIENT;
}

inline void showSystemMenuAt(HWND hwnd, POINT screenPt) {
    HMENU menu = GetSystemMenu(hwnd, FALSE);
    if (!menu) return;
    const bool zoomed = IsZoomed(hwnd) != FALSE;
    EnableMenuItem(menu, SC_RESTORE, MF_BYCOMMAND | (zoomed ? MF_ENABLED : MF_GRAYED));
    EnableMenuItem(menu, SC_MOVE, MF_BYCOMMAND | (zoomed ? MF_GRAYED : MF_ENABLED));
    EnableMenuItem(menu, SC_SIZE, MF_BYCOMMAND | (zoomed ? MF_GRAYED : MF_ENABLED));
    EnableMenuItem(menu, SC_MAXIMIZE, MF_BYCOMMAND | (zoomed ? MF_GRAYED : MF_ENABLED));
    EnableMenuItem(menu, SC_MINIMIZE, MF_BYCOMMAND | MF_ENABLED);
    EnableMenuItem(menu, SC_CLOSE, MF_BYCOMMAND | MF_ENABLED);
    SetMenuDefaultItem(menu, SC_CLOSE, FALSE);
    UINT cmd = static_cast<UINT>(TrackPopupMenu(
        menu, TPM_RETURNCMD | TPM_RIGHTBUTTON, screenPt.x, screenPt.y, 0, hwnd, nullptr));
    if (cmd != 0) PostMessageW(hwnd, WM_SYSCOMMAND, static_cast<WPARAM>(cmd), 0);
}

inline bool applySnapPreset(HWND hwnd, const wchar_t* preset) {
    if (!hwnd || !IsWindow(hwnd) || !preset) return false;
    std::wstring_view p(preset);
    if (p == L"max") {
        ShowWindow(hwnd, IsZoomed(hwnd) ? SW_RESTORE : SW_MAXIMIZE);
        return true;
    }
    double fx = 0, fy = 0, fw = 0, fh = 0;
    if (p == L"h-l") { fx = 0.0; fy = 0.0; fw = 0.5; fh = 1.0; }
    else if (p == L"h-r") { fx = 0.5; fy = 0.0; fw = 0.5; fh = 1.0; }
    else if (p == L"t-l") { fx = 0.0; fy = 0.0; fw = 1.0 / 3.0; fh = 1.0; }
    else if (p == L"t-m") { fx = 1.0 / 3.0; fy = 0.0; fw = 1.0 / 3.0; fh = 1.0; }
    else if (p == L"t-r") { fx = 2.0 / 3.0; fy = 0.0; fw = 1.0 / 3.0; fh = 1.0; }
    else if (p == L"q-tl") { fx = 0.0; fy = 0.0; fw = 0.5; fh = 0.5; }
    else if (p == L"q-tr") { fx = 0.5; fy = 0.0; fw = 0.5; fh = 0.5; }
    else if (p == L"q-bl") { fx = 0.0; fy = 0.5; fw = 0.5; fh = 0.5; }
    else if (p == L"q-br") { fx = 0.5; fy = 0.5; fw = 0.5; fh = 0.5; }
    else return false;

    HMONITOR mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    MONITORINFO mi{sizeof(mi)};
    if (!GetMonitorInfoW(mon, &mi)) return false;
    if (IsZoomed(hwnd)) ShowWindow(hwnd, SW_RESTORE);

    const LONG waW = mi.rcWork.right - mi.rcWork.left;
    const LONG waH = mi.rcWork.bottom - mi.rcWork.top;
    const LONG x = mi.rcWork.left + static_cast<LONG>(waW * fx + 0.5);
    const LONG y = mi.rcWork.top + static_cast<LONG>(waH * fy + 0.5);
    const LONG w = static_cast<LONG>(waW * (fx + fw) + 0.5) - (x - mi.rcWork.left);
    const LONG h = static_cast<LONG>(waH * (fy + fh) + 0.5) - (y - mi.rcWork.top);
    SetWindowPos(hwnd, nullptr, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
    return true;
}

} // namespace pola::chrome
