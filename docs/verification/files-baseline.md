# 기본 Herdr Files와 VS Code 비교 기준선

[#3](https://github.com/kalstein00/herdr-swift-tree/issues/3)은 SwiftTree 출시 전 비교 기준을 수집한다. 측정 용어는 [용어집](../../GLOSSARY.md)을 사용한다. 창 확인과 실제 입력은 [Windows 네이티브 검증 절차](windows-native-ui.md)를 따른다.

## 데이터와 환경

- `wide`는 `target` 폴더 한 곳에 파일을 집중시킨다. `deep`은 같은 수의 파일을 12단계에 나누고 각 단계의 배치 폴더에 최대 1,000개를 둔다. 네 규모는 1,000·10,000·100,000·1,000,000개다. 같은 이름의 기존 디렉터리가 있으면 새 루트를 사용한다.
- Windows NTFS와 QEMU Debian의 ext4에서 같은 스크립트로 생성한다. 모든 파일은 비어 있고 이름에는 고정 길이 일련번호를 사용한다. QEMU에 대형 데이터용 볼륨을 추가할 때는 블록 용량과 inode 수를 함께 확인한다.
- Herdr와 VS Code는 별도 검증 프로필로 실행한다. Git 저장소가 없는 합성 루트를 사용한다. VS Code Explorer의 배지와 색상은 끈다. 기본 Herdr Files는 기본 Git 경로를 유지하므로 저장소 확인 프로세스가 관측될 수 있다.
- 원격은 로컬 QEMU의 SSH 연결을 수립한 뒤 측정한다. 게스트의 시험 NIC에 `netem delay 20ms`를 적용하고 게이트웨이 왕복 시간을 따로 기록한다. 앱의 SSH 요청 왕복과 ICMP 왕복은 각각 기록한다.

```text
python scripts/baseline_fixture.py create <fixture-root> wide 1000
python scripts/baseline_fixture.py create <fixture-root> deep 1000
python scripts/baseline_fixture.py list <fixture-root>/wide-0001000/target
```

각 호스트에서 `list`를 실행해 기준 목록을 확보한다. 비교 시 개행을 정규화한 목록의 항목 수와 해시를 대조한다. 측정 직전에 대상 폴더의 이름을 한 번 열거해 OS 캐시를 예열한다. 독립 표본에는 미사용 복제 루트를 쓰거나 탐색기의 대상 자식 목록을 지운 뒤 접힌 상태에서 시작한다. Herdr Files에서는 폴더를 접고, VS Code에서는 연 파일을 닫고 폴더를 접은 다음 Explorer의 새로 고침을 누른다. [Herdr Files의 닫기 처리](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L212-L230) · [VS Code Explorer의 새로 고침 처리](https://github.com/microsoft/vscode/blob/69047191fc427f2f92828279aae1d90d8eeda7ab/src/vs/workbench/contrib/files/browser/explorerService.ts)

## 측정 규칙

1. **최초 표시.** 이미 준비된 앱에서 대상 탐색기를 열거나 대상으로 전환한 입력부터 엔트리가 보이는 첫 프레임까지 잰다. VS Code에서 이미 로드된 탐색기를 표시한 값에는 그 상태를 명시한다. SSH 연결 설정과 최초 서버 설치 시간은 별도다.
2. **첫 행 선택 가능 시간.** 접힌 `target`을 실제 UI에서 펼친다. 펼침 클릭부터 첫 자식 `row-0000001.txt`가 보이는 프레임까지 잰다. 별도 확인에서 행을 열 수 있어야 한다. 로딩 상태와 펼침 표시만 바뀐 프레임은 제외한다.
3. **마지막 항목 도달 시간.** 같은 펼침 입력부터 스크롤한 목록에 기준 목록의 마지막 항목이 보이고 선택 가능한 프레임까지 잰다. 입력 순서와 횟수를 기록한다. 기본 Files의 한도로 실제 마지막 항목이 빠지면 ‘도달 불가’로 기록한다.

대표 시간 비교는 `wide-0001000/target`을 사용한다. #3 기준선은 환경·제품별 세 독립 반복으로 첫 펼침의 편차 범위를 수집하며, 패널 표시와 마지막 행 도달은 한 번씩 측정한다. 이후 #11에서 세 묶음, 묶음별 세 표본으로 VS Code 묶음별 p95의 최솟값·최댓값과 차이를 기록한다. 같은 방식으로 교대로 측정한 SwiftTree 묶음의 p95가 모두 VS Code 최댓값을 넘으면 합격을 보류한다. p50·p95·p99는 최근접 순위법을 사용한다. 세 표본에서 p95와 p99는 모두 최댓값이므로 표본 수와 원시값을 함께 보존한다. 미완료 묶음과 도달 불가 값은 계산에서 제외하고 이유와 개수를 남긴다.

Windows 호스트에서 같은 QPC 시간축의 입력과 네이티브 합성 프레임을 수집한다. 실제 행 이름과 입력 상태를 이미지에서 판정한다. `capture_baseline.py`는 주어진 창의 클릭·휠 시각과 화면 영역의 변경 프레임을 기록한다. 촬영 대상은 합성 작업공간이며, 탐색 작업은 별도의 실제 UI 조작으로 수행한다.

```text
uv run --isolated --with windows-capture==2.0.1 python scripts/capture_baseline.py <hwnd> <new-output-dir> --crop <x> <y> <width> <height> --seconds 40
```

`events.json`에서 해당 입력과 첫 판정 프레임의 `qpc_ns`를 찾는다. 프레임 시각에서 입력 시각을 빼고 1,000,000으로 나누면 밀리초가 된다.

커진 표본을 처리하거나 마지막 항목을 찾는 경우에는 프레임 집계 시간 대신 실제 가시 행과 기준 목록을 함께 확인한다. 다른 호스트에서 수집한 항목은 로컬 시간 차이 또는 연관 이벤트와 함께 기록한다. 두 호스트의 원시 시각을 직접 빼지 않는다.

## 실행 환경과 #3 측정값

| 항목 | 확인한 환경 |
| --- | --- |
| Windows | Windows 11 Pro 빌드 26300, NTFS, Intel Core Ultra 7 255H 16 논리 코어 |
| QEMU | QEMU 11.1.0, `q35`, vCPU 4개, RAM 4 GiB, Debian 13 `6.12.118+deb13-cloud-amd64`, ext4 |
| 원격 연결 | QEMU 사용자 네트워크의 루프백 SSH 포트 전달, 게스트 `enp0s2`의 `netem delay 20ms`, 연결 수립 후 측정 |
| 앱 | Herdr App 0.1.18와 core 0.1.22, VS Code 1.146.0 (`69047191fc427f2f92828279aae1d90d8eeda7ab`), Remote-SSH 0.128.0 |
| 앱 설정 | Herdr 기본 레이아웃과 Files, VS Code Restricted Mode에서 Explorer, `git.decorations.enabled`, `explorer.decorations.badges`, `explorer.decorations.colors`, `explorer.compactFolders` 모두 `false` |
| 계측 | Python 3.15.2, `windows-capture` 2.0.1, Windows Computer Use |

QEMU에는 NoCloud 시드로 합성 작업용 SSH 계정을 준비했다. 루프백으로 전달할 SSH 포트를 만들어 Herdr와 VS Code에 같은 게스트 계정과 합성 루트를 사용한다. 12 GiB 시험 볼륨은 `mkfs.ext4 -N 3000000`으로 만들었다. `tc qdisc replace dev enp0s2 root netem delay 20ms` 적용 후 게이트웨이 ICMP 응답 5개의 RTT는 최솟값 20.268 ms, 평균 20.709 ms, 최댓값 21.337 ms였다. 비교에 사용한 두 SSH 소켓의 Linux TCP RTT 추정치는 별도 표본에서 약 21–22 ms였다. [QEMU 사용자 네트워크](https://www.qemu.org/docs/master/system/invocation.html) · [cloud-init NoCloud](https://docs.cloud-init.io/en/latest/reference/datasources/nocloud.html)

두 호스트에서 생성한 8개 데이터셋, 호스트당 파일 2,222,000개의 상대 경로 해시와 개수가 일치했다. 대표 `target`의 독립 목록은 1,000행이었고, `row-0000001.txt`에서 `row-0001000.txt`까지였다. 데이터 생성 중 수집한 예비 기록은 아래 반복 표본에서 제외했다.

| 환경·탐색기 | 패널 표시 후 첫 폴더 (ms) | 첫 행 세 표본 (ms) | p50 / p95 / p99 (ms) | 마지막 기준 행 도달 |
| --- | ---: | --- | --- | --- |
| NTFS · Herdr Files | 44.6 | 568.8 / 486.3 / 467.6 | 486.3 / 568.8 / 568.8 | 도달 불가 |
| QEMU · Herdr Files | 56.4 | 177.6 / 188.8 / 180.7 | 180.7 / 188.8 / 188.8 | 도달 불가 |
| NTFS · VS Code | 101.1 | 69.4 / 85.5 / 85.7 | 85.5 / 85.7 / 85.7 | 6,417.4 ms |
| QEMU · VS Code | 106.6 | 100.1 / 122.5 / 96.9 | 100.1 / 122.5 / 122.5 | 12,002.3 ms |

패널 표시는 실행 중인 앱에서 루트를 한 번 표시한 뒤 패널을 숨겼다가 다시 열어 측정했다. 마지막 행 시간에는 세 번째 펼침 뒤 65,000 단위의 휠 조작을 두 번 보낼 때까지의 대기가 포함된다. 총 시간을 재현할 때는 아래 시각에 휠 입력을 보낸다. 입력 사이 간격이 달라진 경우 마지막 휠부터 가시 행까지의 시간도 함께 기록한다.

| VS Code 환경 | 펼침 후 첫 휠 (ms) | 펼침 후 두 번째 휠 (ms) | 두 번째 휠부터 마지막 행까지 (ms) |
| --- | ---: | ---: | ---: |
| NTFS | 3,078.5 | 6,370.8 | 46.6 |
| QEMU | 5,844.9 | 11,953.5 | 48.7 |

VS Code의 마지막 행을 각각 클릭해 편집기에서 `row-0001000.txt`가 열린 것을 확인했다. Herdr에서는 양쪽 모두 `row-0000500.txt`와 500개 제한 문구가 목록 끝에 표시됐다. 각 환경에서 첫 행은 실제 파일을 클릭해 열 수 있는 표본과 화면으로 대조했다.

## 관측 경계

| 구간 | 측정하거나 확인한 범위 |
| --- | --- |
| 입력과 화면 | Windows 호스트의 같은 QPC 시계에서 마우스 입력과 실제 합성 프레임을 비교했다. 클릭으로 열린 파일과 정렬상 첫 행 및 마지막 행을 화면에서 확인했다. |
| SSH | 호스트의 `ssh.exe` 연결을 부모 프로세스와 게스트의 TCP 포트에 대응시켰다. 대표 펼침 전후 `ss -tin`의 게스트 송신/수신 바이트 증가는 Herdr 14,136/1,536, VS Code 168/124였다. 해당 소켓의 구간 합계이며 유지 트래픽이 포함될 수 있다. 폴더 목록 요청별 바이트와 SSH 요청 횟수에는 앱 계측이 필요하다. |
| 프로세스 | 장기 실행 SSH 프로세스의 부모는 각각 `herdr-core.exe`와 `Code.exe`였다. Windows 프로세스 시작 이벤트 구독은 접근이 거부되어 단기 프로세스 생성 수는 미계측이다. |
| 열거·렌더링 | 내장 Files의 열거, JS 모델 갱신과 GPUI 합성은 서로 다른 지점이다. 이번 측정은 최종 가시 행의 QPC 프레임까지 포함한다. 세부 구간별 비용은 미계측이다. |
| VCS | 합성 루트에는 Git 저장소가 없으며 VS Code 장식을 껐다. Herdr의 Files와 Changes가 공유하는 키는 머신과 저장소다. 저장소가 있는 후속 측정에서 공유된 프로세스 실행을 하나로 세며 두 패널의 소비를 별도 실행으로 합산하지 않는다. 이번 기준선에는 Git 실행 횟수 수치가 없다. [내장 Git 공유 경로](https://github.com/herdrdev/herdr-app/blob/9a9ae13d998e6ed74c76e8eb13bdeb2e1420f50c/defaults/mods/files/main.js#L6-L46) |

네이티브 프레임과 입력/프레임 JSON, 파일명 인벤토리와 SSH 소켓 원본은 #3의 로컬 측정 증거로 보관했다. 큰 데이터셋은 생성과 목록 일치를 확인했다. 반복 UI 시간은 대표 1,000개 폴더에서 수집했으며, 대형 탐색과 설치 후보 검증은 후속 티켓에서 수행한다.
