using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace Aurral.App;

internal sealed class CaptionBar : Panel
{
    internal const int CalculateClientSize = 0x0083;
    private const int HitTest = 0x0084;
    private const int CaptionButtonBounds = 5;
    private const int SizeFrameHeight = 33;
    private const int PaddedBorderWidth = 92;
    private const uint RefreshFrameFlags = 0x0037; // Frame changed, keep size, position, activation, and Z order.
    private readonly Form window;

    internal Button Back { get; } = new CaptionButton(CaptionIcon.Back, "Back") { Enabled = false };
    internal Button Forward { get; } = new CaptionButton(CaptionIcon.Forward, "Forward") { Enabled = false };
    internal Button UpdateButton { get; } = new CaptionButton(CaptionIcon.Update, "Check for app updates");
    internal bool ExtendsFrame { get; private set; }

    internal CaptionBar(Form window)
    {
        this.window = window;
        Dock = DockStyle.Top;
        Height = 36;
        BackColor = Color.Black;
        Controls.AddRange([UpdateButton, Back, Forward]);
        window.TextChanged += (_, _) => Invalidate();
    }

    internal void ExtendFrame()
    {
        Height = LogicalToDeviceUnits(36);
        var margins = new Margins { Top = Height };
        ExtendsFrame = !SystemInformation.HighContrast &&
            DwmExtendFrameIntoClientArea(window.Handle, in margins) == 0;
        if (ExtendsFrame) SetWindowPos(window.Handle, IntPtr.Zero, 0, 0, 0, 0, RefreshFrameFlags);
        PerformLayout();
    }

    internal void ExtendClientTop(ref Message message, int windowTop)
    {
        // Keep the standard side and bottom borders. The top border of a maximized
        // window is outside the monitor's working area and must stay out of the client.
        var top = windowTop + (IsZoomed(message.HWnd) ? ResizeBorderHeight : 0);
        Marshal.WriteInt32(message.LParam, sizeof(int), top);
        message.Result = IntPtr.Zero;
    }

    internal bool TryHandleDwmMessage(ref Message message)
    {
        if (!ExtendsFrame ||
            !DwmDefWindowProc(message.HWnd, message.Msg, message.WParam, message.LParam, out var result))
        {
            return false;
        }

        message.Result = result;
        return true;
    }

    internal void HitTestCaption(ref Message message)
    {
        if (!ExtendsFrame || message.Msg != HitTest || message.Result != 1) return;
        var coordinates = message.LParam.ToInt64();
        var point = PointToClient(new Point(unchecked((short)coordinates), unchecked((short)(coordinates >> 16))));
        if (!ClientRectangle.Contains(point) || UpdateButton.Bounds.Contains(point) ||
            Back.Bounds.Contains(point) || Forward.Bounds.Contains(point)) return;

        if (!IsZoomed(message.HWnd) && point.Y < ResizeBorderHeight)
            message.Result = 12; // HTTOP
        else
            message.Result = point.X < LogicalToDeviceUnits(26) ? 3 : 2; // HTSYSMENU or HTCAPTION
    }

    private int ResizeBorderHeight =>
        GetSystemMetricsForDpi(SizeFrameHeight, (uint)DeviceDpi) +
        GetSystemMetricsForDpi(PaddedBorderWidth, (uint)DeviceDpi);

    protected override void OnLayout(LayoutEventArgs e)
    {
        base.OnLayout(e);
        var right = ClientSize.Width - LogicalToDeviceUnits(6);
        var centerY = ClientSize.Height / 2;
        if (ExtendsFrame && window.IsHandleCreated)
        {
            right -= LogicalToDeviceUnits(138);
            if (DwmGetWindowAttribute(window.Handle, CaptionButtonBounds, out var bounds, Marshal.SizeOf<NativeRect>()) == 0 &&
                bounds.Left > 0 && bounds.Bottom > bounds.Top && GetWindowRect(window.Handle, out var frame))
            {
                var buttons = PointToClient(new Point(frame.Left + bounds.Left, frame.Top + (bounds.Top + bounds.Bottom) / 2));
                right = buttons.X;
                centerY = buttons.Y;
            }
        }

        var width = LogicalToDeviceUnits(32);
        var height = LogicalToDeviceUnits(26);
        var top = Math.Clamp(centerY - height / 2, 0, Math.Max(0, ClientSize.Height - height));
        Forward.SetBounds(right - width, top, width, height);
        Back.SetBounds(right - width * 2, top, width, height);
        UpdateButton.SetBounds(right - width * 3, top, width, height);
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        if (!ExtendsFrame) return;

        var iconSize = LogicalToDeviceUnits(16);
        if (window.Icon is { } icon)
            e.Graphics.DrawIcon(icon, new Rectangle(LogicalToDeviceUnits(8), (Height - iconSize) / 2, iconSize, iconSize));

        var titleLeft = LogicalToDeviceUnits(31);
        var titleWidth = Math.Max(0, UpdateButton.Left - titleLeft - LogicalToDeviceUnits(8));
        TextRenderer.DrawText(e.Graphics, window.Text, Font, new Rectangle(titleLeft, 0, titleWidth, Height),
            Color.White, TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis |
            TextFormatFlags.NoPrefix);
    }

    protected override void WndProc(ref Message m)
    {
        if (ExtendsFrame && m.Msg == HitTest)
        {
            m.Result = -1; // Pass empty caption space through to the form for dragging.
            return;
        }
        base.WndProc(ref m);
    }

    private enum CaptionIcon { Back, Forward, Update }

    private sealed class CaptionButton : Button
    {
        private readonly CaptionIcon icon;

        internal CaptionButton(CaptionIcon icon, string label)
        {
            this.icon = icon;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
            AccessibleName = label;
            ForeColor = icon == CaptionIcon.Update ? Color.Gray : Color.White;
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            UseVisualStyleBackColor = false;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var scale = DeviceDpi / 96f;
            var centerX = ClientSize.Width / 2f;
            var centerY = ClientSize.Height / 2f;
            var halfHeight = 5 * scale;
            using var pen = new Pen(Enabled ? ForeColor : Color.Gray, 2 * scale)
            {
                StartCap = LineCap.Round,
                EndCap = LineCap.Round,
                LineJoin = LineJoin.Round,
            };
            e.Graphics.Clear(BackColor);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            if (icon == CaptionIcon.Update)
            {
                e.Graphics.DrawLine(pen, centerX, centerY - halfHeight, centerX, centerY + scale);
                e.Graphics.DrawLines(pen, [
                    new PointF(centerX - 3 * scale, centerY - 2 * scale),
                    new PointF(centerX, centerY + scale),
                    new PointF(centerX + 3 * scale, centerY - 2 * scale),
                ]);
                e.Graphics.DrawLine(pen, centerX - halfHeight, centerY + halfHeight,
                    centerX + halfHeight, centerY + halfHeight);
            }
            else
            {
                var direction = icon == CaptionIcon.Back ? -1 : 1;
                var tipX = centerX + direction * 3 * scale;
                var edgeX = centerX - direction * 3 * scale;
                e.Graphics.DrawLines(pen, [
                    new PointF(edgeX, centerY - halfHeight),
                    new PointF(tipX, centerY),
                    new PointF(edgeX, centerY + halfHeight),
                ]);
            }
            if (Focused && ShowFocusCues)
                ControlPaint.DrawFocusRectangle(e.Graphics, Rectangle.Inflate(ClientRectangle, -3, -3));
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Margins
    {
        public int Left, Right, Top, Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left, Top, Right, Bottom;
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, in Margins margins);

    [DllImport("dwmapi.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DwmDefWindowProc(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, out IntPtr result);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out NativeRect value, int size);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hwnd, out NativeRect rect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsZoomed(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetricsForDpi(int index, uint dpi);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
}
