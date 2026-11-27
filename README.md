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

기본 Files를 사용하려면 `Ctrl+Shift+P`에서 `layout`을 검색하고 **Layout: Herdr**를 선택합니다. 상단 **Files** 버튼으로 기본 패널을 열 수 있습니다. [Windows 네이티브 UI 검증 절차](docs/verification/windows-native-ui.md)
