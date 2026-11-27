# 외부 디렉터리 링크 검증

[#13](https://github.com/kalstein00/herdr-swift-tree/issues/13)은 Windows Herdr의 NTFS와 SSH ext4 트리에서 루트 밖 SDK를 여는 사용자 경로를 검증한다. 각각 `Root`와 같은 부모에 `SDK`를 만들고 `Root/Alpha`와 `Root/Beta`는 `SDK`를, `SDK/Ancestor`는 `Root`를 가리키게 한다. NTFS는 junction을, Linux는 디렉터리 심볼릭 링크를 사용한다.

1. **Files**를 열어 `Alpha`와 `Beta`가 접힌 상태로 표시되는지 확인한다. 이때 대상 내용을 열거한 횟수를 기록한다.
2. 두 경로를 독립적으로 펼치고 `Alpha/Ancestor`를 연다. **순환 링크** 아래에 추가 행이 생기지 않는지 확인한다.
3. 트리 밖에서 `SDK`에 파일을 만들고 두 가지 각각에서 같은 새 이름이 나타나는지 확인한다.
4. 실제 생성·삭제를 25회씩 교대로 수행하고, 다른 파일을 두 이름으로 25회 바꾼다. 0.8초 간격을 유지한다. 생성은 두 가지에 새 이름이 나타난 첫 프레임, 삭제는 두 가지에서 사라진 첫 프레임, 이름 변경은 두 가지 모두에서 이전 이름이 사라지고 새 이름이 나타난 첫 프레임으로 판정한다.

NTFS는 SwiftTree의 실제 목록 시작 지점과 감시 등록을 기록한다. SSH는 대상 머신에서 `inotify`로 `Root`와 `SDK`의 디렉터리 읽기를 관찰하고 독립 열거로 센서가 동작하는지 확인한다. Windows에서는 파일 작업 완료와 화면의 QPC 프레임을 비교한다. SSH에서는 변경 요청을 보낸 Windows의 QPC와 두 가지가 일치한 첫 프레임을 비교해 지연 상한을 구한다. 수신 확인 시각은 같은 구간의 하한을 구하는 데 쓴다. 목표 p95는 작업마다 NTFS 500ms, RTT 20ms의 SSH 1초다. [측정 단위와 화면 수집](files-baseline.md#관측-경계)

Windows는 디렉터리 핸들에서 볼륨 및 파일 ID를 얻고 현재 가지의 조상 ID와 비교한다. 펼친 junction에는 대상 변경 감시를 등록한다. 외부의 중간 junction이 바뀌면 이전 대상의 감시만으로는 알아낼 수 있으므로, 펼친 링크의 대상 ID를 별도로 확인해 감시를 다시 연결한다. 이 확인에는 디렉터리 내용을 읽지 않는다. Linux는 현재 작업 디렉터리에서 장치 번호와 inode를 확인하고, 조상과 다를 때만 직계 목록을 읽는다. GNU `find`는 펼치지 않은 링크의 대상 종류를 메타데이터로만 확인한다. Linux의 기존 GNU `stat` 감시는 새 가지가 펼쳐졌을 때 관찰 범위를 빨리 갱신할 수 있도록 100ms 간격의 확인을 한 원격 요청에서 최대 네 번 수행한다. [Windows 파일 ID](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info) · [Windows 디렉터리 변경 알림](https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-readdirectorychangesw) · [GNU find 링크 처리](https://www.gnu.org/software/findutils/manual/html_node/find_html/Symbolic-Links.html)

## 결과

Windows 11 Pro 26300의 Herdr App 0.1.18과 core 0.1.22에서 두 환경을 검증했다. 접힌 두 링크를 표시했을 때 외부 SDK 내용 열거는 두 환경 모두 0회였다. NTFS에서는 초기 루트 목록 요청 두 건만 기록됐다. SSH의 12.00초 구간에서는 파일시스템 관찰에 루트 읽기만 있었다. 두 경로와 순환 표시를 열어 둔 뒤 SSH에서 30.03초 동안 디렉터리 읽기 알림이 없었다.

두 열린 가지에서 외부에서 생성한 `visible-sdk-change.txt`를 확인했고, 실제 링크 경로에서 파일을 클릭해 읽기 전용 미리보기에 SDK의 본문이 표시되는 것을 확인했다. `Alpha/Ancestor` 아래에는 **순환 링크**가 표시됐다. NTFS에서 `Alpha`를 접자 해당 감시가 종료되고 `Root`와 펼친 `Beta`의 감시는 유지됐다.

NTFS의 별도 간접 링크에서는 외부 중간 junction을 옮겨 대상이 잠시 사라지게 한 뒤 다른 디렉터리로 연결했다. 펼친 가지가 새 대상 목록으로 갱신됐고, 이어서 새 대상에 만든 파일도 다시 펼치는 조작 없이 표시됐다. 고장 주입 검증에서는 목록 재조회 또는 감시 등록이 실패한 동안 기존 행을 유지하고 **Live updates unavailable**을 표시했다. 등록과 재조회에 성공하자 사용자 조작 없이 새 파일이 표시됐다.

SSH에서는 대상이 없는 동안 부모 목록을 갱신해도 펼친 디렉터리 링크가 유지됐다. 외부 대상을 되돌리자 부모를 다시 갱신하거나 링크를 다시 펼치지 않아도 새 파일이 표시됐다. 첫 갱신 시험에서는 두 가지에 처음 `seed.txt`가 보인 프레임 뒤 11.85ms 만에 외부 생성 요청을 보냈다. 두 가지의 생성 반영 상한은 338.06ms였다.

| 두 경로에 반영되기까지 p95 | 생성 | 삭제 | 이름 변경 |
| --- | ---: | ---: | ---: |
| NTFS | 81.22ms | 78.87ms | 83.35ms |
| SSH ext4 상한 | 221.53ms | 221.58ms | 238.89ms |

환경별로 작업마다 25회, 총 150회의 화면 결과를 관측했다. SSH 왕복 시간 중앙값은 두 측정에서 각각 21.39ms와 21.44ms였다. 열거 기록, 실제 파일 작업 시각, 입력과 화면 및 두 가지의 변경·순환 표시 캡처를 작업의 로컬 `ticket-13`에 보관했다.
