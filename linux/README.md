# Aurral App for Linux

Download the x64 [Debian package](https://github.com/ApolloVulpez/aurral-app/releases/download/linux-v0.1.9/Aurral-App-0.1.9-linux-amd64.deb), [AppImage](https://github.com/ApolloVulpez/aurral-app/releases/download/linux-v0.1.9/Aurral-App-0.1.9-linux-x86_64.AppImage), or [Flatpak bundle](https://github.com/ApolloVulpez/aurral-app/releases/download/linux-v0.1.9/Aurral-App-0.1.9-linux-x86_64.flatpak) from the [Linux release](https://github.com/ApolloVulpez/aurral-app/releases/tag/linux-v0.1.9).

| Distribution | Package |
| --- | --- |
| Ubuntu, Debian, Linux Mint | `.deb` |
| Fedora | `.flatpak` or `.AppImage` |
| Other distributions with Flatpak | `.flatpak` |

Use a current, supported release of your distribution.

## Install the Debian package

Install the package through your software installer, or run this command in the folder containing the download.

```sh
sudo apt install ./Aurral-App-0.1.9-linux-amd64.deb
```

Open **Aurral App** from your application menu.

## Run the AppImage

In the file's properties, allow it to run as a program, then open it. You can also run these commands in the download folder.

```sh
chmod +x Aurral-App-0.1.9-linux-x86_64.AppImage
./Aurral-App-0.1.9-linux-x86_64.AppImage
```

The AppImage uses a runtime that avoids a dependency on FUSE 2. On Ubuntu and Mint, the Debian package also supplies the desktop integration needed by their application security settings.

Gear Lever can add an AppImage to your application menu.

## Install the Flatpak bundle

With Flatpak installed, run this command from the download folder.

```sh
flatpak install --user --bundle ./Aurral-App-0.1.9-linux-x86_64.flatpak
```

If you installed Aurral from a bundle downloaded before the update feed moved, download the current bundle again. Remove the old installation and install the new bundle using the same scope. These commands keep your server settings and sign-in.

```sh
flatpak uninstall --user io.github.apollovulpez.aurral-app
flatpak install --user --bundle ./Aurral-App-0.1.9-linux-x86_64.flatpak
```

For a system-wide installation, use `--system` in both commands.

The first install may download the Freedesktop runtime from Flathub. Open **Aurral App** from your application menu. Click the title-bar update button when it lights up. Flatpak installs the update and Aurral prompts you to reopen it.

## Connect and use Aurral

Enter your Aurral server URL, then sign in. Aurral App remembers the URL and session.

Open the **Settings** menu beside the title-bar update button to change servers. You can also open it with **Ctrl + ,** or by tapping **Alt**. The tray menu has **Show Aurral**, **Stop / Play**, **Previous**, **Next**, and **Quit**.

During playback, KDE Plasma can show **Previous**, **Play/Pause**, and **Next** in the taskbar preview. Other desktops may show the controls in their system media panel. The Debian and Flatpak packages also add those three actions to the Aurral launcher’s right-click menu.

Closing the window keeps playback running. Turn off **Settings → Minimize to Tray** if you want closing the window to quit. Desktop environments control whether a tray icon appears. If it is hidden, launching Aurral App again restores the existing window.

Aurral App displays your server's web interface. Report server and web interface issues to the [main Aurral project](https://github.com/lklynet/aurral/issues). Report Linux packaging, tray, and other desktop issues to the [Aurral App tracker](https://github.com/ApolloVulpez/aurral-app/issues).

## Build locally

Install Node.js 24 on Linux, then run these commands from the repository root.

```sh
cd linux
npm ci
npm run build
```

The build creates both packages in `dist/linux`.

To build the Flatpak, install Flatpak and GnuPG and add Flathub as a remote. Set `AURRAL_FLATPAK_REPO` to the working directory for the signed repository. Set `AURRAL_FLATPAK_GPG_HOME` and `AURRAL_FLATPAK_GPG_KEY` to the directory and fingerprint for its signing key. On x86-64 Linux, run these commands from the `linux` directory after `npm ci`.

```sh
flatpak install --user flathub org.freedesktop.Platform//25.08 org.freedesktop.Sdk//25.08 org.electronjs.Electron2.BaseApp//25.08
npm run build:flatpak
```

The bundle is written to `dist/linux`. Publish the signed repository to `flatpak-stable-feed` before publishing the matching GitHub release assets.
