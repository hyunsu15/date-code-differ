import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { clearSchemaCache, listSchemaChanges, readSchemaConfig } from '../server/schemaService.ts'
import { createSource, sourceKey } from '../server/source/resolve.ts'
import type { SourceConfig } from '../src/types.ts'

/**
 * 스키마 덤프 날짜마다 바로 앞 덤프 대비 **테이블** 변경 수 — 스키마 탭 날짜 목록의 "테이블 N개 바뀜".
 * 실제 덤프 파일을 써서 서버가 읽고 파싱·대조하는 그대로 확인한다.
 */

const HEADERS = [
  '[COLUMN],TABLE_NAME,COLUMN_NAME,DATA_TYPE,DATA_LENGTH,DATA_PRECISION,DATA_SCALE,NULLABLE',
  '[CONSTRAINT],TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE,COLUMN_NAME,TO_CHAR(POSITION)',
  '[INDEX],TABLE_NAME,INDEX_NAME,UNIQUNESS,COLUMN_NAME,TO_CHAR(COLUMN_POSITION)',
].join('\n')

const cfg = readSchemaConfig(undefined) // 파일 이름 규칙: snapshot_{env}_{date}.txt
let root = ''

async function dump(date: string, ...lines: string[]): Promise<void> {
  const dir = path.join(root, 'prod')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, `snapshot_prod_${date}.txt`), `${HEADERS}\n${lines.join('\n')}\n`, 'utf8')
}

const place = () => {
  const config: SourceConfig = { mode: 'local', root, encoding: 'auto', schemaRoot: root }
  return {
    source: createSource(config, process.cwd()),
    key: sourceKey(config, process.cwd()),
    root,
    env: 'prod',
  }
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'code-diff-schema-changes-'))
  // 08-01: 처음 — 테이블 2개
  await dump('2026-08-01', '[COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N', '[COLUMN],TB_PAY,PAY_NO,VARCHAR2,20,,,N')
  // 08-15: 덤프는 떴지만 바뀐 것 없음 — 시스템 이름 제약 번호만 다르다(접혀서 세지 않아야 한다)
  await dump(
    '2026-08-15',
    '[COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N',
    '[COLUMN],TB_PAY,PAY_NO,VARCHAR2,20,,,N',
    '[CONSTRAINT],TB_ORD,SYS_C0099,C,ORD_NO,1'
  )
  // 09-01: TB_ORD 컬럼 변경 · TB_PAY 삭제 · TB_RPT 추가
  await dump('2026-09-01', '[COLUMN],TB_ORD,ORD_NO,VARCHAR2,30,,,N', '[COLUMN],TB_RPT,RPT_NO,CHAR,8,,,N')
})

after(async () => {
  clearSchemaCache()
  await fs.rm(root, { recursive: true, force: true })
})

test('덤프마다 바로 앞 덤프 대비 테이블 수 — 시스템 이름 제약만 다른 덤프는 0', async () => {
  clearSchemaCache()
  assert.deepEqual(await listSchemaChanges(place(), cfg), [
    { id: '2026-09-01', base: '2026-08-15', added: 1, removed: 1, modified: 1 },
    { id: '2026-08-15', base: '2026-08-01', added: 0, removed: 0, modified: 0 },
    { id: '2026-08-01', base: null, added: 2, removed: 0, modified: 0 },
  ])
})

test('덤프가 없는 환경은 빈 목록 — 화면이 죽지 않는다', async () => {
  assert.deepEqual(await listSchemaChanges({ ...place(), env: 'test' }, cfg), [])
})
