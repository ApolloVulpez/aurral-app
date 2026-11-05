namespace Aurral.App;

internal sealed class ServerDialog : Form
{
    internal Uri? Server { get; private set; }

    internal ServerDialog(string currentAddress)
    {
        Text = "Connect to Aurral";
        AutoScaleMode = AutoScaleMode.Font;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        ShowInTaskbar = false;
        MinimizeBox = false;
        MaximizeBox = false;
        ClientSize = new Size(450, 180);

        var label = new Label { Text = "&Server URL", AutoSize = true };
        var address = new TextBox
        {
            Text = currentAddress,
            PlaceholderText = "https://music.example.com",
            Dock = DockStyle.Fill,
        };
        var hint = new Label
        {
            Text = "Enter the address you use to open Aurral in your browser.",
            AutoSize = true,
            MaximumSize = new Size(415, 0),
        };
        var error = new Label { AutoSize = true, ForeColor = Color.Firebrick };
        var connect = new Button { Text = "Connect", AutoSize = true };
        var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, AutoSize = true };
        connect.Click += (_, _) =>
        {
            if (!TryParseAddress(address.Text, out var server))
            {
                error.Text = "Enter an HTTP or HTTPS server URL.";
                address.Focus();
                return;
            }

            Server = server;
            DialogResult = DialogResult.OK;
        };

        var buttons = new FlowLayoutPanel
        {
            AutoSize = true,
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
        };
        buttons.Controls.Add(cancel);
        buttons.Controls.Add(connect);

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, Padding = new Padding(16) };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.Controls.Add(label, 0, 0);
        layout.Controls.Add(address, 0, 1);
        layout.Controls.Add(hint, 0, 2);
        layout.Controls.Add(error, 0, 3);
        layout.Controls.Add(buttons, 0, 4);
        Controls.Add(layout);
        AcceptButton = connect;
        CancelButton = cancel;
        Shown += (_, _) => address.SelectAll();
    }

    internal static bool TryParseAddress(string address, out Uri? server)
    {
        server = null;
        if (!Uri.TryCreate(address.Trim(), UriKind.Absolute, out var candidate) ||
            candidate.Scheme is not ("https" or "http") ||
            string.IsNullOrEmpty(candidate.Host) ||
            candidate.UserInfo.Length != 0 ||
            candidate.Query.Length != 0 ||
            candidate.Fragment.Length != 0)
        {
            return false;
        }

        server = candidate;
        return true;
    }
}
