# Aurral App for Linux

Download the x64 [Debian package](https://github.com/ApolloVulpez/aurral-app/releases/download/linux-v0.1.5/Aurral-App-0.1.5-linux-amd64.deb) or [AppImage](https://github.com/ApolloVulpez/aurral-app/releases/download/linux-v0.1.5/Aurral-App-0.1.5-linux-x86_64.AppImage) from the [Linux release](https://github.com/ApolloVulpez/aurral-app/releases/tag/linux-v0.1.5).

| Distribution | Package |
| --- | --- |
| Ubuntu, Debian, Linux Mint | `.deb` |
| Fedora | `.AppImage` |
| SteamOS, Bazzite | `.AppImage`, initially opened in Desktop Mode |

Use a current, supported release of your distribution.

## Install the Debian package

Install the package through your software installer, or run this command in the folder containing the download.

```sh
sudo apt install ./Aurral-App-0.1.5-linux-amd64.deb
```

Open **Aurral App** from your application menu.

## Run the AppImage

In the file's properties, allow it to run as a program, then open it. You can also run these commands in the download folder.

```sh
chmod +x Aurral-App-0.1.5-linux-x86_64.AppImage
./Aurral-App-0.1.5-linux-x86_64.AppImage
```

The AppImage uses a runtime that avoids a dependency on FUSE 2. On Ubuntu and Mint, the Debian package also supplies the desktop integration needed by their application security settings.

On Bazzite, Gear Lever can add an AppImage to the application menu. On SteamOS, start in Desktop Mode. You can add the AppImage to Steam as a non-Steam application if you want to launch it from Gaming Mode.

## Connect and use Aurral

Enter your Aurral server URL, then sign in. Aurral App remembers the URL and session.

Press **Ctrl + ,** to change servers, or tap **Alt** and open **Settings**. The tray menu has **Show Aurral**, **Stop / Play**, **Previous**, **Next**, and **Quit**.

Closing the window keeps playback running. Turn off **Settings → Minimize to Tray** if you want closing the window to quit. Desktop environments control whether a tray icon appears. If it is hidden, launching Aurral App again restores the existing window. For Steam Gaming Mode, turn off **Minimize to Tray** while in Desktop Mode.

Aurral App displays your server's web interface. Report server and web interface issues to the [main Aurral project](https://github.com/lklynet/aurral/issues). Report Linux packaging, tray, and other desktop issues to the [Aurral App tracker](https://github.com/ApolloVulpez/aurral-app/issues).

## Build locally

Install Node.js 24 on Linux, then run these commands from the repository root.

```sh
cd linux
npm ci
npm run build
```

The build creates both packages in `dist/linux`.
