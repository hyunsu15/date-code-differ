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
| `excludeFile` | String | N | 목록에서 접어 둘 파일들이 적힌 텍스트 파일 경로. 비우면 접지 않는다 |
| `schemaRoot` | String | N | 데이터 스키마 덤프가 쌓이는 폴더. 비우면 스키마 API 가 빈 목록을 준다 |
| `schemaExcludeFile` | String | N | 스키마 비교에서 접어 둘 것들이 적힌 텍스트 파일 경로. 비우면 접지 않는다 |

**자격증명 파라미터는 없다.** SSH 인증은 이 API 가 아니라 **ssh 가 알아서 한다** —
개인키 · ssh-agent · `~/.ssh/config`. 비밀번호는 받지도, 보관하지도 않는다.

`encoding` 은 로컬·SSH 모두에 적용된다. `auto` 는 UTF-8 로 읽어보고 유효하지 않으면 EUC-KR 로 본다
(올바른 UTF-8 파일은 항상 UTF-8 로 읽히므로 멀쩡한 파일이 망가지지 않는다).

`excludeFile` 은 **비교 대상과 같은 자리**에서 읽는다 (local 이면 이 PC, ssh 면 원격 서버).
`root` 와 무관하게 푼다 — local 의 상대 경로는 프로젝트 폴더 기준, ssh 는 원격 경로 그대로다
(`~/release/exclude.txt` 처럼 홈 기준도 된다). `rightRoot` 로 좌우 위치가 갈려도 **규칙은 하나**다.

이 파라미터는 **2번 비교 API 에서만** 뜻이 있다 (1·3번은 받아도 무시한다).
읽어 들인 규칙은 캐시되며 `?refresh=1`(1번 API) 로 다시 읽는다.

`schemaRoot` 도 같은 규칙으로 푼다 (`root` 와 무관, local 은 프로젝트 폴더 기준, ssh 는 원격 경로 그대로).
**4·5번 스키마 API 에서만** 뜻이 있다. 그 아래는 환경 폴더로 갈리고 날짜별 파일이 하나씩 있다.

```
<schemaRoot>/<leftEnv>/snapshot_<leftEnv>_2026-09-01.txt
```

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
| `ignoreComments` | flag | N | 주석 전용 줄을 비교에서 뺀다 (화면에는 남는다). 여러 줄 블록 주석도 통째로 |
| `ignoreAuthor` | flag | N | 작성자 표기 줄(`작성자 : 홍길동` · `@author`)을 비교에서 뺀다 |
| `ignoreDeadCode` | flag | N | 조건이 거짓으로 못박힌 블록(`#if 0` … `#endif`)을 비교에서 뺀다 |

---

## 1. 스냅샷 목록

```
GET /api/v1/snapshots
```

외부 폴더 바로 아래의 디렉터리를 스냅샷으로 훑는다.

| 파라미터 | 타입 | 필수 | 의미 |
| -------- | ---- | ---- | ---- |
| `refresh` | flag | N | 서버 캐시를 비우고 외부 폴더를 다시 읽는다 |

환경(운영/테스트)을 가리키는 파라미터는 **없다.** 화면이 고른 환경 폴더를
`root` 에 이미 붙여 보내므로, 서버가 보는 루트 자체가 그 환경이다.

```
GET /api/v1/snapshots?mode=local&root=D%3A%2Frelease%2Fprod
```

이 엔드포인트는 **한 번에 한 위치**만 본다. 좌우가 서로 다른 환경이면 화면이 각 `root`
로 한 번씩 부른다. 캐시 키에도 `root` 가 들어가므로 환경별로 저절로 갈린다.

비교 쪽(`/comparisons` · `/comparisons/files`)은 좌우가 다를 수 있어 `rightRoot` 를
더 받는다 — 아래 참고.

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

## 1-1. 날짜별 변경 수

```
GET /api/v1/snapshots/changes
```

날짜마다 **바로 앞(더 오래된) 날짜와 견줘** 파일이 몇 개 추가 · 삭제 · 변경됐는지 센다.
화면의 날짜 고르기 목록이 "11개 바뀜" 을 붙이고 **변경된 날짜만** 추려 보이는 데 쓴다.

파라미터는 `/snapshots` 와 같다 (위치 파라미터만). 한 번에 한 위치만 본다.

**200 OK**

```json
{
  "items": [
    { "id": "2026-09-01", "base": "2026-08-15", "added": 2, "removed": 3, "modified": 4 },
    { "id": "2026-08-15", "base": "2026-08-01", "added": 0, "removed": 0, "modified": 0 },
    { "id": "2026-06-01", "base": null,         "added": 8, "removed": 0, "modified": 0 }
  ]
}
```

| 필드 | 타입 | 제약 |
| ---- | ---- | ---- |
| `items[].id` | String | 날짜 폴더명. 순서는 `/snapshots` 와 같다 (최신순) |
| `items[].base` | String \| null | 견준 앞 날짜. **가장 오래된 날짜는 `null`** — 그때 `added` 는 든 파일 전체 수 |
| `items[].added` | Number | 이 날짜에만 있는 파일 수 (≥ 0) |
| `items[].removed` | Number | 앞 날짜에만 있던 파일 수 (≥ 0) |
| `items[].modified` | Number | 양쪽에 있고 내용이 다른 파일 수 (≥ 0) |

- 셋이 모두 0 이면 **배포가 없던 날**(앞 날짜와 똑같은 폴더)이다.
- **파일 단위**로 센다 — 한 바이트라도 다르면 변경. 무시 옵션(공백·주석)은 적용하지 않는다.
- `excludeFile`(팀 제외 목록)에 걸린 파일은 세지 않는다. 화면의 "내 제외 목록" 은 적용하지 않는다.
- SSH 는 목록을 만들 때 받은 체크섬으로 가른다 (**추가 접속 없음**). 로컬은 크기가 같은 파일만 본문을 읽어 견준다.

**오류** — `/snapshots` 와 같다 (`ROOT_NOT_FOUND` 404 등)

---

## 2. 좌우 비교

```
GET /api/v1/comparisons?left={id}&right={id}
```

두 스냅샷의 패키지 요약과 파일 목록을 만든다. **파일 본문은 포함하지 않는다.**

| 파라미터 | 타입 | 필수 | 의미 |
| -------- | ---- | ---- | ---- |
| `left` | String | **Y** | 왼쪽(기준) 스냅샷 id |
| `right` | String | **Y** | 오른쪽(견줄) 스냅샷 id |
| `rightRoot` | String | N | 오른쪽이 **다른 폴더**일 때만. 없으면 양쪽 다 `root` 를 본다 |
| 무시 옵션 6종 | flag | N | 위 "공통" 참고 |

`rightRoot` 는 운영 ↔ 테스트처럼 좌우가 다른 환경 폴더일 때 쓴다. 서버·계정·인코딩은
좌우가 같다는 전제라(환경은 루트 아래 하위 폴더다) 갈리는 값은 위치 하나뿐이다.

```
GET /api/v1/comparisons?mode=local&root=.%2Fsample-code%2Fprod
  &rightRoot=.%2Fsample-code%2Ftest&left=2026-09-01&right=2026-08-01
```

**왼쪽이 오른쪽보다 최신이어도 된다.** 환경마다 배포 시점이 달라 "운영 9/1 vs 테스트
8/1"(테스트가 뒤처진 상태)은 정상적인 질문이다. 순서 규칙은 화면이 **같은 위치일 때만**
건다.

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
  "skipped": 0,
  "exclude": { "file": "", "rules": 0, "files": 0, "changed": 0, "error": null }
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
| `files[].excluded` | Boolean | 제외 목록에 걸려 **접어 둔** 파일. 목록에서 빠지지 않는다 |
| `files[].excludedBy` | String \| null | 걸린 규칙의 원문. `excluded=false` 면 `null` |
| `skipped` | Number | 확장자 미대상·용량 초과로 **아예 읽지 않은** 파일 수 (좌우 합계) |
| `exclude.file` | String | 요청의 `excludeFile` 값. 빈 문자열이면 이 기능을 쓰지 않은 것 |
| `exclude.rules` | Number | 규칙 파일에서 읽어 들인 규칙 수 |
| `exclude.files` | Number | 접어 둔 파일 수 (= `files[].excluded` 가 참인 것) |
| `exclude.changed` | Number | 그중 `status !== 'same'` 인 수. **0 이 아니면 화면이 눈에 띄게 알린다** |
| `exclude.error` | String \| null | 규칙 파일을 읽지 못한 이유. 이때도 비교 자체는 정상 응답이다 |

`packages` 는 이름 오름차순, `files` 는 경로 오름차순.

**`skipped` 와 `exclude` 는 다르다.** `skipped` 는 확장자·용량 기준으로 **아예 읽지 않은** 파일이라
결과에 흔적이 없다. `exclude` 는 **읽고 비교까지 마친 뒤 접어 둔** 파일이라 `files` 에 그대로 있고,
통계도 채워져 있다 — 화면이 펼치면 변경 내용까지 그대로 보인다. 그래서 접기는 읽는 양을 줄이지 않는다.

`packages` 는 **접어 둔 파일을 뺀** 값이다. 화면에 보이는 목록과 합계가 어긋나지 않게 하기 위함이며,
한 패키지의 파일이 모두 접히면 그 패키지는 `packages` 에서 사라진다.

#### 규칙 파일 형식

항목을 **쉼표 또는 줄바꿈**으로 구분한다 (`change/config.ts` 의 `SCAN.excludeSeparators` 로 바꿀 수 있다).
`#` 로 시작하는 항목은 설명이다. 정규식은 지원하지 않는다.

| 적는 법 | 뜻 | 예 |
| ------ | -- | -- |
| 이름만 | 어느 폴더에 있든 | `*_bak.pc` → `ord/a_bak.pc` |
| 폴더 이름 | 그 아래 전부 | `rpt` → `rpt/rpt_daily.pc` |
| 슬래시 포함 | 루트부터 맞춤 | `ord/tmp` → `ord/tmp/x.pc` (단 `pay/ord/tmp/x.pc` 는 아님) |
| `*` | 한 폴더 안 | `ord/*.pc` (`ord/sub/a.pc` 는 아님) |
| `**` | 폴더를 넘어 | `ord/**/*.pc` |
| `?` | 한 글자 | `ord_?.pc` |

대소문자는 가리지 않는다 (같은 규칙이 윈도우와 UNIX 에서 다르게 먹지 않도록).

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
| `left` | String | **Y** | 왼쪽(기준) 스냅샷 id |
| `right` | String | **Y** | 오른쪽(견줄) 스냅샷 id |
| `rightRoot` | String | N | 오른쪽이 **다른 폴더**일 때만. 없으면 양쪽 다 `root` 를 본다 |
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

## 4. 스키마 날짜 목록

```
GET /api/v1/schemas/snapshots?leftEnv=prod&rightEnv=test[&위치 파라미터]
```

`<schemaRoot>/<환경>/` 안의 파일 이름에서 날짜를 뽑아 최신순으로 돌려준다.
**날짜가 폴더가 아니라 파일 이름에 있다** — 이름 규칙은 `change/config.ts` 의
`SCHEMA.fileName`(기본 `snapshot_{env}_{date}.txt`)에서 정한다.

| 이름 | 타입 | 필수 | 의미 |
| ---- | ---- | ---- | ---- |
| `leftEnv` | String | N | 왼쪽 환경 폴더명 (`ENV_FOLDERS` 의 `path`). 비우면 `schemaRoot` 바로 아래 |
| `rightEnv` | String | N | 오른쪽 환경 폴더명. `leftEnv` 와 같으면 한 번만 읽는다 |

**환경을 따로 받는 이유.** 코드 비교는 고른 환경 폴더가 이미 `root` 에 붙어서 오지만,
스키마는 `schemaRoot` 아래에 환경 폴더가 따로 붙는다 — 서버가 그 이름을 알아야 경로를 만든다.

**응답**

```json
{
  "root": "./sample-schema",
  "left":  [{ "id": "2026-09-01", "sortKey": "20260901" },
            { "id": "2026-08-01", "sortKey": "20260801" }],
  "right": [{ "id": "2026-09-01", "sortKey": "20260901" }]
}
```

| 필드 | 타입 | 의미 |
| ---- | ---- | ---- |
| `root` | String | 요청의 `schemaRoot` 값. 빈 문자열이면 이 기능을 쓰지 않는 것 |
| `left` `right` | Array | 그 환경의 날짜 목록 (최신순) |
| `items[].id` | String | 파일 이름에서 뽑은 날짜 — 5번 API 의 `left`/`right` 에 그대로 넣는다 |
| `items[].sortKey` | String | 이름에서 뽑은 8자리 숫자. 못 뽑으면 빈 문자열 |

**폴더가 없어도 오류가 아니다** — 빈 배열을 준다. 스키마를 아직 안 올린 환경이 있는 것이
정상이라, 그것 때문에 화면이 죽으면 안 된다.

---

## 4-1. 스키마 날짜별 변경 수

```
GET /api/v1/schemas/changes?leftEnv=prod&rightEnv=test
```

좌우 환경의 덤프 날짜마다 **바로 앞 덤프와 견줘** 테이블이 몇 개 추가 · 삭제 · 변경됐는지 센다.
스키마 탭 날짜 고르기 목록의 "테이블 N개 바뀜" · "변경된 날짜만" 에 쓴다.

| 파라미터 | 타입 | 필수 | 의미 |
| -------- | ---- | ---- | ---- |
| `leftEnv` | String | N | 왼쪽 환경 폴더명 (`prod`). 환경을 안 쓰면 빈 값 |
| `rightEnv` | String | N | 오른쪽 환경 폴더명. `leftEnv` 와 같으면 한 번만 센다 |

**200 OK**

```json
{
  "left":  [
    { "id": "2026-09-01", "base": "2026-08-01", "added": 1, "removed": 0, "modified": 3 },
    { "id": "2026-08-01", "base": null,         "added": 6, "removed": 0, "modified": 0 }
  ],
  "right": [ "...같은 모양..." ]
}
```

| 필드 | 타입 | 제약 |
| ---- | ---- | ---- |
| `left[]` · `right[]` | Array | 각 환경의 덤프 날짜 순서(최신순). 덤프가 없는 환경은 `[]` |
| `[].base` | String \| null | 견준 앞 덤프 날짜. 가장 오래된 덤프는 `null` — 그때 `added` 는 든 테이블 전체 수 |
| `[].added` / `removed` / `modified` | Number | 추가 · 삭제 · 변경된 **테이블** 수 (≥ 0) |

- 테이블 안의 컬럼 · 제약 · 인덱스 중 하나라도 다르면 그 테이블은 변경이다.
- 시스템 이름 제약(`SCHEMA.systemNamePattern`, 기본 `SYS_C…`)은 접혀 세지 않는다.
- 제외 목록 · 종류 토글은 화면이 얹는 것이라 여기서는 적용하지 않는다.

**오류** — `/schemas/snapshots` 와 같다

---

## 5. 스키마 대조

```
GET /api/v1/schemas?left=2026-08-01&right=2026-09-01&leftEnv=prod&rightEnv=test[&위치 파라미터]
```

좌우 스키마 파일을 읽어 **테이블 단위 구조**로 견준다. 줄 단위 diff 가 아니다 —
이름으로 짝지어 컬럼 · 제약 · 인덱스를 각각 대조한다.

| 이름 | 타입 | 필수 | 의미 |
| ---- | ---- | ---- | ---- |
| `left` `right` | String | **Y** | 4번 API 가 준 `id` |
| `leftEnv` `rightEnv` | String | N | 4번과 같음 |

**응답**

```json
{
  "left": "2026-08-01",
  "right": "2026-09-01",
  "leftDescription": "주문·결제계 스키마 — 2026-08 정기배포 반영본",
  "rightDescription": "주문·결제계 스키마 — 2026-09 정기배포 반영본",
  "malformed": 0,
  "tables": [
    {
      "name": "TB_ORD",
      "status": "modified",
      "primaryKeyChanged": true,
      "changedKinds": ["column", "constraint"],
      "sections": {
        "column": {
          "kind": "column",
          "total": 8, "added": 1, "removed": 1, "modified": 1, "systemHidden": 0,
          "rows": [
            {
              "name": "ORD_AMT",
              "status": "modified",
              "systemNamed": false,
              "left":  { "badge": null, "value": "NUMBER(15,2)" },
              "right": { "badge": null, "value": "NUMBER(18,2)" }
            }
          ]
        },
        "constraint": { "kind": "constraint", "total": 2, "added": 0, "removed": 0, "modified": 1, "systemHidden": 8, "rows": [] },
        "index":      { "kind": "index",      "total": 4, "added": 1, "removed": 0, "modified": 0, "systemHidden": 0, "rows": [] }
      }
    }
  ]
}
```

| 필드 | 타입 | 의미 |
| ---- | ---- | ---- |
| `left` `right` | String | 실제로 읽은 날짜 |
| `leftDescription` `rightDescription` | String | 파일 맨 위 `#` 주석. 좌우가 다르면 그것도 변경이다 |
| `malformed` | Number | 종류를 못 알아본 줄 수. 0 이 아니면 `SCHEMA.separator` 를 의심한다 |
| `malformedSample` | Array | 못 읽은 줄의 원문 앞부분 (최대 3개) — 원인을 짚는 데 쓴다 |
| `malformedHint` | String | 못 읽은 원인 추정. 짚을 수 없으면 빈 문자열 |
| `exclude.file` | String | 요청의 `schemaExcludeFile` 값 |
| `exclude.rules` | Array | 읽어 들인 규칙 원문들. **적용은 화면이 한다** (아래 참고) |
| `exclude.error` | String|null | 규칙 파일을 읽지 못했을 때의 안내 |
| `tables[].status` | String | `added` · `removed` · `modified` · `same` |
| `tables[].primaryKeyChanged` | Boolean | 기본키가 움직였는지. **양쪽에 다 있는 테이블에서만** 참이 된다 |
| `tables[].changedKinds` | Array | 변경이 있는 종류들 — 화면의 종류 필터가 쓴다 |
| `sections[종류].total` | Number | 접은 것을 뺀 줄 수 |
| `sections[종류].systemHidden` | Number | 시스템 이름이라 접은 줄 수 (아래 참고) |
| `rows[].left` `rows[].right` | Object\|null | 한쪽에만 있으면 null. `badge` 는 제약 종류·유니크 여부 |

### 값을 그대로 견주지 않는 세 자리

Oracle 딕셔너리를 그대로 흘린 텍스트라, 값을 곧이곧대로 비교하면 없는 변경이 생긴다.
서버가 대조 전에 셋을 정리한다 (`src/lib/schemaParse.ts`).

| | 무엇이 문제인가 | 어떻게 |
| --- | --- | --- |
| 시스템 이름 | Oracle 이 NOT NULL 컬럼마다 만드는 `SYS_C0011234` 는 **번호가 DB 마다 다르다.** 운영↔테스트에서 내용이 같아도 전부 변경으로 뜬다 | `SCHEMA.systemNamePattern` 에 걸리면 접고 수만 남긴다 (`systemHidden`) |
| 길이 | `DATA_LENGTH` 는 문자형에서만 뜻이 있다. NUMBER 는 늘 22, DATE 는 늘 7 | 세 필드를 표시용 타입 하나로 합쳐 견준다 (`NUMBER(15,2)`) |
| 다중 컬럼 | 기본키·인덱스가 `POSITION` 을 단 여러 줄로 흩어져 온다 | 이름으로 묶고 위치 순으로 이어 `ORD_NO, ORD_SEQ` 한 줄로 |

**오류**

| 상황 | code | HTTP |
| ---- | ---- | ---- |
| `left` `right` 중 하나라도 빔 | `MISSING_PARAM` | 400 |

파일이 없으면 오류가 아니라 **빈 스냅샷**으로 본다 (그 날짜에 덤프가 없는 것은 정상이다).

### 제외 규칙은 왜 서버가 적용하지 않나

스키마 접기는 세 겹이다 — 팀 규칙 파일 · 화면에만 있는 내 목록 · 종류 토글.
뒤 둘은 서버가 모르므로, 서버가 일부만 적용하면 **요약 숫자와 목록이 갈린다.**
그래서 서버는 파일을 읽어 규칙만 실어 보내고(`exclude.rules`), 셋을 합쳐 접고 다시 세는
일은 화면이 한 자리에서 한다 (`src/features/schema/schemaExclude.ts`).

규칙 파일 내용은 캐시되므로 파일을 고친 뒤에는 `GET /snapshots?refresh=1`(화면의 새로고침)이 필요하다.

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
| 날짜별 변경(이웃 날짜 쌍) | 위치 + 앞 날짜 + 이 날짜 | 위와 같음 (제외 목록은 캐시 밖에서 매번 얹는다) |
| 좌우 비교 결과 | 위치 + `left` + `right` + 무시 옵션 6비트 | 위와 같음 |
| 제외 규칙 | 위치 + `excludeFile` | 위와 같음 |
| 읽어 들인 스키마 | 위치 + 스키마 파일 경로 + 구분자 + 시스템 이름 규칙 | 위와 같음 |
| 스키마 날짜별 변경(이웃 덤프 쌍) | 위치 + 스키마 폴더 + 환경 + 앞 날짜 + 이 날짜 | 위와 같음 |

"위치" 키에는 `encoding` 도 들어간다 — 인코딩이 다르면 같은 파일도 다른 내용으로 읽힌다.

**`excludeFile` 은 "위치" 키에 들어가지 않는다.** 목록도 비교 결과도 제외와 무관하게 만들고
접기는 그 위에 얹기 때문이다 — 규칙을 고쳐도 폴더를 다시 훑지 않고, 다음 요청에 바로 반영된다
(규칙 **파일의 내용**은 위 표대로 캐시되므로 파일을 고친 뒤에는 새로고침이 필요하다).

"위치" 키에는 개인키 **경로**만 들어간다 (키 내용·비밀번호는 애초에 다루지 않는다).

캐시는 서버 프로세스 메모리에만 있다. 개발 서버를 재시작하면 사라진다.
외부 폴더가 바뀌었는데 화면이 그대로면 화면의 **⟳ 새로고침** 을 누른다.
