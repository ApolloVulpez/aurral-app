const { createHash } = require("node:crypto");
const { Variant, interface: { ACCESS_READ, Interface, method, property }, sessionBus } = require("@jellybrick/dbus-next");

const objectPath = "/org/mpris/MediaPlayer2";
const servicePrefix = "org.mpris.MediaPlayer2";

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
  Identity = "Aurral App";
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

  Next() { if (this.CanGoNext) void this.playback("nexttrack"); }
  Previous() { if (this.CanGoPrevious) void this.playback("previoustrack"); }
  PlayPause() { if (this.CanPlay || this.CanPause) void this.playback("toggle"); }
  Play() { if (this.CanPlay) void this.playback("play"); }
  Pause() { if (this.CanPause) void this.playback("pause"); }
  Stop() { void this.playback("stop"); }
  Seek() {}
  SetPosition() {}
  OpenUri() {}

  setState(state) {
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
    if (trackKey !== this.trackKey) {
      this.trackKey = trackKey;
      const id = createHash("sha256").update(trackKey).digest("hex");
      changes.Metadata = this.Metadata = {
        "mpris:trackid": new Variant("o", `${objectPath}/Track/${id}`),
        "xesam:title": new Variant("s", title),
        "xesam:artist": new Variant("as", artist ? [artist] : []),
        "xesam:album": new Variant("s", album),
      };
    }

    if (Object.keys(changes).length) Interface.emitPropertiesChanged(this, changes);
  }
}

class LinuxMediaControls {
  constructor(desktopName, playback, showWindow) {
    const desktopEntry = desktopName.replace(/\.desktop$/, "");
    this.name = `${servicePrefix}.${desktopEntry}`;
    this.mediaPlayer = new MediaPlayer(desktopEntry, showWindow);
    this.player = new Player(playback);
  }

  bus = null;
  retryAfter = 0;

  update(state) {
    if (!state || !(state.canToggle || state.canNext || state.canPrevious)) {
      this.disconnect();
      return;
    }
    this.player.setState(state);
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
