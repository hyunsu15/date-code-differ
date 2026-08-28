/* ==================================================================
   여기만 고치면 됩니다.

   비교할 대상 위치(프리셋)와 훑을 파일 범위를 정합니다.
   프리셋을 고르는 건 화면(⚙ 위치)에서 하고, 값은 전부 이 파일에 둡니다.

   · 프리셋(SOURCE_PRESETS)   — 고치면 화면에 바로 반영됩니다
   · 훑기 설정(SCAN)          — 고치면 개발 서버를 다시 시작하세요

   ------------------------------------------------------------------
   파일이 둘인 이유

   · change/config.ts          실제로 쓰는 파일. **저장소에 커밋되지 않습니다**
                               (서버 주소·계정이 남지 않도록)
   · change/config.example.ts  위 파일의 템플릿. 커밋됩니다

   config.ts 가 없으면 템플릿을 복사해 자동으로 만들어 줍니다
   (npm install · dev · build · test 앞에서). 이미 있으면 덮어쓰지 않습니다.
   ================================================================== */

import type { ScanConfig, SourcePreset } from '../src/types.ts'

/* ------------------------------------------------------------------
   비교 대상 위치 프리셋

   화면 오른쪽 위 ⚙ 위치 에서 골라 씁니다.
   고른 뒤 값을 직접 고치면 "직접 입력"으로 바뀌고 그 값이 저장됩니다.

   항목을 추가하려면 아래 배열에 하나 더 붙이면 됩니다.
   ------------------------------------------------------------------ */

export const SOURCE_PRESETS: SourcePreset[] = [
  {
    id: 'ssh',
    label: 'SSH 원격',
    description: '원격 서버의 폴더를 읽습니다',
    source: {
      mode: 'ssh',

      // ↓↓↓ 여기를 실제 서버 정보로 바꾸세요 ↓↓↓
      host: 'dev-server',
      user: 'deploy',
      // 날짜 폴더들의 부모 경로. '~/release' 처럼 홈 기준도 됩니다.
      root: '/home/deploy/release',

      /**
       * 인증 방식
       *   'key'      개인키 (기본). 아래 identityFile 또는 ssh 기본 키를 씁니다.
       *   'password' 비밀번호. 비밀번호는 여기 적지 않습니다 —
       *              터미널에서 `npm run ssh-login` 으로 넣으면
       *              개발 서버 메모리에만 보관됩니다.
       */
      auth: 'key',
      // ↑↑↑ 여기까지 ↑↑↑

      // 비우면(null) ssh 기본 포트 22
      port: null,
      // 비우면 ssh 기본 키(~/.ssh/id_*). auth: 'password' 면 쓰이지 않습니다.
      identityFile: '',
      // 'auto' | 'utf-8' | 'euc-kr'
      encoding: 'auto',
    },
  },

  {
    id: 'local',
    label: '내 PC 폴더',
    description: '이 PC 에 있는 폴더를 읽습니다',
    source: {
      mode: 'local',
      // 날짜 폴더들의 부모 폴더.
      // 상대 경로는 이 프로젝트 폴더 기준입니다. 예: 'D:/release', '//nas/deploy/history'
      root: './sample-code',
      encoding: 'auto',
    },
  },
]

/**
 * 처음 열었을 때(저장된 선택이 없을 때) 고를 프리셋.
 *
 * 위 `SOURCE_PRESETS` 의 `id` 중 하나를 적습니다.
 * 없는 id 를 적으면 목록의 첫 항목을 씁니다.
 *
 * 예시 폴더로 먼저 둘러보고 싶으면 `'local'` 로 바꾸세요.
 */
export const DEFAULT_PRESET_ID = 'ssh'

/* ------------------------------------------------------------------
   훑기 설정 — 어떤 파일을 비교 대상으로 볼지

   고친 뒤에는 개발 서버를 다시 시작해야 반영됩니다.
   ------------------------------------------------------------------ */

export const SCAN: ScanConfig = {
  /**
   * 비교 대상 확장자 (점 없이).
   *   pc  = Pro*C 소스,  pch = Pro*C 헤더
   *   pks = Oracle 패키지 명세,  pkb = Oracle 패키지 본문
   */
  extensions: ['pc', 'pch', 'h', 'sql', 'pks', 'pkb'],

  /** 한 파일 최대 크기(바이트). 이보다 크면 목록에서 제외합니다. */
  maxFileBytes: 2_000_000,
}
