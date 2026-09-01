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

test('여러 줄 블록 주석을 통째로 무시한다', () => {
  // 파일 머리말 주석. 가운데 줄들은 그 자체로는 주석 기호가 없거나(빈 줄),
  // 붙어 있어도 한 줄만 봐서는 주석인지 알 수 없다.
  const header = ['/*****', ' * 프로그램명 : ord_create.pc', '', ' * 작성일 : 2026-05-12', ' *****/']
  const a = `${header.join('\n')}\nint x = 1;\n`
  const b = 'int x = 1;\n'
  const on = buildFileDiff(a, b, O({ ignoreComments: true }))
  // 블록 안의 빈 줄도 주석의 일부다 (빈 줄 무시는 꺼져 있다)
  assert.equal(on.stats.ignored, 5)
  assert.equal(on.stats.changedLines, 0)
  assert.equal(on.stats.lineSimilarity, 1)
})

test('블록이 닫힌 뒤 이어지는 코드는 무시하지 않는다', () => {
  const a = '/* 설명\n   이어짐 */ int x = 1;\n'
  const b = '/* 설명\n   이어짐 */ int y = 2;\n'
  const on = buildFileDiff(a, b, O({ ignoreComments: true }))
  assert.equal(on.stats.ignored, 1) // 첫 줄만 주석이다
  assert.equal(on.stats.changedLines, 1) // 뒤에 붙은 코드는 살아서 차이가 잡힌다
})

test('SQL 한 줄 주석도 무시한다', () => {
  const a = '-- 주문 건수를 센다\nSELECT 1 FROM DUAL;\n'
  const b = 'SELECT 1 FROM DUAL;\n'
  const on = buildFileDiff(a, b, O({ ignoreComments: true }))
  assert.equal(on.stats.ignored, 1)
  assert.equal(on.stats.lineSimilarity, 1)
})

test('#include 는 주석이 아니다 — 전처리기 지시자다', () => {
  const on = buildFileDiff('#include <stdio.h>\n', '', O({ ignoreComments: true }))
  assert.equal(on.stats.ignored, 0)
  assert.equal(on.stats.removed, 1)
})

test('--i; 는 SQL 주석이 아니라 감소 연산자다', () => {
  const on = buildFileDiff('--i;\n', '', O({ ignoreComments: true }))
  assert.equal(on.stats.ignored, 0)
  assert.equal(on.stats.removed, 1)
})

test('문자열 안의 주석 기호는 주석이 아니다', () => {
  const on = buildFileDiff('strcpy(buf, "/* 진짜 주석 아님 */");\n', '', O({ ignoreComments: true }))
  assert.equal(on.stats.ignored, 0)
  assert.equal(on.stats.removed, 1)
})

test('한 줄 주석 안의 블록 기호는 블록을 열지 않는다', () => {
  const a = '// 여기 /* 는 주석 시작이 아니다\nint x = 1;\n'
  const b = 'int x = 1;\n'
  const on = buildFileDiff(a, b, O({ ignoreComments: true }))
  assert.equal(on.stats.ignored, 1, '첫 줄만 주석 — 뒤가 주석에 먹히면 안 된다')
  assert.equal(on.stats.changedLines, 0)
})

test('블록 주석은 겹치지 않는다 — 첫 닫힘에서 끝난다 (C 규칙)', () => {
  // `/* a /* b */` 까지가 주석이고 `c */` 는 코드로 남는다
  const on = buildFileDiff('/* a /* b */ c */\n', '', O({ ignoreComments: true }))
  assert.equal(on.stats.ignored, 0)
  assert.equal(on.stats.removed, 1)
})

test('줄 끝 역슬래시는 한 줄 주석을 다음 줄까지 끌고 간다 (C 규칙)', () => {
  const bs = String.fromCharCode(92)
  const a = `// 주석 이어짐 ${bs}\n여전히 주석이다\nint x = 1;\n`
  const b = 'int x = 1;\n'
  const on = buildFileDiff(a, b, O({ ignoreComments: true }))
  // 컴파일러가 두 줄을 한 주석으로 읽으므로 여기서도 그렇게 읽는다
  assert.equal(on.stats.ignored, 2)
  assert.equal(on.stats.changedLines, 0)
})

test('작성자 줄을 무시한다 — 이름만 다르면 같은 파일로 본다', () => {
  const a = ' * 작성자 : 홍길동\nint x = 1;\n'
  const b = ' * 작성자 : 김철수\nint x = 1;\n'
  const on = buildFileDiff(a, b, O({ ignoreAuthor: true }))
  assert.equal(on.stats.ignored, 1) // 좌우 한 줄씩이 한 행으로 묶인다
  assert.equal(on.stats.changedLines, 0)
  assert.equal(on.stats.lineSimilarity, 1)
})

test('글자 사이를 벌려 쓴 표기도 잡는다', () => {
  const a = ' * 작   성   자 : 홍길동\nint x = 1;\n'
  const b = 'int x = 1;\n'
  const on = buildFileDiff(a, b, O({ ignoreAuthor: true }))
  assert.equal(on.stats.ignored, 1)
  assert.equal(on.stats.changedLines, 0)
})

test('@author · 수정자 표기도 잡는다', () => {
  const a = '// @author gdhong\n * 수 정 자 : 김철수\nint x = 1;\n'
  const b = 'int x = 1;\n'
  const on = buildFileDiff(a, b, O({ ignoreAuthor: true }))
  assert.equal(on.stats.ignored, 2)
  assert.equal(on.stats.changedLines, 0)
})

test('상자 테두리 안에 있어도 잡는다', () => {
  const a = '/*==== 작성자 : 홍길동 ====*/\nint x = 1;\n'
  const b = '/*==== 작성자 : 김철수 ====*/\nint x = 1;\n'
  // 주석 무시는 꺼 둔다 — 작성자 규칙만으로 잡히는지 봐야 한다
  const on = buildFileDiff(a, b, O({ ignoreAuthor: true }))
  assert.equal(on.stats.ignored, 1)
  assert.equal(on.stats.changedLines, 0)
})

test('앞에 수식어가 붙어도 잡는다 (최종수정자 · 최초 작성자)', () => {
  const a = ' * 최종수정자 : 김철수\n * 최초 작성자 : 홍길동\nint x = 1;\n'
  const b = 'int x = 1;\n'
  const on = buildFileDiff(a, b, O({ ignoreAuthor: true }))
  assert.equal(on.stats.ignored, 2)
  assert.equal(on.stats.changedLines, 0)
})

test('작성일은 건드리지 않는다 — 이름 줄만 뺀다', () => {
  const a = ' * 작성일 : 2026-05-12\nint x = 1;\n'
  const b = ' * 작성일 : 2026-08-25\nint x = 1;\n'
  const on = buildFileDiff(a, b, O({ ignoreAuthor: true }))
  assert.equal(on.stats.ignored, 0)
  assert.equal(on.stats.changedLines, 1)
})

test('작성자 무시가 코드 줄을 건드리지는 않는다', () => {
  const on = buildFileDiff('strcpy(author, "hong");\n', '', O({ ignoreAuthor: true }))
  assert.equal(on.stats.ignored, 0)
  assert.equal(on.stats.removed, 1)
})

test('주석을 남겨 둔 채 작성자 줄만 뺄 수 있다', () => {
  const a = '/* 설명 */\n * 작성자 : 홍길동\nint x = 1;\n'
  const b = '/* 설명 */\n * 작성자 : 김철수\nint x = 1;\n'
  const on = buildFileDiff(a, b, O({ ignoreAuthor: true }))
  // 주석 무시는 꺼져 있으므로 `/* 설명 */` 은 비교 대상으로 남아 일치로 잡힌다
  assert.equal(on.stats.same, 2)
  assert.equal(on.stats.ignored, 1)
})

/* ---------------- 죽여 둔 코드 ---------------- */

test('#if 0 블록을 통째로 무시한다', () => {
  const a = '#if 0\n  old_call();\n#endif\nint x = 1;\n'
  const b = 'int x = 1;\n'
  const on = buildFileDiff(a, b, O({ ignoreDeadCode: true }))
  assert.equal(on.stats.ignored, 3)
  assert.equal(on.stats.changedLines, 0)
})

test('#if 0 안에 다시 열린 조건도 세어 짝을 맞춘다', () => {
  const a = '#if 0\n#ifdef A\n  a();\n#endif\n  b();\n#endif\nint x = 1;\n'
  const b = 'int x = 1;\n'
  const on = buildFileDiff(a, b, O({ ignoreDeadCode: true }))
  assert.equal(on.stats.ignored, 6, '안쪽 #endif 에서 끝나면 안 된다')
  assert.equal(on.stats.changedLines, 0)
})

test('#else 가지는 살아 있다', () => {
  const a = '#if 0\n  dead();\n#else\n  live();\n#endif\n'
  const b = '  live();\n#endif\n'
  const on = buildFileDiff(a, b, O({ ignoreDeadCode: true }))
  assert.equal(on.stats.ignored, 3, '#if 0 · 죽은 줄 · #else 까지만')
  assert.equal(on.stats.changedLines, 0)
})

test('#ifdef 와 include 가드는 건드리지 않는다', () => {
  const guard = '#ifndef ORD_H\n#define ORD_H\nint x = 1;\n#endif\n'
  const dbg = '#ifdef DEBUG\n  log();\n#endif\n'
  assert.equal(buildFileDiff(guard, '', O({ ignoreDeadCode: true })).stats.ignored, 0)
  assert.equal(buildFileDiff(dbg, '', O({ ignoreDeadCode: true })).stats.ignored, 0)
})

test('#if 1 은 죽은 코드가 아니다', () => {
  const on = buildFileDiff('#if 1\n  live();\n#endif\n', '', O({ ignoreDeadCode: true }))
  assert.equal(on.stats.ignored, 0)
  assert.equal(on.stats.removed, 3)
})

test('주석이나 문자열 안에 적힌 #if 0 에는 속지 않는다', () => {
  const inComment = '/*\n#if 0\n*/\nint x = 1;\n'
  const inString = 'puts("#if 0");\nint x = 1;\n'
  const opts = O({ ignoreDeadCode: true, ignoreComments: true })
  // 주석 줄 3개는 주석이라 빠지고, 그 뒤 코드는 살아 있어야 한다
  assert.equal(buildFileDiff(inComment, 'int x = 1;\n', opts).stats.changedLines, 0)
  assert.equal(buildFileDiff(inString, '', opts).stats.ignored, 0)
})

test('PL/SQL 의 $IF FALSE $THEN 도 같은 규칙이다', () => {
  const a = '$IF FALSE $THEN\n  old();\n$END\nv := 1;\n'
  const b = 'v := 1;\n'
  const on = buildFileDiff(a, b, O({ ignoreDeadCode: true }))
  assert.equal(on.stats.ignored, 3)
  assert.equal(on.stats.changedLines, 0)
  // 조건이 걸린 것은 그대로 둔다
  const live = '$IF $$debug $THEN\n  log();\n$END\n'
  assert.equal(buildFileDiff(live, '', O({ ignoreDeadCode: true })).stats.ignored, 0)
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

