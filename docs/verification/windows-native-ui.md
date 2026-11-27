# Windows Herdr UI 검증

[검증 경로 확인 #2](https://github.com/kalstein00/herdr-swift-tree/issues/2)에서 합의한 Windows 네이티브 검증 도구는 Windows Computer Use다. Windows Herdr 창을 대상으로 클릭, 스크롤, 키보드 입력을 보낸다. 기본 Files에서 클릭과 스크롤을 검증하고 같은 창의 명령 팔레트에서 키보드 선택 이동을 검증한다. SwiftTree의 트리 키보드 동작은 해당 SwiftTree 후보에서 검증한다.

## 격리된 검증 창 준비

Windows에 설치된 Herdr에서 PowerShell로 다음을 실행한다. Herdr가 다른 위치에 설치되어 있으면 `$app`을 설치된 실행 파일 경로로 지정한다. 이후 명령에도 새 프로필과 코어 설정이 적용되도록 같은 PowerShell 세션을 사용한다.

```powershell
$app = Join-Path $env:LOCALAPPDATA 'Programs\herdr-app\herdr-app.exe'
$runId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) "st-ui-$runId"
$tree = Join-Path $scratch 'synthetic-tree'
$branch = Join-Path $tree 'alpha\branch'
New-Item -ItemType Directory -Path $branch -Force | Out-Null
foreach ($row in 1..75) {
    $name = 'row-{0:D3}.txt' -f $row
    Set-Content -LiteralPath (Join-Path $branch $name) -Value 'SwiftTree synthetic UI fixture'
}

$env:HERDR_APP_HOME = Join-Path $scratch 'app'
$env:HC_SESSION = "st-ui-$runId"
$env:XDG_CONFIG_HOME = Join-Path $scratch 'config'
$env:XDG_STATE_HOME = Join-Path $scratch 'state'
$env:HC_SOCKET = $null

& $app --version
$windowProcess = Start-Process -FilePath $app -WorkingDirectory $tree -WindowStyle Normal -PassThru
$windowProcess.Id
```

새 창에 Herdr 환영 화면이 표시될 때까지 기다린다. 다음 명령으로 합성 폴더를 space에 연결한다. `ls`에서 `SwiftTree UI fixture`가 활성 space이고 `folder`가 생성한 합성 폴더인지 확인한다. 레이아웃을 사용할 수 없다는 메시지가 나오면 로컬 코어 연결을 확인한 뒤 `space.new`를 다시 시도한다.

```powershell
& $app do space.new --name 'SwiftTree UI fixture' --folder $tree
& $app ls
```

Computer Use에서 실행한 프로세스의 창을 선택한다. 기존 Herdr 창도 열려 있으면 프로세스의 `MainWindowHandle`을 확인하고 목록에 반환된 창 ID와 대조한다. 클릭 위치와 포커스는 각 동작 직전의 화면으로 확인한다.

## 사용자 경로와 관측 기준

| 동작 | 화면에서 확인할 결과 |
| --- | --- |
| 상단 `Files` 버튼을 클릭한다. | 합성 루트와 접힌 `alpha`가 표시된다. |
| `alpha`를 펼쳐 `branch`를 클릭한다. | 두 폴더가 펼쳐지고 `row-001.txt`부터 파일이 표시된다. |
| Files 목록 안에서 아래로 스크롤한다. | 보이는 목록 범위가 바뀌고 끝에서 `row-075.txt`가 나타난다. |
| `Ctrl+Shift+P`로 명령 팔레트를 열고 `↓`를 누른다. | 팔레트 선택이 `New tab`에서 `Go to space or tab...`으로 이동한다. |

접힌 목록, 펼친 목록, 마지막 행, 팔레트 선택을 캡처하고 각각 직접 열어 행 이름, 펼침 상태, 포커스와 배치를 검사한다. 기본 Files 행 위의 하이라이트는 포인터 호버 상태로 기록한다. 검증 기록에 저장소 후보, Herdr App과 core 버전, OS 빌드, 창 크기, 조작 순서, 관측 결과, 이미지 보관 위치를 남긴다.

## #2 결과

Windows 11 Pro 빌드 26300에서 Herdr App 0.1.18, core 0.1.22, 기본 레이아웃과 Files를 사용했다. 네이티브 프레임 크기는 1600×1025였다. 위 네 동작을 같은 창에서 수행했고, 접힌 목록부터 마지막 행과 팔레트 선택까지 네 화면을 열어 확인했다. 캡처는 작업의 로컬 아티팩트에 보관했다.

Agent Browser 0.45.0의 `connect`는 실제 Herdr를 대상으로 쓸 수 없었다. 실행 중인 Herdr 프로세스에는 TCP 수신 포트가 없었고, 설치본은 `--remote-debugging-port`를 알 수 없는 인자로 처리했다. 비어 있는 로컬 포트로 실행한 연결 시도는 CDP와 BiDi 탐색에 실패해 종료 코드 1을 반환했다. [Agent Browser 연결 방식](https://agent-browser.dev/cdp-mode)

Herdr App 0.1.18의 기본 Files는 포인터 클릭으로 행을 열며, 방향키로 이동하는 행 선택 상태를 제공하지 않는다. SwiftTree 트리의 방향키 이동, 원격 탐색과 성능은 해당 기능이 설치된 후보에서 확인한다. [기본 Files 행과 스크롤 영역 구현](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L252-L280)

## SwiftTree의 Windows 로컬 탐색 검증

Herdr App 0.1.18의 격리된 레이아웃에서 `scripts/install-swifttree.ps1`의 `-AppHome`에 대상 프로필을 지정한다. 홈 아래와 홈 밖 NTFS 폴더를 각각 space의 시작 폴더로 지정한다. 합성 폴더에는 숫자가 붙은 폴더·파일 이름, 파일이 든 하위 폴더, 빈 폴더, 테스트 계정의 열거 권한을 거부한 폴더, 읽기 중 삭제할 폴더를 둔다. 각 위치의 파일을 독립적으로 열거해 기대 목록을 기록한다.

1. 상단 Files 버튼으로 SwiftTree를 열고 처음 보이는 행과 파일·폴더 순서를 비교한다. 폴더를 펼친 뒤 `↓`로 자식 행을 선택한다. 이름에 곡선형 아포스트로피가 있는 폴더도 펼쳐 자식 파일을 확인한다.
2. 한 터미널에서 다른 폴더로 이동한 뒤 다른 폴더를 시작 위치로 한 pane에 포커스를 옮겨 본다. 트리에 해당 space의 원래 목록이 보이는지 확인한다.
3. 빈 폴더, 읽기 권한이 없는 폴더, 목록을 요청한 뒤 삭제된 폴더를 열어 각각의 문구를 확인한다.
4. `Ctrl+Shift+P`에서 `layout`을 검색하고 `Layout: Herdr`로 전환한다. Files 버튼으로 기본 패널을 닫았다가 다시 연다.

실제 창에서 저장한 PNG의 패널 영역에서 제목과 행 순서를 확인할 수 있다. 아래 좌표는 1600×1025 네이티브 프레임의 오른쪽 패널 예다. 창 크기가 다르면 해당 패널에 맞춰 좌표를 지정한다. OCR은 텍스트 순서를 확인하며 포커스와 선택 상태는 이미지를 직접 열어 검사한다.

```powershell
uv run --isolated --python 3.13 --with pillow --with winrt-Windows.Media.Ocr --with winrt-Windows.Graphics.Imaging --with winrt-Windows.Storage --with winrt-Windows.Storage.Streams python tests/assert_herdr_panel.py <capture.png> SwiftTree Folder02 alpha.txt --crop 1130 50 455 620
node --test tests/windows-directory.test.mjs
```

## SwiftTree의 SSH Linux 탐색 검증

같은 Windows Herdr 창에 NTFS space와 연결된 Linux SSH space를 준비한다. 두 탐색 루트의 마지막 이름은 같게 만들고 서로 다른 파일을 둔다. Linux에는 숫자 순서가 다른 폴더와 파일, 각각 고유한 자식이 있는 폴더를 두 개 이상 만든다.

1. SSH space에서 Files를 열고 Linux에 직접 접속해 읽은 기준 목록과 화면의 이름·종류·순서를 비교한다. 폴더를 펼쳐 원격에서만 존재하는 자식을 선택한 뒤 화면을 캡처한다.
2. 테스트 게스트의 네트워크에 지연을 준다. 원격 폴더 두 개를 연속으로 펼치고 로딩 표시가 남아 있는 동안 NTFS space로 전환한다. 원격 응답이 도착한 뒤에도 로컬 전용 파일이 보이는지 확인하고 화면을 캡처한다. 지연을 적용하기 전 설정은 검증 뒤 복구한다.
3. 원격 트리에서 이미 표시된 하위 폴더의 상위 디렉터리에서 검색 권한을 제거한다. 하위 폴더를 펼쳐 `Access denied`를 확인한다. 이미 표시된 다른 폴더를 삭제한 후 펼치면 `Folder no longer exists`가 표시되어야 한다.

로컬 캡처에서 원격 파일이 섞이지 않았는지 검사할 때 `tests/assert_herdr_panel.py`의 `--exclude <파일명>`을 사용한다. `node --test tests/linux-directory.test.mjs`는 원격으로 전달할 머신과 경로, Linux 목록 디코딩, Windows 정렬 및 불완전한 응답 처리를 검사한다.

## 폴더 선택과 재시작 복원 검증

격리된 프로필에서 폴더가 지정되지 않은 로컬 space와 SSH space를 준비한다. 각 space의 Files 패널에 **Open folder**가 표시되는지 확인한다. 상단 **+ → Terminal**로 연 터미널의 실제 시작 경로를 각각 기록한다.

1. 로컬 패널에서 **Open folder**를 눌러 Windows 폴더 선택 창으로 표시할 합성 폴더를 고른다. SSH 패널에서는 연결된 머신의 절대 경로를 입력해 **Open**을 누른다. 두 루트에 한쪽에서만 보이는 파일을 두고 화면에서 구별한다.
2. 다른 space로 이동했다 돌아오고 각 탐색 루트를 확인한다. 격리된 Windows Herdr 창을 닫고 앱 프로세스가 종료됐는지 확인한 뒤 같은 프로필로 다시 실행한다. 로컬과 SSH 패널을 각각 열어 저장한 루트가 복원되는지 확인하고 캡처한다.
3. 두 space에서 다시 **+ → Terminal**을 실행한다. 터미널 프롬프트와 `hc get <terminal> --json`의 `cwd`를 기록하고 이전 시작 경로와 비교한다. `herdr-app ls`에서도 두 space의 지정 폴더가 여전히 비어 있는지 확인한다.

## 읽기 전용 미리보기 검증

NTFS와 SSH마다 내용이 다른 파일 A·B와 스크롤할 수 있는 합성 트리를 준비한다. 파일 본문 접근을 관측하면서 폴더를 펼치고 마지막 자식까지 스크롤한다. 이 구간의 데이터 열기·읽기 이벤트 수를 기록한다. 목록·디렉터리 메타데이터 조회는 본문 읽기에서 제외한다.

1. 실제 Windows Herdr의 트리에 A와 B가 보이는 상태에서 A 읽기만 잠시 지연시킨다. A를 열고 로딩이 표시되는 동안 바로 옆 B를 연다.
2. B의 행 선택과 본문을 같은 프레임에서 확인한다. A가 풀리고 읽기가 끝난 뒤에도 B의 이름·본문이 유지되는지 확인한다. 미리보기에서 수정 입력이 적용되지 않는지 확인한다.
3. NTFS에서는 합성 파일의 oplock 알림으로 데이터 열기를 관측하고, Linux에서는 합성 폴더의 inotify 파일 접근과 A의 파일 lease를 기록한다. A와 B를 열었을 때 감지가 작동하는지 양성 대조로 확인한다. Windows와 Linux의 원시 시각은 각각의 시간축에서 비교한다. [Windows oplock 중단](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/breaking-oplocks) · [Linux 파일 lease](https://www.man7.org/linux/man-pages/man2/F_SETLEASE.2const.html)

패널에서 본문 글자가 작아 OCR이 어긋나면 본문을 좁게 잘라 `--scale 3`으로 검사한다. 파일 선택과 읽기 전용 표시가 함께 보이는 화면은 별도로 직접 연다.
