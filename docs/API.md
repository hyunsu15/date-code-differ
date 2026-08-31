# API 문서

개발/미리보기 서버에 붙는 **읽기 전용** API. 외부 폴더를 수정하는 동작은 없다.

기본 경로: `/api/v1`
지원 메서드: **`GET` 뿐이다.** 그 밖의 메서드는 404 로 떨어진다.

---

## 위치 파라미터 (모든 엔드포인트 공통)

비교 대상이 로컬 폴더인지 SSH 원격인지를 **요청마다** 받는다.
설정은 브라우저(localStorage)가 들고 있고 서버는 상태를 두지 않는다.

| 이름 | 타입 | 필수 | 의미 |
| ---- | ---- | ---- | ---- |
| `mode` | String | N | `local`(기본) 또는 `ssh` |
| `root` | String | **Y** | 날짜 폴더들의 부모 경로. local 의 상대 경로는 프로젝트 폴더 기준 |
| `host` | String | mode=ssh 면 **Y** | 원격 호스트 |
| `user` | String | mode=ssh 면 **Y** | 원격 계정 |
| `port` | Number | N | 비우거나 숫자가 아니면 ssh 기본값(22) |
| `identityFile` | String | N | 개인키 경로. 비우면 ssh 기본 키 |
| `encoding` | String | N | `auto`(기본) · `utf-8` · `euc-kr`. 모르는 값은 `auto` 로 본다 |

**자격증명 파라미터는 없다.** SSH 인증은 이 API 가 아니라 **ssh 가 알아서 한다** —
개인키 · ssh-agent · `~/.ssh/config`. 비밀번호는 받지도, 보관하지도 않는다.

`encoding` 은 로컬·SSH 모두에 적용된다. `auto` 는 UTF-8 로 읽어보고 유효하지 않으면 EUC-KR 로 본다
(올바른 UTF-8 파일은 항상 UTF-8 로 읽히므로 멀쩡한 파일이 망가지지 않는다).

```
GET /api/v1/snapshots
GET /api/v1/snapshots?mode=local&root=D%3A%2Frelease
GET /api/v1/snapshots?mode=ssh&host=build-01&user=deploy&root=%2Fhome%2Fdeploy%2Frelease
```

### 위치 관련 오류

| code | HTTP | 발생 조건 |
| ---- | ---- | -------- |
| `SSH_CONFIG_INCOMPLETE` | 400 | `mode=ssh` 인데 host·user·root 중 빈 값이 있다 |
| `LOCAL_ROOT_EMPTY` | 400 | `mode=local` 인데 `root` 가 비었다 |
| `SSH_NOT_FOUND` | 502 | `ssh` 명령이 PATH 에 없다 |
| `SSH_UNREACHABLE` | 502 | 호스트 이름 해석 실패·접속 거부·타임아웃 |
| `SSH_AUTH_FAILED` | 502 | 인증 실패 (비밀번호가 틀렸거나 받아주는 방식이 아니다) |
| `SSH_TIMEOUT` | 502 | 30초 안에 안 끝났다. 개발 서버 터미널의 비밀번호 프롬프트를 아무도 안 받은 경우가 대부분 |
| `SSH_HOST_KEY` | 502 | `known_hosts` 에 없는 호스트 (자동 수락하지 않는다) |
| `SSH_FAILED` | 502 | 그 밖의 원격 명령 실패 |
| `LOCAL_READ_FAILED` | 502 | 로컬 폴더를 읽지 못했다 |

`SSH_` 로 시작하는 오류는 **실행한 ssh 명령을 `message` 끝에 붙여서** 보낸다.
원격 명령을 이 도구가 조립하므로, 명령을 안 보여주면 무엇이 실패했는지 알 길이 없다.
터미널에 그대로 붙여넣어 재현할 수 있어야 이 도구 문제인지 서버·계정 문제인지 갈린다.
비밀번호는 argv 에 싣지 않으므로 이 문자열에 자격증명이 들어갈 일은 없다.

```json
{
  "code": "SSH_AUTH_FAILED",
  "message": "인증에 실패했습니다.\n…\n\n실행한 명령:\nssh -o ConnectTimeout=10 -o StrictHostKeyChecking=yes deploy@build-01 \"ls -1F -- '/home/deploy/release'\""
}
```

---

## 공통

### 응답 헤더

| 헤더 | 값 |
| ---- | -- |
| `Content-Type` | `application/json; charset=utf-8` |
| `Cache-Control` | `no-store` (외부 폴더 내용이 언제든 바뀔 수 있어 캐시하지 않는다) |

### 오류 응답

모든 오류는 아래 형태로 온다.

```json
{ "code": "MISSING_PARAM", "message": "left, right 파라미터가 모두 필요합니다." }
```

| code | HTTP | 발생 조건 |
| ---- | ---- | -------- |
| `ROOT_NOT_FOUND` | 404 | 지정한 경로에 폴더가 없다 |
| `MISSING_PARAM` | 400 | 필수 쿼리 파라미터가 비었다 |
| `FILE_NOT_FOUND` | 404 | 좌우 스냅샷 어느 쪽에도 그 파일이 없다 |
| `INTERNAL` | 500 | 그 밖의 서버 오류 (message 에 원인) |

### 무시 옵션 (공통 쿼리 파라미터)

diff 계산에 쓰는 옵션. **켤 때만** 보내면 되고, 없으면 꺼진 것으로 본다.
`1` `true` `on` 을 참으로 읽는다.

| 이름 | 타입 | 필수 | 의미 |
| ---- | ---- | ---- | ---- |
| `ignoreWhitespace` | flag | N | 들여쓰기·공백량 차이를 같은 줄로 본다 |
| `ignoreCase` | flag | N | 대소문자 차이를 같은 줄로 본다 |
| `ignoreBlankLines` | flag | N | 빈 줄을 비교에서 뺀다 (화면에는 남는다) |
| `ignoreComments` | flag | N | 주석 전용 줄을 비교에서 뺀다 (화면에는 남는다) |

---

## 1. 스냅샷 목록

```
GET /api/v1/snapshots
```

외부 폴더 바로 아래의 디렉터리를 스냅샷으로 훑는다.

| 파라미터 | 타입 | 필수 | 의미 |
| -------- | ---- | ---- | ---- |
| `refresh` | flag | N | 서버 캐시를 비우고 외부 폴더를 다시 읽는다 |
| `prefix` | String | N | 폴더 이름 접두사. 이 값으로 **시작하는** 폴더만 돌려준다 (대소문자 무시). 비우면 전부 |

`prefix` 는 한 폴더에 환경별 스냅샷이 섞여 있을 때 쓴다 (`prod_20260801` · `test_20260801`).
파일을 훑기 **전에** 거르므로, 걸러진 폴더는 `fileCount` 계산 비용도 들지 않는다
(SSH 면 폴더당 `find` 한 번). 맞는 폴더가 없으면 오류가 아니라 빈 `items` 다.

```
GET /api/v1/snapshots?mode=local&root=D%3A%2Frelease&prefix=prod
```

비교(`/comparisons`)에는 이 파라미터가 없다 — 좌우는 이미 확정된 폴더명으로 지정하기 때문이다.

**200 OK**

```json
{
  "root": "C:\\Users\\KOSCOM\\Downloads\\code-diff\\sample-code",
  "items": [
    { "id": "2026-08-01", "sortKey": "20260801", "fileCount": 14, "packageCount": 4 },
    { "id": "2026-07-01", "sortKey": "20260701", "fileCount": 9,  "packageCount": 3 },
    { "id": "2026-06-01", "sortKey": "20260601", "fileCount": 8,  "packageCount": 3 }
  ]
}
```

| 필드 | 타입 | 제약 |
| ---- | ---- | ---- |
| `root` | String | 서버가 실제로 바라보는 절대 경로 |
| `items[].id` | String | 폴더명 그대로. 이후 요청의 `left` / `right` 값 |
| `items[].sortKey` | String | 폴더명에서 찾은 `YYYYMMDD`. 날짜로 안 읽히면 `""` (아래 참고) |
| `items[].fileCount` | Number | 비교 대상 확장자에 해당하는 파일 수 |
| `items[].packageCount` | Number | 바로 아래 디렉터리 수 (루트 파일이 있으면 `(루트)` 포함) |

정렬: `sortKey` 가 있는 항목이 **최신순**으로 앞에, 없는 항목은 이름 역순으로 뒤에.

#### sortKey 추출 규칙

폴더명 **어디에 있든** 처음 나오는 유효한 날짜를 쓴다. 구분자(`-` `.` `_` `/`)는 선택이다.

| 폴더명 | sortKey |
| ------ | ------- |
| `20260801` · `2026-08-01` · `2026.08.01` · `2026_08_01` | `20260801` |
| `rel_20260801` · `20260801_v2` · `20260801-hotfix` | `20260801` |
| `v2_20260801` · `REL1_20260801` · `build-3-2026-08-01` | `20260801` |
| `20260801_to_20260901` (날짜 2개) | `20260801` (앞선 것) |
| `trunk` · `2026-08` · `2026-13-01` · `2026-08-32` · `99999999` | `""` |

월은 `01`~`12`, 일은 `01`~`31` 범위만 유효로 본다. `sortKey` 가 `""` 여도 **비교 대상에서 빠지지는 않는다.**

**오류** — `ROOT_NOT_FOUND` (404)

---

## 2. 좌우 비교

```
GET /api/v1/comparisons?left={id}&right={id}
```

두 스냅샷의 패키지 요약과 파일 목록을 만든다. **파일 본문은 포함하지 않는다.**

| 파라미터 | 타입 | 필수 | 의미 |
| -------- | ---- | ---- | ---- |
| `left` | String | **Y** | 이전 스냅샷 id |
| `right` | String | **Y** | 이후 스냅샷 id |
| 무시 옵션 4종 | flag | N | 위 "공통" 참고 |

**200 OK**

```json
{
  "left": "2026-07-01",
  "right": "2026-08-01",
  "packages": [
    { "name": "cmm", "status": "modified", "added": 1, "removed": 0, "modified": 1, "same": 1, "changedLines": 36 },
    { "name": "stl", "status": "added",    "added": 3, "removed": 0, "modified": 0, "same": 0, "changedLines": 160 }
  ],
  "files": [
    {
      "path": "cmm/cmm_log.pc",
      "name": "cmm_log.pc",
      "packageName": "cmm",
      "status": "modified",
      "leftSize": 874,
      "rightSize": 1430,
      "stats": { "aLines": 43, "bLines": 63, "same": 41, "modified": 2, "added": 20, "removed": 0, "changedLines": 22, "lineSimilarity": 0.6507, "diceSimilarity": 0.7735, "charSimilarity": 0.7423, "changeRatio": 0.3492, "comparedA": 43, "comparedB": 63, "ignored": 0, "charsA": 874, "charsB": 1430, "commonChars": 1710 }
    }
  ],
  "skipped": 0
}
```

| 필드 | 타입 | 제약 |
| ---- | ---- | ---- |
| `packages[].name` | String | 날짜 폴더 바로 아래 디렉터리명. 루트 파일은 `(루트)` |
| `packages[].status` | String | `added` 이전에 없던 패키지 / `removed` 이후에 없어진 패키지 / `modified` 파일이 하나라도 움직임 / `same` 변화 없음 |
| `packages[].added·removed·modified·same` | Number | 그 패키지에 속한 파일들의 상태별 개수 |
| `packages[].changedLines` | Number | 소속 파일 `stats.changedLines` 의 합 |
| `files[].path` | String | 날짜 폴더 기준 상대 경로. 3번 API 의 `path` 값 |
| `files[].status` | String | `added` 이후에만 있음 / `removed` 이전에만 있음 / `modified` 양쪽에 있고 다름 / `same` 양쪽이 같음 |
| `files[].leftSize` `rightSize` | Number \| null | 그쪽에 파일이 없으면 `null` |
| `files[].stats` | Object | **항상 채워진다.** 한쪽에만 있는 파일은 빈 파일과 비교한 값 (신규는 전 줄 `added`, 삭제는 전 줄 `removed`) |
| `skipped` | Number | 확장자 미대상·용량 초과로 목록에서 빠진 파일 수 (좌우 합계) |

`packages` 는 이름 오름차순, `files` 는 경로 오름차순.

`left` 와 `right` 가 같아도 오류가 아니다. 모든 파일이 `same` 으로 온다.
`left` 가 `right` 보다 최신이어도 오류가 아니며, 신규/삭제가 뒤바뀐 결과가 온다.
(화면에서는 `이후` 가 `이전` 보다 최신이 되도록 고를 수 있는 목록 자체를 제한한다 — API 는 제한하지 않는다.)

**오류** — `MISSING_PARAM` (400)

### stats 필드

| 필드 | 의미 |
| ---- | ---- |
| `aLines` / `bLines` | 좌 / 우 총 줄 수 |
| `comparedA` / `comparedB` | 무시 옵션 적용 후 실제 비교한 줄 수 |
| `same` / `modified` / `added` / `removed` | 상태별 줄 수 |
| `ignored` | 무시 옵션으로 비교에서 빠진 줄 수 |
| `changedLines` | `modified + added + removed` |
| `lineSimilarity` | 일치줄 ÷ max(comparedA, comparedB) — 0~1 |
| `diceSimilarity` | 2 × 일치줄 ÷ (comparedA + comparedB) — 0~1 |
| `charSimilarity` | 수정된 줄 안의 부분 일치까지 반영한 문자 단위 유사도 — 0~1 |
| `changeRatio` | `1 − lineSimilarity` |

양쪽 다 빈 파일이면 유사도는 모두 `1` 이다.

---

## 3. 파일 본문

```
GET /api/v1/comparisons/files?left={id}&right={id}&path={상대경로}
```

선택한 파일 한 건의 좌우 본문을 읽는다. 경로에 `/` 가 들어가므로 쿼리 파라미터로 받는다.

| 파라미터 | 타입 | 필수 | 제약 |
| -------- | ---- | ---- | ---- |
| `left` | String | **Y** | 이전 스냅샷 id |
| `right` | String | **Y** | 이후 스냅샷 id |
| `path` | String | **Y** | 날짜 폴더 기준 상대 경로. `..`·절대 경로·빈 세그먼트는 거부된다 |

**200 OK**

```json
{
  "path": "cmm/cmm_log.pc",
  "leftText": "/*****...\n#include <stdio.h>\n...",
  "rightText": "/*****...\n#include <stdio.h>\n..."
}
```

| 필드 | 타입 | 제약 |
| ---- | ---- | ---- |
| `leftText` | String \| null | 이전 스냅샷에 없거나 읽을 수 없으면 `null` |
| `rightText` | String \| null | 이후 스냅샷에 없거나 읽을 수 없으면 `null` |

**오류**

| 상황 | code | HTTP |
| ---- | ---- | ---- |
| `left` `right` `path` 중 하나라도 빔 | `MISSING_PARAM` | 400 |
| 양쪽 다 `null` (없는 파일, 경로 탈출 시도 포함) | `FILE_NOT_FOUND` | 404 |

---

## 경로 안전장치

외부 폴더 밖을 읽지 못하도록 세 겹으로 막는다.

| 검사 | 막는 것 | 위치 |
| ---- | ------- | ---- |
| 스냅샷 id 검사 | `/` `\` `.` `..` 가 든 id | 각 소스 구현 |
| 상대 경로 정규화 | `..`, 절대 경로(`/`, `C:`), 빈 세그먼트 | `lib/fileTypes.safeRelativePath` |
| 최종 경로 확인 (로컬) | 해석된 절대 경로가 스냅샷 폴더 안인지 | `source/localSource.ts` |
| 원격 셸 인용 (SSH) | 경로에 든 `;` `&&` `$( )` `` ` `` `|` 등이 명령으로 새는 것 | `source/sshCommands.quoteRemotePath` |

폴더를 훑을 때 심볼릭 링크는 따라가지 않고, `node_modules` `.git` `target` `bin` `obj` 등은 건너뛴다.

SSH 는 `execFile` 로 인자 배열을 넘겨 **로컬 셸 보간이 없다.** 마지막 인자(원격 명령)만
원격 셸이 해석하므로, 그 안의 경로는 전부 작은따옴표로 감싼다.
선행 `~` 는 원격 홈으로 확장돼야 해서 `"$HOME"` 으로 바꿔 따옴표 밖에 둔다.

개발 서버는 `cors: false` 로 띄운다 — 다른 사이트가 브라우저를 통해 이 API 를 찔러보지 못한다.

---

## 캐시

| 대상 | 키 | 비우는 방법 |
| ---- | -- | ---------- |
| 스냅샷 파일 목록 | 위치 + 스냅샷 id | `GET /snapshots?refresh=1` |
| 좌우 비교 결과 | 위치 + `left` + `right` + 무시 옵션 4비트 | 위와 같음 |

"위치" 키에는 `encoding` 도 들어간다 — 인코딩이 다르면 같은 파일도 다른 내용으로 읽힌다.

"위치" 키에는 개인키 **경로**만 들어간다 (키 내용·비밀번호는 애초에 다루지 않는다).

캐시는 서버 프로세스 메모리에만 있다. 개발 서버를 재시작하면 사라진다.
외부 폴더가 바뀌었는데 화면이 그대로면 화면의 **⟳ 새로고침** 을 누른다.
