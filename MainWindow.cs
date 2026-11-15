using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Aurral.App;

internal sealed class MainWindow : Form
{
    private const int UseImmersiveDarkMode = 20;
    private const int CaptionColor = 35;
    private const int CaptionTextColor = 36;
    private static readonly Color ContentBackground = Color.FromArgb(17, 20, 27);
    private readonly string appData = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Aurral");
    private readonly WebView2 browser = new()
    {
        Dock = DockStyle.Fill,
        DefaultBackgroundColor = ContentBackground,
    };
    private readonly ContextMenuStrip settingsMenu = new SettingsPopup();
    private readonly ToolStripMenuItem changeServer = new SettingsPopup.Item("Change server…", SettingsPopup.Icon.Server) { Enabled = false };
    private readonly ToolStripMenuItem minimizeToTray = new SettingsPopup.Item("Minimize to tray", SettingsPopup.Icon.Tray) { CheckOnClick = true };
    private readonly ToolStripMenuItem discordActivity = new SettingsPopup.Item("Discord Rich Presence", SettingsPopup.Icon.Chat) { CheckOnClick = true };
    private readonly ToolStripMenuItem discordLinks = new SettingsPopup.Item("Share Listen Links on Discord", SettingsPopup.Icon.Share) { CheckOnClick = true };
    private readonly DiscordPresence discord = new(DiscordPresence.ReadResource("Aurral.DiscordApplicationId.txt"));
    private readonly DiscordArtwork discordArtwork = new();
    private readonly System.Windows.Forms.Timer discordTimer = new() { Interval = 2000 };
    private readonly CaptionBar captionBar;
    private readonly ToolTip captionToolTips = new();
    private readonly TrayControls tray;
    private readonly TaskbarPlayback taskbarPlayback;
    private string serverAddress = "";
    private ulong? openingNavigation;
    private bool openingServer;
    private bool altPressedAlone;
    private bool quitting;
    private bool refreshingDiscord;

    internal MainWindow()
    {
        Text = Application.ProductName;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        AutoScaleMode = AutoScaleMode.Font;
        BackColor = ContentBackground;
        ClientSize = new Size(1200, 800);
        MinimumSize = new Size(520, 420);
        StartPosition = FormStartPosition.CenterScreen;
        KeyPreview = true;

        minimizeToTray.Checked = ReadPreference(MinimizeToTrayFile) != "false";
        discordActivity.Checked = ReadPreference(DiscordActivityFile) != "false";
        discordLinks.Checked = ReadPreference(DiscordLinksFile) != "false";
        discordLinks.Enabled = discordActivity.Checked;
        tray = new TrayControls(Icon, ShowExistingWindow, Quit);
        taskbarPlayback = new TaskbarPlayback(this, tray);
        settingsMenu.Items.AddRange([changeServer, minimizeToTray, new ToolStripSeparator(), discordActivity, discordLinks]);
        captionBar = new CaptionBar(this);
        captionToolTips.SetToolTip(captionBar.Back, "Back");
        captionToolTips.SetToolTip(captionBar.Forward, "Forward");
        captionToolTips.SetToolTip(captionBar.UpdateButton, "Check for app updates");
        captionToolTips.SetToolTip(captionBar.SettingsButton, "Settings");
        captionBar.SettingsButton.Click += (_, _) => ToggleSettings();
        captionBar.UpdateButton.Click += async (_, _) => await CheckForAppUpdateAsync(install: true);
        captionBar.Back.Click += (_, _) =>
        {
            if (browser.CanGoBack) browser.GoBack();
        };
        captionBar.Forward.Click += (_, _) =>
        {
            if (browser.CanGoForward) browser.GoForward();
        };
        Controls.Add(browser);
        Controls.Add(captionBar);

        KeyDown += TrackAlt;
        KeyUp += OpenSettingsOnAlt;
        browser.KeyDown += TrackAlt;
        browser.KeyUp += OpenSettingsOnAlt;
        changeServer.Click += async (_, _) => await PromptForServerAsync();
        minimizeToTray.Click += (_, _) =>
            SavePreference(MinimizeToTrayFile, minimizeToTray.Checked ? "true" : "false",
                "Aurral couldn't remember the tray setting for next time.");
        discordActivity.Click += async (_, _) => await ToggleDiscordAsync();
        discordLinks.Click += (_, _) =>
            SavePreference(DiscordLinksFile, discordLinks.Checked ? "true" : "false", "Aurral couldn't save the Discord listen-link setting.");
        discordTimer.Tick += async (_, _) => await RefreshDiscordAsync();
        Shown += async (_, _) =>
        {
            captionBar.PerformLayout();
            discordTimer.Enabled = discordActivity.Checked;
            await Task.WhenAll(CheckForAppUpdateAsync(install: false), InitializeBrowserAsync());
        };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        if (SystemInformation.HighContrast) return;

        SetWindowAttribute(Handle, UseImmersiveDarkMode, 1);
        SetWindowAttribute(Handle, CaptionColor, ColorTranslator.ToWin32(Color.Black));
        SetWindowAttribute(Handle, CaptionTextColor, ColorTranslator.ToWin32(Color.White));
        captionBar?.ExtendFrame();
    }

    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        base.OnDpiChanged(e);
        captionBar?.ExtendFrame();
    }

    protected override void WndProc(ref Message m)
    {
        if (taskbarPlayback?.ProcessMessage(ref m) == true) return;

        if (captionBar?.ExtendsFrame == true && m.Msg == CaptionBar.CalculateClientSize && m.WParam != IntPtr.Zero)
        {
            var top = Marshal.ReadInt32(m.LParam, sizeof(int));
            base.WndProc(ref m);
            captionBar.ExtendClientTop(ref m, top);
            return;
        }

        if (captionBar?.TryHandleDwmMessage(ref m) == true) return;
        base.WndProc(ref m);
        captionBar?.HitTestCaption(ref m);
    }

    [DllImport("dwmapi.dll", EntryPoint = "DwmSetWindowAttribute", ExactSpelling = true)]
    private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, in int value, int size);

    private static void SetWindowAttribute(IntPtr window, int attribute, int value) =>
        DwmSetWindowAttribute(window, attribute, in value, sizeof(int));

    protected override void OnDeactivate(EventArgs e)
    {
        altPressedAlone = false;
        base.OnDeactivate(e);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            discordTimer.Dispose();
            discord.Dispose();
            captionToolTips.Dispose();
            settingsMenu.Dispose();
            taskbarPlayback.Dispose();
            tray.Dispose();
        }
        base.Dispose(disposing);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        base.OnFormClosing(e);
        if (e.Cancel || e.CloseReason != CloseReason.UserClosing ||
            quitting || !tray.Visible || !minimizeToTray.Checked) return;

        e.Cancel = true;
        settingsMenu.Close();
        Hide();
    }

    internal void ShowExistingWindow()
    {
        if (quitting || IsDisposed) return;
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        var popup = GetLastActivePopup(Handle);
        if (popup != Handle && IsWindowVisible(popup) && SetForegroundWindow(popup)) return;
        Activate();
    }

    [DllImport("user32.dll", ExactSpelling = true)]
    private static extern IntPtr GetLastActivePopup(IntPtr window);

    [DllImport("user32.dll", ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll", ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr window);

    private void Quit()
    {
        quitting = true;
        Close();
    }

    private async Task ToggleDiscordAsync()
    {
        discordLinks.Enabled = discordActivity.Checked;
        discordTimer.Enabled = discordActivity.Checked;
        SavePreference(DiscordActivityFile, discordActivity.Checked ? "true" : "false", "Aurral couldn't save the Discord setting.");
        if (discordActivity.Checked)
        {
            await RefreshDiscordAsync();
        }
        else
        {
            await discord.UpdateAsync(null);
            if (!IsDisposed && !discordActivity.Checked) discord.Dispose();
        }
    }

    private async Task RefreshDiscordAsync()
    {
        if (refreshingDiscord || !discordActivity.Checked || IsDisposed) return;
        refreshingDiscord = true;
        try
        {
            var address = serverAddress;
            var share = discordLinks.Checked && discord.Connected;
            var playback = await tray.ReadDiscordActivityAsync(address, share);
            if (IsDisposed || !discordActivity.Checked || address != serverAddress || (share && !discordLinks.Checked)) return;
            var activity = playback?.Activity;
            if (activity is not null && discord.Connected && playback?.CoverSearch is { } track &&
                discordArtwork.Get(track) is { } cover)
            {
                activity["assets"] = new JsonObject { ["large_image"] = cover };
            }
            await discord.UpdateAsync(activity is null ? null : JsonSerializer.SerializeToElement(activity));
        }
        finally { refreshingDiscord = false; }
    }

    private async Task CheckForAppUpdateAsync(bool install)
    {
        if (!captionBar.UpdateButton.Enabled) return;
        captionBar.UpdateButton.Enabled = false;
        AppUpdates.Update? update = null;
        SetUpdateLabel("Checking for app updates…");
        try
        {
            update = await AppUpdates.CheckAsync();
            if (IsDisposed || !install) return;
            if (update is null)
            {
                MessageBox.Show(this, "Aurral App is up to date.", "App updates", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            var installed = AppUpdates.IsInstalled();
            if (!installed && MessageBox.Show(this, $"Open the Windows installer for Aurral App {update.Version}?",
                "App updates", MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return;

            SetUpdateLabel($"Installing Aurral App {update.Version}…");
            await AppUpdates.InstallAsync(update, installed);
        }
        catch (Exception error)
        {
            if (install && !IsDisposed)
                MessageBox.Show(this, $"Aurral App couldn't finish the update.\n\n{error.Message}",
                    "App updates", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        finally
        {
            if (!IsDisposed)
            {
                captionBar.UpdateButton.Enabled = true;
                captionBar.UpdateButton.ForeColor = update is null ? Color.Gray : Color.White;
                SetUpdateLabel(update is null ? "Check for app updates" : $"Update to Aurral App {update.Version}");
            }
        }
    }

    private void SetUpdateLabel(string label)
    {
        captionBar.UpdateButton.AccessibleName = label;
        captionToolTips.SetToolTip(captionBar.UpdateButton, label);
    }

    private void TrackAlt(object? sender, KeyEventArgs e) =>
        altPressedAlone = e.KeyCode == Keys.Menu && !e.Control && !e.Shift;

    private void OpenSettingsOnAlt(object? sender, KeyEventArgs e)
    {
        if (e.KeyCode != Keys.Menu || !altPressedAlone) return;

        altPressedAlone = false;
        e.Handled = true;
        // Wait until the WebView2 keyboard callback returns before moving focus.
        BeginInvoke(() =>
        {
            if (ContainsFocus) ToggleSettings();
        });
    }

    private void ToggleSettings()
    {
        if (settingsMenu.Visible)
        {
            settingsMenu.Close();
            return;
        }

        var button = captionBar.SettingsButton;
        var y = captionBar.Height - button.Top + captionBar.LogicalToDeviceUnits(4);
        settingsMenu.Show(button, new Point(button.Width, y), ToolStripDropDownDirection.BelowLeft);
    }

    private string AddressFile => Path.Combine(appData, "server.txt");
    private string MinimizeToTrayFile => Path.Combine(appData, "minimize-to-tray.txt");
    private string DiscordActivityFile => Path.Combine(appData, "discord-rich-presence.txt");
    private string DiscordLinksFile => Path.Combine(appData, "discord-listen-links.txt");

    private async Task InitializeBrowserAsync()
    {
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(
                userDataFolder: Path.Combine(appData, "WebView2"));
            if (IsDisposed) return;
            await browser.EnsureCoreWebView2Async(environment);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            ReportStartupError("Install the Microsoft Edge WebView2 Runtime, then reopen Aurral.");
            return;
        }
        catch (Exception ex)
        {
            ReportStartupError($"Aurral couldn't open its browser window.\n\n{ex.Message}");
            return;
        }

        if (IsDisposed) return;
        var core = browser.CoreWebView2;
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsWebMessageEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.HistoryChanged += (_, _) =>
        {
            captionBar.Back.Enabled = core.CanGoBack;
            captionBar.Forward.Enabled = core.CanGoForward;
        };
        core.NavigationStarting += (_, args) =>
        {
            if (openingServer && !args.IsRedirected)
            {
                openingNavigation = args.NavigationId;
                openingServer = false;
            }
        };
        core.NavigationCompleted += OnNavigationCompleted;
        changeServer.Enabled = true;

        if (ServerDialog.TryParseAddress(ReadPreference(AddressFile), out var server) && server is not null)
        {
            await OpenServerAsync(server);
            return;
        }

        if (!await PromptForServerAsync()) Close();
    }

    private async Task<bool> PromptForServerAsync()
    {
        using var dialog = new ServerDialog(serverAddress);
        if (dialog.ShowDialog(this) != DialogResult.OK || dialog.Server is not { } server) return false;

        await OpenServerAsync(server);
        return true;
    }

    private async Task OpenServerAsync(Uri server)
    {
        changeServer.Enabled = false;
        await tray.SetServerAsync(browser.CoreWebView2, server);
        if (IsDisposed) return;

        serverAddress = server.AbsoluteUri;
        Text = $"{Application.ProductName} — {server.Authority}";
        openingNavigation = null;
        openingServer = true;
        tray.Visible = true;
        browser.CoreWebView2.Navigate(serverAddress);
    }

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        if (args.NavigationId != openingNavigation) return;

        openingNavigation = null;
        changeServer.Enabled = true;
        if (!args.IsSuccess || args.HttpStatusCode >= 400)
        {
            var reason = args.HttpStatusCode >= 400 ? $"HTTP {args.HttpStatusCode}" : args.WebErrorStatus.ToString();
            // Queue the dialog after WebView2 finishes its event callback.
            BeginInvoke(() => MessageBox.Show(this,
                $"Couldn't open {serverAddress}\n\n{reason}\n\nOpen the settings menu beside the update button and choose Change server to try again.",
                "Connection failed", MessageBoxButtons.OK, MessageBoxIcon.Warning));
            return;
        }

        tray.PlaybackAvailable = true;
        SavePreference(AddressFile, serverAddress, "Aurral couldn't remember the server URL for next time.");
    }

    private static string ReadPreference(string file)
    {
        try
        {
            return File.ReadAllText(file);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return "";
        }
    }

    private void SavePreference(string file, string value, string error)
    {
        try
        {
            Directory.CreateDirectory(appData);
            File.WriteAllText(file, value);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            BeginInvoke(() => MessageBox.Show(this, error, "Aurral", MessageBoxButtons.OK, MessageBoxIcon.Warning));
        }
    }

    private void ReportStartupError(string message)
    {
        if (IsDisposed) return;
        MessageBox.Show(this, message, "Aurral", MessageBoxButtons.OK, MessageBoxIcon.Error);
        Close();
    }
}
