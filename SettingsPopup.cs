using System.Drawing.Drawing2D;

namespace Aurral.App;

internal sealed class SettingsPopup : ContextMenuStrip
{
    private const int MenuWidth = 274;
    private static readonly Color Surface = Color.FromArgb(14, 14, 14);
    internal static readonly Color TextColor = Color.FromArgb(179, 179, 179);
    private readonly Font? menuFont;

    internal SettingsPopup(string accessibleName = "Settings")
    {
        AccessibleName = accessibleName;
        ShowImageMargin = false;
        ShowCheckMargin = true;
        if (SystemInformation.HighContrast) return;

        ShowCheckMargin = false;
        BackColor = Surface;
        menuFont = new Font("Segoe UI", 10.5f);
        Font = menuFont;
        Renderer = new DarkMenuRenderer();
    }

    protected override void OnLayout(LayoutEventArgs e)
    {
        Padding = new Padding(LogicalToDeviceUnits(5));
        base.OnLayout(e);
    }

    public override Size GetPreferredSize(Size proposedSize)
    {
        var size = base.GetPreferredSize(proposedSize);
        if (!SystemInformation.HighContrast) size.Width = Math.Max(size.Width, LogicalToDeviceUnits(MenuWidth));
        return size;
    }

    protected override void OnSizeChanged(EventArgs e)
    {
        base.OnSizeChanged(e);
        if (SystemInformation.HighContrast || ClientSize.Width == 0 || ClientSize.Height == 0) return;

        using var path = Rounded(ClientRectangle, LogicalToDeviceUnits(10));
        Region = new Region(path);
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing) menuFont?.Dispose();
    }

    internal enum Icon { Server, Tray, Chat, Share }

    internal sealed class Item(string text, Icon icon) : ToolStripMenuItem(text)
    {
        internal Icon Glyph { get; } = icon;

        public override Size GetPreferredSize(Size constrainingSize) =>
            Owner is { } owner && !SystemInformation.HighContrast
                ? owner.LogicalToDeviceUnits(new Size(MenuWidth, 40))
                : base.GetPreferredSize(constrainingSize);
    }

    private static GraphicsPath Rounded(Rectangle bounds, int radius)
    {
        var path = new GraphicsPath();
        path.AddRoundedRectangle(bounds, new Size(radius, radius));
        return path;
    }

    private sealed class DarkMenuRenderer : ToolStripRenderer
    {
        private static readonly Color Outline = Color.FromArgb(37, 37, 37);
        private static readonly Color Disabled = Color.FromArgb(104, 104, 104);

        protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e) => e.Graphics.Clear(Surface);

        protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e)
        {
            var bounds = new Rectangle(Point.Empty, e.ToolStrip.ClientSize - new Size(1, 1));
            using var path = Rounded(bounds, e.ToolStrip.LogicalToDeviceUnits(10));
            using var pen = new Pen(Outline);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            e.Graphics.DrawPath(pen, path);
        }

        protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
        {
            if (e.Item is not Item item || e.ToolStrip is not { } owner) return;
            var scale = owner.DeviceDpi / 96f;
            var saved = e.Graphics.Save();
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            if (item.Selected && item.Enabled)
            {
                var bounds = Rectangle.Inflate(new Rectangle(Point.Empty, item.Size), -owner.LogicalToDeviceUnits(5), -1);
                using var path = Rounded(bounds, owner.LogicalToDeviceUnits(6));
                using var brush = new SolidBrush(Color.FromArgb(27, 27, 27));
                e.Graphics.FillPath(brush, path);
                if (!item.Bounds.Contains(owner.PointToClient(Control.MousePosition)))
                {
                    using var outline = new Pen(Color.FromArgb(125, 125, 125), 2 * scale);
                    e.Graphics.DrawPath(outline, path);
                }
            }

            using var pen = new Pen(ItemColor(item), 1.3f) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
            e.Graphics.TranslateTransform(16 * scale, (item.Height - 16 * scale) / 2);
            e.Graphics.ScaleTransform(scale, scale);
            DrawIcon(e.Graphics, pen, item.Glyph);
            if (item.Checked)
            {
                e.Graphics.TranslateTransform(item.Width / scale - 46, 0);
                e.Graphics.DrawLines(pen, [new PointF(3, 8), new PointF(6.5f, 11.5f), new PointF(13, 5)]);
            }
            e.Graphics.Restore(saved);
        }

        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            var inset = e.ToolStrip?.LogicalToDeviceUnits(40) ?? 40;
            var trailing = e.ToolStrip?.LogicalToDeviceUnits(34) ?? 34;
            var bounds = new Rectangle(inset, 0, Math.Max(0, e.Item.Width - inset - trailing), e.Item.Height);
            TextRenderer.DrawText(e.Graphics, e.Text, e.TextFont, bounds, ItemColor(e.Item), TextFormatFlags.VerticalCenter |
                TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding);
        }

        private static Color ItemColor(ToolStripItem item) => !item.Enabled ? Disabled : item.Selected ? Color.White : TextColor;

        private static void DrawIcon(Graphics graphics, Pen pen, Icon icon)
        {
            switch (icon)
            {
                case Icon.Server:
                    graphics.DrawEllipse(pen, 1.5f, 1.5f, 13, 13);
                    graphics.DrawEllipse(pen, 5, 1.5f, 6, 13);
                    graphics.DrawLine(pen, 1.5f, 8, 14.5f, 8);
                    break;
                case Icon.Tray:
                    graphics.DrawLine(pen, 8, 2, 8, 9);
                    graphics.DrawLines(pen, [new PointF(5, 6), new PointF(8, 9), new PointF(11, 6)]);
                    graphics.DrawLines(pen, [new PointF(2, 9), new PointF(2, 13.5f), new PointF(14, 13.5f), new PointF(14, 9)]);
                    break;
                case Icon.Chat:
                    graphics.DrawPolygon(pen, [new PointF(2, 3), new PointF(14, 3), new PointF(14, 11), new PointF(7, 11), new PointF(4, 14), new PointF(4, 11), new PointF(2, 11)]);
                    graphics.DrawLine(pen, 5, 7, 11, 7);
                    break;
                case Icon.Share:
                    graphics.DrawEllipse(pen, 1, 6, 4, 4);
                    graphics.DrawEllipse(pen, 10.5f, 1.5f, 4, 4);
                    graphics.DrawEllipse(pen, 10.5f, 10.5f, 4, 4);
                    graphics.DrawLine(pen, 4.75f, 7.1f, 10.7f, 4.4f);
                    graphics.DrawLine(pen, 4.75f, 8.9f, 10.7f, 11.6f);
                    break;
            }
        }

        protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
        {
            using var pen = new Pen(Color.FromArgb(34, 34, 34));
            var inset = e.ToolStrip?.LogicalToDeviceUnits(8) ?? 8;
            var y = e.Item.Height / 2;
            e.Graphics.DrawLine(pen, inset, y, e.Item.Width - inset, y);
        }
    }
}
