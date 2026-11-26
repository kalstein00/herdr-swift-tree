# Herdr 기본 Files 패널의 동작

2026년 11월 26일 기준 Herdr App 배포 버전은 0.1.18이다. 아래 내용은 해당 태그의 소스를 기준으로 한다. Files는 포커스된 터미널의 폴더를 따라가며, 루트와 사용자가 펼친 폴더의 목록을 메모리에 보관한다. [공식 배포 정보](https://releases.herdr.dev/app/latest.json) · [폴더 선택](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L50-L58) · [목록 갱신](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L138-L179)

## 패널을 열고 폴더를 펼칠 때

- 기본 레이아웃은 오른쪽 패널을 숨긴 상태로 시작한다. 패널 안에는 Files와 Changes가 있고 Files가 먼저 선택되어 있다. 탭 표시줄의 Files 버튼을 누르면 해당 패널이 열리고, 열린 상태에서 다시 누르면 닫힌다. [기본 레이아웃](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/layouts/main.json#L135-L165) · [Files 버튼](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/tabs/main.js#L131-L152)
- 루트는 포커스된 pane의 작업 디렉터리, 포커스 정보의 작업 디렉터리, 활성 space의 폴더 순서로 정한다. 작업 디렉터리·머신·space 조합이 바뀌면 이전 위치에서 펼친 폴더와 선택한 파일을 기억한다. 돌아오면 그 선택을 복원하고 목록을 다시 읽는다. [위치 선택](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L50-L56) · [상태 복원](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L138-L151)
- 한 디렉터리를 읽을 때 로컬 Windows에서는 PowerShell의 `Get-ChildItem -LiteralPath … -Force`를 실행한다. 다른 로컬 환경과 원격 머신에서는 `sh`로 일반 항목과 숨김 항목을 열거하고, 원격에서 `sh`를 찾지 못하면 그 머신에서 PowerShell로 재시도한다. 양쪽 모두 `.git`을 건너뛴다. [디렉터리 열거](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L60-L82)
- 폴더를 펼치면 그 폴더의 직계 자식을 읽는다. 접으면 그 아래의 펼침 상태와 목록을 지운다. 한 폴더에서 최대 501개까지 열거해 초과 여부를 확인하고, 가져온 순서에서 최대 500개를 남긴 뒤 폴더 우선·이름순으로 정렬한다. 메모리에 보관하는 전체 항목은 최대 5,000개이며, 한도에 걸리면 패널에 안내를 표시한다. [항목 선택과 정렬](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L129-L135) · [펼치기와 접기](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L212-L230) · [한도 표시](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L273-L280)

## 파일시스템 변경이 화면에 반영되는 과정

1. 로컬에서는 현재 작업 디렉터리에 `watchFolder`를 건다. 변경 경로가 하나라도 도착하면 패널에 갱신이 필요하다고 표시한다. 갱신 시 루트부터 시작해 **펼친 모든 폴더**를 차례로 다시 열거한다. 원격 머신에서는 이 감시를 건너뛴다. [감시 등록과 변경 처리](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L104-L122) · [목록 재조회](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L172-L180)
2. 500ms 타이머는 갱신 시점이 되었는지 확인한다. 창이 활성 상태이고 이전 조회가 끝났을 때, 감지한 변경이나 정기 조회 시점에 맞춰 갱신한다. 변경이 있거나 감시가 없는 상태에서 창으로 돌아오면 따라잡기 조회를 요청한다. 기본 정기 조회 간격은 10초다. Git 상태 조회가 500ms 이상 걸리면 그 소요 시간의 5배를 지연으로 적용하며 최대 60초까지 늘린다. 이 값들은 화면 반영 시간의 보장치가 아니다. [갱신 조건](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L85-L102) · [정기 조회 설정](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L160-L171) · [Git 조회 지연](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L22-L35)
3. 목록을 다시 읽은 뒤 `git rev-parse --show-toplevel`로 저장소 루트를 구한다. 성공하면 `git status --porcelain=v1 -z --no-renames --untracked-files=all`에 선택적 잠금과 fsmonitor를 끄는 옵션을 붙여 실행한다. Files와 Changes는 같은 머신·저장소에 대한 조회를 공유할 수 있다. Files는 결과를 경로별 A·U·D·M 표시로 바꾼 뒤 `cx.notify()`로 화면 갱신을 요청한다. [공유 Git 조회](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L6-L35) · [경로별 표시와 갱신](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L180-L208)
4. 렌더링할 때는 메모리에 있는 목록을 순회하며 펼친 폴더의 항목마다 행을 만든 뒤 스크롤 컨테이너에 넣는다. 화면 밖의 행도 이 순회에 포함되며, 행 수 5,000개와 재귀 깊이 40을 상한으로 둔다. 파일을 누르면 별도 읽기 전용 미리보기가 열린다. 바이너리로 판별된 텍스트에는 안내를 표시하고, 긴 텍스트는 처음 400,000 UTF-16 코드 단위까지 표시한다. [행 구성과 렌더링](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L252-L283) · [파일 미리보기](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L233-L249)

## 설치본과 조사한 리비전

이 Windows 호스트의 Herdr App은 0.1.18, hc는 0.1.22다. 설치된 `mods/files/main.js`는 줄바꿈을 정규화하면 App 0.1.18 태그 및 조사 시점의 master와 전문이 일치한다. 아래 런타임 분석은 App master `3e6d564`, core master `329cb66`에 고정했다. 배포 태그는 각각 `9a9ae13`, `6e29846`이다. [App master](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/defaults/mods/files/main.js) · [core master](https://github.com/herdrdev/herdr-core/blob/329cb66ebce5eca3d917fcf7364a099046979b49/crates/herdr-core/src/remote.rs) · [core 배포 태그](https://github.com/herdrdev/herdr-core/tree/6e2984629fcd600b0165f69b2e5b0bda5985ec1c)

## Mod API에서 사용할 수 있는 경로

| 영역 | 문서와 구현에서 확인한 동작 | SwiftTree 설계에 미치는 영향 |
| --- | --- | --- |
| 로컬 목록 | `fs/promises.readdir(path, {withFileTypes:true})`는 작업 스레드에서 열거·정렬하고 이름과 디렉터리 여부를 돌려준다. 읽기 권한은 기본적으로 사용자 홈과 앱이 추가한 Mod 경로에 묶인다. 직계 항목 10,000개 또는 이름 합계 1 MiB를 넘으면 호출이 실패한다. 페이지 인자는 없다. [권한 부여](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/src/mods.rs#L1407-L1419) · [열거와 반환](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/crates/herdr-shell/src/engine/quickjs/host.rs#L226-L245) · [예산과 파일 유형](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/crates/herdr-shell/src/engine/quickjs/host.rs#L442-L520) | 홈 아래에서는 PowerShell을 생략할 후보가 이미 있다. 홈 밖의 작업공간, 단일 대형 폴더, 링크 대상이 디렉터리인 경우에는 별도 검증이 필요하다. |
| 원격 목록 | Files의 `directory`는 폴더당 한 번 원격 셸을 부른다. 앱의 `run_remote_with_limit`는 로컬 `hc exec --json --on`을 실행하고 JSON 결과의 base64 출력을 복원한다. Core는 머신별 연결을 유지하고 원격에서 자식 프로세스를 실행한다. 개별 자식의 유형 검사는 원격 셸 안에서 수행된다. [앱 실행 경로](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/src/mods.rs#L924-L950) · [머신 연결](https://github.com/herdrdev/herdr-core/blob/329cb66ebce5eca3d917fcf7364a099046979b49/crates/herdr-core/src/remote.rs#L1-L4) · [원격 프로세스](https://github.com/herdrdev/herdr-core/blob/329cb66ebce5eca3d917fcf7364a099046979b49/crates/herdr-core/src/exec.rs#L132-L175) | 폴더별 명령 수, SSH 연결 수립 횟수, 전송 바이트를 따로 센다. Linux 셸은 반복 전에 glob을 전개하므로 출력 501개 제한만으로 실제 디렉터리 I/O가 501개에 제한된다고 볼 수 없다. |
| 변경 통지 | `watchFolder(path)`는 로컬 변경 경로 묶음을 반환하는 취소 가능한 단발 대기다. 한도를 넘긴 변경은 루트 경로 하나로 합쳐진다. 폴더 감시 자원은 Mod끼리 공유한다. Windows는 재귀 감시를 사용한다. 원격 머신을 지정하는 인자는 없다. [공식 계약](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/defaults/herdr.d.ts#L510-L530) · [등록과 대기](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/src/files.rs#L144-L198) · [변경 병합](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/src/files.rs#L303-L328) | 로컬은 변경된 부모만 다시 읽는 방식을 검토할 수 있다. 루트 통지, 이벤트 유실, 원격 재연결 이후에는 실제 목록과 대조하는 복구 동작이 필요하다. |
| 비동기·취소·스트리밍 | `cx.spawn`으로 시작한 JS의 동기 연산은 foreground에서 실행된다. `exec`는 작업 스레드에서 프로세스를 실행하고 완료된 뒤 stdout/stderr를 한 번에 반환한다. API에는 실행 중 stdout 구독이나 자식 프로세스 취소 핸들이 없다. 원격 core에는 동시에 실행 가능한 exec 16개 제한이 있다. [JS 스케줄러](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/crates/herdr-shell/src/engine/quickjs/scheduler.rs#L1-L24) · [Mod 타입](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/defaults/herdr.d.ts#L4-L17) · [호스트 실행](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/src/mods.rs#L1094-L1112) · [core 제한](https://github.com/herdrdev/herdr-core/blob/329cb66ebce5eca3d917fcf7364a099046979b49/crates/herdr-core/src/exec.rs#L17-L47) | 화면 전환 후의 결과 폐기와 실제 I/O 취소를 별도로 검증한다. 병렬 조회 수를 늘릴 때는 입력 지연과 서버 부하도 함께 본다. |
| JS와 GPUI | `ScriptView`는 무효화된 뷰의 스냅샷을 다시 만들며 GPUI는 스냅샷을 재사용할 수 있다. `v_virtual_list`는 배치·그리기 준비 단계에 보이는 범위의 행을 JS에 요청한다. 행 클릭은 안정된 키와 목록 수준 핸들러로 연결한다. [뷰 렌더](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/crates/herdr-shell/src/view.rs#L287-L315) · [GPUI 변환](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/crates/herdr-shell/src/materialize.rs#L1-L43) · [행 이벤트](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/crates/herdr-shell/src/materialize/components/virtual_list.rs#L15-L42) | 기본 Files의 JS 행 생성, 스냅샷 구성, 네이티브 요소 생성, 화면 표시를 구별해 측정한다. 가상화의 효과는 데이터 열거·정렬 비용과 별도로 본다. |
| 상주 Helper | 앱은 Mod에 네트워크 접근을 허용하고 QuickJS 모듈 로더에 `net`과 `websocket`을 등록한다. 실행 중인 Helper와 별도 소켓으로 통신할 수 있다. `exec`의 stdin은 닫혀 있다. [권한 부여](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/src/mods.rs#L1407-L1419) · [모듈 등록](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/crates/herdr-shell/src/engine/quickjs/standard/mod.rs#L46-L64) · [소켓 API](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/crates/herdr-shell/src/typings.rs#L3997-L4026) · [프로세스 실행](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/src/mods.rs#L884-L917) | 두 프로세스 간 지속 통신은 가능한 선택지다. 배포·발견·종료와 원격 SSH 경로 연결은 별개의 비용이다. 원격 소켓이 기존 Herdr SSH 연결로 자동 전달된다는 근거는 찾지 못했다. |
| 기본 패널 대체·복귀 | 기본 레이아웃을 복제하고 기존 블록 ID `files`를 유지한 채 `content.mod`를 바꿀 수 있다. 기본 탭 버튼은 이 ID를 선택한다. 복제된 레이아웃은 독립적으로 유지된다. 이미 열린 숨김 패널은 살아 있을 수 있다. [복제와 교체](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/defaults/AGENTS.md#L198-L219) · [버튼 대상](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/defaults/mods/tabs/main.js#L131-L152) · [뷰 수명](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/defaults/AGENTS.md#L938-L951) | 앱 포크 없이 기본 버튼을 사용할 수 있고 기본 레이아웃을 다시 선택해 복귀할 수 있다. 성능 비교는 기본 Files와 SwiftTree가 동시에 백그라운드 작업을 하는지 통제해야 한다. |
| 공통 파일 서비스 | 공개 Mod 표면에는 로컬 열거·감시, 머신 지정 텍스트 읽기, 공유 상태가 있다. core CLI는 파일 읽기·쓰기·편집과 범용 명령 실행을 제공한다. 조사한 표면에서는 로컬·원격 목록과 변경 구독을 통합한 서비스가 발견되지 않았다. Files와 Changes의 공동 Git 조회는 동일 VM의 Map을 이용한다. [Mod 파일 API](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/defaults/herdr.d.ts#L14-L32) · [공유 상태와 감시](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/defaults/herdr.d.ts#L495-L524) · [core 명령](https://github.com/herdrdev/herdr-core/blob/329cb66ebce5eca3d917fcf7364a099046979b49/docs/commands.md#L121-L155) · [Git 조회 공유](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/defaults/mods/files/main.js#L6-L46) | 필요한 로컬 기능을 재사용할 수 있다. 다른 Mod에 서비스를 제공하는 일은 독립된 제품 범위 결정이다. |

## SwiftTree에서 합의한 탐색 범위

첫 버전의 핵심은 대형 폴더 탐색과 외부 파일 변경의 화면 반영이다. 터미널이나 다른 프로그램에서 파일을 생성·삭제·이동하거나 이름을 바꾸면 트리에 그 결과를 반영한다. 사용자가 SwiftTree 안에서 파일을 직접 생성·삭제·이동하거나 이름을 바꾸는 기능은 후속 버전으로 미룬다.

첫 버전은 Git·Perforce 상태 배지를 표시하지 않으며, SwiftTree가 배지를 위한 상태 조회를 시작하는 횟수는 0회여야 한다. Git checkout이나 Perforce sync로 생긴 파일 변경은 다른 외부 변경과 마찬가지로 트리에 반영한다.

Windows 로컬과 SSH 원격 Linux 모두에서 파일을 열면 트리를 계속 표시하고 조작할 수 있는 상태로 읽기 전용 미리보기를 보여준다. 파일 본문 조회는 해당 파일을 여는 동작에서만 시작한다. 검증할 때는 폴더를 펼치고 스크롤하는 동안 본문 읽기가 0회인지 확인하고, 파일을 열면 해당 파일의 미리보기가 나타나며 트리에서 곧바로 다른 파일을 열 수 있는지 확인한다.

탐색 루트는 현재 Herdr space에 지정된 폴더다. 같은 space에서 터미널이 다른 디렉터리로 이동하거나 다른 pane에 포커스가 가도 루트를 유지한다. 폴더가 지정되지 않은 space를 처음 열면 Windows 로컬과 SSH 원격 Linux 모두에서 ‘폴더 열기’를 표시한다. 빈 `space.folder`가 새 터미널의 시작 위치로 뜻하는 홈을 탐색 루트로 자동 선택하지 않는다. Herdr의 `pickFolder`는 로컬 시스템 선택기이므로 원격 폴더 선택에는 해당 머신의 경로를 다루는 방법이 필요하다. [Space API](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/defaults/herdr.d.ts#L131-L143) · [폴더 선택기](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/defaults/AGENTS.md#L1247-L1251)

‘폴더 열기’로 선택한 폴더는 그 머신에 있는 현재 space의 SwiftTree 탐색 루트가 된다. 다른 space에 다녀오거나 Herdr를 다시 실행해 같은 space를 열면 SwiftTree는 선택한 폴더를 복원한다. 이 선택은 파일 트리에만 적용되며, 새 터미널의 시작 폴더는 기존 Herdr 설정을 따른다.

첫 버전부터 Windows 로컬과 SSH 원격 Linux 모두에서 펼친 폴더의 모든 표시 대상 항목에 도달할 수 있어야 한다. 첫 화면에는 일부만 표시해도 된다. 같은 폴더를 펼치는 입력을 기준으로 첫 행 선택 가능 시간과 마지막 항목 도달 시간을 각각 측정한다. [측정 용어](../../GLOSSARY.md)

폴더를 펼칠 때 사용자에게 보이는 순서는 VS Code 기본 Explorer를 따른다. 폴더 내용이 그대로라면 처음 선택할 수 있는 행부터 최종 정렬 순서에 맞아야 한다. 예를 들어 처음부터 `build.cpp`와 `main.cpp`가 들어 있으면, 열거 순서 때문에 `main.cpp`가 맨 위에 잠시 나타났다가 밀려나는 일이 없어야 한다. 펼친 뒤 외부에서 파일을 새로 만드는 경우는 별도의 변경 이벤트다.

이 호스트의 VS Code 1.146.0(`6904719`)에서 `ExplorerItem.fetchChildren`은 처음 여는 디렉터리의 조회 결과를 기다린다. 파일 서비스는 provider의 목록을 받은 뒤 자식을 구성하고, 비동기 트리는 자식을 정렬해 한 번에 해당 노드에 반영한다. 기본 정렬은 폴더 우선이며 폴더끼리, 파일끼리는 이름순이다. SwiftTree의 비교 기준은 첫 화면에서 보이는 순서다. 내부 열거·전송 단위는 정하지 않았다. [Explorer 모델](https://github.com/microsoft/vscode/blob/69047191fc427f2f92828279aae1d90d8eeda7ab/src/vs/workbench/contrib/files/common/explorerModel.ts#L342-L365) · [파일 서비스](https://github.com/microsoft/vscode/blob/69047191fc427f2f92828279aae1d90d8eeda7ab/src/vs/platform/files/common/fileService.ts#L265-L290) · [트리 반영](https://github.com/microsoft/vscode/blob/69047191fc427f2f92828279aae1d90d8eeda7ab/src/vs/base/browser/ui/tree/asyncDataTree.ts#L1164-L1196) · [트리 정렬](https://github.com/microsoft/vscode/blob/69047191fc427f2f92828279aae1d90d8eeda7ab/src/vs/base/browser/ui/tree/asyncDataTree.ts#L1371-L1376) · [기본 정렬 설정](https://github.com/microsoft/vscode/blob/69047191fc427f2f92828279aae1d90d8eeda7ab/src/vs/workbench/contrib/files/browser/files.contribution.ts#L538-L545)

### 탐색 루트 밖의 디렉터리 링크

Windows junction과 SSH 원격 Linux의 디렉터리 심볼릭 링크는 탐색 루트 밖을 가리켜도 트리에서 펼칠 수 있다. 링크가 목록에 나타날 때는 대상 폴더의 내용을 열거하지 않는다. 사용자가 링크를 펼치면 직계 항목을 읽고, 펼친 부분에 일반 폴더와 동일한 변경 반영 기준을 적용한다.

링크를 따라가면 현재 경로의 조상 디렉터리로 되돌아가는 경우에는 해당 항목에 ‘순환 링크’를 표시하고 확장을 멈춘다. 검증 시에는 서로 다른 두 링크가 같은 외부 SDK 폴더를 가리키는 경우와, SDK 안의 링크가 현재 경로의 조상으로 되돌아가는 경우를 구분한다. 두 링크는 각각 펼칠 수 있어야 하며, 되돌아가는 링크에서만 순환을 표시한다. 외부 SDK에서 파일을 변경해 펼친 트리에 반영되는지도 확인한다. [순환 링크의 정의](../../GLOSSARY.md)

## 첫 버전의 규모 검증

Windows 로컬 NTFS와 SSH 원격 Linux에서 아래 세 가지를 각각 검증한다. SwiftTree에는 폴더별·트리 전체 항목 수에 따른 고정 상한을 두지 않는다.

| 데이터 구성 | 구분 | 확인할 결과 |
| --- | --- | --- |
| 총 100만 파일이 여러 폴더에 분산된 작업공간 | 출시 필수 | 루트를 열고 지정한 하위 폴더까지 탐색한다. 방문하지 않은 하위 트리에서 열거한 폴더와 항목 수도 기록한다. |
| 직계 항목 10만 개가 든 단일 폴더 | 출시 필수 | 첫 행 선택 가능 시간과 마지막 항목 도달 시간을 따로 기록한다. 전체 표시 대상 목록을 기준 목록과 대조해 누락·중복을 확인한다. |
| 직계 항목 100만 개가 든 단일 폴더 | 스트레스 테스트 | 같은 방식으로 시간과 목록의 정확성을 측정하고, 자원 부족이나 미완료가 발생하면 해당 결과를 기록한다. 이 규모의 측정 결과는 출시 통과 조건에서 제외한다. |

## 첫 펼침의 성능 목표

직계 항목이 1,000개인 폴더를 처음 펼칠 때의 **첫 행 선택 가능 시간**을 측정한다. 앱은 이미 실행 중이고 대상 머신의 OS 파일 캐시는 예열돼 있으며, 탐색기에는 해당 폴더의 자식 목록이 없는 조건이다.

| 환경 | 네트워크 조건 | SwiftTree 초기 목표 |
| --- | --- | --- |
| Windows 로컬 NTFS | 로컬 디스크 | p95 ≤ 100 ms |
| SSH 원격 Linux | 연결 수립 완료, RTT 20 ms | p95 ≤ 150 ms |

VS Code Explorer와 기존 Herdr Files도 같은 데이터와 조건에서 측정한다. **마지막 항목 도달 시간**은 독립 지표로 기록한다. 기본 Files의 표시 상한 때문에 기준 목록의 마지막 항목을 선택할 수 없는 경우 결과는 ‘도달 불가’로 기록한다. 이 경우 마지막으로 표시된 행을 기준 목록의 마지막 항목으로 대체하면 비교가 왜곡된다.

첫 펼침의 합격 여부는 환경별로 절대 p95 목표와 VS Code 대비 결과를 함께 평가한다. 같은 장비·데이터·캐시 조건에서 VS Code를 반복 측정해 실행 간 p95 편차를 파악하고, SwiftTree와 VS Code를 교대로 측정한다. SwiftTree가 절대 목표를 충족해도 그 편차를 넘어 일관되게 느리면 합격 판정을 보류한다. VS Code의 측정값이 절대 목표를 초과하는 환경에서도 SwiftTree의 절대 목표는 유지한다. 반복 횟수와 편차 판정 방식은 비교 측정 전에 정한다.

## 외부 변경의 화면 반영 목표

활성 창에서 이미 펼쳐 둔 폴더에 외부 프로그램이 파일 하나를 생성·삭제하거나 이름을 바꾼다. 작업 성공부터 생성된 이름이 나타나거나, 삭제된 이름이 사라지거나, 이전 이름이 사라지고 새 이름이 나타난 첫 프레임까지 측정한다. 각 작업의 결과를 개별 집계한다. [단일 변경 반영 시간](../../GLOSSARY.md)

| 환경 | 단일 변경 반영 시간의 초기 목표 |
| --- | --- |
| Windows 로컬 NTFS | p95 ≤ 500 ms |
| SSH 원격 Linux, 연결 수립 완료, RTT 20 ms | p95 ≤ 1초 |

Git checkout과 Perforce sync는 각각 별도의 대량 변경 시나리오로 측정한다. 단일 변경의 p95를 계산할 때는 단일 파일 작업의 표본만 사용한다.

각 시나리오에서 변경이 진행되는 동안 여러 중간 상태를 묶어 표시할 수 있다. 그동안 사용자는 입력과 스크롤을 계속할 수 있어야 하므로, 변경 도중에 조작을 보내고 그 결과가 화면에 반영되는지 검증한다.

각 작업의 **마지막 파일 변경이 끝난 시점**부터 영향을 받은 **모든 펼친 폴더**의 표시 대상 목록이 실제 파일시스템과 일치할 때까지 측정한다. 해당 머신에서 독립적으로 열거한 최종 목록을 기준으로 삼고, 화면 밖에 있는 항목의 누락·중복과 이미 삭제된 이름까지 검사한다. Git checkout과 Perforce sync의 결과는 따로 기록한다. [측정 용어](../../GLOSSARY.md)

## 유휴 조회와 변경 감시 복구

SSH 연결이 끊기면 트리와 열려 있던 읽기 전용 미리보기에 마지막으로 확인한 내용을 유지하고 ‘연결 끊김 · 마지막으로 확인한 내용’을 표시한다. 이미 읽은 목록은 계속 스크롤할 수 있다. 아직 읽지 않은 폴더를 펼치면 ‘연결 후 불러올 수 있음’을 표시해 실제로 비어 있는 폴더와 구별한다.

재연결되면 영향을 받을 수 있는 펼친 폴더를 다시 읽어 단절 중의 변경을 반영한다. 선택한 항목이 여전히 있으면 선택과 스크롤 위치를 유지한다. 검증 시에는 원격 폴더에서 항목을 선택하고 스크롤한 뒤 연결을 끊어 읽은 폴더와 읽지 않은 폴더를 각각 확인한다. 단절 중 다른 항목을 변경한 뒤 재연결해 목록과 탐색 위치가 함께 복원되는지 검사한다.

Windows 로컬과 SSH 원격 Linux 모두에서 초기 목록 조회가 끝나고 연결과 변경 감시가 정상이며 파일 변경이 없는 동안, 펼친 폴더의 주기적 목록 조회 목표는 **0회**다. 변경 통지 유실이 확인되거나 의심될 때와 SSH 재연결 때는 영향을 받을 수 있는 펼친 폴더를 다시 열거한다. 유실 범위를 특정할 수 없으면 해당 감시 범위에 있는 모든 펼친 폴더가 복구 대상이다. 복구 조회는 유휴 조회와 구별해 기록한다. [측정 용어](../../GLOSSARY.md)

원격 검증에서는 같은 실행 구성과 열린 폴더 집합을 유지한다. 먼저 변경이 없는 구간에 디렉터리 목록 재열거가 0회인지 확인하고, 이어서 외부에서 단일 변경을 발생시켜 RTT 20 ms에서 반영 시간 p95가 1초 이하인지 확인한다. 두 조건을 함께 만족해야 한다. 연결 유지 트래픽은 목록 조회에 포함하지 않으며, SSH 전송량에는 포함한다.

원격 검증은 기존 Herdr와 서버에 이미 있는 기능으로 시작한다. 별도 프로그램이 필요할 때 적용할 배포 조건과 성능 보장 범위는 [원격 Helper 도입 조건](../adr/0001-remote-helper.md)에 기록했다.

## 성능 가설을 가를 측정

기본 Herdr Files와 SwiftTree의 성능 비교표에는 기본 설정에서 배지가 표시되는지, 측정 중 어느 구성 요소가 어떤 상태 조회를 몇 번 실행했는지 함께 적는다. 기본 Files에는 Changes와 Git 상태 조회를 공유하는 경로가 있어 한 번의 실행을 두 번 세지 않도록 한다. 배지 작업이 다른 두 제품의 전체 지연 차이만으로 디렉터리 조회 자체가 얼마나 빨라졌는지 단정할 수 없다. [Git 조회 공유](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/defaults/mods/files/main.js#L6-L46)

Windows와 원격 Linux에서 느리다는 것은 사용자의 관찰이다. 이번 조사에서는 소스 경로와 설치 버전을 확인했다. 위의 수치는 합의한 목표이며, 실제 소요 시간과 병목은 아래의 별도 측정으로 검증한다.

- **트리의 크기와 작업량을 따로 기록한다.** 작업공간 총 파일 수, 펼친 폴더 수, 대상 폴더의 직계 자식 수를 독립 변수로 둔다. 최초로 선택 가능한 실제 자식 행이 표시되는 시각, 특정 항목에 도달하는 시각, 전체 목록이 정확해지는 시각을 나눠 기록한다. 동일 데이터에서 기존 Files가 일부 항목만 제공하면 표시 개수와 도달 가능 여부를 결과에 남긴다.
- **한 번의 펼침을 끝까지 추적한다.** 입력 → 명령 시작 → 대상 머신 열거 종료 → 결과 수신·디코딩 → JS 정렬·모델 갱신 → 첫 행 표시를 연결한다. 호스트별 단조 시계로 구간을 측정하고, 다른 머신의 시각을 직접 빼지 않는다. Windows 프로세스 시작·파일 I/O와 원격 명령 횟수·전송량을 함께 수집한다. 앱의 `HERDR_APP_BENCH`는 JS 렌더와 네이티브 요소 생성, CPU 측 프레임 작업을 **초 단위로 집계**한다. 개별 입력의 p95나 실제 표시 시각을 얻으려면 입력과 해당 프레임을 연결하는 추가 관측이 필요하다. [기존 측정 코드](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/src/bench.rs#L11-L43) · [집계 주기와 출력](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/src/bench.rs#L63-L88)
- **공통 비용과 환경별 비용을 분리한다.** 고정된 디렉터리에서 첫 펼침과 재방문, 열린 폴더 1개와 여러 개, Git 저장소 안팎을 비교한다. Windows에서는 홈 안팎과 PowerShell 기동을, SSH에서는 이미 연결된 세션과 재연결 및 RTT 조건을 분리한다. Git checkout과 Perforce sync는 외부 변경이 멈춘 뒤 기준 목록과의 일치 및 화면 반영 지연을 확인한다. 기본 Files의 갱신 코드에서 직접 호출하는 VCS는 Git이다. [Files 갱신 경로](https://github.com/herdrdev/herdr-app/blob/3e6d56448272064fd06ed95f5b7dc2cf70ea67b4/defaults/mods/files/main.js#L169-L208)
- **VS Code는 같은 사용자 작업으로 비교한다.** Remote‑SSH는 서버를 원격 머신에 설치한다. VS Code의 파일 서비스는 리소스에 맞는 provider에 감시를 위임하며 중복된 감시 요청을 합친다. Herdr도 이미 머신별 연결이 있으므로 새 Helper가 필요한지는 현재 경로의 측정값과 필요한 정확성으로 판단한다. [VS Code Remote‑SSH](https://code.visualstudio.com/docs/remote/ssh) · [VS Code 파일 감시 구조](https://github.com/microsoft/vscode/wiki/File-Watcher-Internals) · [Herdr core 연결](https://github.com/herdrdev/herdr-core/blob/329cb66ebce5eca3d917fcf7364a099046979b49/crates/herdr-core/src/remote.rs#L1-L4)
