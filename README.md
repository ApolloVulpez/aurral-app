<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme-dark.svg" />
    <img src="assets/readme-light.svg" width="690" alt="Aurral App" />
  </picture>
</div>

<p align="center">
  <a href="https://github.com/ApolloVulpez/aurral-app/releases/latest"><img src="https://img.shields.io/github/v/release/ApolloVulpez/aurral-app?label=Windows%20release" alt="Latest Windows release" /></a>
</p>

<p align="center">A Windows desktop front end for your Aurral server. (Linux support planned at a later date.)</p>

<p align="center">
  <a href="https://github.com/lklynet/aurral">Aurral project</a> ·
  <a href="https://aurral.org/">Website</a> ·
  <a href="https://docs.aurral.org/">Docs</a> ·
  <a href="https://discord.gg/cpPYfgVURJ">Discord</a>
</p>

> [!IMPORTANT]
> Aurral App requires a running Aurral server and displays that server's web interface. Report server bugs and issues you can also reproduce in a browser to the [main Aurral project](https://github.com/lklynet/aurral/issues). Report Windows installer, tray, and other desktop-only issues to the [Aurral App tracker](https://github.com/ApolloVulpez/aurral-app/issues).

## Install

Download and run the x64 installer from [GitHub Releases](https://github.com/ApolloVulpez/aurral-app/releases). The default install folder is `C:\Program Files\Aurral` and setup requires administrator approval. Setup creates a Start menu shortcut and offers a desktop shortcut. Select **Open Aurral** at the end of setup. To keep a shortcut on the taskbar, right-click Aurral's taskbar icon while the app is open and select **Pin to taskbar**.

The installer includes .NET and installs the Microsoft Edge WebView2 Runtime if it is missing. That runtime download requires an Internet connection.

## Connect and use Aurral

On first launch, enter the URL of a running Aurral server, including its path if it lives under a subpath (for example, `https://music.example.com/aurral`). Then sign in through the Aurral screen that opens in the window. The app remembers the last server it opened. Tap **Alt** to reveal the menu bar, then use **Settings → Change server** to switch servers or retry a connection.

Closing the window with **X** keeps Aurral and its playback in the notification area. Right-click its tray icon for **Show Aurral**, **Stop / Play**, **Previous**, **Next**, and **Quit**. **Stop** pauses the current track so **Play** can resume it. To make **X** exit the app, tap **Alt** and turn off **Settings → Minimize to tray**.

The window loads the frontend served by that Aurral instance. Sign-in, API calls, and streaming go directly to the server. The app uses a separate WebView2 profile in `%LOCALAPPDATA%\Aurral` to keep you signed in across launches until you sign out or the server ends the session.

## Build and run

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
