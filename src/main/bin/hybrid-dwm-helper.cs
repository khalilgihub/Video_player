using System;
using System.Runtime.InteropServices;

public class Program {
    [DllImport("user32.dll")]
    public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    public static extern IntPtr SetClassLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("gdi32.dll")]
    public static extern IntPtr GetStockObject(int fnObject);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    public static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool bRedraw);

    [DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int dwAttribute, ref int pvAttribute, int cbAttribute);

    public static int Main(string[] args) {
        if (args == null || args.Length < 1) return 1;

        long hwndVal = 0;
        string hwndStr = args[0].Trim();
        if (hwndStr.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) {
            hwndVal = Convert.ToInt64(hwndStr.Substring(2), 16);
        } else {
            hwndVal = Convert.ToInt64(hwndStr);
        }

        IntPtr hwnd = new IntPtr(hwndVal);

        long WS_CAPTION = 0x00C00000L;
        long WS_THICKFRAME = 0x00040000L;
        long WS_MINIMIZEBOX = 0x00020000L;
        long WS_MAXIMIZEBOX = 0x00010000L;

        long curStyle = GetWindowLongPtr(hwnd, -16).ToInt64();
        // Remove WS_THICKFRAME to eliminate non-client resize border leakage and unwanted resize handles.
        // WS_CAPTION and WS_MINIMIZEBOX enable hardware DWM zoom/scale animations without injecting ghost caption buttons.
        long newStyle = (curStyle & ~WS_THICKFRAME) | (WS_CAPTION | WS_MINIMIZEBOX | WS_MAXIMIZEBOX);
        SetWindowLongPtr(hwnd, -16, new IntPtr(newStyle));

        // Set class background brush to BLACK_BRUSH
        IntPtr blackBrush = GetStockObject(4);
        SetClassLongPtr(hwnd, -10, blackBrush);

        // Force DWM transitions enabled (enables minimize/restore taskbar animation)
        int forceDisabled = 0;
        DwmSetWindowAttribute(hwnd, 3, ref forceDisabled, 4);

        // Strictly disable rounded corners (DWMWCP_DONOTROUND = 1) to eliminate 4-corner gaps
        int cornerPref = 1;
        DwmSetWindowAttribute(hwnd, 33, ref cornerPref, 4);

        // Clear any window clipping region so the window is a sharp, complete rectangle
        SetWindowRgn(hwnd, IntPtr.Zero, true);

        // Disable DWM non-client frame rendering (DWMNCRP_DISABLED = 1) to eliminate inactive border leak
        int ncPolicy = 1;
        DwmSetWindowAttribute(hwnd, 2, ref ncPolicy, 4);

        // Immersive dark mode (Windows 11 / 10)
        int darkMode = 1;
        DwmSetWindowAttribute(hwnd, 20, ref darkMode, 4);
        DwmSetWindowAttribute(hwnd, 19, ref darkMode, 4);

        // Border color: DWMWA_COLOR_NONE (-2 / 0xFFFFFFFE) to suppress non-client border rendering completely
        int noBorder = -2;
        DwmSetWindowAttribute(hwnd, 34, ref noBorder, 4);

        int blackColor = 0;
        DwmSetWindowAttribute(hwnd, 35, ref blackColor, 4);
        DwmSetWindowAttribute(hwnd, 36, ref blackColor, 4);

        // Disable system backdrop fallbacks (DWMSBT_NONE = 1)
        int backdropNone = 1;
        DwmSetWindowAttribute(hwnd, 38, ref backdropNone, 4);

        // SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS
        // 0x0020 | 0x0002 | 0x0001 | 0x0004 | 0x0010 | 0x0200 | 0x4000 = 0x4237
        SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0, 0x4237);

        // Re-apply corner preference after frame change to guarantee Windows 11 keeps corners square
        DwmSetWindowAttribute(hwnd, 33, ref cornerPref, 4);

        return 0;
    }
}
