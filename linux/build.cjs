const { Arch, build, Platform } = require("electron-builder");
const fs = require("node:fs/promises");
const path = require("node:path");

async function buildLinux() {
  const flatpak = process.argv.includes("--flatpak");
  const root = path.resolve(__dirname, "..");
  const shared = path.join(root, "macos");
  const staging = path.join(root, "obj", flatpak ? "flatpak-source" : "linux-source");
  const output = flatpak ? path.join(root, "obj", "flatpak-electron") : path.join(root, "dist", "linux");
  const { version, dependencies } = require("./package.json");
  const electronVersion = require("../macos/package.json").devDependencies.electron;

  await fs.mkdir(staging, { recursive: true });
  for (const file of [
    "main.cjs", "media-preload.cjs", "updates.cjs", "discord-presence.cjs", "discord-artwork.cjs", "discord-activity.js",
    "external-links.js",
    "setup-preload.cjs", "setup.js", "setup.css", "setup.html",
    "navigation-preload.cjs", "navigation.css", "navigation.html",
    "settings-preload.cjs", "settings.html",
  ]) {
    await fs.copyFile(path.join(shared, file), path.join(staging, file));
  }
  await fs.copyFile(path.join(__dirname, "media-controls.cjs"), path.join(staging, "media-controls.cjs"));
  await fs.cp(path.join(shared, "assets"), path.join(staging, "assets"), { recursive: true });
  await fs.copyFile(path.join(root, "LICENSE"), path.join(staging, "LICENSE"));
  await fs.writeFile(path.join(staging, "package.json"), JSON.stringify({
    name: "aurral-desktop",
    productName: "Aurral App",
    desktopName: "io.github.apollovulpez.aurral-desktop.desktop",
    version,
    dependencies,
    main: "main.cjs",
    description: "A desktop front end for your Aurral server.",
    homepage: "https://github.com/ApolloVulpez/aurral-desktop",
    author: "Aurral App Contributors",
    license: "MIT",
  }, null, 2));

  await build({
    targets: Platform.LINUX.createTarget(flatpak ? ["dir"] : ["deb", "AppImage"], Arch.x64),
    publish: "never",
    config: {
      appId: "io.github.apollovulpez.aurral-desktop",
      productName: "Aurral App",
      electronVersion,
      directories: { app: staging, output, buildResources: path.join(shared, "assets") },
      files: ["*.cjs", "*.js", "*.css", "*.html", "assets/**", "LICENSE", "package.json"],
      asar: true,
      afterPack: async ({ appOutDir }) => {
        if (flatpak) return;
        // Supply the AppImage entry point without adding Chromium launch flags.
        const appRun = path.join(appOutDir, "AppRun");
        // A CRLF checkout breaks the shebang ("bash\r"), so always write LF.
        const script = await fs.readFile(path.join(__dirname, "AppRun"), "utf8");
        await fs.writeFile(appRun, script.replace(/\r\n?/g, "\n"));
        await fs.chmod(appRun, 0o755);
      },
      linux: {
        executableName: "aurral-desktop",
        syncDesktopName: true,
        category: "AudioVideo",
        icon: path.join(__dirname, "icons"),
        maintainer: "Aurral App Contributors",
        artifactName: "Aurral-Desktop-${version}-linux-${arch}.${ext}",
        desktop: {
          entry: {
            Name: "Aurral App",
            Comment: "Connect to your Aurral music server",
            Categories: "AudioVideo;Audio;Player;",
          },
        },
      },
      deb: {
        // The package was named aurral-app before the rename and installs the same files.
        fpm: ["--conflicts", "aurral-app", "--replaces", "aurral-app"],
        desktop: {
          entry: { Actions: "PreviousTrack;PlayPause;NextTrack;" },
          desktopActions: {
            PreviousTrack: { Name: "Previous Track", Exec: '"/opt/Aurral App/aurral-desktop" --aurral-playback=previoustrack' },
            PlayPause: { Name: "Play/Pause", Exec: '"/opt/Aurral App/aurral-desktop" --aurral-playback=toggle' },
            NextTrack: { Name: "Next Track", Exec: '"/opt/Aurral App/aurral-desktop" --aurral-playback=nexttrack' },
          },
        },
      },
      toolsets: { appimage: "1.0.3" },
    },
  });
}

buildLinux().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
