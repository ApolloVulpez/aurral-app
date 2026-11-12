const { Arch, build, Platform } = require("electron-builder");
const fs = require("node:fs/promises");
const path = require("node:path");

async function buildLinux() {
  const root = path.resolve(__dirname, "..");
  const shared = path.join(root, "macos");
  const staging = path.join(root, "obj", "linux-source");
  const output = path.join(root, "dist", "linux");
  const version = require("./package.json").version;
  const electronVersion = require("../macos/package.json").devDependencies.electron;

  await fs.mkdir(staging, { recursive: true });
  for (const file of [
    "main.cjs", "media-preload.cjs", "updates.cjs", "discord-presence.cjs", "discord-artwork.cjs", "discord-activity.js",
    "setup-preload.cjs", "setup.js", "setup.css", "setup.html",
    "navigation-preload.cjs", "navigation.css", "navigation.html",
  ]) {
    await fs.copyFile(path.join(shared, file), path.join(staging, file));
  }
  await fs.cp(path.join(shared, "assets"), path.join(staging, "assets"), { recursive: true });
  await fs.copyFile(path.join(root, "LICENSE"), path.join(staging, "LICENSE"));
  await fs.writeFile(path.join(staging, "package.json"), JSON.stringify({
    name: "aurral-app",
    productName: "Aurral App",
    desktopName: "io.github.apollovulpez.aurral-app.desktop",
    version,
    main: "main.cjs",
    description: "A desktop front end for your Aurral server.",
    homepage: "https://github.com/ApolloVulpez/aurral-app",
    author: "Aurral App Contributors",
    license: "MIT",
  }, null, 2));

  await build({
    targets: Platform.LINUX.createTarget(["deb", "AppImage"], Arch.x64),
    publish: "never",
    config: {
      appId: "io.github.apollovulpez.aurral-app",
      productName: "Aurral App",
      electronVersion,
      directories: { app: staging, output, buildResources: path.join(shared, "assets") },
      files: ["*.cjs", "*.js", "*.css", "*.html", "assets/**", "LICENSE", "package.json"],
      asar: true,
      afterPack: async ({ appOutDir }) => {
        // Supply the AppImage entry point without adding Chromium launch flags.
        const appRun = path.join(appOutDir, "AppRun");
        await fs.copyFile(path.join(__dirname, "AppRun"), appRun);
        await fs.chmod(appRun, 0o755);
      },
      linux: {
        executableName: "aurral-app",
        syncDesktopName: true,
        category: "AudioVideo",
        icon: path.join(__dirname, "icons"),
        maintainer: "Aurral App Contributors",
        artifactName: "Aurral-App-${version}-linux-${arch}.${ext}",
        desktop: {
          entry: {
            Name: "Aurral App",
            Comment: "Connect to your Aurral music server",
            Categories: "AudioVideo;Audio;Player;",
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
