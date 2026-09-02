import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultSelection,
  describeSource,
  missingFields,
  parseSourceSelection,
  presetById,
  SOURCE_PRESETS,
  sourceParams,
  comparisonParams,
} from '../src/features/settings/sourceSettings.ts'
import { DEFAULT_PRESET_ID } from '../change/config.ts'
import { DEFAULT_SSH_SOURCE, type SourceConfig } from '../src/types.ts'

/**
 * 위치 설정은 두 곳에서 온다.
 *  1. `change/config.ts` 의 프리셋 — 파일이 진실
 *  2. 화면에서 직접 고친 값 — localStorage
 *
 * 저장값은 사용자가 직접 고칠 수 있으므로 믿지 않고 한 겹 검증한다.
 */

const LOCAL: SourceConfig = {
  mode: 'local',
  root: 'D:/rel',
  encoding: 'auto',
  excludeFile: '',
  schemaRoot: '',
  schemaExcludeFile: '',
}

/* ---------------- 프리셋 ---------------- */

test('프리셋은 change/config.ts 에서 온다 — 최소 하나는 있어야 한다', () => {
  assert.ok(SOURCE_PRESETS.length > 0)
  for (const preset of SOURCE_PRESETS) {
    assert.ok(preset.id, 'id 는 필수')
    assert.ok(preset.label, 'label 은 필수')
    assert.ok(['local', 'ssh'].includes(preset.source.mode), preset.id)
  }
})

test('프리셋 id 는 서로 겹치지 않는다 (겹치면 선택이 어긋난다)', () => {
  const ids = SOURCE_PRESETS.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('기본 골격은 폴더 하나 + SSH 하나', () => {
  const modes = SOURCE_PRESETS.map((p) => p.source.mode)
  assert.ok(modes.includes('local'), '폴더 프리셋')
  assert.ok(modes.includes('ssh'), 'SSH 프리셋')
})

test('id 로 프리셋을 찾는다', () => {
  const first = SOURCE_PRESETS[0]
  assert.equal(presetById(first.id)?.label, first.label)
  assert.equal(presetById('없는id'), undefined)
  assert.equal(presetById(null), undefined)
})

/* ---------------- 저장값 읽기 ---------------- */

test('저장된 게 없으면 DEFAULT_PRESET_ID 프리셋을 쓴다', () => {
  const expected = defaultSelection()
  assert.deepEqual(parseSourceSelection(null), expected)
  assert.deepEqual(parseSourceSelection(''), expected)
  assert.equal(expected.presetId, DEFAULT_PRESET_ID)
})

test('DEFAULT_PRESET_ID 는 실제로 있는 프리셋을 가리켜야 한다', () => {
  // 없는 id 를 적으면 조용히 첫 항목으로 떨어져 의도와 다른 곳을 보게 된다
  assert.ok(presetById(DEFAULT_PRESET_ID), `${DEFAULT_PRESET_ID} 프리셋이 없다`)
})

test('기본 프리셋은 SSH 다', () => {
  assert.equal(defaultSelection().source.mode, 'ssh')
})

test('깨진 JSON 은 기본 선택으로 떨어진다', () => {
  for (const raw of ['{', 'null', '[]', '"text"', '123', '{"presetId":']) {
    assert.deepEqual(parseSourceSelection(raw), defaultSelection(), raw)
  }
})

test('프리셋을 고른 상태면 저장값이 아니라 프리셋의 현재 값을 쓴다', () => {
  // change/config.ts 를 고치면 바로 반영돼야 하므로, 저장된 사본을 믿지 않는다
  const preset = SOURCE_PRESETS[0]
  const stale = JSON.stringify({
    presetId: preset.id,
    source: { mode: 'local', root: '옛날에-저장된-경로', encoding: 'utf-8' },
  })

  const loaded = parseSourceSelection(stale)
  assert.equal(loaded.presetId, preset.id)
  assert.deepEqual(loaded.source, preset.source)
})

test('없어진 프리셋을 가리키면 저장된 값을 그대로 쓴다', () => {
  const raw = JSON.stringify({ presetId: '삭제된프리셋', source: LOCAL })
  assert.deepEqual(parseSourceSelection(raw), { presetId: null, source: LOCAL })
})

test('직접 입력은 저장된 값을 그대로 쓴다', () => {
  const raw = JSON.stringify({ presetId: null, source: LOCAL })
  assert.deepEqual(parseSourceSelection(raw), { presetId: null, source: LOCAL })
})

test('타입이 어긋난 값은 빈 문자열·null 로 바로잡는다', () => {
  const raw = JSON.stringify({
    presetId: null,
    source: { mode: 'ssh', host: 123, user: null, root: {}, port: 'abc' },
  })
  assert.deepEqual(parseSourceSelection(raw).source, {
    mode: 'ssh',
    host: '',
    port: null,
    user: '',
    identityFile: '',
    root: '',
    encoding: 'auto',
    excludeFile: '',
    schemaRoot: '',
    schemaExcludeFile: '',
  })
})

test('모르는 mode 는 로컬로 본다', () => {
  const raw = JSON.stringify({ presetId: null, source: { mode: 'ftp', root: '/x' } })
  assert.deepEqual(parseSourceSelection(raw).source, {
    mode: 'local',
    root: '/x',
    encoding: 'auto',
    excludeFile: '',
    schemaRoot: '',
    schemaExcludeFile: '',
  })
})

test('비밀번호 같은 여분 필드는 읽어들이지 않는다', () => {
  // 인증은 ssh 몫이다 — 저장돼 있더라도 설정으로 올라오면 안 된다
  const raw = JSON.stringify({
    presetId: null,
    source: { mode: 'ssh', host: 'h', user: 'u', root: '/r', password: 'secret' },
  })
  const { source } = parseSourceSelection(raw)
  assert.equal(JSON.stringify(source).includes('secret'), false)
  assert.equal('password' in (source as unknown as Record<string, unknown>), false)
})

/* ---------------- 인코딩 ---------------- */

test('저장된 인코딩을 읽는다', () => {
  for (const enc of ['utf-8', 'euc-kr', 'auto']) {
    const raw = JSON.stringify({ presetId: null, source: { mode: 'local', root: '/x', encoding: enc } })
    assert.equal(parseSourceSelection(raw).source.encoding, enc, enc)
  }
})

test('모르는 인코딩 값은 자동으로 되돌린다', () => {
  for (const enc of ['cp949', 'shift_jis', '', 123, null]) {
    const raw = JSON.stringify({ presetId: null, source: { mode: 'local', root: '/x', encoding: enc } })
    assert.equal(parseSourceSelection(raw).source.encoding, 'auto', JSON.stringify(enc))
  }
})

/* ---------------- API 파라미터 ---------------- */

test('로컬은 mode 와 경로를 보낸다', () => {
  assert.deepEqual(sourceParams({ mode: 'local', root: ' D:/rel ', encoding: 'auto' }), {
    mode: 'local',
    root: 'D:/rel',
  })
})

test('SSH 는 채워진 값만 보낸다', () => {
  const base = { ...DEFAULT_SSH_SOURCE, host: 'h', user: 'u', root: '/r' }
  assert.deepEqual(sourceParams(base), { mode: 'ssh', host: 'h', user: 'u', root: '/r' })

  assert.deepEqual(sourceParams({ ...base, port: 2222, identityFile: '/k' }), {
    mode: 'ssh',
    host: 'h',
    user: 'u',
    root: '/r',
    port: '2222',
    identityFile: '/k',
  })
})

test('기본값(자동 인코딩)은 파라미터로 보내지 않는다', () => {
  assert.equal('encoding' in sourceParams({ mode: 'local', root: '/r', encoding: 'auto' }), false)
})

test('인코딩을 고정하면 모드와 무관하게 함께 보낸다', () => {
  assert.equal(sourceParams({ mode: 'local', root: '/r', encoding: 'euc-kr' }).encoding, 'euc-kr')
  assert.equal(
    sourceParams({ ...DEFAULT_SSH_SOURCE, host: 'h', user: 'u', root: '/r', encoding: 'euc-kr' })
      .encoding,
    'euc-kr'
  )
})

test('보내는 파라미터에 비밀번호 항목이 없다', () => {
  const params = sourceParams({ ...DEFAULT_SSH_SOURCE, host: 'h', user: 'u', root: '/r' })
  for (const key of Object.keys(params)) {
    assert.ok(!/pass|secret|pw/i.test(key), key)
  }
})

/* ---------------- 표시 / 검증 ---------------- */

test('위치를 한 줄로 요약한다', () => {
  assert.equal(describeSource({ mode: 'local', root: 'D:/rel', encoding: 'auto' }), 'D:/rel')
  assert.equal(describeSource({ mode: 'local', root: '', encoding: 'auto' }), '(폴더 미지정)')
  assert.equal(
    describeSource({ ...DEFAULT_SSH_SOURCE, host: 'h', user: 'u', root: '/r', port: 22 }),
    'u@h:22 /r'
  )
  assert.equal(describeSource(DEFAULT_SSH_SOURCE), 'SSH (설정 필요)')
})

test('비어 있는 필수 항목을 한글 이름으로 알려준다', () => {
  assert.deepEqual(missingFields(DEFAULT_SSH_SOURCE), ['호스트', '계정', '원격 경로'])
  assert.deepEqual(missingFields({ ...DEFAULT_SSH_SOURCE, host: 'h', user: 'u' }), ['원격 경로'])
  assert.deepEqual(missingFields({ ...DEFAULT_SSH_SOURCE, host: 'h', user: 'u', root: '/r' }), [])

  assert.deepEqual(missingFields({ mode: 'local', root: '', encoding: 'auto' }), ['폴더 경로'])
  assert.deepEqual(missingFields(LOCAL), [])
})

test('개인키는 선택 항목이다 (없어도 ssh 기본 키로 시도한다)', () => {
  assert.deepEqual(
    missingFields({ ...DEFAULT_SSH_SOURCE, host: 'h', user: 'u', root: '/r', identityFile: '' }),
    []
  )
})

test('기본으로 들어있는 프리셋은 그대로 쓸 수 있는 상태다', () => {
  // SSH 프리셋은 예시 값이라도 필수 항목이 채워져 있어야 "적용" 이 눌린다
  for (const preset of SOURCE_PRESETS) {
    assert.deepEqual(missingFields(preset.source), [], preset.id)
  }
})

/* ---------------- 제외 목록 파일 ---------------- */

test('제외 목록을 쓰지 않으면 파라미터에 넣지 않는다 — URL 이 예전과 같아야 한다', () => {
  assert.deepEqual(sourceParams({ mode: 'local', root: 'D:/rel', encoding: 'auto' }), {
    mode: 'local',
    root: 'D:/rel',
  })
  assert.deepEqual(
    sourceParams({ mode: 'local', root: 'D:/rel', encoding: 'auto', excludeFile: '   ' }),
    { mode: 'local', root: 'D:/rel' }
  )
})

test('제외 목록 경로는 앞뒤 공백을 털어 보낸다', () => {
  assert.deepEqual(
    sourceParams({ mode: 'local', root: 'D:/rel', encoding: 'auto', excludeFile: ' x.txt ' }),
    { mode: 'local', root: 'D:/rel', excludeFile: 'x.txt' }
  )
  assert.equal(
    sourceParams({ ...DEFAULT_SSH_SOURCE, host: 'h', user: 'u', root: '/r', excludeFile: '~/e.txt' })
      .excludeFile,
    '~/e.txt'
  )
})

test('저장된 제외 목록 경로를 되살린다', () => {
  const raw = JSON.stringify({
    presetId: null,
    source: { mode: 'local', root: '/x', excludeFile: 'e.txt' },
  })
  assert.equal(parseSourceSelection(raw).source.excludeFile, 'e.txt')
})

test('제외 목록 경로가 문자열이 아니면 빈 값으로 본다', () => {
  for (const bad of [123, null, {}, ['a']]) {
    const raw = JSON.stringify({
      presetId: null,
      source: { mode: 'local', root: '/x', excludeFile: bad },
    })
    assert.equal(parseSourceSelection(raw).source.excludeFile, '', JSON.stringify(bad))
  }
})

test('좌우 위치가 갈려도 제외 목록은 하나다', () => {
  const left: SourceConfig = { mode: 'local', root: '/rel/prod', encoding: 'auto', excludeFile: 'e.txt' }
  const right: SourceConfig = { ...left, root: '/rel/test' }
  const params = comparisonParams(left, right)

  assert.equal(params.root, '/rel/prod')
  assert.equal(params.rightRoot, '/rel/test')
  assert.equal(params.excludeFile, 'e.txt', '환경이 갈려도 규칙 파일은 한 곳을 본다')
})
