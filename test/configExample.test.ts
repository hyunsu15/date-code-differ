import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_ENV_ID,
  DEFAULT_PRESET_ID,
  ENV_FOLDERS,
  SCAN,
  SOURCE_PRESETS,
} from '../change/config.example.ts'
import { missingFields } from '../src/features/settings/sourceSettings.ts'
import { readRepositoryConfig } from '../server/snapshotRepository.ts'

/**
 * `change/config.ts` 는 커밋되지 않는다(.gitignore).
 * 새로 받은 사람은 `config.example.ts` 를 복사해 쓰므로,
 * **이 템플릿이 그대로 돌아가는 상태**여야 한다.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('템플릿에는 폴더 프리셋과 SSH 프리셋이 하나씩 있다', () => {
  const modes = SOURCE_PRESETS.map((p) => p.source.mode)
  assert.ok(modes.includes('local'), '폴더 프리셋')
  assert.ok(modes.includes('ssh'), 'SSH 프리셋')
})

test('템플릿의 기본 프리셋 id 는 실제로 있는 항목을 가리킨다', () => {
  assert.ok(
    SOURCE_PRESETS.some((p) => p.id === DEFAULT_PRESET_ID),
    `DEFAULT_PRESET_ID('${DEFAULT_PRESET_ID}') 에 해당하는 프리셋이 없다`
  )
})

test('템플릿 프리셋 id 는 겹치지 않는다', () => {
  const ids = SOURCE_PRESETS.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('템플릿 프리셋은 필수 항목이 다 채워져 있다 — 복사하자마자 "적용" 이 눌려야 한다', () => {
  for (const preset of SOURCE_PRESETS) {
    assert.deepEqual(missingFields(preset.source), [], preset.id)
    assert.ok(preset.label, `${preset.id}: label`)
  }
})

test('템플릿의 폴더 프리셋은 함께 들어있는 예시 폴더를 가리킨다', async () => {
  // 아무것도 안 고쳐도 바로 동작해야 한다
  const local = SOURCE_PRESETS.find((p) => p.source.mode === 'local')
  assert.ok(local)

  const resolved = path.resolve(projectRoot, local.source.root)
  const stat = await fs.stat(resolved)
  assert.ok(stat.isDirectory(), `${resolved} 가 실제로 있어야 한다`)
})

test('템플릿에는 운영·테스트 환경이 들어 있다', () => {
  assert.deepEqual(
    ENV_FOLDERS.map((e) => e.id),
    ['prod', 'test']
  )
})

test('템플릿 환경 항목은 id·label·path 가 모두 채워져야 한다', () => {
  const ids = ENV_FOLDERS.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length, 'id 가 겹치면 선택이 어긋난다')
  for (const item of ENV_FOLDERS) {
    assert.ok(item.label, `${item.id}: label`)
    assert.ok(item.path.trim(), `${item.id}: path`)
  }
})

test('템플릿의 환경 폴더는 예시 폴더에 실제로 있다 — 아무것도 안 고쳐도 열려야 한다', async () => {
  const local = SOURCE_PRESETS.find((p) => p.source.mode === 'local')
  assert.ok(local)

  for (const env of ENV_FOLDERS) {
    const resolved = path.resolve(projectRoot, local.source.root, env.path)
    const stat = await fs.stat(resolved)
    assert.ok(stat.isDirectory(), `${resolved} 가 실제로 있어야 한다`)
  }
})

test('템플릿의 기본 환경은 목록에 있는 항목이다 — 첫 화면이 빈 폴더를 보지 않는다', () => {
  assert.ok(
    ENV_FOLDERS.some((e) => e.id === DEFAULT_ENV_ID),
    `DEFAULT_ENV_ID('${DEFAULT_ENV_ID}') 에 해당하는 환경이 없다`
  )
})

test('템플릿의 훑기 설정은 Pro*C 를 포함한다', () => {
  const cfg = readRepositoryConfig(SCAN)
  assert.ok(cfg.extensions.has('pc'), 'pc')
  assert.ok(cfg.maxFileBytes > 0)
})

test('config.example.ts 는 저장소에 남아 있어야 한다 (gitignore 대상이 아님)', async () => {
  const gitignore = await fs.readFile(path.join(projectRoot, '.gitignore'), 'utf8')
  assert.ok(gitignore.includes('change/config.ts'), 'config.ts 는 무시 대상')
  assert.ok(!/^change\/config\.example\.ts$/m.test(gitignore), 'example 은 무시하면 안 된다')
})
