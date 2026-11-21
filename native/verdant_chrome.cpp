#define WIN32_LEAN_AND_MEAN
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <windowsx.h>
#include <commctrl.h>
#include <dwmapi.h>
#include <shellapi.h>
#include <objbase.h>
#include <oleauto.h>
#include <vector>
#include <atomic>
#include <cstring>
#include <cwchar>

#ifndef DWMWA_USE_IMMERSIVE_DARK_MODE
#define DWMWA_USE_IMMERSIVE_DARK_MODE 20
#endif
#ifndef DWMWA_WINDOW_CORNER_PREFERENCE
#define DWMWA_WINDOW_CORNER_PREFERENCE 33
#endif
#ifndef DWMWCP_ROUND
#define DWMWCP_ROUND 2
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

// {A7E3C142-6F8B-4A21-9D5E-1B3C4E5F6A7B}
static const CLSID CLSID_VerdantChrome = {
    0xa7e3c142, 0x6f8b, 0x4a21, {0x9d, 0x5e, 0x1b, 0x3c, 0x4e, 0x5f, 0x6a, 0x7b}
};

static std::atomic<long> g_refCount{0};
static HMODULE g_hModule = nullptr;

struct ChromeState {
    HWND mainHwnd = nullptr;
    std::vector<HWND> childHwnds;
    bool attached = false;
    bool fullscreen = false;
    bool processingClose = false;
    bool destroying = false;
    bool repaintingActivation = false;

    RECT capRect = {0, 0, 0, 0};
    RECT maxRect = {0, 0, 0, 0};
    int minW = 360;
    int minH = 320;
    int captionPress = HTNOWHERE;

    bool isDark = true;
    COLORREF canvasColorRef = RGB(0, 0, 0);
    COLORREF borderColorRef = RGB(42, 42, 42);
    bool borderColorNone = false;
    bool borderColorDefault = false;
};

static ChromeState g_state;
static const UINT_PTR SUBCLASS_MAIN_ID = 0x56430001;
static const UINT_PTR SUBCLASS_CHILD_ID = 0x56430002;

static int GetWindowDpi(HWND hwnd) {
    typedef UINT (WINAPI *PFN_GetDpiForWindow)(HWND);
    static auto pfn = reinterpret_cast<PFN_GetDpiForWindow>(
        reinterpret_cast<void*>(GetProcAddress(GetModuleHandleW(L"user32.dll"), "GetDpiForWindow")));
    if (pfn && hwnd) {
        UINT d = pfn(hwnd);
        if (d > 0) return static_cast<int>(d);
    }
    return 96;
}

static void ApplyDwmAttributes(HWND hwnd) {
    if (!hwnd || !IsWindow(hwnd)) return;

    DWORD corner = DWMWCP_ROUND;
    DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &corner, sizeof(corner));

    BOOL dark = g_state.isDark ? TRUE : FALSE;
    DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark, sizeof(dark));

    COLORREF capCol = g_state.canvasColorRef;
    DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, &capCol, sizeof(capCol));

    DWORD brdVal = DWMWA_COLOR_DEFAULT;
    if (g_state.borderColorNone) brdVal = DWMWA_COLOR_NONE;
    else if (g_state.borderColorDefault) brdVal = DWMWA_COLOR_DEFAULT;
    else brdVal = static_cast<DWORD>(g_state.borderColorRef);
    DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, &brdVal, sizeof(brdVal));

    // Zero out glass extension so row 0 of the GDI+ JSplitter child does not get a 1px bright line.
    MARGINS m = {0, 0, 0, 0};
    DwmExtendFrameIntoClientArea(hwnd, &m);
}

static bool IsPtInRect(const RECT& rc, int x, int y) {
    return rc.right > rc.left && rc.bottom > rc.top &&
           x >= rc.left && x < rc.right && y >= rc.top && y < rc.bottom;
}

static void FindPrimaryPanelOffset(HWND mainHwnd, int& offX, int& offY) {
    offX = 0;
    offY = 0;
    if (!mainHwnd || !IsWindow(mainHwnd)) return;

    RECT crc{};
    if (!GetClientRect(mainHwnd, &crc)) return;

    HWND best = nullptr;
    LONG bestArea = -1;
    for (HWND ch : g_state.childHwnds) {
        if (!IsWindow(ch) || !IsWindowVisible(ch)) continue;
        RECT r{};
        if (!GetWindowRect(ch, &r)) continue;
        int w = r.right - r.left;
        int h = r.bottom - r.top;
        if (w >= crc.right / 2 && h >= crc.bottom / 2) {
            LONG area = static_cast<LONG>(w) * static_cast<LONG>(h);
            if (area >= bestArea) {
                bestArea = area;
                best = ch;
            }
        }
    }
    if (best) {
        POINT pt = {0, 0};
        ClientToScreen(best, &pt);
        ScreenToClient(mainHwnd, &pt);
        offX = pt.x;
        offY = pt.y;
    }
}

static LRESULT HitTestMainClient(HWND hwnd, int clientX, int clientY, int clientW, int clientH) {
    int offX = 0, offY = 0;
    FindPrimaryPanelOffset(hwnd, offX, offY);
    int px = clientX - offX;
    int py = clientY - offY;

    if (!g_state.fullscreen && !IsZoomed(hwnd)) {
        int dpi = GetWindowDpi(hwnd);
        int topEdge = MulDiv(5, dpi, 96);
        int btnTopEdge = MulDiv(3, dpi, 96);
        int cornerW = MulDiv(8, dpi, 96);
        const int edge = topEdge;
        bool overRightBtns = (g_state.capRect.right > 0 && px >= g_state.capRect.right);
        int effTop = overRightBtns ? btnTopEdge : topEdge;
        if (clientY < effTop) {
            if (clientX < cornerW) return HTTOPLEFT;
            if (clientX >= clientW - cornerW) return HTTOPRIGHT;
            return HTTOP;
        }
        if (clientY >= clientH - edge) {
            if (clientX < cornerW) return HTBOTTOMLEFT;
            if (clientX >= clientW - cornerW) return HTBOTTOMRIGHT;
            return HTBOTTOM;
        }
        if (clientX < edge) {
            if (clientY < cornerW) return HTTOPLEFT;
            if (clientY >= clientH - cornerW) return HTBOTTOMLEFT;
            return HTLEFT;
        }
        if (clientX >= clientW - edge) {
            if (clientY < cornerW) return HTTOPRIGHT;
            if (clientY >= clientH - cornerW) return HTBOTTOMRIGHT;
            return HTRIGHT;
        }
    }

    if (!g_state.fullscreen) {
        if (IsPtInRect(g_state.maxRect, px, py)) {
            return HTMAXBUTTON;
        }
        if (IsPtInRect(g_state.capRect, px, py)) {
            return HTCAPTION;
        }
    }
    return HTCLIENT;
}

static LRESULT HitTestScreenPoint(HWND hwnd, POINT pt) {
    RECT crc{};
    if (!ScreenToClient(hwnd, &pt) || !GetClientRect(hwnd, &crc) || !PtInRect(&crc, pt))
        return HTNOWHERE;
    return HitTestMainClient(hwnd, pt.x, pt.y, crc.right, crc.bottom);
}

static bool MaxButtonHot() {
    HWND hwnd = g_state.mainHwnd;
    POINT cursor{};
    if (!g_state.attached || !hwnd || !IsWindowVisible(hwnd) || IsIconic(hwnd) ||
        g_state.fullscreen || !GetCursorPos(&cursor)) return false;
    HWND target = WindowFromPoint(cursor);
    return target && GetAncestor(target, GA_ROOT) == hwnd &&
           HitTestScreenPoint(hwnd, cursor) == HTMAXBUTTON;
}

static void BeginCaptionPress(HWND hwnd, int hit) {
    g_state.captionPress = hit;
    SetCapture(hwnd);
}

static void CancelCaptionPress(HWND hwnd) {
    g_state.captionPress = HTNOWHERE;
    if (GetCapture() == hwnd) ReleaseCapture();
}

static void FinishCaptionPress(HWND hwnd, POINT screenPt) {
    const int press = g_state.captionPress;
    const bool activate = press != HTNOWHERE && HitTestScreenPoint(hwnd, screenPt) == press;
    CancelCaptionPress(hwnd);
    if (activate) ShowWindow(hwnd, IsZoomed(hwnd) ? SW_RESTORE : SW_MAXIMIZE);
}

static LRESULT CALLBACK ChildSubclassProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam,
                                          UINT_PTR uIdSubclass, DWORD_PTR dwRefData) {
    if (msg == WM_NCHITTEST && g_state.attached && hwnd != g_state.mainHwnd) {
        POINT pt = {GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
        ScreenToClient(g_state.mainHwnd, &pt);
        RECT crc{};
        GetClientRect(g_state.mainHwnd, &crc);
        if (!PtInRect(&crc, pt)) {
            return HTTRANSPARENT;
        }
        LRESULT ht = HitTestMainClient(g_state.mainHwnd, pt.x, pt.y, crc.right, crc.bottom);
        if (ht != HTCLIENT) {
            return HTTRANSPARENT;
        }
    } else if (msg == WM_NCDESTROY) {
        RemoveWindowSubclass(hwnd, ChildSubclassProc, uIdSubclass);
    }
    return DefSubclassProc(hwnd, msg, wParam, lParam);
}

static BOOL CALLBACK AttachChildEnumProc(HWND hwnd, LPARAM lParam) {
    if (hwnd && IsWindow(hwnd)) {
        if (SetWindowSubclass(hwnd, ChildSubclassProc, SUBCLASS_CHILD_ID, 0))
            g_state.childHwnds.push_back(hwnd);
    }
    return TRUE;
}

static void RefreshChildSubclasses() {
    for (HWND ch : g_state.childHwnds) {
        if (IsWindow(ch)) RemoveWindowSubclass(ch, ChildSubclassProc, SUBCLASS_CHILD_ID);
    }
    g_state.childHwnds.clear();
    if (g_state.mainHwnd && IsWindow(g_state.mainHwnd)) {
        EnumChildWindows(g_state.mainHwnd, AttachChildEnumProc, 0);
    }
}

static BOOL CALLBACK EnsureChildEnumProc(HWND hwnd, LPARAM lParam) {
    if (hwnd && IsWindow(hwnd)) {
        auto* nextList = reinterpret_cast<std::vector<HWND>*>(lParam);
        bool known = false;
        for (HWND prev : g_state.childHwnds) {
            if (prev == hwnd) {
                known = true;
                break;
            }
        }
        if (!known) known = SetWindowSubclass(hwnd, ChildSubclassProc, SUBCLASS_CHILD_ID, 0) != FALSE;
        if (known && nextList) nextList->push_back(hwnd);
    }
    return TRUE;
}

static void EnsureChildSubclasses() {
    if (!g_state.mainHwnd || !IsWindow(g_state.mainHwnd)) {
        g_state.childHwnds.clear();
        return;
    }
    std::vector<HWND> nextList;
    EnumChildWindows(g_state.mainHwnd, EnsureChildEnumProc, reinterpret_cast<LPARAM>(&nextList));
    g_state.childHwnds.swap(nextList);
}

static LRESULT CALLBACK MainSubclassProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam,
                                         UINT_PTR uIdSubclass, DWORD_PTR dwRefData) {
    switch (msg) {
        case WM_NCCALCSIZE: {
            if (wParam == TRUE) {
                auto* params = reinterpret_cast<NCCALCSIZE_PARAMS*>(lParam);
                if (IsZoomed(hwnd)) {
                    HMONITOR mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                    MONITORINFO mi{};
                    mi.cbSize = sizeof(mi);
                    if (GetMonitorInfoW(mon, &mi)) {
                        RECT work = mi.rcWork;
                        if (EqualRect(&mi.rcWork, &mi.rcMonitor)) {
                            APPBARDATA abd{};
                            abd.cbSize = sizeof(abd);
                            if (SHAppBarMessage(ABM_GETSTATE, &abd) & ABS_AUTOHIDE) {
                                APPBARDATA pos{};
                                pos.cbSize = sizeof(pos);
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
                    return 0;
                }
                // The restored window uses the whole client surface. Resizing is handled
                // by invisible edge hit targets, leaving no native frame bands to repaint.
                return 0;
            }
            return 0;
        }

        case WM_NCHITTEST: {
            POINT cpt = {GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
            ScreenToClient(hwnd, &cpt);
            RECT crc{};
            GetClientRect(hwnd, &crc);
            if (!PtInRect(&crc, cpt)) {
                return DefSubclassProc(hwnd, msg, wParam, lParam);
            }
            return HitTestMainClient(hwnd, cpt.x, cpt.y, crc.right, crc.bottom);
        }

        case WM_NCACTIVATE: {
            if (!IsIconic(hwnd)) {
                // Even DefWindowProcW with lParam=-1 can expose the system caption
                // on a custom-drawn frame. Own activation painting completely.
                if (!g_state.processingClose && !g_state.destroying && !g_state.repaintingActivation) {
                    g_state.repaintingActivation = true;
                    RedrawWindow(hwnd, nullptr, nullptr, RDW_INVALIDATE | RDW_ALLCHILDREN | RDW_UPDATENOW);
                    g_state.repaintingActivation = false;
                }
                return TRUE;
            }
            break;
        }

        case WM_NCPAINT: {
            // The caption is owned by Verdant even when DWM is disabled for this window.
            if (!IsIconic(hwnd)) {
                return 0;
            }
            break;
        }

        case WM_ERASEBKGND: {
            HDC hdc = reinterpret_cast<HDC>(wParam);
            RECT crc{};
            if (hdc && GetClientRect(hwnd, &crc)) {
                HBRUSH br = CreateSolidBrush(g_state.canvasColorRef);
                if (br) {
                    FillRect(hdc, &crc, br);
                    DeleteObject(br);
                    return 1;
                }
            }
            break;
        }

        case WM_DWMCOMPOSITIONCHANGED: {
            ApplyDwmAttributes(hwnd);
            break;
        }

        case WM_NCMOUSEMOVE: {
            LRESULT result = 0;
            if (DwmDefWindowProc(hwnd, msg, wParam, lParam, &result)) return result;
            break;
        }

        case WM_NCMOUSELEAVE: {
            LRESULT result = 0;
            if (DwmDefWindowProc(hwnd, msg, wParam, lParam, &result)) return result;
            break;
        }

        case WM_NCLBUTTONDOWN: {
            if (wParam == HTMAXBUTTON) {
                BeginCaptionPress(hwnd, HTMAXBUTTON);
                return 0;
            }
            if (wParam == HTCAPTION) {
                if (g_state.fullscreen || g_state.processingClose || g_state.destroying) return 0;
                // UI Wizard intercepts this message and moves the window manually.
                // Let Windows own the caption move loop, including native Snap.
                return DefWindowProcW(hwnd, msg, wParam, lParam);
            }
            break;
        }

        case WM_NCLBUTTONUP: {
            if (wParam == HTMAXBUTTON || g_state.captionPress != HTNOWHERE) {
                FinishCaptionPress(hwnd, {GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)});
                return 0;
            }
            break;
        }

        case WM_LBUTTONUP: {
            if (g_state.captionPress != HTNOWHERE) {
                POINT pt = {GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
                ClientToScreen(hwnd, &pt);
                FinishCaptionPress(hwnd, pt);
                return 0;
            }
            break;
        }

        case WM_NCLBUTTONDBLCLK: {
            if (wParam == HTCAPTION || wParam == HTMAXBUTTON) {
                BeginCaptionPress(hwnd, static_cast<int>(wParam));
                return 0;
            }
            break;
        }

        case WM_CANCELMODE:
            if (g_state.captionPress != HTNOWHERE) CancelCaptionPress(hwnd);
            break;

        case WM_CAPTURECHANGED:
            g_state.captionPress = HTNOWHERE;
            break;

        case WM_NCRBUTTONUP: {
            if (wParam == HTCAPTION) {
                HMENU hMenu = GetSystemMenu(hwnd, FALSE);
                if (hMenu) {
                    bool zoomed = IsZoomed(hwnd) != FALSE;
                    EnableMenuItem(hMenu, SC_RESTORE, MF_BYCOMMAND | (zoomed ? MF_ENABLED : MF_GRAYED));
                    EnableMenuItem(hMenu, SC_MOVE, MF_BYCOMMAND | (zoomed ? MF_GRAYED : MF_ENABLED));
                    EnableMenuItem(hMenu, SC_SIZE, MF_BYCOMMAND | (zoomed ? MF_GRAYED : MF_ENABLED));
                    EnableMenuItem(hMenu, SC_MAXIMIZE, MF_BYCOMMAND | (zoomed ? MF_GRAYED : MF_ENABLED));
                    EnableMenuItem(hMenu, SC_MINIMIZE, MF_BYCOMMAND | MF_ENABLED);
                    EnableMenuItem(hMenu, SC_CLOSE, MF_BYCOMMAND | MF_ENABLED);
                    SetMenuDefaultItem(hMenu, SC_CLOSE, FALSE);
                    UINT cmd = static_cast<UINT>(TrackPopupMenu(
                        hMenu,
                        TPM_RETURNCMD | TPM_RIGHTBUTTON,
                        GET_X_LPARAM(lParam),
                        GET_Y_LPARAM(lParam),
                        0,
                        hwnd,
                        nullptr));
                    if (cmd != 0) {
                        PostMessageW(hwnd, WM_SYSCOMMAND, static_cast<WPARAM>(cmd), 0);
                    }
                }
                return 0;
            }
            break;
        }

        case WM_GETMINMAXINFO: {
            LRESULT res = DefSubclassProc(hwnd, msg, wParam, lParam);
            auto* mmi = reinterpret_cast<MINMAXINFO*>(lParam);
            if (mmi) {
                if (g_state.minW > 0) mmi->ptMinTrackSize.x = g_state.minW;
                if (g_state.minH > 0) mmi->ptMinTrackSize.y = g_state.minH;
            }
            return res;
        }

        case WM_PARENTNOTIFY: {
            if (LOWORD(wParam) == WM_CREATE) {
                RefreshChildSubclasses();
            }
            break;
        }

        case WM_CLOSE: {
            const bool wasClosing = g_state.processingClose;
            g_state.processingClose = true;
            LRESULT result = DefSubclassProc(hwnd, msg, wParam, lParam);
            g_state.processingClose = wasClosing;
            return result;
        }

        case WM_DESTROY:
            g_state.destroying = true;
            break;

        case WM_NCDESTROY: {
            g_state.destroying = true;
            RemoveWindowSubclass(hwnd, MainSubclassProc, uIdSubclass);
            for (HWND ch : g_state.childHwnds) {
                if (IsWindow(ch)) RemoveWindowSubclass(ch, ChildSubclassProc, SUBCLASS_CHILD_ID);
            }
            g_state.childHwnds.clear();
            LRESULT result = DefSubclassProc(hwnd, msg, wParam, lParam);
            g_state.attached = false;
            g_state.mainHwnd = nullptr;
            g_state.captionPress = HTNOWHERE;
            g_state.processingClose = false;
            g_state.destroying = false;
            return result;
        }
    }
    return DefSubclassProc(hwnd, msg, wParam, lParam);
}

struct FindMainCtx {
    DWORD pid;
    HWND classMatch;
    HWND fallbackBest;
    LONG fallbackArea;
};

static BOOL CALLBACK FindMainEnumProc(HWND hwnd, LPARAM lParam) {
    auto* ctx = reinterpret_cast<FindMainCtx*>(lParam);
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (pid != ctx->pid) return TRUE;
    if (GetWindow(hwnd, GW_OWNER) != nullptr) return TRUE;

    wchar_t cls[128] = {};
    GetClassNameW(hwnd, cls, 128);
    if (wcsstr(cls, L"{97E27FAA-") != nullptr || wcsstr(cls, L"{E7076D1C-") != nullptr) {
        ctx->classMatch = hwnd;
        return FALSE;
    }

    if (!IsWindowVisible(hwnd)) return TRUE;

    RECT r{};
    if (GetWindowRect(hwnd, &r)) {
        LONG area = (r.right - r.left) * (r.bottom - r.top);
        if (area > ctx->fallbackArea) {
            ctx->fallbackArea = area;
            ctx->fallbackBest = hwnd;
        }
    }
    return TRUE;
}

static HWND LocateFoobarMainWindow() {
    FindMainCtx ctx{GetCurrentProcessId(), nullptr, nullptr, 0};
    EnumWindows(FindMainEnumProc, reinterpret_cast<LPARAM>(&ctx));
    return ctx.classMatch ? ctx.classMatch : ctx.fallbackBest;
}

static void DetachChrome(bool restoreDwm) {
    HWND prev = g_state.mainHwnd;
    if (prev && IsWindow(prev)) {
        if (g_state.captionPress != HTNOWHERE) CancelCaptionPress(prev);
        RemoveWindowSubclass(prev, MainSubclassProc, SUBCLASS_MAIN_ID);
    }
    for (HWND ch : g_state.childHwnds) {
        if (IsWindow(ch)) RemoveWindowSubclass(ch, ChildSubclassProc, SUBCLASS_CHILD_ID);
    }
    g_state.childHwnds.clear();
    g_state.attached = false;
    g_state.mainHwnd = nullptr;
    g_state.captionPress = HTNOWHERE;
    g_state.processingClose = false;
    g_state.destroying = false;

    if (restoreDwm && prev && IsWindow(prev)) {
        DWORD defCol = DWMWA_COLOR_DEFAULT;
        DwmSetWindowAttribute(prev, DWMWA_CAPTION_COLOR, &defCol, sizeof(defCol));
        DwmSetWindowAttribute(prev, DWMWA_BORDER_COLOR, &defCol, sizeof(defCol));
        SetWindowPos(prev, nullptr, 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    }
}

static void ReleaseChrome(bool exiting) {
    // A closing window still needs its custom frame hook until WM_NCDESTROY.
    // Normal panel reloads, however, must release the hook and restore the host.
    if (exiting || g_state.processingClose || g_state.destroying) return;
    DetachChrome(true);
}

static bool AttachChrome() {
    HWND hwnd = LocateFoobarMainWindow();
    if (!hwnd) return false;
    if (GetWindowThreadProcessId(hwnd, nullptr) != GetCurrentThreadId()) return false;
    if (!g_state.attached || g_state.mainHwnd != hwnd) DetachChrome(false);
    g_state.mainHwnd = hwnd;

    // The host can finish installing its own hooks after our first attachment.
    // Reattach on the deferred startup check, then recalculate the frame.
    if (g_state.attached) RemoveWindowSubclass(hwnd, MainSubclassProc, SUBCLASS_MAIN_ID);
    if (!SetWindowSubclass(hwnd, MainSubclassProc, SUBCLASS_MAIN_ID, 0)) {
        DetachChrome(false);
        return false;
    }
    g_state.attached = true;

    LONG_PTR style = GetWindowLongPtrW(hwnd, GWL_STYLE);
    LONG_PTR wanted = WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
    if ((style & wanted) != wanted || (style & WS_POPUP) != 0) {
        SetWindowLongPtrW(hwnd, GWL_STYLE, (style | wanted) & ~WS_POPUP);
    }

    ApplyDwmAttributes(hwnd);

    RefreshChildSubclasses();

    SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    return true;
}

static int VarToInt(const VARIANT& v, int dflt = 0) {
    VARIANT tmp;
    VariantInit(&tmp);
    if (SUCCEEDED(VariantChangeType(&tmp, const_cast<VARIANT*>(&v), 0, VT_I4))) {
        return tmp.lVal;
    }
    return dflt;
}

static PARAMDATA g_paramsMetrics[] = {
    {const_cast<LPOLESTR>(L"capX"), VT_I4},
    {const_cast<LPOLESTR>(L"capY"), VT_I4},
    {const_cast<LPOLESTR>(L"capW"), VT_I4},
    {const_cast<LPOLESTR>(L"capH"), VT_I4},
    {const_cast<LPOLESTR>(L"maxX"), VT_I4},
    {const_cast<LPOLESTR>(L"maxY"), VT_I4},
    {const_cast<LPOLESTR>(L"maxW"), VT_I4},
    {const_cast<LPOLESTR>(L"maxH"), VT_I4},
    {const_cast<LPOLESTR>(L"minW"), VT_I4},
    {const_cast<LPOLESTR>(L"minH"), VT_I4}
};
static PARAMDATA g_paramsFullscreen[] = {
    {const_cast<LPOLESTR>(L"isFs"), VT_I4}
};
static PARAMDATA g_paramsTheme[] = {
    {const_cast<LPOLESTR>(L"isDark"), VT_I4},
    {const_cast<LPOLESTR>(L"canvasColor"), VT_I4},
    {const_cast<LPOLESTR>(L"borderColor"), VT_I4}
};
static METHODDATA g_chromeMethods[] = {
    {const_cast<LPOLESTR>(L"Attach"), nullptr, 1, 0, CC_STDCALL, 0, DISPATCH_METHOD, VT_BOOL},
    {const_cast<LPOLESTR>(L"Detach"), nullptr, 2, 1, CC_STDCALL, 0, DISPATCH_METHOD, VT_EMPTY},
    {const_cast<LPOLESTR>(L"SetChromeMetrics"), g_paramsMetrics, 3, 2, CC_STDCALL, 10, DISPATCH_METHOD, VT_EMPTY},
    {const_cast<LPOLESTR>(L"SetFullscreen"), g_paramsFullscreen, 4, 3, CC_STDCALL, 1, DISPATCH_METHOD, VT_EMPTY},
    {const_cast<LPOLESTR>(L"WindowState"), nullptr, 5, 4, CC_STDCALL, 0, DISPATCH_PROPERTYGET, VT_I4},
    {const_cast<LPOLESTR>(L"ToggleMaximize"), nullptr, 6, 5, CC_STDCALL, 0, DISPATCH_METHOD, VT_EMPTY},
    {const_cast<LPOLESTR>(L"WindowMinimize"), nullptr, 7, 6, CC_STDCALL, 0, DISPATCH_METHOD, VT_EMPTY},
    {const_cast<LPOLESTR>(L"ExitMaximize"), nullptr, 8, 7, CC_STDCALL, 0, DISPATCH_METHOD, VT_EMPTY},
    {const_cast<LPOLESTR>(L"SetTheme"), g_paramsTheme, 9, 8, CC_STDCALL, 3, DISPATCH_METHOD, VT_EMPTY},
    {const_cast<LPOLESTR>(L"MaxButtonHot"), nullptr, 11, 9, CC_STDCALL, 0, DISPATCH_PROPERTYGET, VT_BOOL},
    {const_cast<LPOLESTR>(L"DetachForExit"), nullptr, 12, 10, CC_STDCALL, 0, DISPATCH_METHOD, VT_EMPTY}
};
static INTERFACEDATA g_chromeIface = {
    g_chromeMethods,
    static_cast<UINT>(sizeof(g_chromeMethods) / sizeof(g_chromeMethods[0]))
};

static ITypeInfo* BuildChromeTypeInfo() {
    ITypeInfo* outer = nullptr;
    if (FAILED(CreateDispTypeInfo(&g_chromeIface, LOCALE_NEUTRAL, &outer)) || !outer) {
        return nullptr;
    }
    HREFTYPE href = 0;
    ITypeInfo* inner = nullptr;
    if (SUCCEEDED(outer->GetRefTypeOfImplType(0, &href))) {
        if (FAILED(outer->GetRefTypeInfo(href, &inner))) {
            inner = nullptr;
        }
    }
    if (inner) {
        outer->Release();
        return inner;
    }
    return outer;
}

class VerdantChromeObj : public IDispatch {
    std::atomic<long> m_ref{1};
    ITypeInfo* m_ptinfo = nullptr;
public:
    VerdantChromeObj() {
        g_refCount++;
        m_ptinfo = BuildChromeTypeInfo();
    }
    virtual ~VerdantChromeObj() {
        if (m_ptinfo) {
            m_ptinfo->Release();
            m_ptinfo = nullptr;
        }
        g_refCount--;
    }

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == IID_IDispatch) {
            *ppv = static_cast<IDispatch*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++m_ref; }
    ULONG STDMETHODCALLTYPE Release() override {
        long r = --m_ref;
        if (r == 0) delete this;
        return r;
    }

    HRESULT STDMETHODCALLTYPE GetTypeInfoCount(UINT* pctinfo) override {
        if (!pctinfo) return E_INVALIDARG;
        *pctinfo = m_ptinfo ? 1u : 0u;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetTypeInfo(UINT iTInfo, LCID, ITypeInfo** pptinfo) override {
        if (!pptinfo) return E_INVALIDARG;
        *pptinfo = nullptr;
        if (iTInfo != 0) return DISP_E_BADINDEX;
        if (!m_ptinfo) return E_FAIL;
        m_ptinfo->AddRef();
        *pptinfo = m_ptinfo;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetIDsOfNames(REFIID, LPOLESTR* rgszNames, UINT cNames, LCID, DISPID* rgDispId) override {
        if (!rgszNames || !rgDispId || cNames == 0) return E_INVALIDARG;
        for (UINT i = 0; i < cNames; ++i) rgDispId[i] = DISPID_UNKNOWN;
        const wchar_t* name = rgszNames[0];
        if (!name) return DISP_E_UNKNOWNNAME;
        if (_wcsicmp(name, L"Attach") == 0) rgDispId[0] = 1;
        else if (_wcsicmp(name, L"Detach") == 0) rgDispId[0] = 2;
        else if (_wcsicmp(name, L"SetChromeMetrics") == 0) rgDispId[0] = 3;
        else if (_wcsicmp(name, L"SetFullscreen") == 0) rgDispId[0] = 4;
        else if (_wcsicmp(name, L"WindowState") == 0) rgDispId[0] = 5;
        else if (_wcsicmp(name, L"ToggleMaximize") == 0) rgDispId[0] = 6;
        else if (_wcsicmp(name, L"WindowMinimize") == 0) rgDispId[0] = 7;
        else if (_wcsicmp(name, L"ExitMaximize") == 0) rgDispId[0] = 8;
        else if (_wcsicmp(name, L"SetTheme") == 0) rgDispId[0] = 9;
        else if (_wcsicmp(name, L"MaxButtonHot") == 0) rgDispId[0] = 11;
        else if (_wcsicmp(name, L"DetachForExit") == 0) rgDispId[0] = 12;
        else return DISP_E_UNKNOWNNAME;
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE Invoke(DISPID dispIdMember, REFIID, LCID, WORD wFlags,
                                     DISPPARAMS* pDispParams, VARIANT* pVarResult,
                                     EXCEPINFO*, UINT*) override {
        if (pVarResult) VariantInit(pVarResult);
        UINT argc = pDispParams ? pDispParams->cArgs : 0;
        VARIANT* argv = pDispParams ? pDispParams->rgvarg : nullptr;

        switch (dispIdMember) {
            case 1: { // Attach()
                bool ok = AttachChrome();
                if (pVarResult) {
                    pVarResult->vt = VT_BOOL;
                    pVarResult->boolVal = ok ? VARIANT_TRUE : VARIANT_FALSE;
                }
                return S_OK;
            }
            case 2: { // Detach()
                ReleaseChrome(false);
                return S_OK;
            }
            case 3: { // SetChromeMetrics(capX, capY, capW, capH, maxX, maxY, maxW, maxH, minW, minH)
                if (argc < 10 || !argv) return DISP_E_BADPARAMCOUNT;
                // COM DISPPARAMS args are in reverse order
                int capX = VarToInt(argv[9]);
                int capY = VarToInt(argv[8]);
                int capW = VarToInt(argv[7]);
                int capH = VarToInt(argv[6]);
                int maxX = VarToInt(argv[5]);
                int maxY = VarToInt(argv[4]);
                int maxW = VarToInt(argv[3]);
                int maxH = VarToInt(argv[2]);
                int minW = VarToInt(argv[1], 360);
                int minH = VarToInt(argv[0], 320);

                g_state.capRect = {capX, capY, capX + capW, capY + capH};
                g_state.maxRect = {maxX, maxY, maxX + maxW, maxY + maxH};
                g_state.minW = minW;
                g_state.minH = minH;
                EnsureChildSubclasses();
                return S_OK;
            }
            case 4: { // SetFullscreen(isFs)
                if (argc >= 1 && argv) {
                    g_state.fullscreen = (VarToInt(argv[0]) != 0);
                }
                return S_OK;
            }
            case 5: { // WindowState
                if (wFlags & DISPATCH_PROPERTYGET) {
                    int st = (g_state.mainHwnd && IsWindow(g_state.mainHwnd) && IsZoomed(g_state.mainHwnd)) ? 1 : 0;
                    if (pVarResult) {
                        pVarResult->vt = VT_I4;
                        pVarResult->lVal = st;
                    }
                    return S_OK;
                }
                return DISP_E_MEMBERNOTFOUND;
            }
            case 6: { // ToggleMaximize()
                if (g_state.mainHwnd && IsWindow(g_state.mainHwnd)) {
                    ShowWindow(g_state.mainHwnd, IsZoomed(g_state.mainHwnd) ? SW_RESTORE : SW_MAXIMIZE);
                }
                return S_OK;
            }
            case 7: { // WindowMinimize()
                if (g_state.mainHwnd && IsWindow(g_state.mainHwnd)) {
                    ShowWindow(g_state.mainHwnd, SW_MINIMIZE);
                }
                return S_OK;
            }
            case 8: { // ExitMaximize()
                if (g_state.mainHwnd && IsWindow(g_state.mainHwnd) && IsZoomed(g_state.mainHwnd)) {
                    ShowWindow(g_state.mainHwnd, SW_RESTORE);
                }
                return S_OK;
            }
            case 9: { // SetTheme(isDark, canvasColorRef, borderColorRef)
                if (argc < 3 || !argv) return DISP_E_BADPARAMCOUNT;
                // COM DISPPARAMS args are in reverse order
                int isDark = VarToInt(argv[2], 1);
                int canvasRaw = VarToInt(argv[1], 0);
                int borderRaw = VarToInt(argv[0], static_cast<int>(RGB(42, 42, 42)));

                g_state.isDark = (isDark != 0);
                g_state.canvasColorRef = static_cast<COLORREF>(canvasRaw & 0x00FFFFFF);
                if (borderRaw == -2) {
                    g_state.borderColorNone = true;
                    g_state.borderColorDefault = false;
                } else if (borderRaw == -1) {
                    g_state.borderColorNone = false;
                    g_state.borderColorDefault = true;
                } else {
                    g_state.borderColorNone = false;
                    g_state.borderColorDefault = false;
                    g_state.borderColorRef = static_cast<COLORREF>(borderRaw & 0x00FFFFFF);
                }

                if (g_state.attached && g_state.mainHwnd && IsWindow(g_state.mainHwnd)) {
                    ApplyDwmAttributes(g_state.mainHwnd);
                    InvalidateRect(g_state.mainHwnd, nullptr, FALSE);
                }
                return S_OK;
            }
            case 11: { // MaxButtonHot
                if (!(wFlags & DISPATCH_PROPERTYGET)) return DISP_E_MEMBERNOTFOUND;
                if (pVarResult) {
                    pVarResult->vt = VT_BOOL;
                    pVarResult->boolVal = MaxButtonHot() ? VARIANT_TRUE : VARIANT_FALSE;
                }
                return S_OK;
            }
            case 12: { // DetachForExit()
                ReleaseChrome(true);
                return S_OK;
            }
            default:
                return DISP_E_MEMBERNOTFOUND;
        }
    }
};

class VerdantChromeFactory : public IClassFactory {
    std::atomic<long> m_ref{1};
public:
    virtual ~VerdantChromeFactory() = default;
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == IID_IClassFactory) {
            *ppv = static_cast<IClassFactory*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++m_ref; }
    ULONG STDMETHODCALLTYPE Release() override {
        long r = --m_ref;
        if (r == 0) delete this;
        return r;
    }
    HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* pUnkOuter, REFIID riid, void** ppv) override {
        if (pUnkOuter) return CLASS_E_NOAGGREGATION;
        auto* obj = new VerdantChromeObj();
        HRESULT hr = obj->QueryInterface(riid, ppv);
        obj->Release();
        return hr;
    }
    HRESULT STDMETHODCALLTYPE LockServer(BOOL fLock) override {
        if (fLock) g_refCount++; else g_refCount--;
        return S_OK;
    }
};

extern "C" {

BOOL WINAPI DllMain(HINSTANCE hinstDLL, DWORD fdwReason, LPVOID lpvReserved) {
    if (fdwReason == DLL_PROCESS_ATTACH) {
        g_hModule = hinstDLL;
        DisableThreadLibraryCalls(hinstDLL);
    } else if (fdwReason == DLL_PROCESS_DETACH) {
        if (lpvReserved == nullptr) {
            DetachChrome(false);
        }
    }
    return TRUE;
}

HRESULT __stdcall DllGetClassObject(REFCLSID rclsid, REFIID riid, void** ppv) {
    if (rclsid != CLSID_VerdantChrome) return CLASS_E_CLASSNOTAVAILABLE;
    auto* factory = new VerdantChromeFactory();
    HRESULT hr = factory->QueryInterface(riid, ppv);
    factory->Release();
    return hr;
}

HRESULT __stdcall DllCanUnloadNow() {
    return (g_refCount.load() == 0 && !g_state.attached) ? S_OK : S_FALSE;
}

}
