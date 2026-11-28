# Windows Herdr UI 검증

실행 중인 Windows Herdr에서 `herdr-app shot`으로 화면을 캡처하고 `status`와 `ls`로 앱 상태를 확인한다. `herdr-app do`에 같은 동작이 있으면 검증 창의 레이아웃, space, pane, 패널을 CLI에서 조작한다. SwiftTree의 실제 클릭, 스크롤, 키 바인딩, 폴더 선택은 검증 창에 한정한 Windows 네이티브 입력으로 확인한다. 별도 확대 창과 첫 화면 표시 시각은 Windows Graphics Capture로 캡처한다. [Herdr CLI 조사와 Windows 재현](../research/herdr-screen-inspection.md)

UI TDD에서는 위 경로로 실제 창의 검증 가능 여부를 먼저 확인한다. 회귀 E2E는 같은 동작과 화면 단언으로 수정 전 RED와 수정 후 GREEN을 확인한다. 최종 후보에서도 사용자 경로를 다시 실행하고 캡처한 PNG를 열어 결과를 확인한다.

## 격리된 검증 창 준비

재현용 창을 준비하려면 저장소 루트에서 PowerShell로 다음을 실행한다. Herdr가 다른 위치에 설치되어 있으면 `$app`을 설치된 실행 파일 경로로 지정한다. 이후 명령에도 새 프로필과 코어 설정이 적용되도록 같은 PowerShell 세션을 사용한다. 기존 창이나 프로필 상태가 검증 대상이면 해당 창의 앱 홈과 코어 세션을 지정한다.

```powershell
$app = Join-Path $env:LOCALAPPDATA 'Programs\herdr-app\herdr-app.exe'
$runId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) "st-ui-$runId"
$tree = Join-Path $scratch 'synthetic-tree'
$branch = Join-Path $tree 'alpha\branch'
New-Item -ItemType Directory -Path $branch -Force | Out-Null
Set-Content -LiteralPath (Join-Path $tree 'Proof.txt') -Value 'SwiftTree capture fixture'
foreach ($row in 1..75) {
    $name = 'row-{0:D3}.txt' -f $row
    Set-Content -LiteralPath (Join-Path $branch $name) -Value 'SwiftTree synthetic UI fixture'
}

$env:HERDR_APP_HOME = Join-Path $scratch 'app'
$env:HC_SESSION = "st-ui-$runId"
$env:XDG_CONFIG_HOME = Join-Path $scratch 'config'
$env:XDG_STATE_HOME = Join-Path $scratch 'state'
$env:HC_SOCKET = $null

& $app --version | Out-Host
$windowProcess = Start-Process -FilePath $app -WorkingDirectory $tree -WindowStyle Normal -PassThru
$windowProcess.Id
```

새 창의 **Welcome to Herdr** 화면은 우측 상단의 **×**로 한 번 건너뛴다. Herdr 0.1.18에서는 이 버튼이 환영 화면을 건너뛴 상태를 저장한다. `overlay.close` 명령으로 닫으면 다음 렌더링에 화면이 다시 열릴 수 있다. [Herdr 환영 화면 구현](https://github.com/herdrdev/herdr-app/blob/v0.1.18/defaults/frame/welcome/main.js#L496-L524)

PowerShell에서 Herdr의 JSON 응답을 파이프로 읽으면 명령이 끝난 뒤 종료 코드를 확인할 수 있다. 다음 명령으로 합성 폴더를 space에 연결하고 생성한 space와 활성 폴더를 확인한다. 레이아웃을 사용할 수 없다는 메시지가 나오면 로컬 코어 연결을 확인한 뒤 `space.new`를 다시 시도한다.

```powershell
function Invoke-HerdrJson([string[]]$HerdrArgs) {
    $response = & $app @HerdrArgs | Out-String
    if ($LASTEXITCODE -ne 0) {
        throw "Herdr $($HerdrArgs -join ' ') failed (exit $LASTEXITCODE). $response"
    }
    $response | ConvertFrom-Json -ErrorAction Stop
}

$initialStatus = Invoke-HerdrJson @('status')
if ($initialStatus.overlays -contains 'frame-welcome') {
    throw 'Dismiss Welcome to Herdr from the fixture window before continuing.'
}
$created = Invoke-HerdrJson @('do', 'space.new', '--name', 'SwiftTree UI fixture', '--folder', $tree)
$active = (Invoke-HerdrJson @('ls')).spaces | Where-Object active
if (!$created.space -or $active.id -ne $created.space -or $active.folder -ne $tree) {
    throw 'The fixture space is not active.'
}
```

## CLI로 화면 검증

SwiftTree를 검증할 때는 같은 앱 홈에 현재 체크아웃의 후보를 설치한다. 기본 Files 동작을 검증할 때는 기본 레이아웃으로 진행한다. 아래 예제는 설치한 모듈을 확인하고 패널을 연 다음, 활성 레이아웃과 오류 상태를 확인해 캡처한다.

```powershell
& .\scripts\install-swifttree.ps1 -HerdrApp $app -AppHome $env:HERDR_APP_HOME
$installed = Join-Path $env:HERDR_APP_HOME 'mods/swifttree/main.js'
if ((Get-FileHash -LiteralPath $installed -ErrorAction Stop).Hash -ne
    (Get-FileHash -LiteralPath 'mods/swifttree/main.js' -ErrorAction Stop).Hash) {
    throw 'The installed SwiftTree module does not match the checkout.'
}

$shown = Invoke-HerdrJson @('do', 'layout.show', '--id', 'panel')
if (!$shown.ok) { throw 'Herdr did not show the panel.' }
$selected = Invoke-HerdrJson @('do', 'layout.select', '--stack', 'panel-body', '--child', 'files')
if (!$selected.ok) { throw 'Herdr did not select Files.' }

$status = Invoke-HerdrJson @('status')
if ($status.layout -ne 'swifttree' -or $status.space -ne $created.space -or
    $status.errors.Count -gt 0 -or $status.overlays.Count -gt 0) {
    $status | ConvertTo-Json -Depth 8 | Write-Host
    throw 'The fixture is not showing an error-free SwiftTree layout.'
}

function Save-HerdrFrame {
    $path = Join-Path $scratch ('files-{0}.png' -f [guid]::NewGuid())
    $capture = Start-Process -FilePath $app -ArgumentList 'shot', ('"{0}"' -f $path) -WindowStyle Hidden -Wait -PassThru
    if ($capture.ExitCode -ne 0 -or !(Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Herdr capture failed (exit $($capture.ExitCode))."
    }
    $path
}
$shot = Save-HerdrFrame
Get-Item -LiteralPath $shot
```

PNG를 열어 **SwiftTree** 제목과 합성 파일 **Proof.txt**가 같은 패널에 표시되는지 확인한다. 목록이 로딩 중이면 제한 시간 안에서 `$shot = Save-HerdrFrame`을 다시 실행해 기대 상태를 확인한다. 텍스트를 자동 확인할 때는 아래의 OCR 검사에 패널 또는 행 영역을 넘긴다. 터미널 경로 동기화 검증에는 `hc get <terminal> --json`의 `foreground.cwd` 또는 `hc read`로 확인한 현재 프롬프트를 사용한다. 같은 프레임의 패널 제목과 해당 경로에만 있는 파일을 대조한다. `hc get`의 최상위 `cwd`는 터미널 시작 경로다.

검증 기록에는 저장소 후보, Herdr App과 core 버전, OS 빌드, 창 크기, 명령이나 조작 순서, 기대 결과와 관측 결과, 이미지 보관 위치를 남긴다.

Windows 빌드 26300의 새 프로필에서 Herdr App 0.1.18, core 0.1.22로 위 절차를 실행했다. `layout.show`와 `layout.select`가 차례로 성공했고 `status`에서 `swifttree` 레이아웃과 오류·오버레이 0건을 확인했다. 1600×1025 캡처를 열어 `SwiftTree`와 `Proof.txt`를 확인했고 OCR 검사도 통과했다.

## #2 기본 Herdr 네이티브 입력 재현

Computer Use에서 격리된 창을 선택한다. 기존 Herdr 창도 열려 있으면 검증 프로세스의 `MainWindowHandle`을 확인하고 목록에 반환된 창 ID와 대조한다. 클릭 위치와 포커스는 각 동작 직전의 화면으로 확인한다. 아래 경로는 [검증 경로 확인 #2](https://github.com/kalstein00/herdr-swift-tree/issues/2)에서 기본 Files와 명령 팔레트의 입력을 확인할 때 사용했다. SwiftTree의 입력은 해당 후보에서 검증한다.

| 동작 | 화면에서 확인할 결과 |
| --- | --- |
| 상단 `Files` 버튼을 클릭한다. | 합성 루트와 접힌 `alpha`가 표시된다. |
| `alpha`를 펼쳐 `branch`를 클릭한다. | 두 폴더가 펼쳐지고 `row-001.txt`부터 파일이 표시된다. |
| Files 목록 안에서 아래로 스크롤한다. | 보이는 목록 범위가 바뀌고 끝에서 `row-075.txt`가 나타난다. |
| `Ctrl+Shift+P`로 명령 팔레트를 열고 `↓`를 누른다. | 팔레트 선택이 `New tab`에서 `Go to space or tab...`으로 이동한다. |

접힌 목록, 펼친 목록, 마지막 행, 팔레트 선택을 캡처하고 각각 직접 열어 행 이름, 펼침 상태, 포커스와 배치를 검사한다. 기본 Files 행 위의 하이라이트는 포인터 호버 상태로 기록한다.

## #2 결과

Windows 11 Pro 빌드 26300에서 Herdr App 0.1.18, core 0.1.22, 기본 레이아웃과 Files를 사용했다. 네이티브 프레임 크기는 1600×1025였다. 위 네 동작을 같은 창에서 수행했고, 접힌 목록부터 마지막 행과 팔레트 선택까지 네 화면을 열어 확인했다. 캡처는 작업의 로컬 아티팩트에 보관했다.

Agent Browser 0.45.0의 `connect`는 실제 Herdr를 대상으로 쓸 수 없었다. 실행 중인 Herdr 프로세스에는 TCP 수신 포트가 없었고, 설치본은 `--remote-debugging-port`를 알 수 없는 인자로 처리했다. 비어 있는 로컬 포트로 실행한 연결 시도는 CDP와 BiDi 탐색에 실패해 종료 코드 1을 반환했다. [Agent Browser 연결 방식](https://agent-browser.dev/cdp-mode)

Herdr App 0.1.18의 기본 Files는 포인터 클릭으로 행을 열며, 방향키로 이동하는 행 선택 상태를 제공하지 않는다. SwiftTree 트리의 방향키 이동, 원격 탐색과 성능은 해당 기능이 설치된 후보에서 확인한다. [기본 Files 행과 스크롤 영역 구현](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L252-L280)

## SwiftTree의 Windows 로컬 탐색 검증

Herdr App 0.1.18의 격리된 레이아웃에서 `scripts/install-swifttree.ps1`의 `-AppHome`에 대상 프로필을 지정한다. 홈 아래와 홈 밖 NTFS 폴더를 각각 space의 시작 폴더로 지정한다. 합성 폴더에는 숫자가 붙은 폴더·파일 이름, 파일이 든 하위 폴더, 빈 폴더, 테스트 계정의 열거 권한을 거부한 폴더, 읽기 중 삭제할 폴더를 둔다. 각 위치의 파일을 독립적으로 열거해 기대 목록을 기록한다.

1. 상단 Files 버튼으로 SwiftTree를 열고 처음 보이는 행과 파일·폴더 순서를 비교한다. 폴더를 펼친 뒤 `↓`로 자식 행을 선택한다. 이름에 곡선형 아포스트로피가 있는 폴더도 펼쳐 자식 파일을 확인한다.
2. 한 터미널에서 `cd`를 실행한 뒤 다른 폴더에서 시작한 pane으로 포커스를 옮긴다. 각 단계에서 활성 터미널의 현재 경로와 SwiftTree 제목 및 고유 파일 행이 일치하는지 확인한다. 아래 CLI 회귀 테스트는 각 화면을 캡처하고 OCR로 파일 행을 확인한다.
3. 빈 폴더, 읽기 권한이 없는 폴더, 목록을 요청한 뒤 삭제된 폴더를 열어 각각의 문구를 확인한다.
4. `Ctrl+Shift+P`에서 `layout`을 검색하고 `Layout: Herdr`로 전환한다. Files 버튼으로 기본 패널을 닫았다가 다시 연다.

실제 창에서 저장한 PNG의 패널 영역에서 제목과 행 순서를 확인할 수 있다. 아래 좌표는 1600×1025 네이티브 프레임의 오른쪽 패널 예다. 창 크기가 다르면 해당 패널에 맞춰 좌표를 지정한다. OCR은 텍스트 순서를 확인하며 포커스와 선택 상태는 이미지를 직접 열어 검사한다.

```powershell
uv run --isolated --python 3.13 --with pillow --with winrt-Windows.Media.Ocr --with winrt-Windows.Graphics.Imaging --with winrt-Windows.Storage --with winrt-Windows.Storage.Streams python tests/assert_herdr_panel.py <capture.png> SwiftTree Folder02 alpha.txt --crop 1130 50 455 620
node --test tests/windows-directory.test.mjs
./tests/windows-terminal-root.ps1 -FixtureRoot $scratch -HerdrApp $app
```

코어도 다른 위치에 설치했다면 `-HerdrCore`에 `hc.exe` 경로를 지정한다. 테스트는 만든 space를 닫고 PNG 경로를 출력한다.

## SwiftTree의 SSH Linux 탐색 검증

같은 Windows Herdr 창에 NTFS space와 연결된 Linux SSH space를 준비한다. 두 탐색 루트의 마지막 이름은 같게 만들고 서로 다른 파일을 둔다. Linux에는 숫자 순서가 다른 폴더와 파일, 각각 고유한 자식이 있는 폴더를 두 개 이상 만든다.

1. SSH space에서 Files를 열고 Linux에 직접 접속해 읽은 기준 목록과 화면의 이름·종류·순서를 비교한다. 폴더를 펼쳐 원격에서만 존재하는 자식을 선택한 뒤 화면을 캡처한다.
2. 테스트 게스트의 네트워크에 지연을 준다. 원격 폴더 두 개를 연속으로 펼치고 로딩 표시가 남아 있는 동안 NTFS space로 전환한다. 원격 응답이 도착한 뒤에도 로컬 전용 파일이 보이는지 확인하고 화면을 캡처한다. 지연을 적용하기 전 설정은 검증 뒤 복구한다.
3. 원격 트리에서 이미 표시된 하위 폴더의 상위 디렉터리에서 검색 권한을 제거한다. 하위 폴더를 펼쳐 `Access denied`를 확인한다. 이미 표시된 다른 폴더를 삭제한 후 펼치면 `Folder no longer exists`가 표시되어야 한다.

로컬 캡처에서 원격 파일이 섞이지 않았는지 검사할 때 `tests/assert_herdr_panel.py`의 `--exclude <파일명>`을 사용한다. `node --test tests/linux-directory.test.mjs`는 원격으로 전달할 머신과 경로, Linux 목록 디코딩, Windows 정렬 및 불완전한 응답 처리를 검사한다.

Agent 레이아웃도 별도로 검증한다. 격리 창에서 `swifttree` 레이아웃을 복제하고 중앙 블록의 내용을 `{ "agent": "focused" }`로 바꾼다. 로컬 space를 활성 상태로 둔 채 `hc run --on <machine> --bg --cwd <remote-folder>`로 별도 pane이 없는 SSH 터미널을 열고, `herdr-app do agent.focus --terminal <address>`로 표시한다. `hc get <address> --json`의 `foreground.cwd`와 SwiftTree 제목을 대조하고 원격 고유 파일을 캡처에서 확인한다. 같은 SSH 터미널에서 `cd`를 실행하고 새 경로와 고유 파일 행을 다시 확인한다.

## 폴더 선택과 재시작 복원 검증

격리된 프로필에서 폴더가 지정되지 않은 로컬 space와 SSH space를 준비한다. Files를 볼 때는 터미널이 없는 모드 탭을 선택해 각 space의 패널에 **Open folder**가 표시되는지 확인한다. 상단 **+ → Terminal**로 연 터미널의 실제 시작 경로를 각각 기록하고, 폴더 선택과 복원 확인은 모드 탭에서 진행한다.

1. 로컬 패널에서 **Open folder**를 눌러 Windows 폴더 선택 창으로 표시할 합성 폴더를 고른다. SSH 패널에서는 연결된 머신의 절대 경로를 입력해 **Open**을 누른다. 두 루트에 한쪽에서만 보이는 파일을 두고 화면에서 구별한다.
2. 다른 space로 이동했다 돌아오고 각 탐색 루트를 확인한다. 격리된 Windows Herdr 창을 닫고 앱 프로세스가 종료됐는지 확인한 뒤 같은 프로필로 다시 실행한다. 로컬과 SSH 패널을 각각 열어 저장한 루트가 복원되는지 확인하고 캡처한다.
3. 두 space에서 다시 **+ → Terminal**을 실행한다. 터미널 프롬프트와 `hc get <terminal> --json`의 `cwd`를 기록하고 이전 시작 경로와 비교한다. `herdr-app ls`에서도 두 space의 지정 폴더가 여전히 비어 있는지 확인한다.

## 읽기 전용 미리보기 검증

NTFS와 SSH마다 내용이 다른 파일 A·B와 스크롤할 수 있는 합성 트리를 준비한다. 파일 본문 접근을 관측하면서 폴더를 펼치고 마지막 자식까지 스크롤한다. 이 구간의 데이터 열기·읽기 이벤트 수를 기록한다. 목록·디렉터리 메타데이터 조회는 본문 읽기에서 제외한다.

1. 실제 Windows Herdr의 트리에 A와 B가 보이는 상태에서 A 읽기만 잠시 지연시킨다. A를 열고 로딩이 표시되는 동안 바로 옆 B를 연다.
2. B의 행 선택과 본문을 같은 프레임에서 확인한다. A가 풀리고 읽기가 끝난 뒤에도 B의 이름·본문이 유지되는지 확인한다. 미리보기에서 수정 입력이 적용되지 않는지 확인한다.
3. NTFS에서는 합성 파일의 oplock 알림으로 데이터 열기를 관측하고, Linux에서는 합성 폴더의 inotify 파일 접근과 A의 파일 lease를 기록한다. A와 B를 열었을 때 감지가 작동하는지 양성 대조로 확인한다. Windows와 Linux의 원시 시각은 각각의 시간축에서 비교한다. [Windows oplock 중단](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/breaking-oplocks) · [Linux 파일 lease](https://www.man7.org/linux/man-pages/man2/F_SETLEASE.2const.html)

패널에서 본문 글자가 작아 OCR이 어긋나면 본문을 좁게 잘라 `--scale 3`으로 검사한다. 파일 선택과 읽기 전용 표시가 함께 보이는 화면은 별도로 직접 연다.

### 파일 미리보기 닫기 검증

NTFS와 SSH에 `alpha.js`, `binary.bin`, `bravo.txt`, `empty.txt`, `missing.txt`가 보이는 합성 루트를 만든다. `alpha.js`는 `const previewLine001 = "ALPHA 001";`부터 줄 번호가 서로 다른 160줄로 만들고 `bravo.txt`에는 `BRAVO PROOF`를 쓴다. `binary.bin`에는 NUL을 포함한다. `missing.txt`는 트리에 보이는 상태에서 본문 읽기만 실패하도록 설정한다.

1. 격리된 실제 창에서 첫 행 `alpha.js`를 클릭한 뒤 포인터를 미리보기 제목 줄 오른쪽으로 옮기고 `herdr-app shot`으로 `opened.png`를 저장한다. 그 위치의 **×**를 클릭하고 `closed.png`를 저장한다. 수정 전 후보에서도 같은 위치를 클릭한다. 기본 1600×1025 프레임의 닫기 위치는 `(1563, 574)`다. 다른 크기에서는 화면에서 위치를 다시 확인한다.
2. 기본 1600×1025 프레임에서는 아래 명령으로 미리보기가 닫혔고 첫 행에 선택이 남았는지 확인한다. `Enter`로 다시 열고, 닫은 뒤 클릭으로도 다시 연다. 긴 본문을 휠로 스크롤하고 **×**로 닫아 본다. 방향키로 `bravo.txt`를 선택한 직후에는 `alpha.js`가 보이고 `Enter`를 누른 뒤에만 본문이 바뀌어야 한다.
3. 빈 파일, 읽기 실패, 표시할 수 없는 파일에서도 각각 **×**로 닫는다. 위의 방법으로 `alpha.js` 읽기를 지연시켜 로딩 중에 닫는다. 지연을 풀고 본문 읽기 완료를 관측한 뒤에도 미리보기가 닫혀 있어야 한다. 다시 지연시켜 닫고 `bravo.txt`를 연 뒤, `alpha.js` 읽기가 완료돼도 `bravo.txt`의 제목, 본문과 선택이 유지되는지 확인한다.

```powershell
uv run --isolated --python 3.13 --with pillow --with winrt-Windows.Media.Ocr --with winrt-Windows.Graphics.Imaging --with winrt-Windows.Storage --with winrt-Windows.Storage.Streams python -B tests/assert_herdr_preview_close.py opened.png closed.png
```

### 확대 미리보기 검증

같은 NTFS와 SSH 합성 루트에 언어를 식별할 수 없는 확장자의 텍스트 파일을 추가한다. 기존 `alpha.js`는 구문 강조와 줄 번호를 확인하는 데 사용한다. `example.ts`, `.ts`, `.bashrc`, `example.js.erb`로 파일명·복합 확장자도 확인한다.

1. `alpha.js`를 열고 방향키로 `bravo.txt`를 선택한 뒤 아래쪽 본문을 휠로 스크롤한다. `inline.png`를 저장하고 제목 줄의 **크게 보기**를 누른다. 기본 1600×1025 프레임에서 클릭 위치는 `(1500, 574)`다. `expanded.png`에 `alpha.js`의 제목과 1번 줄이 나오며 키워드와 문자열에 구문 강조가 적용돼야 한다. 파일 읽기를 관측할 수 있으면 같은 파일을 다시 열 때의 양성 대조와 비교한다.
2. 확대 화면에서 첫 줄을 선택해 복사하고 클립보드의 전체 문장을 비교한다. 타이핑과 붙여넣기를 한 뒤 같은 문장을 다시 복사하고 원본 파일도 비교한다. 알 수 없는 확장자의 파일을 같은 방법으로 열어 일반 텍스트가 줄 번호와 함께 표시되는지 확인한다.
3. 확대 화면에서 스크롤한 뒤 `Esc`로 닫고 `returned.png`를 찍는다. 아래쪽에서 보던 줄과 트리 선택이 유지됐는지 확인한다. 다시 확대하면 1번 줄에서 시작해야 한다. 다시 스크롤한 뒤 중앙의 **×**로 닫아서 같은 확인을 반복한다. 이어서 아래쪽 **×**가 아래 미리보기만 닫는지 확인한다.
4. 로딩, 빈 파일, 읽기 실패, 표시 불가 상태에는 아래쪽 **×**만 보여야 한다. Files 패널을 좁힌 상태에서 두 버튼이 겹치거나 잘리지 않는지 보고 각각 눌러 확인한다.

Windows NTFS와 SSH Linux 모두 Windows Graphics Capture로 확대 창을 캡처하고 `herdr-app shot`으로 아래쪽 상태를 캡처한다. 두 닫기 방식에서 캡처한 아래쪽 본문과 선택 행을 비교한다.

#### Markdown 확대 미리보기

헤딩, 목록, 표, 코드 펜스, Mermaid, 인라인·블록 수식과 문서 하단 헤딩을 가리키는 참조 링크가 들어 있는 `.md`를 준비한다. 다른 제목을 가진 `.markdown`과 일반 `.txt`도 같은 루트에 둔다.

1. Files에서 `.md`를 선택하고 아래쪽 원문을 스크롤한다. **크게 보기**가 첫 화면에 **문서 보기**를 열면 표 셀, 코드와 다이어그램, 두 종류 수식을 확대 창에서 캡처해 확인한다. 문서 내 참조 링크를 클릭해 하단 제목으로 이동한다.
2. **원문**을 누르고 같은 파일명과 줄 번호, Markdown 기호가 보이는지 확인한다. 원문을 선택해 복사한 텍스트를 파일과 비교한다. **문서 보기**로 돌아가 하단 제목이 보이는 상태에서 `Esc`로 닫는다.
3. 같은 파일을 다시 열어 처음부터 **문서 보기**로 시작하는지 확인한다. **원문**에서 중앙의 **×**로 닫는다. 두 번 닫은 뒤 Herdr 창이 포커스를 되찾고 아래쪽 선택과 스크롤 위치가 같은지 캡처를 비교한다.
4. `.markdown`과 `.txt`를 차례로 확대한다. 각각 새 파일이 표시되고 `.txt`에는 보기 전환 버튼이 표시되지 않아야 한다. 오프라인 설치본의 로컬 자산이 같은 동작을 제공하는지 확인한다.

#### Windows 로컬과 SSH Linux의 대용량 파일

1. 1 MiB에서 1바이트 모자란 파일, 정확히 1 MiB인 파일, 1바이트 초과한 파일, 8 MiB 파일, 32 MiB 파일을 만든다. 파일명에 0을 채운 8자리 바이트 수를 쓴다(예 `01048577.txt`). 첫 줄에는 `TOP SIZE PROOF`와 바이트 크기를, 마지막 줄에는 `END SIZE PROOF`와 바이트 크기를 넣는다. 64 KiB 경계를 UTF-8 한글 문자 중간에 둔 파일도 준비한다.
2. 격리 Herdr에서 Files를 열고 각 파일을 클릭한다. 아래쪽의 파일명과 **Showing the start of the file**을 확인하고 `inline.png`로 저장한다. **크게 보기**를 눌러 중앙 뷰어의 첫 줄을 캡처한다. `Ctrl+End`로 끝에 가서 마지막 줄도 캡처한다. 아래 명령에서 `1048577`을 검증 파일의 바이트 크기로 바꾼다.
3. 32 MiB 파일의 끝 문구와 UTF-8 경계 문구를 `Ctrl+F`로 찾는다. 본문 선택과 클립보드 내용을 비교하고 타이핑이나 붙여넣기 뒤에도 같은 본문을 복사할 수 있는지 확인한다. 시작 전과 종료 후 원본 파일의 SHA-256도 비교한다.
4. 격리 프로필을 시작할 때 `SWIFTTREE_PREVIEW_TRACE`에 작업용 절대 경로를 지정한다. Files를 열기 전에 `prewarm/ready`를 확인한다. 창을 숨겼다가 열 때의 창 핸들, 호스트 PID, 브라우저 PID를 확인한다. 열기 전후에 Herdr의 네이티브 포커스를 확인하고, 격리 Herdr가 종료된 뒤 해당 호스트가 종료되는지 확인한다.

```powershell
uv run --isolated --python 3.13 --with pillow --with winrt-Windows.Media.Ocr --with winrt-Windows.Graphics.Imaging --with winrt-Windows.Storage --with winrt-Windows.Storage.Streams python -B tests/assert_herdr_large_preview.py 1048577 inline.png --expanded first.png --end last.png
```

SSH에서는 같은 크기의 자료를 격리된 원격 탐색 루트에 복사한 뒤 위 순서를 반복한다. 별도 SSH 연결에서 파일 lease로 A의 열기를 늦추고 아래쪽 **×**를 누른 뒤 B를 연다. 원격 연결이 끊겼을 때 오류를 캡처하고 다시 연결한 뒤 같은 경로를 열어 최신 내용을 확인한다. 이미 받은 첫 부분이 표시되는 동안 32 MiB 파일을 교체하거나 메타데이터가 그대로인 매핑 쓰기를 수행하고 파일 변경 안내를 캡처한다. 범위 사이에서 SSH 연결이 교체되면 기존 요청이 중단 상태로 끝나는지 확인한다.

#### 장문 첫 화면 시간

`scripts/preview_benchmark_fixture.py <folder> NTFS`와 `scripts/preview_benchmark_fixture.py <folder> SSH`로 8 MiB 원문과 280개 섹션의 Markdown을 각각 두 개씩 만든다. SSH 쪽 자료는 격리한 원격 디렉터리에 복사한다. Windows 밝은 테마와 디스플레이 배율 100%에서 격리 Herdr의 클라이언트 크기를 1600×1025로 맞춘다. Files에 검증 폴더만 열고 네 파일이 번호 순서로 표시되는지 확인한다.

각 파일을 한 번 열어 첫 본문, Markdown의 첫 다이어그램과 수식이 표시된 1290×804 확대 창을 Windows Graphics Capture로 저장한다. 캡처 이름은 `source-A.png`, `source-B.png`, `design-A.png`, `design-B.png`로 저장한다. 프로젝트의 `scripts/capture_baseline.py`에 확대 창 HWND와 `--seconds 1 --crop 0 0 1290 804`를 주면 기준 프레임을 캡처할 수 있다. 격리 Herdr를 시작하기 전에 네이티브 추적 경로 `SWIFTTREE_PREVIEW_TRACE`를 지정한다.

```powershell
uv run --isolated --python 3.13 --with opencv-python --with numpy --with windows-capture python -B scripts/preview_benchmark.py <Herdr-HWND> <output> <references> --profile <isolated-app-home> --trace <trace-file> --shape design --mode different --count 20
```

`--shape source`와 `--shape design` 각각에 대해 `--mode cold`, `different`, `reopen`을 실행한다. 원격 공간에서는 `--ssh`를 추가한다. 콜드 표본은 클릭 전에 격리 프로필의 확대 프로세스를 종료하고, 같은 WebView2 사용자 데이터로 프로세스를 다시 시작한다. 다른 파일은 두 파일을 교대로 열고, 다시 열기는 같은 파일을 반복한다. 스크립트는 시작한 프로세스 또는 준비된 프로세스가 실제로 사용됐는지 네이티브 추적으로 확인한다.

첫 본문은 파일마다 다른 본문 표식이 처음 보인 Windows Graphics Capture 프레임으로 판정한다. Markdown은 첫 다이어그램과 첫 블록 수식의 프레임도 따로 기록한다. `samples.json`에 실제 클릭 시각, 프레임 시각, 원시 표본과 p50·p95를 보관하고, SSH의 테스트 연결 RTT를 함께 기록한다. 첫 프레임의 파일명과 본문을 직접 연다. 문서 내 링크로 마지막 섹션으로 이동하고 필요한 만큼 스크롤해 마지막 다이어그램과 수식 및 원문 끝까지 확인한다.

## Windows 외부 변경 감시 검증

격리된 NTFS 합성 루트를 Git 저장소로 초기화하고 `Left`, `Right`, `Burst`를 만든다. 격리된 Herdr 프로세스를 시작하기 전에 쓰기 가능한 별도 절대 경로를 환경 변수 `SWIFTTREE_WINDOWS_TRACE`에 넣는다. 기록에서 `watch/ready`를 확인하고 실제 Files의 `Left`와 `Right`를 펼친다.

1. 앱 외부에서 생성, 삭제, 이름 변경을 각각 25회 실행한다. 성공 직후의 Windows 고해상도 카운터 값과 화면 변화가 처음 나타난 Windows Graphics Capture 프레임의 같은 시간축 값을 대조한다. 각 종류에서 95번째 백분위수는 순위법으로 계산하고 500ms 이내인지 확인한다. 이름 변경과 삭제에서는 이전 이름이 화면에서 사라진 것도 확인한다.
2. 열린 두 폴더를 65초 동안 그대로 두고 `list` 기록이 추가되거나 감시 연결이 다시 열리지 않는지 확인한다. Git 저장소에서도 감시·목록 갱신 경로에는 상태 배지 요청을 보내는 호출이 없는지 확인한다.
3. 한 열린 폴더의 파일을 다른 열린 폴더로 이동한다. 실제 패널에서 원래 행이 사라지고 대상 폴더에 행이 한 번만 나타나는지 확인한다.
4. 격리된 해당 감시 프로세스가 이벤트를 처리하지 못하는 짧은 구간에 닫힌 `Burst`로 긴 이름의 합성 파일을 대량 이동한다. 같은 구간에 열린 양쪽 폴더의 내용도 바꾼다. 감시를 재개한 후 `watch/overflow`와 함께 루트 및 펼친 폴더의 `list/recovery`를 확인한다. 패널이 그대로 펼쳐진 상태에서 독립적으로 열거한 목록과 표시 순서를 대조한다.

원시 프레임, 변경 성공 시각, 목록 기록, 설치 후보를 함께 보관한다. 목록 기록은 SwiftTree가 실행한 목록 작업을 세는 자료다. 화면이나 다른 프로세스의 파일 시스템 호출은 포함하지 않는다.

## SSH 외부 변경 감시 검증

격리된 Windows Herdr에 제품 후보를 설치하고 netem 20ms의 QEMU Linux를 연결한다. 합성 루트와 자식 `Left`, `Right`를 열어 처음 목록이 나온 것을 확인한다. 다른 SSH 연결을 써서 파일을 바꾸고 기준 목록을 읽는다.

1. 루트와 열린 두 폴더의 디렉터리 읽기를 Linux inotify로 관측한다. 각 경로를 한 번 열거해 관측 도구가 읽기를 감지하는지 확인한다. 안정된 상태로 30초 동안 목록 읽기 0회를 확인한다. 주기적 메타데이터 확인과 SSH 연결 유지 트래픽은 목록 열거와 구분한다.
2. 같은 창과 열린 폴더를 유지한 채 생성·삭제·이름 변경을 각 25회 수행한다. Windows에서 원격 작업의 요청 전과 성공 응답 후 QPC 시각을 기록해 작업 성공 범위를 얻는다. 결과가 처음 나타난 네이티브 프레임으로 각 p95의 상한을 구하고 1초 이하인지 확인한다. 이름 변경에는 이전 이름 소멸과 새 이름 출현이 모두 필요하다. [측정 방식](remote-watch-feasibility.md#같은-구성에서-유휴와-단일-변경-측정)
3. 외부에서 파일을 열린 폴더 사이로 이동한다. 기존 위치에서 사라지고 대상에 한 번만 표시되는지 확인한다.
4. 격리된 게스트에서 해당 합성 루트에 대한 SwiftTree의 원격 메타데이터 요청을 중단한 직후 열린 두 폴더를 변경한다. **Live updates unavailable**이 표시되는 프레임과 감시 복귀 후 프레임을 캡처한다. 별도로 읽은 게스트 목록과 복귀한 화면의 열린 폴더를 대조한다.

## Windows 파일 이름 검색 검증

1600×1025 격리 창에서 로컬 NTFS 탐색 루트의 Alpha와 Bravo 폴더에 각각 tree-rows.js를 둔다. 본문은 각각 ALPHA PREVIEW PROOF와 BRAVO PREVIEW PROOF다. 같은 루트의 build에는 ScopeBuild.txt를, .git에는 ScopeGit.txt를 둔다. 루트 밖 ScopeLink.txt가 든 폴더를 junction으로 연결한다. 두 번째 루트에는 ScopeAlternate.txt를 둔다.

SwiftTree를 설치한 뒤 원래 루트의 터미널을 포커스하고, PowerShell 7에서 검증 창 PID와 캡처 폴더를 windows-file-search.ps1에 넘긴다. AlternateRoot는 두 번째 루트의 절대 경로다. 테스트는 Win32 키·마우스 입력으로 Ctrl+P, 파일명 입력, 선택과 취소를 수행하고 Herdr 캡처와 터미널 출력으로 결과를 확인한다.
