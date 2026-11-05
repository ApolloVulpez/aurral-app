using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Aurral.App;

internal sealed class TrayControls : IDisposable
{
    // Record Aurral's Media Session handlers so the tray uses the same queue as the web player.
    private const string MediaBridge = """
        (serverUrl => {
            if (window !== window.top || !navigator.mediaSession) return;

            const server = new URL(serverUrl);
            const origin = server.origin;
            if (server.protocol === "http:") server.protocol = "https:";
            if (location.origin !== origin && location.origin !== server.origin) return;

            const session = navigator.mediaSession;
            const setActionHandler = session.setActionHandler.bind(session);
            const handlers = new Map();
            session.setActionHandler = (action, handler) => {
                setActionHandler(action, handler);
                if (handler) handlers.set(action, handler);
                else handlers.delete(action);
            };

            window.__aurralTrayMedia = command => {
                if (command === "state") {
                    return {
                        Playing: session.playbackState === "playing",
                        CanToggle: handlers.has(session.playbackState === "playing" ? "pause" : "play"),
                        CanPrevious: handlers.has("previoustrack"),
                        CanNext: handlers.has("nexttrack")
                    };
                }

                const action = command === "toggle"
                    ? (session.playbackState === "playing" ? "pause" : "play")
                    : command;
                handlers.get(action)?.({ action });
                return null;
            };
        })
        """;

    private readonly NotifyIcon icon;
    private readonly ContextMenuStrip menu = new();
    private readonly ToolStripMenuItem toggle = new("Play") { Enabled = false };
    private readonly ToolStripMenuItem previous = new("Previous") { Enabled = false };
    private readonly ToolStripMenuItem next = new("Next") { Enabled = false };
    private CoreWebView2? webView;
    private string? scriptId;

    internal TrayControls(Icon? appIcon, Action showWindow, Action quit)
    {
        var show = new ToolStripMenuItem("Show Aurral", null, (_, _) => showWindow());
        var exit = new ToolStripMenuItem("Quit", null, (_, _) => quit());
        menu.Items.AddRange([show, new ToolStripSeparator(), toggle, previous, next, new ToolStripSeparator(), exit]);
        menu.Opening += async (_, _) => await RefreshMenuAsync();
        toggle.Click += async (_, _) => await ExecuteAsync("toggle");
        previous.Click += async (_, _) => await ExecuteAsync("previoustrack");
        next.Click += async (_, _) => await ExecuteAsync("nexttrack");
        icon = new NotifyIcon { Text = "Aurral", Icon = appIcon, ContextMenuStrip = menu };
        icon.DoubleClick += (_, _) => showWindow();
    }

    internal bool Visible
    {
        get => icon.Visible;
        set => icon.Visible = value;
    }

    internal bool PlaybackAvailable { get; set; }

    internal async Task SetServerAsync(CoreWebView2 core, Uri server)
    {
        PlaybackAvailable = false;
        webView = core;
        var previousScript = scriptId;
        scriptId = null;

        try
        {
            if (previousScript is not null) core.RemoveScriptToExecuteOnDocumentCreated(previousScript);
            scriptId = await core.AddScriptToExecuteOnDocumentCreatedAsync(
                $"{MediaBridge}({JsonSerializer.Serialize(server.AbsoluteUri)});");
        }
        catch (Exception ex) when (ex is InvalidOperationException or COMException)
        {
            // A failed tray script should never prevent the server from opening.
        }
    }

    private async Task RefreshMenuAsync()
    {
        UpdateMenu(null);
        var result = await ExecuteAsync("state");
        if (menu.IsDisposed || !PlaybackAvailable || result is null) return;

        try
        {
            UpdateMenu(JsonSerializer.Deserialize<PlaybackState>(result));
        }
        catch (JsonException)
        {
            // The page has no usable media state.
        }
    }

    private void UpdateMenu(PlaybackState? state)
    {
        toggle.Text = state?.Playing == true ? "Stop" : "Play";
        toggle.Enabled = state?.CanToggle == true;
        previous.Enabled = state?.CanPrevious == true;
        next.Enabled = state?.CanNext == true;
    }

    private async Task<string?> ExecuteAsync(string command)
    {
        if (!PlaybackAvailable || webView is null || scriptId is null) return null;

        try
        {
            return await webView.ExecuteScriptAsync(
                $"window.__aurralTrayMedia?.({JsonSerializer.Serialize(command)})");
        }
        catch (Exception ex) when (ex is InvalidOperationException or COMException)
        {
            return null;
        }
    }

    public void Dispose()
    {
        icon.Dispose();
        menu.Dispose();
    }

    private sealed record PlaybackState(bool Playing, bool CanToggle, bool CanPrevious, bool CanNext);
}
