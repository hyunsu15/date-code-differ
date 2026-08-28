import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeText } from '../server/source/decode.ts'

/**
 * UNIX 에서 오래 관리된 Pro*C 소스는 EUC-KR 인 경우가 많다.
 * UTF-8 로 읽으면 한글 주석이 깨지므로 인코딩을 고를 수 있어야 한다.
 */

const utf8 = (text: string): Buffer => Buffer.from(text, 'utf8')

/** `주문 접수` 를 EUC-KR 로 인코딩한 바이트 */
const EUCKR_ORDER = Buffer.from([0xc1, 0xd6, 0xb9, 0xae, 0x20, 0xc1, 0xa2, 0xbc, 0xf6])

/* ---------------- 지정한 인코딩 ---------------- */

test('EUC-KR 을 지정하면 한글이 제대로 읽힌다', () => {
  assert.equal(decodeText(EUCKR_ORDER, 'euc-kr'), '주문 접수')
})

test('UTF-8 을 지정하면 UTF-8 로 읽는다', () => {
  assert.equal(decodeText(utf8('주문 접수'), 'utf-8'), '주문 접수')
})

test('UTF-8 지정 시 깨진 바이트는 대체문자로 두고 파일 전체를 살린다', () => {
  // fatal 을 켜면 파일 하나를 통째로 못 읽는다. 읽히는 부분은 보여주는 편이 낫다.
  const decoded = decodeText(EUCKR_ORDER, 'utf-8')
  assert.ok(decoded.length > 0)
  assert.ok(decoded.includes('�'), '대체문자가 들어가야 한다')
})

/* ---------------- 자동 판별 ---------------- */

test('자동 — 올바른 UTF-8 은 UTF-8 로 읽는다', () => {
  for (const text of ['주문 접수', 'plain ascii', '한글/ASCII 섞임 mixed', '이모지 🙂']) {
    assert.equal(decodeText(utf8(text), 'auto'), text, text)
  }
})

test('자동 — UTF-8 로 유효하지 않으면 EUC-KR 로 본다', () => {
  assert.equal(decodeText(EUCKR_ORDER, 'auto'), '주문 접수')
})

test('자동 — ASCII 만 있으면 어느 쪽으로 읽어도 같다', () => {
  const ascii = Buffer.from('int main(void) { return 0; }', 'ascii')
  assert.equal(decodeText(ascii, 'auto'), 'int main(void) { return 0; }')
  assert.equal(decodeText(ascii, 'euc-kr'), 'int main(void) { return 0; }')
  assert.equal(decodeText(ascii, 'utf-8'), 'int main(void) { return 0; }')
})

test('자동 판별이 UTF-8 파일을 망치지 않는다', () => {
  // 자동을 기본값으로 둘 수 있는 근거 — 올바른 UTF-8 은 항상 UTF-8 로 읽힌다
  const source = '/* 주문 등록 */\nint ord_create(void)\n{\n    return 0;\n}\n'
  assert.equal(decodeText(utf8(source), 'auto'), source)
})

/* ---------------- 경계 ---------------- */

test('빈 내용은 빈 문자열', () => {
  for (const enc of ['auto', 'utf-8', 'euc-kr'] as const) {
    assert.equal(decodeText(Buffer.alloc(0), enc), '', enc)
  }
})

test('UTF-8 BOM 은 떼어낸다 — 소스 첫 줄에 보이지 않는 글자가 남지 않게', () => {
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8('#include <stdio.h>')])
  for (const enc of ['auto', 'utf-8'] as const) {
    assert.equal(decodeText(withBom, enc), '#include <stdio.h>', enc)
  }
})

test('줄바꿈과 탭은 그대로 유지된다', () => {
  const source = 'a\r\n\tb\nc'
  assert.equal(decodeText(utf8(source), 'auto'), source)
})

test('표준 완성형 한글은 모두 읽는다', () => {
  // 실사용 범위 — 선행바이트 0xA1~0xFE
  const cases: [number[], string][] = [
    [[0xc1, 0xd6], '주'],
    [[0xb9, 0xae], '문'],
    [[0xc3, 0xeb], '취'],
    [[0xbc, 0xd2], '소'],
    [[0xb0, 0xe8], '계'],
    [[0xc1, 0xa2], '접'],
    [[0xbc, 0xf6], '수'],
    [[0xb5, 0xee], '등'],
    [[0xb7, 0xcf], '록'],
  ]
  for (const [bytes, expected] of cases) {
    assert.equal(decodeText(Buffer.from(bytes), 'euc-kr'), expected, expected)
  }
})

test('CP949 확장 영역은 옮기지 못한다 (알려진 제약)', () => {
  // Node 내장 `euc-kr` 디코더는 선행바이트 0x81~0xA0 을 처리하지 못한다.
  // `똠`(0x8C 0x63) 같은 확장 글자가 필요해지면 외부 디코더를 붙여야 한다.
  // 일반적인 한글 주석은 전부 완성형 범위라 실사용에는 걸리지 않는다.
  assert.notEqual(decodeText(Buffer.from([0x8c, 0x63]), 'euc-kr'), '똠')
})
