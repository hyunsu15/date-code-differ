import { copyFile, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `change/config.ts` 가 없으면 `change/config.example.ts` 를 복사해 만든다.
 *
 * `config.ts` 는 서버 주소·계정이 들어가므로 커밋하지 않는다(.gitignore).
 * 그런데 코드가 이 파일을 직접 import 하므로, 없으면 개발 서버가 아예 뜨지 않는다.
 * 새로 받은 사람이 아무것도 안 해도 돌아가도록 여기서 채워 넣는다.
 *
 * `npm install`(postinstall) 과 dev·build·test 시작 전에 자동으로 돈다.
 * **이미 있으면 절대 덮어쓰지 않는다** — 사용자가 넣은 값이 날아가면 안 된다.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const changeDir = path.resolve(here, '..', 'change')

const target = path.join(changeDir, 'config.ts')
const template = path.join(changeDir, 'config.example.ts')

const exists = async (file) => {
  try {
    await access(file, constants.F_OK)
    return true
  } catch {
    return false
  }
}

if (await exists(target)) {
  // 이미 있으면 손대지 않는다 (조용히 끝낸다 — 매번 로그를 남길 이유가 없다)
  process.exit(0)
}

if (!(await exists(template))) {
  console.error(
    `[code-diff] ${path.relative(process.cwd(), template)} 가 없습니다.\n` +
      '           저장소가 온전한지 확인하세요.'
  )
  process.exit(1)
}

// copyFile 의 COPYFILE_EXCL — 그 사이 누가 만들었으면 덮어쓰지 않고 실패한다
try {
  await copyFile(template, target, constants.COPYFILE_EXCL)
  console.log(
    '[code-diff] change/config.ts 를 만들었습니다 (config.example.ts 복사).\n' +
      '           비교할 폴더·SSH 서버 정보를 이 파일에서 고치세요.'
  )
} catch (e) {
  if (e.code === 'EEXIST') process.exit(0)
  throw e
}
