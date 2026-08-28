import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBlocks, buildFileDiff, diffWithinLine } from '../src/lib/diffEngine.ts'
import { DEFAULT_OPTIONS } from '../src/lib/normalize.ts'
import { searchRows } from '../src/lib/search.ts'
import type { CharRange, DiffOptions, SearchOptions } from '../src/types.ts'

const O = (o: Partial<DiffOptions> = {}): DiffOptions => ({ ...DEFAULT_OPTIONS, ...o })
const spanLen = (ranges: CharRange[]): number => ranges.reduce((n, [s, e]) => n + (e - s), 0)

/* ---------------- 기본 ---------------- */

test('동일한 파일 → 유사도 100%', () => {
  const src = 'a\nb\nc\n'
  const { stats, hunks } = buildFileDiff(src, src, O())
  assert.equal(stats.same, 3)
  assert.equal(stats.changedLines, 0)
  assert.equal(stats.lineSimilarity, 1)
  assert.equal(stats.charSimilarity, 1)
  assert.equal(hunks.length, 0)
})

test('완전히 다른 파일 → 유사도 0%', () => {
  const { stats } = buildFileDiff('a\nb\n', 'x\ny\n', O())
  assert.equal(stats.same, 0)
  assert.equal(stats.lineSimilarity, 0)
})

test('줄 갯수 대비 유사도 = 일치줄 / max(양쪽 줄수)', () => {
  // 이전 4줄, 이후 5줄, 3줄 일치
  const { stats } = buildFileDiff('a\nb\nc\nZZ\n', 'a\nb\nc\nX\nY\n', O())
  assert.equal(stats.same, 3)
  assert.equal(stats.comparedA, 4)
  assert.equal(stats.comparedB, 5)
  assert.equal(stats.lineSimilarity, 3 / 5)
  assert.equal(stats.diceSimilarity, 6 / 9)
})

test('한쪽만 있는 파일 → 전부 삭제/추가', () => {
  const only = buildFileDiff('a\nb\nc\n', '', O())
  assert.equal(only.stats.removed, 3)
  assert.equal(only.stats.added, 0)
  assert.equal(only.stats.lineSimilarity, 0)
  const rev = buildFileDiff('', 'a\nb\nc\n', O())
  assert.equal(rev.stats.added, 3)
})

test('빈 파일 두 개 → 100%', () => {
  const { stats } = buildFileDiff('', '', O())
  assert.equal(stats.lineSimilarity, 1)
})

/* ---------------- 행 정렬 ---------------- */

test('삭제+추가 블록은 modify 로 짝지어짐', () => {
  const { rows } = buildFileDiff('a\nfoo(1)\nc\n', 'a\nfoo(2)\nc\n', O())
  assert.equal(rows.length, 3)
  assert.equal(rows[1].kind, 'modify')
  assert.equal(rows[1].aNo, 2)
  assert.equal(rows[1].bNo, 2)
})

test('행 번호는 원본 파일 기준으로 매겨짐', () => {
  const { rows } = buildFileDiff('a\nb\nc\n', 'a\nNEW\nb\nc\n', O())
  const add = rows.find((r) => r.kind === 'add')
  assert.ok(add)
  assert.equal(add.bNo, 2)
  assert.equal(add.aNo, null)
  const last = rows[rows.length - 1]
  assert.equal(last.aNo, 3)
  assert.equal(last.bNo, 4)
})

test('rows 의 id 는 0부터 연속', () => {
  const { rows } = buildFileDiff('a\nb\nc\n', 'a\nX\nc\nD\n', O())
  rows.forEach((r, i) => assert.equal(r.id, i))
})

/* ---------------- 단어 단위 diff ---------------- */

test('단어 구간이 양쪽 문자열 좌표로 정확히 잡힘', () => {
  const a = 'int total = 10;'
  const b = 'int count = 20;'
  const { aRanges, bRanges, commonA, commonB } = diffWithinLine(a, b, O())
  // 변경 구간을 잘라내면 실제로 바뀐 토큰이 나와야 한다
  assert.equal(aRanges.map(([s, e]) => a.slice(s, e)).join('|'), 'total|10')
  assert.equal(bRanges.map(([s, e]) => b.slice(s, e)).join('|'), 'count|20')
  // 공통 문자 수 + 변경 문자 수 = 전체 길이
  assert.equal(commonA + spanLen(aRanges), a.length)
  assert.equal(commonB + spanLen(bRanges), b.length)
})

test('길이가 다른 라인에서도 commonA/commonB 가 각 측 길이를 넘지 않음', () => {
  const cases: [string, string][] = [
    ['return ResponseEntity.ok(list);', 'return ResponseEntity.ok(taskCaseService.getCaseList(taskId));'],
    ['  private TaskCaseRepository repo;', 'private final TaskCaseRepository taskCaseRepository;'],
    ['x', 'a much longer line entirely different'],
  ]
  for (const [a, b] of cases) {
    const { commonA, commonB, aRanges, bRanges } = diffWithinLine(a, b, O())
    assert.ok(commonA <= a.length, `commonA ${commonA} > ${a.length}`)
    assert.ok(commonB <= b.length, `commonB ${commonB} > ${b.length}`)
    for (const [s, e] of aRanges) assert.ok(e <= a.length && s >= 0, 'aRange out of bounds')
    for (const [s, e] of bRanges) assert.ok(e <= b.length && s >= 0, 'bRange out of bounds')
  }
})

test('공백 뺀 공통량(commonNonWs)은 공통량 이하', () => {
  const { commonA, commonB, commonNonWsA, commonNonWsB } = diffWithinLine(
    '    return a + b;',
    '    return a - b;',
    O()
  )
  assert.ok(commonNonWsA <= commonA)
  assert.ok(commonNonWsB <= commonB)
  assert.ok(commonNonWsA > 0)
})

test('접두어만 겹치는 import 줄은 통짜가 아니라 단어 단위로 칠해짐', () => {
  const a = 'import java.util.Optional;'
  const b = 'import lombok.RequiredArgsConstructor;'
  const { rows } = buildFileDiff(`${a}\n`, `${b}\n`, O())
  const row = rows[0]
  assert.equal(row.kind, 'modify')
  assert.ok(row.aRanges)
  // 줄 전체(0..길이)를 한 구간으로 칠했다면 폴백이 걸린 것
  assert.ok(spanLen(row.aRanges) < a.length, '왼쪽이 통짜로 칠해짐')
  assert.ok(row.bRanges && spanLen(row.bRanges) < b.length, '오른쪽이 통짜로 칠해짐')
})

test('완전히 무관한 줄은 통짜로 칠해짐', () => {
  const a = 'x'
  const b = 'System.out.println("hello world, entirely unrelated");'
  const { rows } = buildFileDiff(`${a}\n`, `${b}\n`, O())
  const row = rows[0]
  assert.equal(row.kind, 'modify')
  assert.deepEqual(row.aRanges, [[0, a.length]])
  assert.deepEqual(row.bRanges, [[0, b.length]])
})

test('문자 유사도는 0~1 범위 안', () => {
  const { stats } = buildFileDiff(
    'public void run(int a) {\n  call(a);\n}\n',
    'public void run(long a, Ctx c) {\n  call(a, c);\n}\n',
    O()
  )
  assert.ok(stats.charSimilarity > 0 && stats.charSimilarity < 1, `got ${stats.charSimilarity}`)
  assert.ok(stats.charSimilarity > stats.lineSimilarity, '부분일치가 반영되어야 함')
})

/* ---------------- 무시 옵션 ---------------- */

test('공백 무시하면 들여쓰기만 다른 줄이 일치로 잡힘', () => {
  const a = 'if (x) {\n    doWork();\n}\n'
  const b = 'if (x) {\n\t\tdoWork();\n}\n'
  const off = buildFileDiff(a, b, O())
  const on = buildFileDiff(a, b, O({ ignoreWhitespace: true }))
  assert.equal(off.stats.same, 2)
  assert.equal(on.stats.same, 3)
  assert.equal(on.stats.lineSimilarity, 1)
})

test('대소문자 무시', () => {
  const on = buildFileDiff('Foo();\n', 'foo();\n', O({ ignoreCase: true }))
  assert.equal(on.stats.same, 1)
})

test('빈 줄 무시 — 비교에서 빠지되 화면에는 남음', () => {
  const a = 'a\n\n\n\nb\n'
  const b = 'a\nb\n'
  const on = buildFileDiff(a, b, O({ ignoreBlankLines: true }))
  assert.equal(on.stats.same, 2)
  assert.equal(on.stats.changedLines, 0)
  assert.equal(on.stats.lineSimilarity, 1)
  // 무시된 줄도 rows 에 남아 있어야 원본을 그대로 보여줄 수 있다
  assert.equal(on.rows.filter((r) => r.kind === 'ignored').length, 3)
  assert.equal(on.stats.ignored, 3)
})

test('주석 무시', () => {
  const a = '// 설명\nint x = 1;\n'
  const b = 'int x = 1;\n'
  const on = buildFileDiff(a, b, O({ ignoreComments: true }))
  assert.equal(on.stats.lineSimilarity, 1)
  assert.equal(on.stats.ignored, 1)
})

test('무시 라인 되돌리기 후에도 행 번호가 원본과 1:1', () => {
  const a = 'a\n\nb\n// c\nd\n'
  const b = 'a\nb\nd\n'
  const { rows } = buildFileDiff(a, b, O({ ignoreBlankLines: true, ignoreComments: true }))
  const aLines = a.replace(/\n$/, '').split('\n')
  for (const r of rows) {
    if (r.aNo != null) assert.equal(r.aText, aLines[r.aNo - 1], `행 ${r.aNo} 불일치`)
  }
  // 원본 A 의 모든 줄이 정확히 한 번씩 등장
  const seen = rows
    .filter((r) => r.aNo != null)
    .map((r) => r.aNo as number)
    .sort((x, y) => x - y)
  assert.deepEqual(seen, [1, 2, 3, 4, 5])
})

/* ---------------- hunk ---------------- */

test('연속 변경은 하나의 diff 포인트로 묶임', () => {
  const a = 'a\nb\nc\nd\ne\nf\ng\n'
  const b = 'a\nB1\nB2\nd\ne\nF1\ng\n'
  const { hunks } = buildFileDiff(a, b, O())
  assert.equal(hunks.length, 2)
  assert.equal(hunks[0].index, 0)
  assert.ok(hunks[0].preview.length > 0)
  assert.ok(hunks[0].rowEnd >= hunks[0].rowStart)
  assert.ok(hunks[1].rowStart > hunks[0].rowEnd)
})

test('hunk 는 항상 rows 범위 안이고 변경행만 포함', () => {
  const a = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
  const b = a.replace('line 5', 'LINE five').replace('line 30', 'LINE thirty')
  const { rows, hunks } = buildFileDiff(a, b, O())
  assert.equal(hunks.length, 2)
  for (const h of hunks) {
    assert.ok(h.rowStart >= 0 && h.rowEnd < rows.length)
    for (let i = h.rowStart; i <= h.rowEnd; i++) {
      assert.notEqual(rows[i].kind, 'equal', `hunk 안에 equal 행 포함 (row ${i})`)
    }
  }
})

/* ---------------- 접기 ---------------- */

test('변경 지점에서 먼 구간은 접힘', () => {
  const a = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')
  const b = a.replace('line 30', 'CHANGED')
  const { rows } = buildFileDiff(a, b, O())
  const blocks = buildBlocks(rows, 3, new Set())
  assert.equal(blocks.filter((x) => x.kind === 'gap').length, 2)
  // 보이는 행은 변경행 1개 + 위아래 3줄씩 = 7
  const shown = blocks
    .filter((x) => x.kind === 'rows')
    .reduce((n, x) => n + (x.to - x.from + 1), 0)
  assert.equal(shown, 7)
})

test('접기 펼치면 해당 구간이 rows 로 바뀜', () => {
  const a = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')
  const b = a.replace('line 30', 'CHANGED')
  const { rows } = buildFileDiff(a, b, O())
  const first = buildBlocks(rows, 3, new Set()).find((x) => x.kind === 'gap')
  assert.ok(first)
  const after = buildBlocks(rows, 3, new Set([first.from]))
  assert.equal(after.filter((x) => x.kind === 'gap').length, 1)
})

test('문맥 -1 이면 전부 보임', () => {
  const a = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')
  const b = a.replace('line 10', 'X')
  const { rows } = buildFileDiff(a, b, O())
  const blocks = buildBlocks(rows, -1, new Set())
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].to - blocks[0].from + 1, rows.length)
})

/* ---------------- 줄바꿈 처리 ---------------- */

test('CRLF 와 LF 는 같은 내용으로 취급', () => {
  const { stats } = buildFileDiff('a\r\nb\r\nc\r\n', 'a\nb\nc\n', O())
  assert.equal(stats.lineSimilarity, 1)
})

test('마지막 개행 유무는 줄 수에 영향 없음', () => {
  assert.equal(buildFileDiff('a\nb\n', 'a\nb', O()).stats.aLines, 2)
  assert.equal(buildFileDiff('a\nb\n', 'a\nb', O()).stats.bLines, 2)
})

/* ---------------- diff 표시 끄기 ---------------- */

/* ---------------- 코드 내용 검색 ---------------- */

const S = (o: Partial<SearchOptions> = {}): SearchOptions => ({
  query: '',
  caseSensitive: false,
  regex: false,
  ...o,
})

test('양쪽에서 모두 찾고, 같은 행이면 이전(왼쪽) 먼저', () => {
  const { rows } = buildFileDiff('foo bar\n', 'foo baz\n', O())
  const r = searchRows(rows, S({ query: 'foo' }))
  assert.equal(r.matches.length, 2)
  assert.equal(r.matches[0].side, 'a')
  assert.equal(r.matches[1].side, 'b')
  assert.deepEqual([r.matches[0].start, r.matches[0].end], [0, 3])
})

test('결과는 위에서 아래 순서', () => {
  const src = 'x\ny\nx\nz\nx\n'
  const { rows } = buildFileDiff(src, src, O())
  const r = searchRows(rows, S({ query: 'x' }))
  const aRows = r.matches.filter((m) => m.side === 'a').map((m) => m.row)
  assert.deepEqual(aRows, [...aRows].sort((p, q) => p - q))
})

test('대소문자 구분 옵션', () => {
  const { rows } = buildFileDiff('Foo foo FOO\n', 'Foo foo FOO\n', O())
  assert.equal(searchRows(rows, S({ query: 'foo' })).matches.length, 6) // 양쪽 3개씩
  assert.equal(searchRows(rows, S({ query: 'foo', caseSensitive: true })).matches.length, 2)
})

test('일반 모드에서는 정규식 문자를 글자 그대로 찾는다', () => {
  const { rows } = buildFileDiff('a.c\n', 'abc\n', O())
  const plain = searchRows(rows, S({ query: 'a.c' }))
  assert.equal(plain.matches.length, 1)
  assert.equal(plain.matches[0].side, 'a')
  const re = searchRows(rows, S({ query: 'a.c', regex: true }))
  assert.equal(re.matches.length, 2)
})

test('잘못된 정규식은 오류로 알린다', () => {
  const { rows } = buildFileDiff('x\n', 'x\n', O())
  const r = searchRows(rows, S({ query: '[', regex: true }))
  assert.ok(r.error)
  assert.equal(r.matches.length, 0)
})

test('길이 0 매치에도 멈추지 않는다', () => {
  const { rows } = buildFileDiff('aaa\n', 'bbb\n', O())
  const r = searchRows(rows, S({ query: 'a*', regex: true }))
  assert.equal(r.matches.length, 1) // 'aaa' 한 번, 빈 매치는 건너뜀
})

test('빈 검색어는 결과 없음', () => {
  const { rows } = buildFileDiff('abc\n', 'abc\n', O())
  assert.equal(searchRows(rows, S({ query: '' })).matches.length, 0)
})

test('byRow 구간은 실제 그 위치의 글자와 일치', () => {
  const { rows } = buildFileDiff('int total = 10;\n', 'int count = 20;\n', O())
  const r = searchRows(rows, S({ query: 'int' }))
  for (const [rowIdx, m] of r.byRow) {
    for (const [s, e] of m.a) assert.equal(rows[rowIdx].aText?.slice(s, e), 'int')
    for (const [s, e] of m.b) assert.equal(rows[rowIdx].bText?.slice(s, e), 'int')
  }
  assert.equal(r.byRow.size, 1)
})

test('접힌 구간의 행도 검색된다 (렌더링과 무관)', () => {
  const a = Array.from({ length: 60 }, (_, i) => (i === 40 ? 'NEEDLE here' : `line ${i}`)).join('\n')
  const b = a.replace('line 0', 'CHANGED')
  const { rows } = buildFileDiff(a, b, O())
  const blocks = buildBlocks(rows, 3, new Set())
  const needleRow = rows.findIndex((r) => r.aText?.includes('NEEDLE'))
  const inGap = blocks.some((x) => x.kind === 'gap' && needleRow >= x.from && needleRow <= x.to)
  assert.ok(inGap, '테스트 전제: NEEDLE 이 접힌 구간에 있어야 함')
  assert.ok(searchRows(rows, S({ query: 'NEEDLE' })).matches.length > 0)
})

