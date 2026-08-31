import { build } from 'esbuild'
import { rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 독립 실행 서버(`server/main.ts`)를 **단일 파일**로 묶는다.
 *
 * 왜 번들인가 — 배포 산출물을 하나로 줄이기 위해서다. 소스를 그대로 옮기면
 * `server/`, `src/lib/`, `src/types.ts`, `change/config.ts`, `node_modules/diff`,
 * `package.json` 을 빠짐없이 복사해야 하고, 그 목록을 계속 관리해야 한다.
 * 번들은 이걸 전부 삼켜 `backend_next/main.mjs` 하나가 된다 —
 * 복사도 하나, blue-green 스왑(update.sh)도 하나.
 *
 * 유일한 런타임 npm 의존은 `diff` 하나뿐이라(프리즘은 화면 전용) 통째로 인라인된다.
 * `node:*` 내장 모듈은 esbuild 가 알아서 밖에 둔다.
 *
 * `.mjs` 로 내는 이유: 옆에 `package.json` 이 없어도 Node 가 ESM 으로 읽는다.
 *
 * ⚠ `change/config.ts` 가 번들에 **박힌다.** 서버 주소·훑기 설정을 바꾸면
 * 다시 빌드해야 한다 (화면 번들도 프리셋을 갖고 있으므로 어차피 함께 빌드된다).
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const outDir = path.join(root, 'backend_next')
const outFile = path.join(outDir, 'main.mjs')

// 앞선 빌드가 남긴 것을 지운다 — update.sh 가 이 폴더를 통째로 옮기므로 섞이면 안 된다
await rm(outDir, { recursive: true, force: true })

await build({
  entryPoints: [path.join(root, 'server', 'main.ts')],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  // 운영 서버의 Node 가 최신이 아닐 수 있다. import.meta.dirname 이 들어온 20.11 을 밑줄로 본다
  target: 'node20',
  // 사내 도구라 크기보다 읽히는 스택 트레이스가 낫다
  minify: false,
  sourcemap: true,
  logLevel: 'info',
})

const { size } = await stat(outFile)
console.log(
  `[code-diff] ${path.relative(root, outFile)}  ${(size / 1024).toFixed(0)} KB\n` +
    `           실행: node ${path.relative(root, outFile)}   (화면은 ../dist 에서 찾는다)`
)
