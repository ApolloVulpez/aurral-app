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
      return {
        playing,
        canToggle: handlers.has(toggle),
        canPrevious: handlers.has("previoustrack"),
        canNext: handlers.has("nexttrack"),
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
