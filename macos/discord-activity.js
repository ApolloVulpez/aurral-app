((serverUrl, sharePlayback) => {
  const server = new URL(serverUrl);
  const origin = server.origin;
  if (server.protocol === "http:") server.protocol = "https:";
  if (location.origin !== origin && location.origin !== server.origin) return null;

  const track = window.__aurralTrayMedia?.("presence");
  if (!track?.title?.trim()) return null;
  const text = value => {
    const trimmed = value?.trim().slice(0, 128);
    return trimmed?.length === 1 ? `${trimmed}\u200b` : trimmed || undefined;
  };
  const activity = { type: 2, status_display_type: 2, details: text(track.title), state: text(track.artist) };
  if (track.timestamps && track.timestamps.end > Date.now() / 1000) activity.timestamps = track.timestamps;

  const apiBase = `${server.pathname.replace(/\/+$/, "")}/api`;
  const apiRequest = (path, options = {}) => {
    const token = localStorage.getItem("auth_token") || sessionStorage.getItem("auth_token");
    return fetch(new URL(`${apiBase}/${path}`, location.origin), {
      credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), ...options,
      headers: { ...options.headers, ...(token && { Authorization: `Bearer ${token}` }) },
    });
  };
  const apiJson = async path => {
    try {
      const response = await apiRequest(path, { signal: AbortSignal.timeout(4_000) });
      return response.ok ? await response.json() : null;
    } catch { return null; }
  };
  const parseUrl = value => {
    try { return typeof value === "string" && value ? new URL(value, location.origin) : null; }
    catch { return null; }
  };
  const providerCover = value => {
    let image = parseUrl(value);
    if (image?.origin === location.origin && image.pathname === `${apiBase}/image-proxy`) {
      image = parseUrl(image.searchParams.get("src"));
    }
    if (!image || image.protocol !== "https:" || image.username || image.password || image.port ||
        image.search || image.hash || image.href.length > 256) return null;
    const hosts = ["coverartarchive.org", "i.scdn.co", "cdn-images.dzcdn.net", "e-cdns-images.dzcdn.net", "lastfm.freetls.fastly.net"];
    return hosts.includes(image.hostname) || /^is\d+(?:-ssl)?\.mzstatic\.com$/.test(image.hostname) ||
      (/(^|\.)archive\.org$/.test(image.hostname) && /^\/download\/mbid-[a-f0-9-]{36}\//i.test(image.pathname))
      ? image.href : null;
  };

  const image = parseUrl(track.artwork);
  const imagePath = image?.origin === location.origin && image.pathname.startsWith(`${apiBase}/`)
    ? image.pathname.slice(apiBase.length) : "";
  const albumCover = /^\/library\/(?:albums\/([1-9]\d*)\/cover|artwork\/album\/([1-9]\d*))$/i.exec(imagePath);
  const releaseCover = /^\/artists\/release-group\/([a-f0-9-]{36})\/cover\/image$/i.exec(imagePath);
  const artworkRoute = albumCover || releaseCover || /^\/(?:image-proxy\/[a-f0-9]{64}(?:\.[a-z0-9]+)?|library\/artwork\/track\/[^/]+)$/i.test(imagePath);
  const publicServerCover = async () => {
    if (!artworkRoute || image.protocol !== "https:" || image.port ||
        !/\.[a-z][a-z0-9-]*$/i.test(image.hostname) ||
        /\.(?:local|localhost|lan|internal|home|test|example|invalid|onion|arpa)$/i.test(image.hostname)) return null;
    const anonymous = new URL(image.pathname, image.origin);
    const version = image.searchParams.get("v");
    if (/^[\w.-]{1,64}$/.test(version ?? "")) anonymous.searchParams.set("v", version);
    if (anonymous.href.length > 256) return null;
    try {
      const response = await fetch(anonymous, { credentials: "omit", redirect: "error", cache: "no-store",
        signal: AbortSignal.timeout(3_000) });
      const isImage = response.ok && response.headers.get("content-type")?.startsWith("image/") &&
        /(?:^|,)\s*public\b/i.test(response.headers.get("cache-control") ?? "");
      void response.body?.cancel().catch(() => {});
      return isImage ? anonymous.href : null;
    } catch { return null; }
  };

  const catalogCover = async () => {
    const normalize = value => typeof value === "string" ? value.trim().normalize("NFC").toLowerCase() : "";
    const trackMatches = candidate => candidate?.title === track.title && candidate?.artist === track.artist && candidate?.album === track.album;
    let queueTrack;
    try {
      const queue = JSON.parse(localStorage.getItem("aurral.player.queue.v1"));
      const candidate = queue?.tracks?.[queue.playbackOrder?.[queue.currentIndex]];
      if (trackMatches(candidate)) queueTrack = candidate;
    } catch {}
    const albumId = albumCover?.[1] || albumCover?.[2] || queueTrack?.libraryAlbumId;
    const album = /^[1-9]\d*$/.test(albumId ?? "") ? await apiJson(`library/albums/${albumId}`) : null;
    const albumTitle = album?.albumName || track.album;
    const artistName = album?.artistName || track.artist;
    const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
    let mbid = [releaseCover?.[1], album?.releaseGroupMbid, album?.mbid, album?.foreignAlbumId, queueTrack?.albumMbid]
      .find(value => uuid.test(value ?? ""));
    if (!mbid && normalize(albumTitle) && normalize(artistName)) {
      const query = new URLSearchParams({ scope: "album", q: albumTitle, limit: "12" });
      const search = await apiJson(`search?${query}`);
      const matches = search?.items?.filter(item => normalize(item.title) === normalize(albumTitle) &&
        normalize(item.artistName) === normalize(artistName));
      const match = matches?.find(item => item.inLibrary) ?? matches?.[0];
      const cover = providerCover(match?.coverUrl);
      if (cover) return cover;
      if (uuid.test(match?.id ?? "")) mbid = match.id;
    }
    if (!mbid) return null;
    const query = new URLSearchParams({ albumTitle: albumTitle ?? "", artistName: artistName ?? "" });
    const result = await apiJson(`artists/release-group/${mbid}/cover?${query}`);
    return providerCover(result?.images?.find(item => item.front)?.image ?? result?.images?.[0]?.image);
  };

  let cover = providerCover(track.artwork);
  let coverSearch;
  if (!cover) {
    const artwork = window.__aurralDiscordArtwork ??= new Map();
    const key = JSON.stringify([image?.origin, image?.pathname, image?.searchParams.get("v"), track.album, track.artist]);
    let entry = artwork.get(key);
    if (!entry || entry.retryAfter <= Date.now()) {
      if (artwork.size >= 100) artwork.delete(artwork.keys().next().value);
      entry = { retryAfter: Date.now() + 5 * 60_000 };
      artwork.set(key, entry);
      void (async () => {
        entry.url = await publicServerCover() ?? await catalogCover();
        if (entry.url) entry.retryAfter = Infinity;
      })().catch(() => {}).finally(() => { entry.finished = true; });
    }
    cover = entry.url;
    if (!cover && entry.finished && track.artist?.trim()) {
      coverSearch = { title: track.title.trim(), artist: track.artist.trim(), album: track.album?.trim() };
    }
  }
  if (cover) activity.assets = { large_image: cover, large_text: text(track.album) };
  const result = { activity, coverSearch };

  if (!sharePlayback || !track.artist?.trim()) return result;
  const trackTitle = track.title.trim();
  const artistName = track.artist.trim();
  const albumTitle = track.album?.trim() || undefined;
  const key = JSON.stringify([trackTitle, artistName, albumTitle]);
  const links = window.__aurralDiscordListenLinks ??= new Map();
  const cached = links.get(key);
  if (cached && cached.until > Date.now()) {
    if (cached.url) activity.buttons = [{ label: "Listen On Aurral", url: cached.url }];
    return result;
  }

  if (links.size >= 100) links.delete(links.keys().next().value);
  // Publish at most once per track while the request is in flight. Unsupported servers retry later.
  const entry = { until: Date.now() + 60_000 };
  links.set(key, entry);
  void (async () => {
    const metadata = { title: trackTitle, artistName, albumTitle };
    const response = await apiRequest("share-links", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "track", ...metadata, shareFiles: true, allowDownload: false, expiresIn: "1d",
        manifest: { kind: "track", ...metadata, tracks: [metadata] },
      }),
    });
    if (!response.ok) return;
    const { link } = await response.json();
    if (link?.shareFiles !== true || !Number.isFinite(link.expiresAt) || link.expiresAt <= Date.now() ||
        !/^https:\/\/aurral\.org\/s\/s[A-Za-z0-9_-]{15}$/.test(link.url)) return;
    entry.url = link.url;
    entry.until = link.expiresAt;
  })().catch(() => {});
  return result;
})
