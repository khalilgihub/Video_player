/**
 * Native Windows DWM Helper for Hybrid Player
 * Restores Win32 window styles and enables hardware-accelerated
 * DWM taskbar zoom/scale animations for frameless/transparent windows
 * with zero border leakage and zero white flash.
 */

#include <windows.h>
#include <dwmapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>

#ifndef DWMWA_NCRENDERING_POLICY
#define DWMWA_NCRENDERING_POLICY 2
#endif

#ifndef DWMNCRP_ENABLED
#define DWMNCRP_ENABLED 2
#endif

#ifndef DWMWA_TRANSITIONS_FORCEDISABLED
#define DWMWA_TRANSITIONS_FORCEDISABLED 3
#endif

#ifndef DWMWA_USE_IMMERSIVE_DARK_MODE
#define DWMWA_USE_IMMERSIVE_DARK_MODE 20
#endif

#ifndef DWMWA_BORDER_COLOR
#define DWMWA_BORDER_COLOR 34
#endif
#ifndef DWMWA_CAPTION_COLOR
#define DWMWA_CAPTION_COLOR 35
#endif
#ifndef DWMWA_TEXT_COLOR
#define DWMWA_TEXT_COLOR 36
#endif
#ifndef DWMWA_SYSTEMBACKDROP_TYPE
#define DWMWA_SYSTEMBACKDROP_TYPE 38
#endif

#ifndef SWP_ASYNCWINDOWPOS
#define SWP_ASYNCWINDOWPOS 0x4000
#endif

#ifndef GCLP_HBRBACKGROUND
#define GCLP_HBRBACKGROUND (-10)
#endif

int main(int argc, char* argv[]) {
    if (argc < 2) {
        return 1;
    }

    const char* hwndStr = argv[1];
    uint64_t hwndVal = 0;
    if (hwndStr[0] == '0' && (hwndStr[1] == 'x' || hwndStr[1] == 'X')) {
        hwndVal = strtoull(hwndStr + 2, NULL, 16);
    } else {
        hwndVal = strtoull(hwndStr, NULL, 10);
    }

    HWND hwnd = (HWND)(uintptr_t)hwndVal;
    if (!hwnd || !IsWindow(hwnd)) {
        return 2;
    }

    // 2. Add WS_CAPTION, WS_MINIMIZEBOX, WS_MAXIMIZEBOX, WS_SYSMENU and remove WS_THICKFRAME.
    // WS_CAPTION and WS_MINIMIZEBOX are strictly required by Windows DWM to execute
    // the hardware Zoom / Scale minimize and restore animation.
    LONG_PTR style = GetWindowLongPtrW(hwnd, GWL_STYLE);
    style &= ~WS_THICKFRAME;
    style |= (WS_CAPTION | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU);
    SetWindowLongPtrW(hwnd, GWL_STYLE, style);

    // 3. Force DWM transitions to enabled (DWMWA_TRANSITIONS_FORCEDISABLED = FALSE)
    BOOL forceDisabled = FALSE;
    DwmSetWindowAttribute(hwnd, DWMWA_TRANSITIONS_FORCEDISABLED, &forceDisabled, sizeof(BOOL));

    // 4. Set NC rendering policy to DISABLED (DWMNCRP_DISABLED) to eliminate inactive border leak
    DWORD ncPolicy = DWMNCRP_DISABLED;
    DwmSetWindowAttribute(hwnd, DWMWA_NCRENDERING_POLICY, &ncPolicy, sizeof(DWORD));

    // 5. Set immersive dark mode (both Windows 11 / 20H1+ [20] and older Win10 [19])
    BOOL darkMode = TRUE;
    DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &darkMode, sizeof(BOOL));
    DwmSetWindowAttribute(hwnd, 19, &darkMode, sizeof(BOOL));

    // 6. Disable window corner rounding (DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWCP_DONOTROUND = 1)
    DWORD cornerPref = 1;
    DwmSetWindowAttribute(hwnd, 33, &cornerPref, sizeof(DWORD));

    // 7. Set border color to DWMWA_COLOR_NONE (0xFFFFFFFE) to suppress non-client border leakage
    COLORREF noBorderColor = 0xFFFFFFFE;
    COLORREF blackColor = RGB(0, 0, 0);
    DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, &noBorderColor, sizeof(COLORREF));
    DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, &blackColor, sizeof(COLORREF));
    DwmSetWindowAttribute(hwnd, DWMWA_TEXT_COLOR, &blackColor, sizeof(COLORREF));

    // 7. Disable system backdrops (no white glass/mica fallback)
    DWORD backdropNone = 1; // DWMSBT_NONE
    DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, &backdropNone, sizeof(DWORD));

    // 8. Set window class background brush to BLACK_BRUSH
    SetClassLongPtrW(hwnd, GCLP_HBRBACKGROUND, (LONG_PTR)GetStockObject(BLACK_BRUSH));

    // 9. Refresh window frame asynchronously without deadlocking the UI thread
    SetWindowPos(
        hwnd,
        NULL,
        0, 0, 0, 0,
        SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS
    );

    return 0;
}
