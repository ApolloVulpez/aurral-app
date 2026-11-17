(serverUrl => {
  if (!serverUrl || window !== window.top) return;
  const server = new URL(serverUrl);
  const origin = server.origin;
  if (server.protocol === "http:") server.protocol = "https:";
  if (location.origin !== origin && location.origin !== server.origin) return;

  // Route ordinary links through the same new-window handler as target=_blank links.
  // Script and form navigations can carry sign-in or other in-app state.
  window.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.altKey) return;
    const link = event.composedPath().find(node => node instanceof HTMLAnchorElement);
    if (!link?.hasAttribute("href") || link.hasAttribute("download")) return;
    const url = URL.parse(link.href);
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || url.origin === location.origin) return;

    event.preventDefault();
    window.open(url.href, "_blank", "noopener,noreferrer");
  });
})
