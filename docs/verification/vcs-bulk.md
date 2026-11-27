# Git checkout과 Perforce sync 검증

[#15](https://github.com/kalstein00/herdr-swift-tree/issues/15)는 NTFS와 SSH ext4에서 실제 버전 관리 작업이 파일을 바꾸는 동안의 조작과, 작업 뒤 모든 열린 목록의 일치를 검증한다.

## 준비

- 저장소 밖의 전용 경로에서 `python scripts/vcs_fixture.py git <workspace>`로 `before`와 `after` 브랜치를 만든다. 초기 작업공간은 `before`다.
- Perforce는 시험 전용 P4 Server와 발행 및 측정 클라이언트를 사용한다. 두 클라이언트의 별도 루트를 같은 depot 경로에 매핑하고 `nomodtime`을 쓴다. 발행 루트에 `vcs_fixture.py before`를 적용하고 `p4 reconcile`과 `p4 submit`을 실행한다. 같은 루트에서 `vcs_fixture.py after`를 적용해 다시 reconcile과 submit을 실행한다. 측정 클라이언트는 첫 변경 목록으로 sync한다. [P4 배포본](https://www.perforce.com/downloads) · [p4 sync](https://help.perforce.com/helix-core/server-apps/cmdref/current/content/CmdRef/p4_sync.html)
- 각 작업공간의 다섯 폴더에는 240개의 유지 파일과 6,000개의 교체 파일이 있다. 작업 이후에는 기존 30,000개 이름이 사라지고 새 이름 30,000개가 생긴다. Windows Herdr에서 해당 space의 Files를 열고 `A-Open`, `B-Open`, `C-Open`만 펼친다.

## 관측 경계

1. `scripts/capture_baseline.py`로 실제 창의 입력 및 변경 프레임을 QPC로 기록한다. 작업 시작 후 Files에 휠과 방향키 입력을 보내고 달라진 행과 선택을 화면에서 확인한다.
2. 작업공간이 있는 머신에서 `python scripts/vcs_measure.py --root <workspace> --output <run> -- git checkout -q after`를 실행한다. Perforce는 같은 명령 위치에 측정 클라이언트의 `p4 sync -q <depot-path>@<after>`를 전달한다. 시작과 명령 종료를 기록하며, 다섯 대상 폴더에서 파일 이름이 바뀐 시각과 파일 쓰기 시각을 실제 파일시스템에서 확인한다.
3. 해당 머신에서 `vcs_fixture.py inventory <workspace>`로 독립 기준 목록을 작성한다. 앱에서 대조하는 범위는 탐색 루트와 펼친 세 폴더의 전체 이름, 유형, 순서다. 파일이 화면 밖에 있어도 대조에 포함한다.
4. Windows 입력 및 프레임은 QPC를 사용한다. SSH 관측 시에는 동일한 유지보수 SSH 세션으로 요청·응답 사이의 원격 시각을 여러 번 읽어 호스트 시각 차이의 범위를 구한다. 작업 중 조작은 시간 오차를 감안해도 실제 변경 구간에 포함되는 프레임으로 판단한다. 목록 일치 시각과 명령 종료는 각각 마지막 파일 변경에 대비해 기록한다.
5. SwiftTree의 명령 실행을 기록하고 배지를 위한 Git·Perforce 조회가 있었는지 확인한다. 네 대량 변경 결과는 단일 변경 p95와 별도로 보관한다.

## 실제 창의 작업 중 조작

Windows 11 Pro 26300, 네이티브 Herdr App 0.1.18 및 core 0.1.22, 1600×1025 창에서 검사했다. 원격 작업공간은 QEMU의 Debian 13.8 ext4에 있고, Git 버전은 Windows 2.56.0.windows.4와 Linux 2.47.3이다. 시험용 로컬 P4 Server와 CLI는 양쪽에서 2025.2/3148719를 사용했다. [Windows Perforce 배포본](https://ftp.perforce.com/perforce/r25.2/bin.ntx64/) · [Linux Perforce 배포본](https://ftp.perforce.com/pub/perforce/r25.2/bin.linux26x86_64/)

작업 중 휠로 `keep-00012.txt` 또는 `keep-00013.txt` 인근까지 이동했다. 이어진 방향키 입력으로 다음 행이 선택되는 것을 네 경우 모두 프레임에서 확인했다. 각 입력과 해당 프레임은 첫 변경 관측 뒤, 마지막 파일 변경 전에 있었다. 작업이 끝난 뒤 `C-Open`의 `new-06000.txt`를 선택했고 `D-Closed`와 `E-Closed`는 접힌 상태였다.

| 환경과 작업 | 명령 실행 | 마지막 파일 변경부터 명령 종료 | 휠 입력부터 프레임 | 방향키 입력부터 프레임 |
| --- | ---: | ---: | ---: | ---: |
| NTFS Git checkout | 22.54초 | 585.50ms | 57.07ms | 49.64ms |
| SSH Git checkout | 3.18초 | 78.12ms | 29.38ms | 39.23ms |
| NTFS Perforce sync | 47.04초 | 35.44ms | 43.37ms | 58.23ms |
| SSH Perforce sync | 9.80초 | 22.68ms | 29.22ms | 46.65ms |

표는 진단용 기록 코드를 추가하기 전의 실제 설치본에서 환경별·작업별 한 회를 기록한 것이다. 로컬 `ticket-15` 폴더에 `clean-*` 프레임과 `*-after.png` 완료 화면, 작업별 `analysis-*.json` 및 `actor-*/filesystem.json`을 보관했다.

## 전체 목록 대조와 수렴 시각

같은 실제 작업을 다시 실행하면서 설치본의 렌더가 사용하는 목록을 읽기 전용으로 기록했다. 각 목록이 바뀐 시각을 남기고, 독립 기준과 처음 일치한 뒤에도 마지막 기록까지 일치하는지 확인했다. 각 운영체제의 파일시스템에서 얻은 폴더 갱신 시각과 새 파일의 쓰기 시각 중 가장 늦은 값을 마지막 파일 변경으로 삼았다. SSH 시각 비교의 불확실성은 약 21ms였다.

| 환경과 작업 | 일치한 행 | 전체 마지막 파일 변경에 앞서 목록이 일치한 시간 | 누락 / 추가 / 중복 / 삭제 잔존 | SwiftTree 배지 조회 |
| --- | ---: | ---: | ---: | ---: |
| NTFS Git checkout | 18,726 | 5,872.62–5,873.62ms | 0 / 0 / 0 / 0 | 0 |
| SSH Git checkout | 18,726 | 237.03–259.14ms | 0 / 0 / 0 / 0 | 0 |
| NTFS Perforce sync | 18,725 | 12,215.23–12,216.23ms | 0 / 0 / 0 / 0 | 0 |
| SSH Perforce sync | 18,725 | 2,511.04–2,533.15ms | 0 / 0 / 0 / 0 | 0 |

접힌 `D-Closed`와 `E-Closed`에서도 작업이 이어졌으므로, 네 실행 모두 전체 작업의 마지막 변경 시점에 열린 목록이 이미 기준과 일치했다. 이 시점 이후 일치까지의 대기는 0ms였다. 대량 변경 표본은 단일 변경 p95와 별개로 기록했다.

SwiftTree의 명령 실행 경계에서는 NTFS 작업 중 새 외부 명령이 없었고, SSH에서 기록된 명령은 메타데이터를 읽는 `sh` 요청이었다. Windows 상주 도우미는 자체 작업자와 Herdr Core를 사용한다. 계측한 목록과 명령, 기준 목록, 비교 결과를 작업의 로컬 `ticket-15`에 보관했다.
