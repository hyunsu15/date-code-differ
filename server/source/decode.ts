import type { TextEncodingName } from '../../src/types.ts'

/**
 * 원격·로컬에서 읽은 바이트를 문자열로 바꾼다.
 *
 * UNIX 에서 오래 관리된 Pro*C 소스는 EUC-KR 로 저장된 경우가 많다.
 * 그대로 UTF-8 로 읽으면 한글 주석이 깨지므로 인코딩을 고를 수 있게 한다.
 */

/** UTF-8 파일 앞에 붙는 BOM — 소스 첫 줄에 보이지 않는 글자로 남지 않게 떼어낸다 */
const BOM = '﻿'

const stripBom = (text: string): string => (text.startsWith(BOM) ? text.slice(1) : text)

/**
 * Node 내장 디코더 이름. `cp949` 라는 이름은 받지 않아 `euc-kr` 을 쓴다.
 *
 * ⚠️ 실측: 이 디코더는 **표준 완성형(선행바이트 0xA1–0xFE)만** 옮긴다.
 * CP949 확장 영역(0x81–0xA0, 예: `똠` `뷁`)은 제대로 옮기지 못한다.
 * 일반적인 한글 주석은 전부 완성형 범위라 실사용에는 문제가 없다.
 * 확장 글자까지 필요해지면 `iconv-lite` 같은 외부 디코더를 붙여야 한다.
 */
const EUC_KR = 'euc-kr'

/**
 * UTF-8 로 읽어보고, 유효하지 않으면 EUC-KR 로 본다.
 *
 * EUC-KR 한글 바이트는 거의 항상 UTF-8 로는 잘못된 시퀀스라 이 판별이 잘 맞는다.
 * 반대로 올바른 UTF-8 파일은 항상 UTF-8 로 읽히므로, 자동 판별이 UTF-8 파일을 망치지 않는다.
 */
function decodeAuto(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder(EUC_KR).decode(bytes)
  }
}

export function decodeText(bytes: Uint8Array, encoding: TextEncodingName): string {
  if (bytes.length === 0) return ''

  switch (encoding) {
    case 'euc-kr':
      return stripBom(new TextDecoder(EUC_KR).decode(bytes))
    case 'utf-8':
      // fatal 을 켜지 않는다 — 깨진 바이트는 U+FFFD 로 두고 파일을 통째로 못 읽는 일이 없게 한다
      return stripBom(new TextDecoder('utf-8').decode(bytes))
    default:
      return stripBom(decodeAuto(bytes))
  }
}
