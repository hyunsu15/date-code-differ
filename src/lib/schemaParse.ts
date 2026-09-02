/**
 * 데이터 스키마 덤프를 읽어 **테이블 단위 구조**로 바꾼다.
 *
 * 입력은 Oracle 딕셔너리를 그대로 흘린 텍스트다. 줄마다 앞머리 `[…]` 로 종류를 밝히고,
 * 나머지 필드를 구분자로 가른다.
 *
 *     [COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N
 *     [CONSTRAINT],TB_ORD,PK_ORD,P,ORD_NO,1
 *     [INDEX],TB_ORD,IX_ORD_01,NONUNIQUE,ORD_DT,1
 *
 * **값을 그대로 견주면 안 되는 자리가 세 곳 있다.** 이 파일이 그 셋을 여기서 흡수해,
 * 위 계층(`schemaDiff.ts`)은 이미 정리된 값만 이름으로 짝지으면 되게 한다.
 *
 * 1. `DATA_LENGTH` 는 문자형에서만 뜻이 있다 — NUMBER 는 늘 22, DATE 는 늘 7 인
 *    내부 저장 크기다. 그대로 비교하면 없는 변경이 생긴다 → `formatType` 이 세 필드
 *    (`DATA_LENGTH` · `DATA_PRECISION` · `DATA_SCALE`)를 표시용 타입 하나로 합친다.
 *
 * 2. `SYS_C0011234` 같은 이름은 DB 가 붙인 것이고 번호가 **데이터베이스마다 다르다.**
 *    Oracle 은 `NOT NULL` 컬럼마다 이런 제약을 만들므로, 운영 ↔ 테스트를 견주면
 *    내용이 같아도 수백 개가 전부 변경으로 뜬다 → `systemNamed` 로 표시해 접는다
 *    (지우지는 않는다 — 몇 개를 접었는지 화면에 남긴다).
 *
 * 3. 다중 컬럼 기본키·인덱스는 `POSITION` 을 단 **여러 줄**로 흩어져 온다. 줄 단위로
 *    견주면 컬럼 하나 추가된 것이 "신규 1 + 기존 그대로" 로 갈라져 무슨 일이 났는지
 *    안 보인다 → 이름으로 묶고 위치 순으로 이어 `ORD_NO, ORD_SEQ` 한 줄로 만든다.
 *
 * 필드 순서는 **파일이 스스로 들고 있다.** 종류마다 첫 줄에 헤더가 오므로
 * (`[COLUMN],TABLE_NAME,COLUMN_NAME,…`) 거기서 읽는다. SELECT 목록에 컬럼이 하나
 * 늘어도 이 도구를 고칠 필요가 없다. 헤더가 없으면 `DEFAULT_FIELDS` 로 돌아간다.
 */

import type {
  ConstraintKind,
  SchemaColumn,
  SchemaConfig,
  SchemaConstraint,
  SchemaIndex,
  SchemaKind,
  SchemaSnapshot,
  TableSchema,
} from '../types.ts'

/** 메모장이 붙이는 BOM. 첫 줄 앞에 남으면 그 줄만 조용히 안 읽힌다 */
const BOM = '﻿'

/** 이 글자로 시작하는 줄은 설명이다 — 파일 맨 위 것은 화면에 보여준다 */
const COMMENT = '#'

/** 줄 앞머리 `[…]` 와 종류의 대응. 대소문자는 가리지 않는다 */
const KIND_BY_TAG: Record<string, SchemaKind> = {
  COLUMN: 'column',
  CONSTRAINT: 'constraint',
  INDEX: 'index',
}

export const CONSTRAINT_LABEL: Record<ConstraintKind, string> = {
  P: '기본키',
  R: '외래키',
  U: '유니크',
  C: '체크',
  other: '제약',
}

/**
 * 헤더 칸에서 딕셔너리 컬럼명만 뽑기 위해 걷어낼 함수들.
 * `NVL(TO_CHAR(DATA_LENGTH,''))` 처럼 감싸여 오는 것이 보통이다.
 */
const SQL_FUNCTIONS = new Set([
  'NVL',
  'NVL2',
  'TO_CHAR',
  'TO_NUMBER',
  'TRIM',
  'LTRIM',
  'RTRIM',
  'SUBSTR',
  'UPPER',
  'LOWER',
  'DECODE',
  'COALESCE',
  'CAST',
  'REPLACE',
])

/**
 * 딕셔너리 컬럼명 → 이 도구가 쓰는 역할 이름.
 * 종류마다 따로 읽으므로 `COLUMN_NAME` 이 컬럼 자신의 이름이기도 하고
 * 제약에 딸린 컬럼이기도 하지만 헷갈릴 자리가 없다.
 */
const ROLE_BY_DICTIONARY: Record<string, string> = {
  TABLE_NAME: 'table',
  COLUMN_NAME: 'column',
  DATA_TYPE: 'type',
  DATA_LENGTH: 'length',
  DATA_PRECISION: 'precision',
  DATA_SCALE: 'scale',
  NULLABLE: 'nullable',
  CONSTRAINT_NAME: 'name',
  CONSTRAINT_TYPE: 'ctype',
  INDEX_NAME: 'name',
  // 실제 덤프에 `UNIQUNESS` 로 적혀 온다. 원문 오타를 고치라고 요구하지 않는다
  UNIQUENESS: 'unique',
  UNIQUNESS: 'unique',
  POSITION: 'position',
  COLUMN_POSITION: 'position',
}

/** 헤더 줄이 없을 때 쓸 필드 순서 */
const DEFAULT_FIELDS: Record<SchemaKind, readonly string[]> = {
  column: ['table', 'column', 'type', 'length', 'precision', 'scale', 'nullable'],
  constraint: ['table', 'name', 'ctype', 'column', 'position'],
  index: ['table', 'name', 'unique', 'column', 'position'],
}

/** 길이가 뜻을 갖는 타입 */
const SIZED_CHAR_TYPES = new Set(['VARCHAR2', 'VARCHAR', 'NVARCHAR2', 'CHAR', 'NCHAR', 'RAW'])

/** 자릿수·소수점이 뜻을 갖는 타입 */
const SCALED_NUMBER_TYPES = new Set(['NUMBER', 'DECIMAL', 'NUMERIC', 'FLOAT'])

/** 길이·자릿수로 쓸 수 있는 값인지. 빈 칸과 문자열을 걸러 낸다 */
function digits(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  return /^-?\d+$/.test(value) ? String(Number(value)) : ''
}

/**
 * 세 필드를 화면에 보여줄 타입 문자열 하나로 합친다 (**함정 1**).
 *
 *   VARCHAR2 · 20 · — · —   →  `VARCHAR2(20)`
 *   NUMBER   · 22 · 15 · 2  →  `NUMBER(15,2)`
 *   NUMBER   · 22 · 10 · 0  →  `NUMBER(10)`
 *   NUMBER   · 22 · —  · —  →  `NUMBER`
 *   DATE     ·  7 · — · —   →  `DATE`
 *
 * 문자형이 아니면 `DATA_LENGTH` 를 버린다 — 내부 저장 크기라 뜻이 없고,
 * 그대로 두면 타입이 같은데도 좌우가 달라 보이는 일이 생긴다.
 */
export function formatType(
  type: string | undefined,
  length: string | undefined,
  precision: string | undefined,
  scale: string | undefined
): string {
  const name = (type ?? '').trim().toUpperCase()
  if (!name) return ''

  if (SIZED_CHAR_TYPES.has(name)) {
    const size = digits(length)
    return size ? `${name}(${size})` : name
  }

  if (SCALED_NUMBER_TYPES.has(name)) {
    const p = digits(precision)
    if (!p) return name
    const s = digits(scale)
    // 자릿수 0 은 정수라는 뜻이라 `NUMBER(10,0)` 이 아니라 `NUMBER(10)` 으로 적는다
    return s && s !== '0' ? `${name}(${p},${s})` : `${name}(${p})`
  }

  // DATE · CLOB · TIMESTAMP(6) … 딕셔너리의 타입 이름이 이미 완결형이다
  return name
}

/**
 * 헤더 칸에서 딕셔너리 컬럼명을 뽑는다.
 * `NVL(TO_CHAR(DATA_LENGTH,''))` → `DATA_LENGTH`
 */
export function unwrapFieldName(cell: string): string {
  const identifiers = cell.toUpperCase().match(/[A-Z_][A-Z0-9_]*/g) ?? []
  return identifiers.find((id) => !SQL_FUNCTIONS.has(id)) ?? cell.trim().toUpperCase()
}

/** 제약 종류 원문을 아는 값으로 좁힌다. 모르는 것은 원문을 배지에 그대로 쓴다 */
function toConstraintKind(raw: string): ConstraintKind {
  const value = raw.trim().toUpperCase()
  return value === 'P' || value === 'R' || value === 'U' || value === 'C' ? value : 'other'
}

/** 여러 줄로 흩어져 온 한 덩어리 (**함정 3**) — 이름으로 묶어 위치 순으로 잇는다 */
interface Grouped {
  name: string
  /** 제약 종류 원문 또는 인덱스의 유니크 여부 */
  extra: string
  parts: { position: number; column: string }[]
}

/**
 * 한 종류의 필드 배치. 헤더 줄에서 읽거나 기본값에서 온다.
 * 값은 "역할 → 몇 번째 칸" 이다.
 */
type FieldIndex = Map<string, number>

function toFieldIndex(fields: readonly string[]): FieldIndex {
  const index: FieldIndex = new Map()
  // 첫 칸은 `[COLUMN]` 태그라 1 부터 센다
  fields.forEach((role, i) => {
    if (role && !index.has(role)) index.set(role, i + 1)
  })
  return index
}

/**
 * 헤더 줄인지 가린다 — 두 번째 칸이 `TABLE_NAME` 이면 헤더다.
 * 데이터 줄의 그 자리에는 실제 테이블명이 온다.
 */
function isHeaderRow(cells: string[]): boolean {
  return cells.length > 1 && unwrapFieldName(cells[1]) === 'TABLE_NAME'
}

/**
 * 스키마 덤프 본문을 읽어 들인다.
 *
 * **한 줄이 잘못돼도 나머지를 죽이지 않는다.** 사람이 만드는 파일이 아니라 DB 덤프라
 * 형식은 일정하지만, 종류를 못 알아본 줄은 세어 두고(`malformed`) 계속 읽는다 —
 * 조용히 0 개로 넘어가면 테이블이 통째로 비어도 이유를 알 수 없다.
 */
export function parseSchema(raw: string | null, config: SchemaConfig): SchemaSnapshot {
  if (!raw) return { description: '', tables: [], malformed: 0, malformedSample: [] }

  const separator = config.separator || ','
  const systemName = toSystemNameTest(config.systemNamePattern)

  const description: string[] = []
  const malformedSample: string[] = []
  let sawData = false
  let malformed = 0

  /** 못 읽은 줄을 세고, 앞의 몇 개는 원문을 남긴다 (화면이 원인을 짚는 데 쓴다) */
  const dropLine = (line: string): void => {
    malformed += 1
    if (malformedSample.length < MALFORMED_SAMPLE_MAX) {
      malformedSample.push(line.slice(0, MALFORMED_SAMPLE_CHARS))
    }
  }

  const fieldsByKind = new Map<SchemaKind, FieldIndex>()
  const columnsByTable = new Map<string, SchemaColumn[]>()
  const constraintsByTable = new Map<string, Map<string, Grouped>>()
  const indexesByTable = new Map<string, Map<string, Grouped>>()

  for (const line of raw.replace(BOM, '').split(/\r?\n/)) {
    const text = line.trim()
    if (!text) continue

    if (text.startsWith(COMMENT)) {
      // 파일 맨 위 설명만 화면으로 올린다. 중간 주석은 구분선인 경우가 많다
      if (!sawData) description.push(text.slice(1).trim())
      continue
    }

    const cells = text.split(separator)
    const kind = KIND_BY_TAG[stripTag(cells[0])]
    if (!kind) {
      dropLine(text)
      continue
    }

    if (isHeaderRow(cells)) {
      fieldsByKind.set(kind, toFieldIndex(cells.slice(1).map(toRole)))
      continue
    }
    sawData = true

    const fields = fieldsByKind.get(kind) ?? toFieldIndex(DEFAULT_FIELDS[kind])
    const at = (role: string): string => (cells[fields.get(role) ?? -1] ?? '').trim()

    const table = at('table')
    if (!table) {
      dropLine(text)
      continue
    }

    if (kind === 'column') {
      const name = at('column')
      if (!name) {
        dropLine(text)
        continue
      }
      const list = columnsByTable.get(table) ?? []
      // 같은 컬럼이 두 번 오면 먼저 온 것을 남긴다 (덤프가 겹쳐 나오는 경우 대비)
      if (!list.some((c) => c.name === name)) {
        list.push({
          name,
          type: formatType(at('type'), at('length'), at('precision'), at('scale')),
          // Oracle 딕셔너리 규약: NULLABLE 이 `N` 이면 NOT NULL 이다
          nullable: at('nullable').toUpperCase() !== 'N',
        })
      }
      columnsByTable.set(table, list)
      continue
    }

    const store = kind === 'constraint' ? constraintsByTable : indexesByTable
    const name = at('name')
    if (!name) {
      dropLine(text)
      continue
    }

    const byName = store.get(table) ?? new Map<string, Grouped>()
    const found = byName.get(name) ?? {
      name,
      extra: kind === 'constraint' ? at('ctype') : at('unique'),
      parts: [],
    }
    const column = at('column')
    if (column) {
      const position = Number(at('position'))
      found.parts.push({
        position: Number.isFinite(position) ? position : found.parts.length + 1,
        column,
      })
    }
    byName.set(name, found)
    store.set(table, byName)
  }

  // 어느 종류에서든 이름이 나온 테이블은 전부 목록에 올린다 —
  // 컬럼이 하나도 없고 인덱스만 있는 테이블도 좌우 대조에서 빠지면 안 된다
  const names = new Set([
    ...columnsByTable.keys(),
    ...constraintsByTable.keys(),
    ...indexesByTable.keys(),
  ])

  const tables: TableSchema[] = [...names].sort().map((name) => ({
    name,
    columns: columnsByTable.get(name) ?? [],
    constraints: [...(constraintsByTable.get(name)?.values() ?? [])].map((g) =>
      toConstraint(g, systemName)
    ),
    indexes: [...(indexesByTable.get(name)?.values() ?? [])].map((g) => toIndex(g, systemName)),
  }))

  return { description: description.join('\n').trim(), tables, malformed, malformedSample }
}

/** 못 읽은 줄을 몇 개까지 들고 올지. 원인을 짚는 데는 한둘이면 충분하다 */
const MALFORMED_SAMPLE_MAX = 3
/** 한 줄에서 남길 글자 수 — 화면 한 줄에 들어가고 값이 통째로 새지 않을 만큼 */
const MALFORMED_SAMPLE_CHARS = 120

/** 구분자로 흔히 쓰이는 글자들 — 설정이 틀렸을 때 무엇이 맞는지 짚어 준다 */
const SEPARATOR_CANDIDATES: readonly { value: string; label: string }[] = [
  { value: '|', label: '|' },
  { value: ',', label: ',' },
  { value: '\t', label: '탭' },
  { value: ';', label: ';' },
]

/**
 * 왜 못 읽었는지 짚어 본다.
 *
 * 구분자가 틀린 것과 앞머리 태그가 다른 것은 화면에서 **똑같이 보인다** — 둘 다
 * "테이블 0개 · 못 읽은 줄 N" 이다. 그런데 고칠 곳은 서로 다르다. 실패했을 때
 * 어디를 봐야 하는지까지 말해 주지 않으면 사람이 설정을 하나씩 바꿔 가며 찍어야 한다.
 *
 * @returns 안내 문장. 짚을 수 없으면 빈 문자열
 */
export function diagnoseMalformed(
  sample: readonly string[],
  config: SchemaConfig
): string {
  const lines = sample.filter((l) => l.trim())
  if (lines.length === 0) return ''

  const separator = config.separator || ','

  // 1) 설정한 구분자가 아예 안 보이는데 다른 후보가 보이면 그게 원인이다
  if (!lines.some((l) => l.includes(separator))) {
    const found = SEPARATOR_CANDIDATES.find(
      (c) => c.value !== separator && lines.every((l) => l.includes(c.value))
    )
    if (found) {
      return (
        `구분자가 안 맞습니다 — 설정은 '${separator}' 인데 파일은 '${found.label}' 로 갈라져 있습니다.\n` +
        "change/config.ts 의 SCHEMA.separator 를 고치고 개발 서버를 다시 시작하세요."
      )
    }
  }

  // 2) 앞머리는 있는데 아는 종류가 아니다
  const tag = /^\s*\[([^\]]{1,40})\]/.exec(lines[0])?.[1]
  if (tag && !KIND_BY_TAG[tag.trim().toUpperCase()]) {
    return (
      `앞머리 '[${tag}]' 를 모릅니다 — 이 도구는 [COLUMN] · [CONSTRAINT] · [INDEX] 만 읽습니다.\n` +
      '덤프의 종류 이름이 다르면 알려 주세요.'
    )
  }

  // 3) 앞머리 자체가 없다
  if (!lines[0].trimStart().startsWith('[')) {
    return (
      "줄 앞머리에 [COLUMN] 같은 종류 표시가 없습니다.\n" +
      '이 도구는 줄마다 종류가 적혀 있어야 읽을 수 있습니다.'
    )
  }

  return ''
}

/** `[COLUMN]` → `COLUMN`. 대괄호가 없으면 원문을 대문자로 */
function stripTag(cell: string | undefined): string {
  const text = (cell ?? '').trim().toUpperCase()
  return text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1).trim() : text
}

/** 헤더 칸 하나를 역할 이름으로. 모르는 컬럼은 빈 이름이라 자리만 차지한다 */
function toRole(cell: string): string {
  return ROLE_BY_DICTIONARY[unwrapFieldName(cell)] ?? ''
}

/** 흩어진 줄들을 위치 순으로 이어 하나로 (**함정 3**) */
function joinColumns(group: Grouped): string[] {
  return [...group.parts].sort((a, b) => a.position - b.position).map((p) => p.column)
}

function toConstraint(group: Grouped, systemName: (name: string) => boolean): SchemaConstraint {
  return {
    name: group.name,
    kind: toConstraintKind(group.extra),
    rawKind: group.extra.trim(),
    columns: joinColumns(group),
    systemNamed: systemName(group.name),
  }
}

function toIndex(group: Grouped, systemName: (name: string) => boolean): SchemaIndex {
  return {
    name: group.name,
    // 딕셔너리는 `UNIQUE` / `NONUNIQUE` 로 적는다
    unique: group.extra.trim().toUpperCase() === 'UNIQUE',
    columns: joinColumns(group),
    systemNamed: systemName(group.name),
  }
}

/**
 * 시스템이 붙인 이름인지 가리는 판정을 만든다 (**함정 2**).
 *
 * 설정을 잘못 적어 정규식이 깨져도 비교가 죽어서는 안 된다 — 그때는 아무것도 접지 않고
 * 전부 보여준다. 접힌 줄 알았던 것이 보이는 쪽이, 봐야 할 것이 사라지는 쪽보다 낫다.
 */
function toSystemNameTest(pattern: string): (name: string) => boolean {
  const source = (pattern ?? '').trim()
  if (!source) return () => false
  try {
    const re = new RegExp(source, 'i')
    return (name) => re.test(name)
  } catch {
    return () => false
  }
}
