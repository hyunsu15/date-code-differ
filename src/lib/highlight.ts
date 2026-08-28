import Prism from 'prismjs'
// 로드 순서 주의: clike → java/csharp, javascript → typescript/jsx → tsx
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-csharp'
import 'prismjs/components/prism-c'
import 'prismjs/components/prism-cpp'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-kotlin'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-properties'
import 'prismjs/components/prism-markdown'
import type { CharRange, LineSegments, MergedSegment, Segment } from '../types.ts'

/* ------------------------------------------------------------------ */
/* Pro*C (.pc) — C 문법 + `EXEC SQL ... ;` 임베디드 SQL                  */
/* ------------------------------------------------------------------ */

// 'string' 앞에 끼워 넣는다. comment 가 먼저 매칭되므로
// 주석 안의 EXEC SQL 은 SQL 로 잘못 칠해지지 않는다.
Prism.languages.proc = Prism.languages.extend('c', {})
Prism.languages.insertBefore('proc', 'string', {
  'exec-sql': {
    pattern: /\bEXEC\s+SQL\b[\s\S]*?;/,
    greedy: true,
    inside: {
      'exec-directive': { pattern: /^EXEC\s+SQL/, alias: 'keyword' },
      // 호스트 변수 — `:h_ord_no`, `:*balance`
      'host-variable': { pattern: /:\s*\*?[A-Za-z_]\w*/, alias: 'symbol' },
      rest: Prism.languages.sql,
    },
  },
})

const EXT_LANG: Record<string, string> = {
  // Pro*C — 이 도구의 주 비교 대상
  pc: 'proc', pco: 'proc', pch: 'c',
  // Oracle 패키지 명세/본문
  pks: 'sql', pkb: 'sql',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  java: 'java', kt: 'kotlin', kts: 'kotlin',
  cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  go: 'go', py: 'python',
  sql: 'sql', json: 'json',
  yml: 'yaml', yaml: 'yaml',
  sh: 'bash', bash: 'bash',
  html: 'markup', htm: 'markup', xml: 'markup', vue: 'markup', svg: 'markup',
  css: 'css', scss: 'css', less: 'css',
  md: 'markdown', properties: 'properties',
}

export function detectLanguage(filename = ''): string | null {
  const ext = filename.split('.').pop()?.toLowerCase()
  return (ext && EXT_LANG[ext]) || null
}

/* ------------------------------------------------------------------ */

type PrismNode = string | Prism.Token

function flatten(nodes: PrismNode[], parentType: string | null, out: Segment[]): void {
  for (const node of nodes) {
    if (typeof node === 'string') {
      if (node) out.push({ text: node, type: parentType })
      continue
    }
    const alias = Array.isArray(node.alias) ? node.alias.join(' ') : node.alias
    const type = alias ? `${node.type} ${alias}` : node.type
    if (typeof node.content === 'string') {
      if (node.content) out.push({ text: node.content, type })
    } else {
      const children = Array.isArray(node.content) ? node.content : [node.content]
      flatten(children as PrismNode[], type, out)
    }
  }
}

const cache = new Map<string, LineSegments>()
const CACHE_MAX = 40

/**
 * 파일 전체를 한 번에 토크나이즈해서 라인별 세그먼트 배열로 돌려준다.
 * (라인 단위로 쪼개서 토크나이즈하면 여러 줄 주석/문자열이 깨진다)
 * 하이라이트할 수 없으면 null.
 */
export function highlightByLine(
  text: string,
  lang: string | null,
  cacheKey: string
): LineSegments | null {
  if (!lang || !Prism.languages[lang]) return null
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  if (normalized.length > 400_000) return null // 초대형 파일은 하이라이트 생략

  const key = `${cacheKey}::${lang}::${normalized.length}`
  const hit = cache.get(key)
  if (hit) return hit

  const flatSegs: Segment[] = []
  try {
    const tokens = Prism.tokenize(normalized, Prism.languages[lang])
    flatten(tokens as PrismNode[], null, flatSegs)
  } catch {
    return null
  }

  const lines: LineSegments = [[]]
  for (const seg of flatSegs) {
    const pieces = seg.text.split('\n')
    for (let i = 0; i < pieces.length; i++) {
      if (i > 0) lines.push([])
      if (pieces[i]) lines[lines.length - 1].push({ text: pieces[i], type: seg.type })
    }
  }

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, lines)
  return lines
}

const covers = (ranges: CharRange[] | null | undefined, from: number, to: number): boolean =>
  !!ranges && ranges.some(([s, e]) => from >= s && to <= e)

/**
 * 세 겹을 하나로 합친다 — 문법 하이라이트 / 단어단위 변경 구간 / 검색 결과.
 * @param text    원본 라인
 * @param segs    해당 라인의 문법 세그먼트 (없으면 null)
 * @param ranges  변경 구간 (없으면 null)
 * @param matches 검색어 일치 구간 (없으면 null)
 * @param active  그중 현재 선택된 구간 (없으면 null)
 */
export function mergeSegments(
  text: string,
  segs: Segment[] | null | undefined,
  ranges: CharRange[] | null | undefined,
  matches?: CharRange[] | null,
  active?: CharRange | null
): MergedSegment[] {
  if (!text) return []
  const hasRanges = !!(ranges && ranges.length)
  const hasMatches = !!(matches && matches.length)
  if (!segs && !hasRanges && !hasMatches) {
    return [{ text, type: null, changed: false, match: false, active: false }]
  }

  // 경계점 수집
  const bounds = new Set<number>([0, text.length])
  const addBound = (n: number): void => {
    if (n > 0 && n < text.length) bounds.add(n)
  }
  let pos = 0
  if (segs) {
    for (const s of segs) {
      pos += s.text.length
      addBound(pos)
    }
  }
  for (const list of [ranges, matches]) {
    if (!list) continue
    for (const [s, e] of list) {
      addBound(s)
      addBound(e)
    }
  }
  if (active) {
    addBound(active[0])
    addBound(active[1])
  }

  const points = [...bounds].sort((a, b) => a - b)
  const typeAt = buildTypeLookup(segs, text.length)
  const out: MergedSegment[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    if (to <= from) continue
    out.push({
      text: text.slice(from, to),
      type: typeAt(from),
      changed: covers(ranges, from, to),
      match: covers(matches, from, to),
      active: !!active && from >= active[0] && to <= active[1],
    })
  }
  return out
}

function buildTypeLookup(
  segs: Segment[] | null | undefined,
  len: number
): (offset: number) => string | null {
  if (!segs || !segs.length) return () => null
  const starts: number[] = []
  const types: (string | null)[] = []
  let pos = 0
  for (const s of segs) {
    starts.push(pos)
    types.push(s.type)
    pos += s.text.length
  }
  // segs 길이 합이 라인 길이와 다를 수 있으므로 이분탐색으로 안전하게 조회
  return (offset: number) => {
    if (offset >= len) return null
    let lo = 0
    let hi = starts.length - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (starts[mid] <= offset) {
        found = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return found >= 0 ? types[found] : null
  }
}
