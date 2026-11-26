#pragma once
#include <windows.h>
#include <oleauto.h>

typedef bool (*WvResourceHandlerFn)(
    void* ctx,
    const wchar_t* uri,
    void* envPtr,
    void* argsPtr);

bool WvIsAvailable(HMODULE selfModule);
bool WvIsReady();
bool WvInit(HWND mainHwnd, HMODULE selfModule, const wchar_t* appDir, const wchar_t* cacheDir, const wchar_t* dataDir);
void WvSetVisible(bool visible);
void WvSyncBounds(HWND mainHwnd);
void WvSetInsets(int left, int top, int right, int bottom);
void WvSetBackdropColor(COLORREF color);
void WvSetAcceleratorMode(bool captureSpace, bool captureEscape);
void WvSetResourceHandler(const wchar_t* uriFilter, WvResourceHandlerFn handler, void* ctx);
bool WvPostJson(const wchar_t* json);
BSTR WvDrainMessagesJson();
void WvDestroy();
bool WvOwnsWindow(HWND hwnd);
