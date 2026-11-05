function installMediaBridge(serverUrl) {
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
    const playing = session.playbackState === "playing";
    const toggle = playing ? "pause" : "play";
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
