using System.ComponentModel;
using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json.Serialization;
using Microsoft.Win32;

namespace Aurral.App;

internal static class AppUpdates
{
    private const string ReleaseApi = "https://api.github.com/repos/ApolloVulpez/aurral-app/releases?per_page=100";
    private const string ReleaseDownloads = "https://github.com/ApolloVulpez/aurral-app/releases/download/";
    private const string WindowsTagPrefix = "windows-";
    private const string UninstallKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{96AB4288-F7A0-4C16-B0D8-DFFAC7CD6659}_is1";
    private static readonly HttpClient Client = new() { Timeout = Timeout.InfiniteTimeSpan };
    private static readonly Version CurrentVersion = typeof(AppUpdates).Assembly.GetName().Version!;

    static AppUpdates() => Client.DefaultRequestHeaders.UserAgent.ParseAdd($"Aurral-App/{CurrentVersion}");

    internal sealed record Update(Version Version, string Url, long Size, string? Digest);

    internal static async Task<Update?> CheckAsync()
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var releases = await Client.GetFromJsonAsync<Release[]>(ReleaseApi, timeout.Token);
        return FindUpdate(releases ?? [], CurrentVersion);
    }

    private static Update? FindUpdate(IEnumerable<Release> releases, Version current)
    {
        Update? newest = null;
        foreach (var release in releases)
        {
            var tag = release.Tag.StartsWith(WindowsTagPrefix, StringComparison.Ordinal)
                ? release.Tag[WindowsTagPrefix.Length..] : release.Tag;
            if (release.Draft || release.Prerelease || !tag.StartsWith('v') ||
                !Version.TryParse(tag[1..], out var version) || version.Build < 0 || version.Revision >= 0 ||
                tag != $"v{version}" || version <= (newest?.Version ?? current)) continue;

            var name = $"Aurral-Setup-{version}-win-x64.exe";
            var url = $"{ReleaseDownloads}{release.Tag}/{name}";
            var asset = release.Assets.FirstOrDefault(asset => asset.State == "uploaded" &&
                asset.Name == name && asset.Url == url && asset.Size > 0);
            if (asset is not null) newest = new Update(version, url, asset.Size, asset.Digest);
        }
        return newest;
    }

    internal static bool IsInstalled()
    {
        using var registry = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
        using var uninstall = registry.OpenSubKey(UninstallKey);
        return uninstall?.GetValue("InstallLocation") is string installPath &&
            Path.GetFullPath(Path.Combine(installPath, "Aurral.exe"))
                .Equals(Application.ExecutablePath, StringComparison.OrdinalIgnoreCase);
    }

    internal static async Task InstallAsync(Update update, bool installed)
    {
        if (update.Digest is not { Length: 71 } digest || !digest.StartsWith("sha256:", StringComparison.Ordinal))
            throw new InvalidDataException("GitHub did not provide a checksum for this installer.");
        var expectedHash = Convert.FromHexString(digest[7..]);
        var directory = Directory.CreateTempSubdirectory("aurral-update-");
        var installer = Path.Combine(directory.FullName, $"Aurral-Setup-{update.Version}-win-x64.exe");
        try
        {
            await DownloadAsync(update, installer, expectedHash);
            var start = new ProcessStartInfo(installer) { UseShellExecute = true, WorkingDirectory = directory.FullName };
            if (installed) start.Arguments = "/SILENT /SP- /NORESTART /CLOSEAPPLICATIONS /AurralUpdate=1";
            using var process = Process.Start(start) ?? throw new InvalidOperationException("Setup could not start.");
            await process.WaitForExitAsync();
            if (process.ExitCode != 0) throw new InvalidOperationException($"Setup exited with code {process.ExitCode}.");
        }
        catch (Win32Exception exception) when (exception.NativeErrorCode == 1223)
        {
            throw new OperationCanceledException("Administrator approval was canceled.", exception);
        }
        finally
        {
            try { directory.Delete(recursive: true); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    private static async Task DownloadAsync(Update update, string installer, byte[] expectedHash)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(15));
        using var response = await Client.GetAsync(update.Url, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        response.EnsureSuccessStatusCode();
        await using var input = await response.Content.ReadAsStreamAsync(timeout.Token);
        await using var output = new FileStream(installer, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, true);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[65536];
        long size = 0;
        int read;
        while ((read = await input.ReadAsync(buffer, timeout.Token)) != 0)
        {
            size += read;
            if (size > update.Size) throw new InvalidDataException("The installer is larger than expected.");
            hash.AppendData(buffer, 0, read);
            await output.WriteAsync(buffer.AsMemory(0, read), timeout.Token);
        }

        if (size != update.Size || !CryptographicOperations.FixedTimeEquals(expectedHash, hash.GetHashAndReset()))
            throw new InvalidDataException("The installer download failed its checksum check.");
    }

    private sealed record Release(
        [property: JsonPropertyName("tag_name")] string Tag,
        [property: JsonPropertyName("draft")] bool Draft,
        [property: JsonPropertyName("prerelease")] bool Prerelease,
        [property: JsonPropertyName("assets")] Asset[] Assets);

    private sealed record Asset(
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("state")] string State,
        [property: JsonPropertyName("size")] long Size,
        [property: JsonPropertyName("browser_download_url")] string Url,
        [property: JsonPropertyName("digest")] string? Digest);
}
