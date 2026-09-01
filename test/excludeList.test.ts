import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_EXCLUDE_SEPARATORS, ExcludeList } from '../src/lib/excludeList.ts'

/**
 * 제외 목록의 **읽기와 판정**만 다룬다 (접은 뒤 무엇이 달라지는지는 comparison.test.ts).
 *
 * 규칙 파일은 사용자가 직접 손으로 적는다 — 오타·빈 줄·윈도우 줄끝·메모장 BOM 이
 * 섞여 들어오는 것이 정상이라고 보고, 그중 무엇도 다른 규칙을 죽이지 않아야 한다.
 */

/* ---------------- 읽기 ---------------- */

test('빈 입력은 규칙이 없는 상태', () => {
  assert.equal(ExcludeList.parse(null).size, 0)
  assert.equal(ExcludeList.parse('').size, 0)
  assert.equal(ExcludeList.parse('   \n\n  ').size, 0)
  assert.equal(ExcludeList.parse(null).isEmpty, true)
})

test('쉼표와 줄바꿈을 둘 다 받는다 — 섞여 있어도 된다', () => {
  const list = ExcludeList.parse('a.pc, b.pc\nc.pc,\nd.pc')
  assert.deepEqual([...list.patterns], ['a.pc', 'b.pc', 'c.pc', 'd.pc'])
})

test('항목 앞뒤 공백과 윈도우 줄끝(CRLF)을 털어 낸다', () => {
  const list = ExcludeList.parse('  a.pc  ,\r\n\tb.pc\r\n')
  assert.deepEqual([...list.patterns], ['a.pc', 'b.pc'])
  assert.equal(list.matches('a.pc'), 'a.pc')
})

test('# 로 시작하는 항목은 설명이라 규칙이 되지 않는다', () => {
  const list = ExcludeList.parse('# 자동생성물\n*_gen.pc\n# 여기부터 벤더\nvendor')
  assert.deepEqual([...list.patterns], ['*_gen.pc', 'vendor'])
})

test('설명이 뒤 규칙을 삼키지 않는다 — 항목마다 따로 본다', () => {
  const list = ExcludeList.parse('#설명,a.pc,#또 설명,b.pc')
  assert.deepEqual([...list.patterns], ['a.pc', 'b.pc'])
})

test('같은 뜻의 중복은 한 번만 든다 (표기가 달라도)', () => {
  const list = ExcludeList.parse('a.pc, ./a.pc, /a.pc, a.pc/')
  assert.equal(list.size, 1)
})

test('메모장이 붙인 BOM 때문에 첫 규칙이 죽지 않는다', () => {
  const list = ExcludeList.parse('﻿a.pc,b.pc')
  assert.equal(list.matches('a.pc'), 'a.pc')
})

test('규칙 원문을 그대로 들고 있다 — 화면이 "왜 접혔는지" 를 보여줘야 한다', () => {
  const list = ExcludeList.parse('  *_bak.pc  ')
  assert.equal(list.matches('ord/ord_bak.pc'), '*_bak.pc')
})

/* ---------------- 구분자 바꾸기 ---------------- */

test('구분자를 바꿀 수 있다 — 세미콜론으로만 가른다', () => {
  const list = ExcludeList.parse('a.pc;b.pc,c.pc', [';'])
  assert.deepEqual([...list.patterns], ['a.pc', 'b.pc,c.pc'])
})

test('여러 글자짜리 구분자도 받는다', () => {
  const list = ExcludeList.parse('a.pc||b.pc', ['||'])
  assert.deepEqual([...list.patterns], ['a.pc', 'b.pc'])
})

test('구분자가 정규식으로 해석되지 않는다', () => {
  // `.` 를 구분자로 주면 **점 그대로** 갈라야 한다 (아무 글자가 아니라)
  const list = ExcludeList.parse('a.pc', ['.'])
  assert.deepEqual([...list.patterns], ['a', 'pc'])
})

test('쓸 수 있는 구분자가 없으면 기본값으로 돌아간다', () => {
  assert.deepEqual([...ExcludeList.parse('a.pc,b.pc', []).patterns], ['a.pc', 'b.pc'])
  assert.deepEqual([...ExcludeList.parse('a.pc,b.pc', ['']).patterns], ['a.pc', 'b.pc'])
  assert.deepEqual([...DEFAULT_EXCLUDE_SEPARATORS], [',', '\n'])
})

/* ---------------- 판정 ---------------- */

test('이름만 적으면 어느 폴더에 있든 걸린다', () => {
  const list = ExcludeList.parse('ord_create.pc')
  assert.equal(list.matches('ord_create.pc'), 'ord_create.pc')
  assert.equal(list.matches('ord/ord_create.pc'), 'ord_create.pc')
  assert.equal(list.matches('a/b/c/ord_create.pc'), 'ord_create.pc')
  assert.equal(list.matches('ord/ord_create.pch'), null)
})

test('슬래시가 들어가면 루트부터 맞춘다', () => {
  const list = ExcludeList.parse('ord/tmp')
  assert.equal(list.matches('ord/tmp/x.pc'), 'ord/tmp')
  assert.equal(list.matches('pay/ord/tmp/x.pc'), null, '루트부터 맞춰야 한다')
})

test('폴더 이름을 적으면 그 아래 전부가 걸린다', () => {
  const list = ExcludeList.parse('rpt')
  assert.equal(list.matches('rpt/rpt_daily.pc'), 'rpt')
  assert.equal(list.matches('rpt/sub/deep.pc'), 'rpt')
  assert.equal(list.matches('rpt_daily.pc'), null, '이름이 같은 파일까지 걸면 안 된다')
})

test('* 는 폴더 경계를 넘지 않고, ** 는 넘는다', () => {
  const one = ExcludeList.parse('ord/*.pc')
  assert.equal(one.matches('ord/a.pc'), 'ord/*.pc')
  assert.equal(one.matches('ord/sub/a.pc'), null)

  const deep = ExcludeList.parse('ord/**/*.pc')
  assert.equal(deep.matches('ord/sub/a.pc'), 'ord/**/*.pc')
  assert.equal(deep.matches('ord/a/b/c.pc'), 'ord/**/*.pc')
})

test('별 두 개는 0단도 건너뛴다 — 루트에 바로 있는 파일도 걸린다', () => {
  const list = ExcludeList.parse('**/a.pc')
  assert.equal(list.matches('a.pc'), '**/a.pc')
  assert.equal(list.matches('x/a.pc'), '**/a.pc')
})

test('? 는 한 글자', () => {
  const list = ExcludeList.parse('ord_?.pc')
  assert.equal(list.matches('ord_1.pc'), 'ord_?.pc')
  assert.equal(list.matches('ord_12.pc'), null)
})

test('대소문자를 가리지 않는다 — 같은 규칙이 로컬과 원격에서 다르게 먹으면 안 된다', () => {
  const list = ExcludeList.parse('ORD/*.PC')
  assert.equal(list.matches('ord/a.pc'), 'ORD/*.PC')
})

test('윈도우식 역슬래시 경로도 같은 것으로 본다', () => {
  const list = ExcludeList.parse('ord\\tmp')
  assert.equal(list.matches('ord/tmp/x.pc'), 'ord\\tmp')
  assert.equal(ExcludeList.parse('ord/tmp').matches('ord\\tmp\\x.pc'), 'ord/tmp')
})

/* ---------------- 정규식으로 새지 않는다 ---------------- */

test('규칙의 점은 아무 글자가 아니라 점 그대로다', () => {
  const list = ExcludeList.parse('a.pc')
  assert.equal(list.matches('axpc'), null)
})

test('정규식 메타문자가 들어와도 그 글자 그대로 찾는다', () => {
  const list = ExcludeList.parse('a+b(1).pc, ord[old]')
  assert.equal(list.matches('a+b(1).pc'), 'a+b(1).pc')
  assert.equal(list.matches('ord[old]/x.pc'), 'ord[old]')
  assert.equal(list.matches('aab1.pc'), null)
})

test('규칙으로 정규식을 적어도 정규식으로 해석되지 않는다', () => {
  const list = ExcludeList.parse('^ord/.*$')
  assert.equal(list.matches('ord/a.pc'), null, '정규식은 지원하지 않는다')
})

/* ---------------- 경계 ---------------- */

test('빈 경로는 어떤 규칙에도 걸리지 않는다', () => {
  const list = ExcludeList.parse('**')
  assert.equal(list.matches(''), null)
  assert.equal(list.matches('   '), null)
})

test('규칙이 없으면 아무것도 걸리지 않는다', () => {
  assert.equal(ExcludeList.EMPTY.matches('ord/a.pc'), null)
  assert.equal(ExcludeList.EMPTY.size, 0)
})

test('먼저 적은 규칙이 이긴다 — 어느 줄을 고쳐야 하는지 흔들리지 않게', () => {
  const list = ExcludeList.parse('ord, *.pc')
  assert.equal(list.matches('ord/a.pc'), 'ord')
})

test('규칙 목록을 밖에서 고칠 수 없다', () => {
  const list = ExcludeList.parse('a.pc')
  const patterns = list.patterns as string[]
  patterns.push('b.pc')
  assert.equal(list.size, 1, '내부 상태가 밖의 배열 조작에 흔들리면 안 된다')
})
