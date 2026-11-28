# SwiftTree 설치 후보 검증

[#16](https://github.com/kalstein00/herdr-swift-tree/issues/16)의 출시 검증 범위는 사용자 승인에 따라 Windows NTFS와 기존 QEMU Linux의 SSH/ext4 환경으로 정했다. 설치와 업데이트는 Windows에서 검증했고, 원격 기능과 복구는 QEMU SSH에서 검증했다.

## 설치 및 복귀

Windows 11 Pro 26300, Herdr App 0.1.18, core 0.1.22에서 격리한 Herdr 프로필을 사용했다. 이전 소스 `088f8743ab260761c5dc3e9052d4db55cb87824b`와 통합 소스 `3dd3ecad8bdea5b9ad810d2a88aa441cab68c2d6`를 각각 로컬 ZIP으로 만들어 사용했다. 통합 소스 ZIP의 SHA-256은 `57F3FF31354AC0DD2EDE986071F39D8B7286F3A648C34C0A35CC58690D7E87B9`였다.

1. Windows에 공급할 후보 소스 ZIP을 사전에 준비한다. Herdr를 열고 압축을 푼 디렉터리에서 `./scripts/install-swifttree.ps1`을 실행한다. 이미 실행 중인 이전 레이아웃을 업데이트할 때도 같은 명령을 사용한다.
2. 시험 설치기의 HTTP와 HTTPS 프록시를 연결을 거부하는 루프백 주소로 설정했다. 인터넷 HTTPS 요청이 해당 주소에서 거절되는 것을 확인했다. 이 조건에서 이전 버전 신규 설치와 통합 후보 업데이트가 완료됐다. 업데이트 시 이전 버전의 Windows 도우미 프로세스 두 개가 실행 중이었다.
3. 업데이트한 앱의 Files에서 `notes.txt`를 열어 읽기 전용 표시와 본문을 확인했다. 통합 ZIP의 Mod 파일 10개가 설치된 파일과 일치했다. 설치된 Windows 도우미의 SHA-256은 `A2C1D19FF275E3D72AED2EA4BC461F0D0A31E734903E839B0F773D4439C1DC3C`였다.
4. 명령 팔레트의 **Layout: Herdr**를 선택하고 기본 **Files**에서 같은 폴더와 두 파일을 열었다. 기본 `main.json`의 SHA-256은 설치 전과 복귀 뒤에 같았다. 같은 기본 **Files** 레이아웃에서 기존 QEMU SSH 폴더도 펼쳐 파일 목록을 확인했다. **Layout: Swifttree**로 돌아가 후속 검증을 계속했다.

Windows 배포는 기존 Herdr와 Windows에 설치된 .NET Framework 컴파일러 및 ICU를 사용한다. 검증한 Herdr App과 Core 소스는 Apache-2.0이다. SwiftTree 설치에는 별도 유료 라이브러리나 서버 Helper가 필요하지 않으며, 기존 원격 Herdr와 Linux의 `sh`, GNU `find`, `stat`, `sleep`을 사용한다. VS Code, Perforce, QEMU는 비교 및 시험 도구다. [Herdr App 라이선스](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/LICENSE) · [Herdr Core 라이선스](https://github.com/herdrdev/herdr-core/blob/329cb66ebce5eca3d917fcf7364a099046979b49/LICENSE) · [Windows의 .NET Framework](https://learn.microsoft.com/en-us/dotnet/framework/install/) · [Windows ICU](https://learn.microsoft.com/en-us/dotnet/core/extensions/globalization-icu) · [GNU 라이선스 안내](https://www.gnu.org/licenses/gpl-faq.html) · [원격 Helper 결정](../adr/0001-remote-helper.md)

## 설치본 UI 재검증

Windows의 빈 space에서는 폴더 선택 창으로 `A-Open`을 저장했다. QEMU SSH의 빈 space에서는 `/home/bench/fixtures/SharedScope`를 저장했다. 시험용 앱을 제목 표시줄에서 닫고 이전 프로세스가 종료된 것을 확인한 뒤 같은 프로필로 다시 열었다. 두 space에서 이전 루트가 복원됐고, 터미널은 각각 시험 프로필 디렉터리와 `/home/bench`에 계속 있었다.

QEMU의 별도 시험 SSH 전송을 끊었다. 설치본은 열린 목록과 `row-148.txt` 미리보기, 단절 안내, 처음 펼친 폴더의 대기 안내를 표시했다. 독립 연결에서 열린 `Shelf`의 앞쪽에 12행을 추가하고 `OpenSmall`과 아직 읽지 않은 `Unread`에 각각 파일 하나를 추가했다. 다시 연결하자 세 폴더의 새 내용이 표시됐다. 선택한 `row-148.txt`와 주변 행이 같은 화면 구간에 남았다. 단절 안내가 사라질 때 선택 행의 목록 내 위치는 한 행 높이보다 작게 달라졌다.

Windows와 QEMU에서 직계 100,000개 폴더를 펼친 뒤 처음과 마지막 행을 각각 키보드로 선택했다. 설치본 확인은 파일명, 배경의 선택 상태, 잘림과 겹침을 포함한다. 각각 `row-0000001.txt`와 `row-0100000.txt`를 실제 화면에서 확인했다.

작업의 로컬 `ticket-16`에 설치 로그, 후보와 기본 레이아웃의 해시, 입력 시각 및 직접 검사한 캡처를 보관했다. 주요 이미지는 `installed-candidate-readonly-preview.png`, `installed-candidate-recovered-selection.png`, `restored-builtin-files.png`다.

## 대형 목록과 파일 변경

별도 계측 실행에서는 설치본이 네이티브 목록에 넘긴 100,000행을 읽기 전용으로 기록했다. NTFS와 QEMU 각각의 파일시스템 직접 열거 결과와 이름·유형·순서가 모두 일치했다. 두 환경 모두 누락·중복·추가 행은 0개였으며, 정규화한 목록 SHA-256은 `6c01338ba8c2b66b1a018e167a982fc13aae07eaf7946d7e375bbb7cbabe8830`이었다. 계측 후 설치본 Mod 파일 10개와 컴파일한 도우미의 해시를 패키지 기록과 재대조했다. 설치된 Mod 디렉터리를 지정한 `herdr-app check`도 통과했다.

계측 코드를 넣기 전 설치본의 실제 Windows 창에서 직계 100,000개 폴더를 펼쳐 첫 항목까지 NTFS 2.734초, QEMU 3.004초를 관찰했다. `End` 입력 후 마지막 행의 선택이 화면에 나타나기까지 각각 38.47ms, 28.91ms였다. 펼치기 클릭부터 마지막 행이 선택된 프레임까지는 각각 4.141초, 5.624초였다. 이 시간에는 중간 키 입력과 입력 사이 대기가 포함된다. 분산된 1,000,000개 픽스처에서는 두 환경 모두 `d01`부터 `d11`, `batch-0999667`을 차례로 펼쳐 `row-1000000.txt`의 읽기 전용 미리보기를 열었다. 단일 폴더 직계 1,000,000개 스트레스는 앞선 측정에서 NTFS 읽기 실패, QEMU 관찰 종료까지 로딩 상태로 기록돼 있다. [대형 폴더 기준선](files-baseline.md)

QEMU에서 설치본으로 루트와 `Left`, `Right`를 연 뒤 30.03초 동안 독립 `inotify` 관측기로 디렉터리 열기·읽기를 관측했다. 세 경로의 직접 읽기 양성 대조가 모두 감지됐으며, 유휴 관측 중에는 0건이었다. 최종 설치본에서 `Left`와 `Right`를 모두 펼친 합성 경로에 생성·삭제·이름 변경을 각각 25회 수행했다. 파일 변경 시각과 이름이 바뀐 첫 화면 프레임을 대조했다. NTFS p95는 생성 72.21ms, 삭제 80.68ms, 이름 변경 77.52ms로 모두 500ms 이하였다. QEMU는 명령 전송 시점부터 계산한 보수적 p95 상한이 각각 199.06ms, 181.50ms, 196.55ms로 모두 1초 이하였다. 두 원격 측정의 SSH 왕복 중앙값은 각각 21.87ms와 22.32ms였다. 모든 표본에서 기대 행을 확인했다. Git checkout과 Perforce sync 중 전체 목록 일치, 입력·스크롤 및 SwiftTree 배지용 Git·Perforce 조회 0회는 후보에 포함된 `3dd3ecad`의 네 실제 작업에서 확인했다. [감시 기준선](files-baseline.md) · [대량 VCS 변경 검증](vcs-bulk.md)

## 같은 장비의 세 탐색기 비교

Windows NTFS와 RTT 약 20ms를 주입한 QEMU SSH에서 각각 동일한 1,000개 파일 폴더 세 개를 썼다. 지원되는 최초 펼치기마다 대상 폴더를 교체했고, 탐색기별로 시작하기 전에 운영체제의 디렉터리 목록을 읽었다. 모든 입력과 화면은 실제 앱에서 Windows Graphics Capture로 기록했다. VS Code 1.146.0은 별도 시험 프로필, Remote - SSH 0.128.0, Restricted Mode, Explorer 배지와 색상 비활성 상태였다. 합성 폴더는 Git 저장소 밖이다. 기본 Files는 기본 공유 Git 경로를 사용한다. SwiftTree의 배지용 조회 0회는 실제 저장소에서 별도로 계측됐다. 이 표는 제품·환경마다 세 표본의 최근접 순위 결과이므로 p95와 p99는 관측 최대값이다. 기존 9표본 비교는 참고 기록에 있다. [초기 비교와 반복 표본](files-baseline.md) · [VCS 조회 계측](vcs-bulk.md)

| 환경 | 탐색기 | 패널 열기→루트 표시 | 첫 자식 표시 p50 / p95 / p99 | Down→선택 | 휠→첫 스크롤 | 펼치기→마지막 항목 | End→마지막 항목 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| NTFS | SwiftTree | 64.62ms | 60.02 / **63.10** / 63.10ms | 39.51ms | 28.65ms | 905.65ms | 25.04ms |
| NTFS | 기본 Files | 54.12ms | 477.60 / 480.20 / 480.20ms | 해당 없음 | 64.32ms | 도달 불가 | 해당 없음 |
| NTFS | VS Code | 88.16ms | 81.22 / 119.71 / 119.71ms | 27.92ms | 34.51ms | 889.35ms | 37.85ms |
| QEMU | SwiftTree | 69.12ms | 117.18 / **132.42** / 132.42ms | 24.70ms | 20.67ms | 1,009.76ms | 39.82ms |
| QEMU | 기본 Files | 54.40ms | 171.86 / 173.32 / 173.32ms | 해당 없음 | 54.42ms | 도달 불가 | 해당 없음 |
| QEMU | VS Code | 89.12ms | 151.27 / 185.57 / 185.57ms | 30.76ms | 43.14ms | 867.76ms | 36.89ms |

SwiftTree의 p95는 NTFS 100ms와 QEMU 150ms 기준을 각각 충족했다. Down과 휠 값은 다시 연 폴더의 단일 조작 표본이다. 펼치기부터 마지막 항목까지의 시간은 펼치기 클릭부터 마지막 행이 나타난 화면 프레임까지이며, 중간 키 입력과 입력 사이 대기를 포함한다. 두 도구에서 `End`로 `row-0001000.txt`를 실제 선택했다. 기본 Files는 폴더당 500행 상한을 표시했다. 패널 표시는 이미 실행 중이고 대상 루트를 연 앱에서 숨긴 패널을 표시하는 단일 표본이다. VS Code는 표시 시 이미 보유한 목록을 사용했다. [기본 Files 탐색 기준](files-baseline.md)

| 환경 | 탐색기 | CPU 유휴 중앙값 / 활동 최대 | 전용 메모리 유휴 중앙값 / 활동 최대 | 작업 집합 유휴 중앙값 / 활동 최대 | 프로세스 유휴 중앙값 / 활동 최대 |
| --- | --- | ---: | ---: | ---: | ---: |
| NTFS | SwiftTree | 5.10 / 14.07% | 431.83 / 433.41MiB | 976.22 / 977.75MiB | 21 / 21 |
| NTFS | 기본 Files | 2.72 / 9.87% | 432.83 / 443.23MiB | 977.28 / 986.83MiB | 21 / 21 |
| NTFS | VS Code | 7.70 / 64.08% | 1,236.32 / 1,229.92MiB | 1,802.19 / 1,797.41MiB | 13 / 13 |
| QEMU | SwiftTree | 2.56 / 18.98% | 435.22 / 437.34MiB | 1,001.50 / 1,003.55MiB | 23 / 23 |
| QEMU | 기본 Files | 4.96 / 11.80% | 432.66 / 437.56MiB | 977.08 / 981.16MiB | 21 / 21 |
| QEMU | VS Code | 2.77 / 33.78% | 1,454.08 / 1,453.26MiB | 1,957.41 / 1,955.98MiB | 17 / 17 |

Windows에서 Herdr App과 Core, 또는 VS Code를 기점으로 해당 시험 프로필의 자손 프로세스를 합산했다. 프로필에 이미 열린 시험 창과 터미널도 포함된다. CPU의 100%는 논리 코어 하나를 뜻한다. 표본 간격 중앙값은 599–653ms였고 활동 시점에는 2–3개의 표본이 남았다. 최대치는 활동 표본에서 관측한 값이다. 종료된 일부 프로세스의 빈 메모리 카운터를 합계에서 제외했다. SwiftTree QEMU 활동 구간에 Core 클라이언트와 콘솔 호스트가 새 PID로 관측됐다. 이 간격 사이에 시작하고 종료한 단기 프로세스와 게스트 서버의 CPU·메모리는 계측하지 않았다.

| QEMU에서 같은 폴더 다시 펼치기 | 관찰 구간 | 게스트→Windows | Windows→게스트 |
| --- | ---: | ---: | ---: |
| SwiftTree | 1.979초 | 51,200바이트 | 9,780바이트 |
| 기본 Files | 2.028초 | 24,992바이트 | 1,780바이트 |
| VS Code | 1.885초 | 1,276바이트 | 376바이트 |

게스트 `ss -tin`을 해당 앱의 이미 수립된 TCP 연결에 대응시켰다. 표는 같은 `target-02`를 다시 펼친 동안 해당 소켓의 합계로, 앱 내부 캐시와 연결 유지 트래픽이 포함된다. 별도 시험에서는 처음 펼치는 1,000개 파일의 동일한 복제 폴더를 탐색기마다 하나씩 썼다. QEMU에서 `inotify`로 8초 동안 디렉터리 열기와 접근 알림을 각각 세었다. SwiftTree는 8회/5건, 기본 Files는 3회/7건, VS Code는 1회/2건이었다. 세 탐색기 모두 자식 파일을 연 알림은 0건이었다. 직접 열거 양성 대조는 조작 직전에 각 폴더에서 통과했다. SwiftTree 유휴 목록 조회 0회는 위의 별도 디렉터리 관측 결과다.

다른 동일 복제 폴더로 QEMU에서 SSH를 통해 받은 앱 요청도 직접 계측했다. 실제 UI에서 폴더를 처음 펼친 구간을 포함해 8초간 받는 프로세스의 입구를 추적했다. Herdr Core의 프레임에서 JSON-RPC 요청을, VS Code Server에서 `remoteFilesystem` IPC 요청을 해석했다. 대상 폴더 경로가 인자에 포함된 요청을 각각 한 건으로 셌다. 위치 변경, 다른 폴더, 연결 유지 데이터의 요청 수는 이 표에서 제외했다. 앞 표의 전송량에는 해당 소켓의 연결 유지 데이터가 포함된다. [Herdr Core 프레임 규격](https://github.com/herdrdev/herdr-core/blob/329cb66ebce5eca3d917fcf7364a099046979b49/schema/README.md) · [기본 Files 목록 요청](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L67-L78) · [VS Code 파일시스템 IPC](https://github.com/microsoft/vscode/blob/69047191fc427f2f92828279aae1d90d8eeda7ab/src/vs/platform/files/node/diskFileSystemProviderServer.ts#L32-L51)

| QEMU에서 1,000개 파일 폴더의 첫 펼침 | 대상 경로를 포함한 요청 | 요청 구성 |
| --- | ---: | --- |
| SwiftTree | 21건 | `machine.exec` 목록 2건, 감시용 `stat` 19건 |
| 기본 Files | 2건 | `machine.exec` 목록 2건 |
| VS Code | 2건 | `stat` 1건, `readdir` 1건 |

기본 Files의 원격 연결에서는 같은 8초 구간에 대상 경로를 포함하지 않은 Git 실행 1건도 관측됐다. 기본 Files는 루트 저장소를 확인할 때 `git rev-parse`를 호출한다. 표는 단일 구간에서 직접 관측한 앱 요청 수다. 폴더를 다시 조회하는 횟수는 관측 구간과 기본 Files의 주기 갱신 시점에 따라 달라졌다. 원시 스트림은 QEMU의 임시 디렉터리에만 기록했고, 계측이 끝나면 삭제했다. 요청 ID와 종류만 남긴 `remote-requests-*.jsonl`을 로컬 증거에 보관했다.

## 검증 상태

통합 후보의 Node 자동 테스트 15개, Python 검사, PowerShell 구문 검사와 설치된 Mod의 Herdr 검사를 통과했다. UI는 Windows Computer Use로 조작했다. 이 Herdr 빌드의 네이티브 창에는 Agent Browser에 연결할 제어 엔드포인트가 없었다. Windows와 QEMU의 설치본 검사에 사용한 캡처, 입력 프레임 자료, 비교 목록과 자원 표본은 로컬 `ticket-16`에 보관했다.

별도 실제 Linux 서버는 합의한 #16의 검증 범위에서 제외했다. Windows 설치기는 기존 Herdr 환경에 Mod를 설치한다. QEMU는 원격 Linux 시험 환경이며 제품 설치에 필요한 구성 요소는 기존 Herdr와 앞서 명시한 운영체제 도구다.
