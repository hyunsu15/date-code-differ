import { copyFile, access, readFile } from 'node:fs/promises'
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

/**
 * 나중에 생긴 설정 항목들.
 * 이미 있는 `config.ts` 는 **고치지 않고**, 빠진 항목만 알려 준다 —
 * 사용자가 넣은 값을 스크립트가 건드리는 것보다 안내가 낫다.
 */
const LATER_ADDITIONS = [
  {
    name: 'ENV_FOLDERS',
    hint: '환경 폴더(운영/테스트/개발) 고르기가 화면에 나오지 않습니다.',
  },
]

if (await exists(target)) {
  // 이미 있으면 손대지 않는다 (조용히 끝낸다 — 매번 로그를 남길 이유가 없다)
  const current = await readFile(target, 'utf8')
  for (const { name, hint } of LATER_ADDITIONS) {
    if (current.includes(name)) continue
    console.log(
      `[code-diff] change/config.ts 에 ${name} 가 없습니다 — ${hint}\n` +
        `           change/config.example.ts 의 해당 블록을 복사해 넣으면 켜집니다.`
    )
  }
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
