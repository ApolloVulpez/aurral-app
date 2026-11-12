using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Aurral.App;

internal sealed record DiscordCoverSearch(string Title, string Artist, string? Album);

internal sealed record DiscordPlayback(JsonObject Activity, DiscordCoverSearch? CoverSearch);

internal sealed class DiscordArtwork
{
    private static readonly HttpClient Client = new(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false })
        { BaseAddress = new Uri("https://api.deezer.com/"), Timeout = TimeSpan.FromSeconds(4) };
    private static readonly string[] ArtistSeparators = [" feat. ", " ft. ", " featuring ", ", ", " & "];
    private readonly Dictionary<DiscordCoverSearch, CoverEntry> covers = new();

    internal string? Get(DiscordCoverSearch track)
    {
        if (covers.TryGetValue(track, out var cached) && cached.RetryAfter > DateTime.UtcNow) return cached.Url;
        if (covers.Count >= 100) covers.Remove(covers.Keys.First());

        var entry = new CoverEntry();
        covers[track] = entry;
        _ = FindCoverAsync(track, entry);
        return null;
    }

    private static async Task FindCoverAsync(DiscordCoverSearch track, CoverEntry entry)
    {
        var wantedAlbum = AlbumName(track.Album);
        var tracks = await SearchAsync("track", $"{track.Artist} {track.Title}");
        var match = tracks.FirstOrDefault(item => Normalize(item.Title) == Normalize(track.Title) &&
            SameArtist(track.Artist, item.Artist?.Name) && (wantedAlbum.Length == 0 || AlbumName(item.Album?.Title) == wantedAlbum) &&
            IsCover(item.Album?.Cover));
        var url = match?.Album?.Cover;
        if (url is null && wantedAlbum.Length != 0)
        {
            var albums = await SearchAsync("album", $"{track.Artist} {track.Album}");
            url = albums.FirstOrDefault(item => SameArtist(track.Artist, item.Artist?.Name) &&
                AlbumName(item.Title) == wantedAlbum && IsCover(item.Cover))?.Cover;
        }
        if (url is null) return;
        entry.Url = url;
        entry.RetryAfter = DateTime.MaxValue;
    }

    private static async Task<CatalogItem[]> SearchAsync(string type, string query)
    {
        try
        {
            var result = await Client.GetFromJsonAsync<CatalogResponse>($"search/{type}?q={Uri.EscapeDataString(query)}&limit=20");
            return result?.Data ?? [];
        }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException or System.Text.Json.JsonException)
        {
            return [];
        }
    }

    private static string Normalize(string? value) => value?.Trim().Normalize().ToLowerInvariant() ?? "";

    private static string AlbumName(string? value) => Regex.Replace(Normalize(value), @"\s+-\s+(?:single|ep)$", "");

    private static bool SameArtist(string credit, string? artist)
    {
        var name = Normalize(artist);
        var value = Normalize(credit);
        return name.Length != 0 && (value == name || ArtistSeparators.Any(separator =>
            value.StartsWith(name + separator, StringComparison.Ordinal)));
    }

    private static bool IsCover(string? url) => url is { Length: <= 256 } && Regex.IsMatch(url,
        @"^https://(?:cdn-images|e-cdns-images)\.dzcdn\.net/images/cover/[a-f0-9]+/[\w.-]+$", RegexOptions.IgnoreCase);

    private sealed class CoverEntry
    {
        internal DateTime RetryAfter { get; set; } = DateTime.UtcNow.AddMinutes(5);
        internal string? Url { get; set; }
    }

    private sealed record CatalogResponse(CatalogItem[]? Data);
    private sealed record CatalogArtist(string? Name);
    private sealed record CatalogItem(string? Title, CatalogArtist? Artist, CatalogItem? Album,
        [property: JsonPropertyName("cover_big")] string? Cover);
}
