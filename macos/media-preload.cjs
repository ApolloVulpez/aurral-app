const { contextBridge } = require("electron");

function installMediaBridge(serverUrl) {
  if (window !== window.top || !navigator.mediaSession) return;

  const server = new URL(serverUrl);
  const origin = server.origin;
  if (server.protocol === "http:") server.protocol = "https:";
  if (location.origin !== origin && location.origin !== server.origin) return;

  const session = navigator.mediaSession;
  const setActionHandler = session.setActionHandler.bind(session);
  const setPositionState = session.setPositionState.bind(session);
  const handlers = new Map();
  let timing;
  session.setPositionState = position => {
    setPositionState(position);
    timing = null;
    if (position?.duration > 0 && position.playbackRate > 0) {
      const start = Date.now() / 1000 - position.position / position.playbackRate;
      timing = { metadata: session.metadata, start: Math.round(start),
        end: Math.round(start + position.duration / position.playbackRate) };
    }
  };
  session.setActionHandler = (action, handler) => {
    setActionHandler(action, handler);
    if (handler) handlers.set(action, handler);
    else handlers.delete(action);
  };

  // The largest web artwork, so desktop media controls can show the cover.
  const coverArt = artwork => {
    let best;
    let bestSize = -1;
    for (const image of artwork ?? []) {
      let url;
      try { url = new URL(image.src, location.href); } catch { continue; }
      if (!["http:", "https:"].includes(url.protocol) || url.href.length > 4096) continue;
      const size = Math.max(0, ...String(image.sizes ?? "").split(/\s+/)
        .map(value => /^(\d+)x(\d+)$/i.exec(value)).filter(Boolean).map(match => match[1] * match[2]));
      if (size >= bestSize) [best, bestSize] = [url.href, size];
    }
    return best;
  };

  window.__aurralTrayMedia = command => {
    const playing = session.playbackState === "playing";
    const toggle = playing ? "pause" : "play";
    if (command === "presence") {
      const metadata = session.metadata;
      if (!playing || !metadata) return null;
      return { title: metadata.title, artist: metadata.artist, album: metadata.album,
        artwork: metadata.artwork[0]?.src,
        timestamps: timing?.metadata === metadata ? { start: timing.start, end: timing.end } : null };
    }
    if (command === "state") {
      const track = session.metadata;
      return {
        playing,
        canToggle: handlers.has(toggle),
        canPrevious: handlers.has("previoustrack"),
        canNext: handlers.has("nexttrack"),
        canPlay: handlers.has("play"),
        canPause: handlers.has("pause"),
        track: track ? { title: track.title, artist: track.artist, album: track.album, artwork: coverArt(track.artwork) } : null,
      };
    }

    const action = command === "toggle" ? toggle : command;
    handlers.get(action)?.({ action });
    return null;
  };
}
const serverArgument = "--aurral-server=";
const configuredServer = process.argv.find(arg => arg.startsWith(serverArgument));
if (configuredServer) {
  contextBridge.executeInMainWorld({
    func: installMediaBridge,
    args: [configuredServer.slice(serverArgument.length)],
  });
}
