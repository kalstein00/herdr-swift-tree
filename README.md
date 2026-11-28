# herdr-swift-tree

SwiftTree는 Windows용 Herdr App에서 로컬 NTFS와 SSH Linux 폴더를 탐색하는 Files Mod입니다. 대형 폴더를 키보드로 탐색하고, 외부 파일 변경을 열린 목록에서 확인하고, 텍스트 파일을 읽기 전용으로 미리 볼 수 있습니다.

## 설치 및 업데이트

- **Windows**에서는 네이티브 Herdr App과 PowerShell이 필요합니다. Windows 11 x64, Herdr App 0.1.18, Herdr Core 0.1.22에서 검증했습니다. 설치 스크립트는 Windows의 .NET Framework C# 컴파일러를 사용해 도우미를 빌드하며, 도우미는 Windows의 ICU를 사용합니다. 확대 미리보기에는 Microsoft Edge WebView2 Runtime이 필요합니다. [Herdr App 다운로드](https://herdr.dev/download/) · [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
- **SSH Linux**를 탐색하려면 먼저 Herdr에 원격 머신을 연결합니다. 원격 탐색에는 `sh`, GNU `find`, `stat`, `sleep`이 필요합니다. SSH 파일 미리보기는 GNU `dd`, `sha256sum`, procps의 `ps`와 Linux `/proc`을 사용합니다. SwiftTree 설치는 Windows에서 한 번 수행하면 됩니다. [Herdr 가이드](https://herdr.dev/guide/)

1. 최신 릴리즈에서 `SwiftTree-windows.zip`을 내려받고 압축을 풉니다. `Get-FileHash .\SwiftTree-windows.zip`의 SHA-256을 릴리즈 노트와 비교할 수 있습니다. [최신 릴리즈](https://github.com/kalstein00/herdr-swift-tree/releases/latest)
2. Herdr App을 열어 둔 상태에서, `scripts` 폴더가 보이는 위치에서 PowerShell로 아래 명령을 실행합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\install-swifttree.ps1
```

설치 스크립트는 기본 레이아웃을 복제해 **Swifttree** 레이아웃을 만들고 선택합니다. 업데이트할 때는 새 ZIP을 풀고 같은 명령을 실행합니다. Herdr 실행 파일이나 프로필이 기본 경로 밖에 있으면 각각 `-HerdrApp`과 `-AppHome`으로 지정할 수 있습니다. 다운로드한 스크립트 실행이 차단되면 ZIP의 SHA-256을 확인하고, ZIP 속성에서 **차단 해제**를 선택한 뒤 다시 압축을 풉니다.

## 사용 방법

상단에 **Files** 버튼이 보이지 않으면 Herdr에서 `Ctrl+Shift+P`를 누르고 **Welcome**을 검색해 실행합니다. **Next** → **Not now**로 **Choose your panels** 화면에 이동해 **Files**를 켜고, **Next** → **Done**을 누릅니다. Herdr의 패널 선택이 꺼져 있으면 SwiftTree 설치가 성공해도 버튼이 표시되지 않습니다.

Windows 로컬 또는 SSH Linux의 space를 열고 상단의 **Files**를 누릅니다. SwiftTree는 활성 터미널의 현재 디렉터리를 표시합니다. 현재 디렉터리를 알 수 없으면 space에 지정된 폴더나 이전에 선택한 폴더를 사용합니다. 사용할 폴더가 없으면 **Open folder**에서 로컬 폴더를 선택하거나 SSH 머신의 절대 경로를 입력할 수 있습니다. 새 터미널은 Herdr의 기존 시작 경로를 따릅니다.

- 폴더를 클릭하면 자식이 펼쳐집니다. 트리에 포커스가 있으면 `↑`와 `↓`로 행을 선택하고, `Home`과 `End`로 펼쳐진 트리의 첫 항목과 마지막 항목을 선택합니다. `→` 또는 `Enter`로 닫힌 폴더를 펼치고, `←`로 열린 폴더를 접거나 부모 행으로 이동합니다.
- 목록은 폴더 우선이며 같은 종류 안에서는 숫자를 고려한 이름순으로 표시됩니다. 터미널에서 `cd`를 실행하거나 다른 터미널 pane에 포커스를 옮기면 탐색 루트가 해당 디렉터리로 바뀝니다.
- 로컬 Windows 폴더의 열린 목록은 파일이나 폴더가 생성·삭제·이동되거나 이름이 바뀌면 자동으로 갱신됩니다. Windows 변경 알림이 유실되면 SwiftTree가 열린 목록을 다시 읽습니다. 정상적으로 감시 중일 때는 유휴 상태에서 목록을 재조회하지 않습니다.
- `Empty folder`, `Access denied`, `Folder no longer exists`는 각각 빈 폴더, 읽기 권한이 없는 폴더, 조회할 때 경로가 사라진 폴더를 뜻합니다. 접었다가 다시 펼치면 해당 폴더를 다시 읽습니다.

SSH Linux 폴더의 UTF-8 이름도 로컬 폴더와 같은 순서로 정렬됩니다.

SSH Linux에서도 열린 폴더의 생성·삭제·이동·이름 변경을 자동으로 반영합니다. 기존 Herdr 연결에서 `sh`, GNU `stat`, `sleep`으로 열린 폴더의 메타데이터를 확인하고 변한 목록을 갱신합니다. 감시가 일시적으로 중단되면 **Live updates unavailable**이 표시됩니다. 다시 감시할 수 있게 되면 열린 목록을 재확인합니다.

SSH 연결이 끊기면 **연결 끊김 · 마지막으로 확인한 내용**이 표시됩니다. 이미 읽은 목록은 계속 스크롤할 수 있고 열어 둔 미리보기도 유지됩니다. 아직 읽지 않은 폴더를 펼치면 **연결 후 불러올 수 있음**이 표시됩니다. 다시 연결되면 열린 폴더를 실제로 읽고, 아직 존재하는 항목의 선택과 스크롤 위치를 유지합니다. [SSH 복구 검증](docs/verification/ssh-recovery.md)

Git checkout이나 Perforce sync가 진행되는 동안에도 스크롤과 방향키 탐색을 계속할 수 있습니다. 파일 변경은 열린 폴더에 반영됩니다. [대량 파일 변경 검증](docs/verification/vcs-bulk.md)

루트 밖 디렉터리를 가리키는 Windows junction이나 Linux 심볼릭 링크를 펼치면 대상의 파일과 변경을 볼 수 있습니다. 같은 디렉터리를 가리키는 두 링크는 각각 펼칠 수 있습니다. 현재 가지에서 이미 거친 디렉터리로 돌아가는 링크에는 **순환 링크**가 표시되고 그 아래로 펼쳐지지 않습니다. [외부 링크 검증](docs/verification/external-links.md)

파일을 클릭하거나 선택한 파일에서 `Enter`를 누르면 트리 아래에 읽기 전용 미리보기가 열립니다. 미리보기의 **×**를 누르면 트리의 선택을 유지한 채 미리보기만 닫힙니다. 같은 파일을 다시 클릭하거나 `Enter`를 누르면 다시 열립니다. 방향키는 트리의 선택만 옮깁니다. 아래쪽에 파일의 첫 부분만 표시되면 **Showing the start of the file**이 나타납니다.

본문이 있는 미리보기에서 **크게 보기**를 누르면 현재 파일을 Herdr 창 중앙에서 첫 줄부터 볼 수 있습니다. Windows 로컬과 SSH Linux의 파일은 1 MiB를 넘어도 끝까지 읽을 수 있습니다. `Ctrl+F`로 검색하고 `Ctrl+End`로 파일 끝으로 이동합니다. 확대 미리보기에는 줄 번호와 지원되는 언어의 구문 강조가 적용됩니다. 읽기 전용 본문을 선택하고 복사할 수 있습니다. `Esc`나 중앙 창의 **×**로 닫으면 아래쪽에서 보던 위치로 돌아옵니다. 원격 연결이 복구되거나 읽는 동안 파일이 바뀌면 Files에서 파일을 다시 열어 현재 내용을 불러옵니다.

## 기본 Files로 돌아가기

`Ctrl+Shift+P`에서 `layout`을 검색하고 **Layout: Herdr**를 선택합니다. 상단 **Files** 버튼으로 기본 패널을 열 수 있습니다. 다시 SwiftTree를 사용하려면 **Layout: Swifttree**를 선택합니다.

## 검증 및 라이선스

- Windows NTFS와 QEMU의 SSH Linux/ext4에서 설치본을 검증했습니다. 설치·업데이트·복귀, 대형 폴더, 파일 변경 반영, SSH 재연결 결과를 확인할 수 있습니다. [릴리즈 검증 기록](docs/verification/release-candidate.md) · [Windows UI 검증 절차](docs/verification/windows-native-ui.md)
- SwiftTree는 MIT 라이선스로 배포합니다. [라이선스](LICENSE)
