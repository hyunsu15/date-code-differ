#!/usr/bin/env node
/**
 * `docs/사용설명서.md` 의 스크린샷을 다시 만든다.
 *
 *   npm run dev      (다른 창에서 개발 서버를 먼저 띄운다)
 *   npm run shots
 *
 * 화면이 바뀌면 설명서 그림도 같이 낡는다. 손으로 캡처해 두면 아무도 다시 안 찍으므로
 * 한 명령으로 전부 다시 뽑을 수 있게 해 둔다.
 *
 * 실제 화면을 크로미움 계열 브라우저로 열어 찍는다. 박스·번호는 `scripts/shot.html`
 * 이 앱과 같은 출처에서 실제 요소 좌표를 읽어 그려 준다 — 그림 편집기가 필요 없다.
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(projectRoot, 'docs', 'images')

const PORT = 5181
const SIZE = { width: 1280, height: 800 }

/** 찍을 화면들. 이름이 곧 파일명이고, scene 은 shot.html 이 아는 값이다 */
const SHOTS = [
  ['01-overview', 'overview'],
  ['02-settings', 'settings'],
  ['03-picker', 'picker'],
  ['04-crossenv', 'crossenv'],
  ['05-files', 'files'],
  ['06-diff', 'diff'],
  ['07-exclude', 'exclude'],
  ['08-schema', 'schema'],
  ['09-report', 'report'],
  ['10-dates', 'dates'],
  ['11-viewoptions', 'viewoptions'],
  ['12-undo', 'undo'],
  ['13-help', 'help'],
  ['14-allsame', 'allsame'],
  ['15-lastweek', 'lastweek'],
]

/**
 * 설치돼 있는 크로미움 계열 브라우저를 찾는다.
 * 별도 패키지를 받지 않으려고 이미 깔린 것을 쓴다 (Playwright 는 브라우저만 수백 MB다).
 */
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

async function findBrowser() {
  for (const candidate of CANDIDATES) {
    if (!candidate) continue
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // 다음 후보
    }
  }
  return null
}

const run = (bin, args) =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 90_000 }, (error) => (error ? reject(error) : resolve()))
  })

async function main() {
  const browser = await findBrowser()
  if (!browser) {
    console.error(
      '크로미움 계열 브라우저를 찾지 못했습니다.\n' +
        'Chrome 이나 Edge 를 설치하거나, CHROME_PATH 환경변수로 경로를 알려주세요.'
    )
    process.exit(1)
  }

  // 개발 서버가 떠 있어야 한다. 안 떠 있으면 빈 화면만 찍히므로 먼저 확인한다.
  try {
    const res = await fetch(`http://localhost:${PORT}/`)
    if (!res.ok) throw new Error(String(res.status))
  } catch {
    console.error(`http://localhost:${PORT} 에 개발 서버가 없습니다. 다른 창에서 npm run dev 를 먼저 실행하세요.`)
    process.exit(1)
  }

  await fs.mkdir(outDir, { recursive: true })
  // 사용자의 실제 브라우저 프로필을 건드리지 않도록 캡처 전용 프로필을 쓴다
  const profile = path.join(projectRoot, 'node_modules', '.cache', 'shot-profile')
  await fs.mkdir(profile, { recursive: true })

  for (const [name, scene] of SHOTS) {
    const out = path.join(outDir, `${name}.png`)
    await run(browser, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      `--user-data-dir=${profile}`,
      `--window-size=${SIZE.width},${SIZE.height}`,
      // 화면이 다 그려질 때까지 기다린다 (비교 결과가 와야 코드가 보인다)
      '--virtual-time-budget=20000',
      `--screenshot=${out}`,
      `http://localhost:${PORT}/scripts/shot.html?scene=${scene}`,
    ])
    const { size } = await fs.stat(out)
    console.log(`docs/images/${name}.png  ${Math.round(size / 1024)} KB`)
  }
}

await main()
