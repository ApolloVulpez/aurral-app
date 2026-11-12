<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme-dark.svg" />
    <img src="assets/readme-light.svg" width="690" alt="Aurral App" />
  </picture>
</div>

<p align="center">
  <a href="https://github.com/ApolloVulpez/aurral-app/releases/tag/windows-v0.1.1"><img src="https://img.shields.io/badge/Windows-v0.1.1-84cc16" alt="Windows release" /></a>
  <a href="https://github.com/ApolloVulpez/aurral-app/releases/tag/macos-v0.1.2"><img src="https://img.shields.io/badge/macOS-v0.1.2-84cc16" alt="macOS release" /></a>
  <a href="https://github.com/ApolloVulpez/aurral-app/releases/tag/linux-v0.1.4"><img src="https://img.shields.io/badge/Linux-v0.1.4-84cc16" alt="Linux release" /></a>
</p>

<p align="center">A Windows, macOS, and Linux desktop front end for your Aurral server.</p>

<p align="center">
  <a href="https://github.com/lklynet/aurral">Aurral project</a> ·
  <a href="https://aurral.org/">Website</a> ·
  <a href="https://docs.aurral.org/">Docs</a> ·
  <a href="https://discord.gg/cpPYfgVURJ">Discord</a>
</p>

> [!IMPORTANT]
> Aurral App requires a running Aurral server and displays that server's web interface. Report server bugs and issues you can also reproduce in a browser to the [main Aurral project](https://github.com/lklynet/aurral/issues). Report installation, tray, and other desktop-only issues to the [Aurral App tracker](https://github.com/ApolloVulpez/aurral-app/issues).

## Install

### Windows

Download and run the [Windows x64 installer](https://github.com/ApolloVulpez/aurral-app/releases/download/windows-v0.1.1/Aurral-Setup-0.1.1-win-x64.exe). The default install folder is `C:\Program Files\Aurral` and setup requires administrator approval. Setup creates a Start menu shortcut and offers a desktop shortcut. Select **Open Aurral** at the end of setup. To keep a shortcut on the taskbar, right-click Aurral's taskbar icon while the app is open and select **Pin to taskbar**.

The installer includes .NET and installs the Microsoft Edge WebView2 Runtime if it is missing. That runtime download requires an Internet connection.

### macOS

Download the DMG for [Apple Silicon](https://github.com/ApolloVulpez/aurral-app/releases/download/macos-v0.1.2/Aurral-App-0.1.2-macOS-arm64.dmg) or [Intel](https://github.com/ApolloVulpez/aurral-app/releases/download/macos-v0.1.2/Aurral-App-0.1.2-macOS-x64.dmg). Open the disk image and drag **Aurral App** into **Applications**. These builds require macOS 13 or later. They are not Apple-notarized, so macOS may block the first launch.

### Linux

Download the x64 [Debian package](https://github.com/ApolloVulpez/aurral-app/releases/download/linux-v0.1.4/Aurral-App-0.1.4-linux-amd64.deb) for Ubuntu, Debian, and Linux Mint, or the [AppImage](https://github.com/ApolloVulpez/aurral-app/releases/download/linux-v0.1.4/Aurral-App-0.1.4-linux-x86_64.AppImage) for Fedora, SteamOS, and Bazzite.

Install the `.deb` through your software installer. For the AppImage, allow the file to run as a program in its properties, then open it. Start in Desktop Mode on SteamOS and Bazzite. See the [Linux guide](linux/README.md) for installation commands and desktop integration.

## Connect and use Aurral

On first launch, enter the URL of a running Aurral server, including its path if it lives under a subpath (for example, `https://music.example.com/aurral`). Then sign in through the Aurral screen that opens in the window. The app remembers the last server it opened and keeps you signed in across launches until you sign out or the server ends the session.

- **On Windows**, tap **Alt** and choose **Settings → Change server** to switch servers. Right-click the Aurral icon in the notification area to open the tray menu. To make **X** exit the app, turn off **Settings → Minimize to tray**.
- **On macOS**, press **⌘ + ,** or choose **Aurral App → Change Server** to switch servers. Click the Aurral icon near the clock in the macOS menu bar to open the playback menu. To make closing the window exit the app, turn off **Aurral App → Minimize to Tray**.
- **On Linux**, press **Ctrl + ,** to change servers, or tap **Alt** and open **Settings**. Use the Aurral tray icon for playback controls. Turn off **Settings → Minimize to Tray** to make closing the window quit. If your desktop hides the tray icon, launching Aurral App again restores the existing window.

Closing the window keeps playback running by default. The tray or menu-bar icon offers **Show Aurral**, **Stop / Play**, **Previous**, **Next**, and **Quit**. **Stop** pauses the current track so **Play** can resume it. Sign-in, API calls, and streaming go directly to your server.

Use the title-bar arrows to go back and forward. On macOS, use **⌘ + [** and **⌘ + ]**. On Linux, use **Alt + ←** and **Alt + →**.

## App updates

Aurral App checks GitHub on startup. The download icon beside Back and Forward turns white when a newer compatible release is available and stays grey otherwise. Click it to check, download, and install the update. Windows and `.deb` installations can prompt for administrator approval. Aurral App reopens after an in-place update and keeps your server settings and sign-in. If the installation needs to be finished manually, the app opens the downloaded package or shows its location.

Windows, macOS, and Linux use independent version numbers. Publish stable releases with the matching `windows-vMAJOR.MINOR.PATCH`, `macos-vMAJOR.MINOR.PATCH`, or `linux-vMAJOR.MINOR.PATCH` tag and keep the filenames produced by the build scripts.

## Build and run

### Windows

Install the .NET 10 SDK and the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/). From the repository root in PowerShell:

```powershell
dotnet run --project .\Aurral.App.csproj
```

To publish a portable x64 Windows build with .NET included:

```powershell
dotnet publish .\Aurral.App.csproj -c Release -r win-x64 --self-contained -o .\dist\win-x64
```

Keep the publish folder together and open `Aurral.exe`.

To build the installer, install [Inno Setup 6.7 or later](https://jrsoftware.org/isdl.php) and pass the path to its compiler:

```powershell
.\installer\Build.ps1 -InnoCompiler 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
```

The installer is written to `dist\installer`.

### macOS

Install Node.js 24 and the Xcode command-line tools, then run these commands from the repository root.

```sh
cd macos
npm ci
npm start
```

Use `npm run build` from the same directory to create a universal DMG in `dist/macos` at the repository root.

### Linux

Install Node.js 24 on Linux, then run these commands from the repository root.

```sh
cd linux
npm ci
npm run build
```

The build creates both the `.deb` and AppImage in `dist/linux`.
