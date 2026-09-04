$shortcutPath = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Hybrid Player.lnk"

# C# snippet using IPersistFile and IPropertyStore to set System.AppUserModel.ID
$code = @"
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

[ComImport]
[Guid("00021401-0000-0000-C000-000000000046")]
[ClassInterface(ClassInterfaceType.None)]
public class ShellLink {}

[ComImport]
[Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore
{
    uint GetCount();
    void GetAt(uint iprop, out PropertyKey pkey);
    void GetValue([In] ref PropertyKey key, [Out] PropVariant pv);
    void SetValue([In] ref PropertyKey key, [In] PropVariant pv);
    void Commit();
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct PropertyKey
{
    public Guid fmtid;
    public uint pid;
    public PropertyKey(Guid guid, uint id) { fmtid = guid; pid = id; }
}

[StructLayout(LayoutKind.Explicit)]
public class PropVariant : IDisposable
{
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr pwszVal;

    public static PropVariant FromString(string val)
    {
        var pv = new PropVariant();
        pv.vt = 31; // VT_LPWSTR
        pv.pwszVal = Marshal.StringToCoTaskMemUni(val);
        return pv;
    }

    public void Dispose()
    {
        if (pwszVal != IntPtr.Zero)
        {
            Marshal.FreeCoTaskMem(pwszVal);
            pwszVal = IntPtr.Zero;
        }
    }
}

public static class ShortcutHelper
{
    public static void SetAppId(string shortcutPath, string appId)
    {
        var link = (ShellLink)new ShellLink();
        var file = (IPersistFile)link;
        file.Load(shortcutPath, 2);

        var store = (IPropertyStore)link;
        var pkey = new PropertyKey(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5);
        using (var pv = PropVariant.FromString(appId))
        {
            store.SetValue(ref pkey, pv);
            store.Commit();
        }

        file.Save(shortcutPath, true);
    }

    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);

    public static void RefreshShellIcons()
    {
        // SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_FLUSH = 0x1000
        SHChangeNotify(0x08000000, 0x1000, IntPtr.Zero, IntPtr.Zero);
    }
}
"@

Add-Type -TypeDefinition $code -Language CSharp
[ShortcutHelper]::SetAppId($shortcutPath, "com.hybridplayer.app")
[ShortcutHelper]::RefreshShellIcons()
Write-Host "Successfully assigned System.AppUserModel.ID = com.hybridplayer.app and refreshed shell icons"

