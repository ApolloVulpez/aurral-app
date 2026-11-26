const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Variant, interface: { ACCESS_READ, Interface, method, property }, sessionBus } = require("@jellybrick/dbus-next");

const objectPath = "/org/mpris/MediaPlayer2";
const servicePrefix = "org.mpris.MediaPlayer2";
const maxArtworkBytes = 10 * 1024 * 1024;
const artworkTypes = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

// Desktop shells load mpris:artUrl themselves and lack the page's sign-in, so
// cache the cover with the app's session and hand them a local file instead.
class ArtworkCache {
  constructor(directory, fetchImage, changed) {
    this.directory = directory;
    this.fetchImage = fetchImage;
    this.changed = changed;
  }

  source;
  url = "";
  generation = 0;

  request(source) {
    if (typeof source !== "string" || !/^https?:\/\//i.test(source)) source = undefined;
    if (source === this.source) return this.url;
    this.source = source;
    this.url = "";
    const generation = ++this.generation;
    if (source) {
      void this.load(source, generation).then(url => {
        if (url && generation === this.generation) {
          this.url = url;
          this.changed();
        }
      }).catch(() => {});
    }
    return "";
  }

  async load(source, generation) {
    const response = await this.fetchImage(source);
    if (!response.ok) return "";
    const extension = artworkTypes[response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()];
    if (!extension || Number(response.headers.get("content-length")) > maxArtworkBytes) return "";
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length || data.length > maxArtworkBytes || generation !== this.generation) return "";

    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const name = `${createHash("sha256").update(source).digest("hex").slice(0, 32)}.${extension}`;
    const file = path.join(this.directory, name);
    await fs.writeFile(`${file}.tmp`, data, { mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
    if (generation !== this.generation) {
      await fs.rm(file, { force: true });
      return "";
    }
    // Keep only the current cover.
    for (const entry of await fs.readdir(this.directory)) {
      if (entry !== name) await fs.rm(path.join(this.directory, entry), { force: true });
    }
    return pathToFileURL(file).href;
  }
}

function exportMembers(instance, properties, methods) {
  for (const [name, signature] of Object.entries(properties)) {
    property({ signature, access: ACCESS_READ })(instance, name);
  }
  const prototype = Object.getPrototypeOf(instance);
  for (const [name, inSignature] of Object.entries(methods)) {
    method({ inSignature })(instance, name, Object.getOwnPropertyDescriptor(prototype, name));
  }
}

class MediaPlayer extends Interface {
  constructor(desktopEntry, showWindow) {
    super(servicePrefix);
    this.DesktopEntry = desktopEntry;
    this.showWindow = showWindow;
    exportMembers(this, {
      CanQuit: "b", CanRaise: "b", HasTrackList: "b", Identity: "s",
      DesktopEntry: "s", SupportedUriSchemes: "as", SupportedMimeTypes: "as",
    }, { Raise: "", Quit: "" });
  }

  CanQuit = false;
  CanRaise = true;
  HasTrackList = false;
  Identity = "Aurral Desktop";
  SupportedUriSchemes = [];
  SupportedMimeTypes = [];

  Raise() { this.showWindow(); }
  Quit() {}
}

class Player extends Interface {
  constructor(playback) {
    super(`${servicePrefix}.Player`);
    this.playback = playback;
    exportMembers(this, {
      CanControl: "b", CanSeek: "b", MinimumRate: "d", MaximumRate: "d", Rate: "d", Volume: "d", Position: "x",
      PlaybackStatus: "s", CanGoPrevious: "b", CanGoNext: "b", CanPlay: "b", CanPause: "b", Metadata: "a{sv}",
    }, {
      Next: "", Previous: "", PlayPause: "", Play: "", Pause: "", Stop: "", Seek: "x", SetPosition: "ox", OpenUri: "s",
    });
  }

  CanControl = true;
  CanSeek = false;
  MinimumRate = 1;
  MaximumRate = 1;
  Rate = 1;
  Volume = 1;
  Position = 0n;
  PlaybackStatus = "Stopped";
  CanGoPrevious = false;
  CanGoNext = false;
  CanPlay = false;
  CanPause = false;
  Metadata = {};
  trackKey = "";
  artUrl = "";

  Next() { if (this.CanGoNext) void this.playback("nexttrack"); }
  Previous() { if (this.CanGoPrevious) void this.playback("previoustrack"); }
  PlayPause() { if (this.CanPlay || this.CanPause) void this.playback("toggle"); }
  Play() { if (this.CanPlay) void this.playback("play"); }
  Pause() { if (this.CanPause) void this.playback("pause"); }
  Stop() { void this.playback("stop"); }
  Seek() {}
  SetPosition() {}
  OpenUri() {}

  setState(state, artUrl = "") {
    const properties = {
      PlaybackStatus: state.playing ? "Playing" : "Paused",
      CanGoPrevious: state.canPrevious === true,
      CanGoNext: state.canNext === true,
      CanPlay: state.canPlay === true,
      CanPause: state.canPause === true,
    };
    const changes = {};
    for (const [key, value] of Object.entries(properties)) {
      if (this[key] !== value) changes[key] = this[key] = value;
    }

    const [title, artist, album] = [state.track?.title, state.track?.artist, state.track?.album]
      .map(value => typeof value === "string" ? value.replaceAll("\0", "") : "");
    const trackKey = JSON.stringify([title, artist, album]);
    if (trackKey !== this.trackKey || artUrl !== this.artUrl) {
      this.trackKey = trackKey;
      this.artUrl = artUrl;
      const id = createHash("sha256").update(trackKey).digest("hex");
      changes.Metadata = this.Metadata = {
        "mpris:trackid": new Variant("o", `${objectPath}/Track/${id}`),
        "xesam:title": new Variant("s", title),
        "xesam:artist": new Variant("as", artist ? [artist] : []),
        "xesam:album": new Variant("s", album),
      };
      if (artUrl) this.Metadata["mpris:artUrl"] = new Variant("s", artUrl);
    }

    if (Object.keys(changes).length) Interface.emitPropertiesChanged(this, changes);
  }
}

class LinuxMediaControls {
  constructor(desktopName, playback, showWindow, artwork) {
    const desktopEntry = desktopName.replace(/\.desktop$/, "");
    this.name = `${servicePrefix}.${desktopEntry}`;
    this.mediaPlayer = new MediaPlayer(desktopEntry, showWindow);
    this.player = new Player(playback);
    if (artwork) {
      this.artwork = new ArtworkCache(artwork.directory, artwork.fetch, () => {
        if (this.state) this.player.setState(this.state, this.artwork.url);
      });
    }
  }

  bus = null;
  retryAfter = 0;
  state = null;

  update(state) {
    if (!state || !(state.canToggle || state.canNext || state.canPrevious)) {
      this.state = null;
      this.disconnect();
      return;
    }
    this.state = state;
    this.player.setState(state, this.artwork?.request(state.track?.artwork) ?? "");
    if (this.bus || Date.now() < this.retryAfter) return;

    const retry = () => {
      this.disconnect();
      this.retryAfter = Date.now() + 10_000;
    };
    try {
      const bus = this.bus = sessionBus();
      bus.on("error", () => { if (this.bus === bus) retry(); });
      bus.export(objectPath, this.mediaPlayer);
      bus.export(objectPath, this.player);
      // Do not queue for the name if another installation of Aurral is using it.
      void bus.requestName(this.name, 4).then(reply => {
        if (this.bus === bus && reply !== 1) retry();
      }).catch(() => { if (this.bus === bus) retry(); });
    } catch {
      retry();
    }
  }

  disconnect() {
    const bus = this.bus;
    this.bus = null;
    if (bus) {
      bus.unexport(objectPath);
      bus.disconnect();
    }
  }
}

module.exports = { LinuxMediaControls };
