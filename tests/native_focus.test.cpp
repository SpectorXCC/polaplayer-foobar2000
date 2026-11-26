#define WIN32_LEAN_AND_MEAN
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <dwmapi.h>

static int systemNcActivations=0;
static int systemCaptionDrags=0;
static HWND systemDragWindow=nullptr;
static LPARAM systemDragPoint=0;
static const LRESULT systemDragResult=0x1234;
static int synchronousRepaints=0;
static int dwmFrameResets=0;

[[maybe_unused]] static LRESULT WINAPI RecordingDefWindowProcW(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    if (msg==WM_NCACTIVATE) ++systemNcActivations;
    if (msg==WM_NCLBUTTONDOWN && wp==HTCAPTION) {
        ++systemCaptionDrags;
        systemDragWindow=hwnd;
        systemDragPoint=lp;
        // Record the handoff without starting the interactive system move loop.
        return systemDragResult;
    }
    return DefWindowProcW(hwnd,msg,wp,lp);
}

static BOOL WINAPI RecordingRedrawWindow(HWND hwnd, const RECT* rect, HRGN region, UINT flags) {
    if ((flags&RDW_UPDATENOW) && (flags&RDW_ALLCHILDREN)) ++synchronousRepaints;
    return RedrawWindow(hwnd,rect,region,flags);
}

static HRESULT WINAPI RecordingDwmExtendFrameIntoClientArea(HWND hwnd, const MARGINS* margins) {
    ++dwmFrameResets;
    return DwmExtendFrameIntoClientArea(hwnd,margins);
}

#define DefWindowProcW RecordingDefWindowProcW
#define RedrawWindow RecordingRedrawWindow
#define DwmExtendFrameIntoClientArea RecordingDwmExtendFrameIntoClientArea
#include "../native/verdant_chrome.cpp"
#undef DefWindowProcW
#undef RedrawWindow
#undef DwmExtendFrameIntoClientArea
#include <cstdio>
#include <cstdlib>

static int hostActivations=0;
static int hostPaints=0;
static int hostClientActivations=0;
static int hostClientDeactivations=0;
static int hostCaptionDrags=0;
static int hostEdgeDrags=0;

static LRESULT CALLBACK HostProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    if (msg==WM_NCLBUTTONDOWN && wp==HTCAPTION) {
        ++hostCaptionDrags;
        return 0; // Model UI Wizard's manual drag interceptor.
    }
    if (msg==WM_NCLBUTTONDOWN && wp==HTLEFT) {
        ++hostEdgeDrags;
        return 0; // Avoid a live sizing loop in the hidden test window.
    }
    if (msg==WM_NCACTIVATE) ++hostActivations;
    if (msg==WM_NCPAINT) ++hostPaints;
    if (msg==WM_ACTIVATE) {
        if (LOWORD(wp)==WA_INACTIVE) ++hostClientDeactivations;
        else ++hostClientActivations;
    }
    return DefWindowProcW(hwnd,msg,wp,lp);
}

static void check(bool ok, const char* description) {
    if (!ok) {
        std::fprintf(stderr,"FAIL: %s\n",description);
        std::exit(1);
    }
}

int main() {
    WNDCLASSW cls{};
    cls.lpfnWndProc=HostProc;
    cls.hInstance=GetModuleHandleW(nullptr);
    cls.lpszClassName=L"VerdantFocusRegressionTest";
    check(RegisterClassW(&cls)!=0,"register hidden test host");
    HWND hwnd=CreateWindowExW(0,cls.lpszClassName,L"Test",WS_OVERLAPPEDWINDOW,
                              0,0,640,480,nullptr,nullptr,cls.hInstance,nullptr);
    check(hwnd!=nullptr,"create hidden window");
    g_state.mainHwnd=hwnd;
    g_state.attached=true;
    g_state.capRect={100,0,300,32};
    g_state.maxRect={400,0,446,32};
    check(SetWindowSubclass(hwnd,MainSubclassProc,SUBCLASS_MAIN_ID,0)!=FALSE,"attach Verdant hook");

    hostActivations=hostPaints=0;
    systemNcActivations=synchronousRepaints=dwmFrameResets=hostClientActivations=hostClientDeactivations=0;
    check(SendMessageW(hwnd,WM_NCACTIVATE,FALSE,0)!=FALSE,"deactivation is allowed");
    SendMessageW(hwnd,WM_NCACTIVATE,TRUE,0);
    SendMessageW(hwnd,WM_NCPAINT,1,0);
    check(hostActivations==0,"no active/inactive frame paint delegated to host");
    check(hostPaints==0,"no legacy nonclient paint delegated to host");
    check(systemNcActivations==0,"custom frame never calls default nonclient activation painting");
    check(synchronousRepaints==2,"custom frame and its child windows repaint before activation returns");
    SendMessageW(hwnd,WM_ACTIVATE,WA_INACTIVE,0);
    check(hostClientDeactivations>0,"host still receives normal focus deactivation messages");
    SendMessageW(hwnd,WM_ACTIVATE,WA_ACTIVE,0);
    check(hostClientActivations>0,"host still receives normal focus activation messages");
    check(dwmFrameResets==0,"focus changes never reset the DWM frame");

    const int repaintsBeforeClose=synchronousRepaints;
    g_state.processingClose=true;
    check(SendMessageW(hwnd,WM_NCACTIVATE,FALSE,0)!=FALSE,"deactivation is allowed while closing");
    check(synchronousRepaints==repaintsBeforeClose,"closing skips synchronous activation repaint");
    check(systemNcActivations==0,"closing still suppresses default titlebar painting");
    g_state.processingClose=false;

    const RECT proposed={10,20,650,500};
    NCCALCSIZE_PARAMS params{};
    params.rgrc[0]=proposed;
    SendMessageW(hwnd,WM_NCCALCSIZE,TRUE,reinterpret_cast<LPARAM>(&params));
    check(EqualRect(&params.rgrc[0],&proposed)!=FALSE,"restored window uses full client area without legacy border bands");

    const int w=600,h=400;
    check(HitTestMainClient(hwnd,0,200,w,h)==HTLEFT,"left resize edge");
    check(HitTestMainClient(hwnd,w-1,200,w,h)==HTRIGHT,"right resize edge");
    check(HitTestMainClient(hwnd,300,h-1,w,h)==HTBOTTOM,"bottom resize edge");
    check(HitTestMainClient(hwnd,300,0,w,h)==HTTOP,"top resize edge");
    check(HitTestMainClient(hwnd,0,0,w,h)==HTTOPLEFT,"top-left resize corner");
    check(HitTestMainClient(hwnd,w-1,0,w,h)==HTTOPRIGHT,"top-right resize corner");
    check(HitTestMainClient(hwnd,0,h-1,w,h)==HTBOTTOMLEFT,"bottom-left resize corner");
    check(HitTestMainClient(hwnd,w-1,h-1,w,h)==HTBOTTOMRIGHT,"bottom-right resize corner");
    check(HitTestMainClient(hwnd,300,200,w,h)==HTCLIENT,"interior remains interactive");
    g_state.fullscreen=true;
    check(HitTestMainClient(hwnd,0,200,w,h)==HTCLIENT,"fullscreen disables resize zones");
    check(HitTestMainClient(hwnd,w-1,h-1,w,h)==HTCLIENT,"fullscreen disables corner resize zones");
    g_state.fullscreen=false;
    check(HitTestMainClient(hwnd,200,16,600,400)==HTCAPTION,"caption remains draggable");
    check(HitTestMainClient(hwnd,425,16,600,400)==HTMAXBUTTON,"Snap Layout maximize hit target preserved");
    check((GetWindowLongPtrW(hwnd,GWL_STYLE)&WS_MAXIMIZEBOX)!=0,"maximize window style preserved");

    // A native caption drag must bypass the host's manual drag path.
    const LPARAM dragPoint=MAKELPARAM(-320,120); // Signed monitor coordinates.
    check(SendMessageW(hwnd,WM_NCLBUTTONDOWN,HTCAPTION,dragPoint)==systemDragResult,
          "caption press enters the native Windows move path");
    check(systemCaptionDrags==1 && systemDragWindow==hwnd && systemDragPoint==dragPoint,
          "native drag receives original window and screen coordinates exactly once");
    check(hostCaptionDrags==0,"UI Wizard does not capture caption drag");
    check(g_state.captionPress==HTNOWHERE,"native drag does not use custom button capture");
    SendMessageW(hwnd,WM_NCLBUTTONDOWN,HTLEFT,dragPoint);
    check(hostEdgeDrags==1 && systemCaptionDrags==1,"resize edge uses the existing route");

    SendMessageW(hwnd,WM_NCLBUTTONDOWN,HTMAXBUTTON,dragPoint);
    check(g_state.captionPress==HTMAXBUTTON && systemCaptionDrags==1,"maximize button keeps its custom press handling");
    SendMessageW(hwnd,WM_CANCELMODE,0,0);
    check(g_state.captionPress==HTNOWHERE,"maximize button capture can be cancelled");
    SendMessageW(hwnd,WM_NCLBUTTONDBLCLK,HTCAPTION,dragPoint);
    check(g_state.captionPress==HTCAPTION && systemCaptionDrags==1,"caption double click retains custom maximize/restore handling");
    SendMessageW(hwnd,WM_CANCELMODE,0,0);

    g_state.fullscreen=true;
    SendMessageW(hwnd,WM_NCLBUTTONDOWN,HTCAPTION,dragPoint);
    check(systemCaptionDrags==1 && hostCaptionDrags==0,"fullscreen never starts a caption drag");
    g_state.fullscreen=false;
    g_state.processingClose=true;
    SendMessageW(hwnd,WM_NCLBUTTONDOWN,HTCAPTION,dragPoint);
    check(systemCaptionDrags==1 && hostCaptionDrags==0,"closing never starts a caption drag");
    g_state.processingClose=false;

    const LONG_PTR normalStyle=GetWindowLongPtrW(hwnd,GWL_STYLE);
    SetWindowLongPtrW(hwnd,GWL_STYLE,normalStyle|WS_MAXIMIZE);
    check(IsZoomed(hwnd)!=FALSE,"test window enters maximized state");
    check(HitTestMainClient(hwnd,0,200,w,h)==HTCLIENT,"maximized window has no resize edges");
    check(HitTestMainClient(hwnd,w-1,h-1,w,h)==HTCLIENT,"maximized window has no resize corners");
    check(HitTestMainClient(hwnd,425,16,w,h)==HTMAXBUTTON,"restore button remains available when maximized");
    check(SendMessageW(hwnd,WM_NCLBUTTONDOWN,HTCAPTION,dragPoint)==systemDragResult &&
          systemCaptionDrags==2 && hostCaptionDrags==0,"maximized caption drag also reaches native Windows restore/move handling");
    SetWindowLongPtrW(hwnd,GWL_STYLE,normalStyle);

    auto* chrome=new VerdantChromeObj();
    LPOLESTR method=const_cast<LPOLESTR>(L"DetachForExit");
    DISPID id=DISPID_UNKNOWN;
    DISPPARAMS noargs{};
    check(SUCCEEDED(chrome->GetIDsOfNames(IID_NULL,&method,1,LOCALE_NEUTRAL,&id)),"exit-specific COM method exists");
    check(SUCCEEDED(chrome->Invoke(id,IID_NULL,LOCALE_NEUTRAL,DISPATCH_METHOD,&noargs,nullptr,nullptr,nullptr)),"exit release succeeds");
    for (const wchar_t* wvMethod : {L"WebViewAvailable",L"WebViewReady",L"WebViewInit",L"WebViewShow",L"WebViewPostMessage",L"WebViewPollMessages",L"WebViewDestroy"}) {
        DISPID wvId=DISPID_UNKNOWN;
        LPOLESTR wvName=const_cast<LPOLESTR>(wvMethod);
        check(SUCCEEDED(chrome->GetIDsOfNames(IID_NULL,&wvName,1,LOCALE_NEUTRAL,&wvId)),"WebView2 COM member exists");
    }
    VARIANT pollRes; VariantInit(&pollRes);
    DISPID pollId=DISPID_UNKNOWN;
    LPOLESTR pollName=const_cast<LPOLESTR>(L"WebViewPollMessages");
    check(SUCCEEDED(chrome->GetIDsOfNames(IID_NULL,&pollName,1,LOCALE_NEUTRAL,&pollId)),"WebViewPollMessages resolves");
    check(SUCCEEDED(chrome->Invoke(pollId,IID_NULL,LOCALE_NEUTRAL,DISPATCH_METHOD,&noargs,&pollRes,nullptr,nullptr)),"WebViewPollMessages succeeds cleanly");
    check(pollRes.vt==VT_BSTR,"WebViewPollMessages returns BSTR");
    VariantClear(&pollRes);
    check(g_state.attached && g_state.mainHwnd==hwnd,"exit release preserves frame hook until native destruction");
    chrome->Release();
    check(DllCanUnloadNow()==S_FALSE,"DLL remains loaded while its native window hook exists");
    hostActivations=hostPaints=0;
    SendMessageW(hwnd,WM_NCACTIVATE,FALSE,0);
    SendMessageW(hwnd,WM_NCPAINT,1,0);
    check(hostActivations==0 && hostPaints==0,"late shutdown paint cannot restore native frame");
    check(DestroyWindow(hwnd)!=FALSE,"destroy test window");
    check(!g_state.attached && g_state.mainHwnd==nullptr,"native destruction releases the frame hook");
    check(DllCanUnloadNow()==S_OK,"DLL can unload after destruction");
    std::puts("Native focus regression passed");
}
