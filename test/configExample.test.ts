import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PRESET_ID, SCAN, SOURCE_PRESETS } from '../change/config.example.ts'
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
