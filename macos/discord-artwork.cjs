const albumName = value => value?.trim().normalize("NFC").toLowerCase().replace(/\s+-\s+(?:single|ep)$/, "") ?? "";
const normalize = value => value?.trim().normalize("NFC").toLowerCase() ?? "";

function sameArtist(credit, artist) {
  const name = normalize(artist);
  const value = normalize(credit);
  return name && (value === name || [" feat. ", " ft. ", " featuring ", ", ", " & "].some(separator => value.startsWith(name + separator)));
}

function coverUrl(album) {
  const url = album?.cover_big;
  return typeof url === "string" && url.length <= 256 &&
    /^https:\/\/(?:cdn-images|e-cdns-images)\.dzcdn\.net\/images\/cover\/[a-f0-9]+\/[\w.-]+$/i.test(url)
    ? url : undefined;
}

async function search(type, query) {
  const url = new URL(`https://api.deezer.com/search/${type}`);
  url.search = new URLSearchParams({ q: query, limit: "20" });
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(4_000) });
    const result = response.ok ? await response.json() : null;
    return Array.isArray(result?.data) ? result.data : [];
  } catch { return []; }
}

async function findCover({ title, artist, album }) {
  const wantedAlbum = albumName(album);
  const matchesAlbum = value => albumName(value) === wantedAlbum;
  const tracks = await search("track", `${artist} ${title}`);
  const matchingTrack = tracks.find(track => normalize(track.title) === normalize(title) &&
    sameArtist(artist, track.artist?.name) && (!wantedAlbum || matchesAlbum(track.album?.title)) && coverUrl(track.album));
  if (matchingTrack) return coverUrl(matchingTrack.album);
  if (!wantedAlbum) return undefined;

  const albums = await search("album", `${artist} ${album}`);
  const matchingAlbum = albums.find(item => sameArtist(artist, item.artist?.name) && matchesAlbum(item.title) && coverUrl(item));
  return coverUrl(matchingAlbum);
}

class DiscordArtwork {
  #covers = new Map();

  get(track) {
    const key = JSON.stringify([track.artist, track.album, track.title]);
    const cached = this.#covers.get(key);
    if (cached && cached.retryAfter > Date.now()) return cached.url;
    if (this.#covers.size >= 100) this.#covers.delete(this.#covers.keys().next().value);

    const entry = { retryAfter: Date.now() + 5 * 60_000 };
    this.#covers.set(key, entry);
    void findCover(track).then(url => {
      entry.url = url;
      if (url) entry.retryAfter = Infinity;
    }).catch(() => {});
    return undefined;
  }
}

module.exports = { DiscordArtwork };
