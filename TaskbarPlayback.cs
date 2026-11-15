using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using PlaybackState = Aurral.App.TrayControls.PlaybackState;

namespace Aurral.App;

internal sealed class TaskbarPlayback : IDisposable
{
    private const int WindowCommand = 0x0111;
    private const int ThumbnailButtonClicked = 0x1800;
    private const uint IconTooltipAndFlags = 0x0002 | 0x0004 | 0x0008;
    private const uint DisabledButton = 0x0001;
    private const int IconWidthMetric = 11;
    private const int IconHeightMetric = 12;
    private const int NotImplemented = unchecked((int)0x80004001);
    private static readonly int TaskbarButtonCreated = RegisterWindowMessage("TaskbarButtonCreated");

    private readonly Form window;
    private readonly TrayControls playback;
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 1000 };
    private ITaskbarList3? taskbar;
    private IntPtr handle;
    private PlaybackState? displayedState;
    private int displayedDpi;
    private bool refreshing;

    internal TaskbarPlayback(Form window, TrayControls playback)
    {
        this.window = window;
        this.playback = playback;
        timer.Tick += async (_, _) => await RefreshAsync();
    }

    internal bool ProcessMessage(ref Message message)
    {
        if (TaskbarButtonCreated != 0 && message.Msg == TaskbarButtonCreated)
        {
            if (!window.Disposing && !window.IsDisposed) Attach(message.HWnd);
            return false;
        }

        if (message.Msg != WindowCommand || message.HWnd != handle) return false;
        var command = unchecked((uint)message.WParam.ToInt64());
        if (command >> 16 != ThumbnailButtonClicked) return false;

        var action = (Button)(command & 0xFFFF) switch
        {
            Button.Previous => "previoustrack",
            Button.Toggle => "toggle",
            Button.Next => "nexttrack",
            _ => null
        };
        if (action is null) return false;

        message.Result = IntPtr.Zero;
        _ = ExecuteAsync(action);
        return true;
    }

    private void Attach(IntPtr newHandle)
    {
        Detach();
        try
        {
            taskbar = (ITaskbarList3)new TaskbarList();
            handle = newHandle;
            var initialized = taskbar.HrInit();
            if ((initialized >= 0 || initialized == NotImplemented) &&
                SetButtons(taskbar, null, window.DeviceDpi, add: true))
            {
                timer.Start();
                return;
            }
        }
        catch (COMException)
        {
            // The Windows shell can be unavailable, for example while Explorer restarts.
        }
        Detach();
    }

    private async Task ExecuteAsync(string action)
    {
        await playback.ExecuteAsync(action);
        await RefreshAsync();
    }

    private async Task RefreshAsync()
    {
        if (refreshing || taskbar is null || !window.Visible || !window.IsHandleCreated || window.Handle != handle) return;

        refreshing = true;
        var attachedTaskbar = taskbar;
        try
        {
            var state = await playback.ReadPlaybackStateAsync();
            if (taskbar != attachedTaskbar || !window.Visible || !window.IsHandleCreated || window.Handle != handle) return;

            var dpi = window.DeviceDpi;
            if (state != displayedState || dpi != displayedDpi) SetButtons(attachedTaskbar, state, dpi, add: false);
        }
        finally
        {
            refreshing = false;
        }
    }

    private bool SetButtons(ITaskbarList3 shell, PlaybackState? state, int dpi, bool add)
    {
        var size = new Size(GetSystemMetricsForDpi(IconWidthMetric, (uint)dpi),
            GetSystemMetricsForDpi(IconHeightMetric, (uint)dpi));
        var playing = state?.Playing == true;
        var buttons = new ThumbnailButton[3];
        try
        {
            buttons[0] = CreateButton(Button.Previous, "Previous track", state?.CanPrevious == true, size);
            buttons[1] = CreateButton(Button.Toggle, playing ? "Pause" : "Play", state?.CanToggle == true, size, playing);
            buttons[2] = CreateButton(Button.Next, "Next track", state?.CanNext == true, size);

            // Explorer can notify the same window again when it reappears from the tray.
            var added = add && shell.ThumbBarAddButtons(handle, (uint)buttons.Length, buttons) >= 0;
            if (!added && shell.ThumbBarUpdateButtons(handle, (uint)buttons.Length, buttons) < 0) return false;

            displayedState = state;
            displayedDpi = dpi;
            return true;
        }
        finally
        {
            // The shell copies the icons in ThumbBarAddButtons and ThumbBarUpdateButtons.
            foreach (var button in buttons)
                if (button.Icon != IntPtr.Zero) DestroyIcon(button.Icon);
        }
    }

    private static ThumbnailButton CreateButton(Button button, string tooltip, bool enabled, Size size, bool playing = false)
    {
        using var bitmap = new Bitmap(size.Width, size.Height, PixelFormat.Format32bppArgb);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.ScaleTransform(size.Width / 32f, size.Height / 32f);

        using var path = new GraphicsPath();
        switch (button)
        {
            case Button.Previous:
                path.AddRectangle(new RectangleF(7, 8, 3, 16));
                path.AddPolygon([new PointF(11, 16), new PointF(24, 8), new PointF(24, 24)]);
                break;
            case Button.Next:
                path.AddPolygon([new PointF(8, 8), new PointF(21, 16), new PointF(8, 24)]);
                path.AddRectangle(new RectangleF(22, 8, 3, 16));
                break;
            case Button.Toggle when playing:
                path.AddRectangle(new RectangleF(9, 8, 5, 16));
                path.AddRectangle(new RectangleF(18, 8, 5, 16));
                break;
            case Button.Toggle:
                path.AddPolygon([new PointF(10, 7), new PointF(25, 16), new PointF(10, 25)]);
                break;
        }

        using var outline = new Pen(Color.FromArgb(205, 0, 0, 0), 1.5f) { LineJoin = LineJoin.Round };
        graphics.DrawPath(outline, path);
        graphics.FillPath(Brushes.White, path);
        return new ThumbnailButton
        {
            Mask = IconTooltipAndFlags,
            Id = (uint)button,
            Icon = bitmap.GetHicon(),
            Tooltip = tooltip,
            Flags = enabled ? 0 : DisabledButton
        };
    }

    private void Detach()
    {
        timer.Stop();
        if (taskbar is not null) Marshal.ReleaseComObject(taskbar);
        taskbar = null;
        handle = IntPtr.Zero;
    }

    public void Dispose()
    {
        Detach();
        timer.Dispose();
    }

    private enum Button : uint
    {
        Previous = 0x5101,
        Toggle,
        Next
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ThumbnailButton
    {
        public uint Mask;
        public uint Id;
        public uint BitmapIndex;
        public IntPtr Icon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Tooltip;
        public uint Flags;
    }

    [ComImport, Guid("56FDF344-FD6D-11D0-958A-006097C9A090")]
    private class TaskbarList;

    [ComImport, Guid("EA1AFB91-9E28-4B86-90E9-9E9F8A5EEFAF"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ITaskbarList3
    {
        // Include the inherited ITaskbarList and ITaskbarList2 methods in vtable order.
        [PreserveSig] int HrInit();
        [PreserveSig] int AddTab(IntPtr window);
        [PreserveSig] int DeleteTab(IntPtr window);
        [PreserveSig] int ActivateTab(IntPtr window);
        [PreserveSig] int SetActiveAlt(IntPtr window);
        [PreserveSig] int MarkFullscreenWindow(IntPtr window, [MarshalAs(UnmanagedType.Bool)] bool fullscreen);
        [PreserveSig] int SetProgressValue(IntPtr window, ulong completed, ulong total);
        [PreserveSig] int SetProgressState(IntPtr window, uint flags);
        [PreserveSig] int RegisterTab(IntPtr tab, IntPtr parent);
        [PreserveSig] int UnregisterTab(IntPtr tab);
        [PreserveSig] int SetTabOrder(IntPtr tab, IntPtr insertBefore);
        [PreserveSig] int SetTabActive(IntPtr tab, IntPtr parent, uint reserved);
        [PreserveSig] int ThumbBarAddButtons(IntPtr window, uint count,
            [In, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] ThumbnailButton[] buttons);
        [PreserveSig] int ThumbBarUpdateButtons(IntPtr window, uint count,
            [In, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] ThumbnailButton[] buttons);
    }

    [DllImport("user32.dll", EntryPoint = "RegisterWindowMessageW", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int RegisterWindowMessage(string message);

    [DllImport("user32.dll", ExactSpelling = true)]
    private static extern int GetSystemMetricsForDpi(int index, uint dpi);

    [DllImport("user32.dll", ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr icon);
}
