; Installer Windows Radio Translate Papua (Inno Setup 6). Dipanggil oleh packaging/build.py:
;   iscc /DAppVersion=1.0.0 /DSourceDir=dist\RadioTranslatePapua /DOutputDir=dist /DOutputName=... /DIconFile=... installer.iss
; Dipasang per pengguna (tanpa hak admin) di %LOCALAPPDATA%\Programs\RadioTranslatePapua.
; Model AI, rekaman, setelan dan log ada di %LOCALAPPDATA%\RadioTranslatePapua (tidak dihapus saat uninstall).

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6C2F2E4B-6E1D-4B7A-9E1E-52A1B7F0C0DE}
AppName=Radio Translate Papua
AppVersion={#AppVersion}
AppPublisher=Radio RTI Group
DefaultDirName={localappdata}\Programs\RadioTranslatePapua
DefaultGroupName=Radio Translate Papua
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename={#OutputName}
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\RadioTranslatePapua.exe
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern

[Languages]
Name: "indonesian"; MessagesFile: "compiler:Languages\Indonesian.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Radio Translate Papua"; Filename: "{app}\RadioTranslatePapua.exe"
Name: "{group}\Folder data (model & rekaman)"; Filename: "{localappdata}\RadioTranslatePapua"
Name: "{autodesktop}\Radio Translate Papua"; Filename: "{app}\RadioTranslatePapua.exe"; Tasks: desktopicon

[Dirs]
Name: "{localappdata}\RadioTranslatePapua\models"; Flags: uninsneveruninstall

[Run]
Filename: "{app}\RadioTranslatePapua.exe"; Description: "{cm:LaunchProgram,Radio Translate Papua}"; Flags: nowait postinstall skipifsilent
