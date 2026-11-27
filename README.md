# herdr-swift-tree
High-performance File Explorer for Herdr

## Windows에서 사용하기

Windows 11의 네이티브 Herdr App 0.1.18에서 검증했습니다. Herdr를 연 상태에서 저장소 루트의 PowerShell에서 아래 명령을 실행합니다.

```powershell
.\scripts\install-swifttree.ps1
```

설치 스크립트는 기본 레이아웃을 복제해 SwiftTree 레이아웃을 만들고 선택합니다. 탐색할 Windows 폴더가 지정된 space로 이동한 다음, 상단의 **Files** 버튼을 누릅니다.

- 폴더를 클릭하면 자식이 펼쳐집니다. 트리에 포커스가 있으면 `↑`와 `↓`로 행을 선택하고, `→` 또는 `Enter`로 닫힌 폴더를 펼칩니다. `←`는 열린 폴더를 접거나 부모 행으로 이동합니다.
- 목록은 폴더 우선이며 같은 종류 안에서는 숫자를 고려한 이름순으로 표시됩니다. 터미널에서 `cd`를 실행하거나 다른 pane을 선택해도 탐색 루트는 현재 space의 지정 폴더입니다.
- `Empty folder`, `Access denied`, `Folder no longer exists`는 각각 빈 폴더, 읽기 권한이 없는 폴더, 조회할 때 경로가 사라진 폴더를 뜻합니다. 접었다가 다시 펼치면 해당 폴더를 다시 읽습니다.

Herdr에 연결한 SSH Linux 머신에서 탐색할 폴더를 지정한 space를 열면 같은 Files 버튼에서 원격 파일을 탐색할 수 있습니다. 연결된 Linux 머신의 `sh`와 GNU `find`로 UTF-8 이름의 목록을 읽습니다. 파일·폴더 이름은 Windows 창에서 로컬과 같은 순서로 정렬됩니다.

폴더가 지정되지 않은 space에서는 SwiftTree의 **Open folder**를 누릅니다. 로컬 space에서는 Windows 폴더 선택 창을 사용하고, SSH space에서는 연결된 머신의 절대 경로를 입력합니다. 선택한 탐색 루트는 해당 space에 저장되며 Herdr를 다시 실행해도 복원됩니다. 새 터미널은 Herdr의 기존 시작 경로를 따릅니다.

기본 Files를 사용하려면 `Ctrl+Shift+P`에서 `layout`을 검색하고 **Layout: Herdr**를 선택합니다. 상단 **Files** 버튼으로 기본 패널을 열 수 있습니다. [Windows 네이티브 UI 검증 절차](docs/verification/windows-native-ui.md)
