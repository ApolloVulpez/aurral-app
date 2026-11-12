[Setup]
AppId={{96AB4288-F7A0-4C16-B0D8-DFFAC7CD6659}
AppName=Aurral
AppVersion={#AppVersion}
AppPublisher=Aurral Contributors
AppPublisherURL=https://github.com/ApolloVulpez/aurral-app
DefaultDirName={autopf}\Aurral
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
MinVersion=10.0.17763
SetupIconFile=..\Aurral.ico
UninstallDisplayIcon={app}\Aurral.exe
OutputBaseFilename=Aurral-Setup-{#AppVersion}-win-x64
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern dynamic
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Excludes: "*.pdb"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "Aurral-LICENSE.txt"; Flags: ignoreversion
Source: "{#Bootstrapper}"; Flags: dontcopy noencryption

[Icons]
Name: "{autoprograms}\Aurral"; Filename: "{app}\Aurral.exe"; WorkingDir: "{app}"; AppUserModelID: "Aurral.Desktop"
Name: "{autodesktop}\Aurral"; Filename: "{app}\Aurral.exe"; WorkingDir: "{app}"; AppUserModelID: "Aurral.Desktop"; Tasks: desktopicon

[Run]
Filename: "{app}\Aurral.exe"; Description: "Open Aurral"; Flags: nowait postinstall runasoriginaluser skipifsilent
Filename: "{app}\Aurral.exe"; Flags: nowait runasoriginaluser skipifnotsilent; Check: IsAurralUpdate

[Code]
const
  WebView2Key = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2Setup = 'MicrosoftEdgeWebview2Setup.exe';

function IsAurralUpdate: Boolean;
begin
  Result := ExpandConstant('{param:AurralUpdate|0}') = '1';
end;

function HasWebView2InRegistry(Root: Integer): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(Root, WebView2Key, 'pv', Version) and
    (Trim(Version) <> '') and (Version <> '0.0.0.0');
end;

function HasWebView2: Boolean;
begin
  Result := HasWebView2InRegistry(HKLM32) or HasWebView2InRegistry(HKCU);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
begin
  Result := '';
  if HasWebView2 then
    Exit;

  WizardForm.PreparingLabel.Caption := 'Installing the Microsoft Edge WebView2 Runtime...';
  ExtractTemporaryFile(WebView2Setup);
  if not Exec(ExpandConstant('{tmp}\' + WebView2Setup), '/silent /install', '',
    SW_HIDE, ewWaitUntilTerminated, ExitCode) or not HasWebView2 then
    Result := 'Aurral needs the Microsoft Edge WebView2 Runtime. Check your Internet connection and try again, or install the runtime from https://developer.microsoft.com/microsoft-edge/webview2/.';
end;

procedure UpdateFinishButton(Sender: TObject);
begin
  if WizardForm.RunList.Checked[0] then
    WizardForm.NextButton.Caption := 'Open Aurral'
  else
    WizardForm.NextButton.Caption := SetupMessage(msgButtonFinish);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpFinished) and (WizardForm.RunList.Items.Count > 0) then
  begin
    WizardForm.RunList.OnClickCheck := @UpdateFinishButton;
    UpdateFinishButton(WizardForm.RunList);
  end;
end;
