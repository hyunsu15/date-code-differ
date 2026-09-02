import fs from 'node:fs/promises'
import path from 'node:path'
import { safeRelativePath, SKIP_DIR_RE } from '../../src/lib/fileTypes.ts'
import { decodeText } from './decode.ts'
import { SourceError, type RawFile, type SnapshotSource } from './types.ts'
import type { TextEncodingName } from '../../src/types.ts'

/** 이 PC 의 폴더를 읽는 소스 */
export class LocalSource implements SnapshotSource {
  /** 절대 경로 */
  private readonly root: string
  private readonly encoding: TextEncodingName
  /** 루트 **밖의** 상대 경로(제외 목록 파일)를 푸는 기준. 루트와는 별개다 */
  private readonly projectRoot: string

  constructor(root: string, encoding: TextEncodingName, projectRoot: string) {
    this.root = root
    this.encoding = encoding
    this.projectRoot = projectRoot
  }

  describe(): string {
    return this.root
  }

  async listSnapshotDirs(): Promise<string[]> {
    let entries
    try {
      entries = await fs.readdir(this.root, { withFileTypes: true })
    } catch (e) {
      // 없는 경로·폴더가 아닌 경로는 "폴더 없음"으로 갈라 알린다 — 설정을 고치면 되는 문제라
      // 권한·디스크 오류와 같은 칸에 두면 사용자가 엉뚱한 곳을 뒤진다
      const code = (e as NodeJS.ErrnoException).code
      const notFound = code === 'ENOENT' || code === 'ENOTDIR'
      throw new SourceError(
        `${notFound ? '비교할 폴더를 찾을 수 없습니다' : '폴더를 읽지 못했습니다'}: ${this.root}\n` +
          (e as Error).message,
        notFound ? 'ROOT_NOT_FOUND' : 'LOCAL_READ_FAILED'
      )
    }
    // 심볼릭 링크는 루트 밖을 가리킬 수 있어 따라가지 않는다
    return entries.filter((e) => e.isDirectory() && !SKIP_DIR_RE.test(e.name)).map((e) => e.name)
  }

  async listFilesIn(snapshotIds: readonly string[]): Promise<Map<string, RawFile[]>> {
    const out = new Map<string, RawFile[]>()

    for (const snapshotId of snapshotIds) {
      const base = this.resolveSnapshot(snapshotId)
      if (!base) continue

      const files: RawFile[] = []
      await this.walk(base, '', files)
      out.set(snapshotId, files)
    }

    return out
  }

  /**
   * 로컬은 왕복 비용이 없어 그냥 하나씩 읽는다.
   * 인터페이스가 배치 모양인 것은 SSH 소스 사정이다 (`source/types.ts`).
   */
  async readFiles(snapshotId: string, relPaths: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()

    for (const relPath of relPaths) {
      const text = await this.readOne(snapshotId, relPath)
      if (text !== null) out.set(relPath, text)
    }

    return out
  }

  /**
   * 루트 밖의 텍스트 파일 한 건. 상대 경로는 **프로젝트 폴더 기준**으로 푼다
   * (`root` 와 같은 규칙이라 설정에 적을 때 헷갈리지 않는다).
   *
   * 없는 파일은 null 로, 그 밖의 실패는 오류로 갈라 낸다 — 경로를 잘못 적은 것과
   * 권한이 없거나 폴더를 가리킨 것은 고칠 곳이 다르다.
   */
  async readTextFile(target: string): Promise<string | null> {
    const file = path.resolve(this.projectRoot, target)
    try {
      return decodeText(await fs.readFile(file), this.encoding)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return null
      throw new SourceError(`${file}\n${(e as Error).message}`, 'LOCAL_READ_FAILED')
    }
  }

  /**
   * 루트 밖 폴더의 파일 이름 목록. 경로 규칙은 `readTextFile` 과 같다.
   * 없는 폴더는 빈 배열로 돌려준다 — 설정을 아직 안 채운 상태가 정상 흐름이다.
   */
  async listFileNames(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(path.resolve(this.projectRoot, dir), {
        withFileTypes: true,
      })
      return entries.filter((e) => e.isFile()).map((e) => e.name)
    } catch {
      return []
    }
  }

  private async readOne(snapshotId: string, relPath: string): Promise<string | null> {
    const base = this.resolveSnapshot(snapshotId)
    if (!base) return null

    const safe = safeRelativePath(relPath)
    if (!safe) return null

    const target = resolveInside(base, safe)
    if (!target) return null

    try {
      // 바이트로 읽고 설정한 인코딩으로 옮긴다 (EUC-KR 소스 대응)
      return decodeText(await fs.readFile(target), this.encoding)
    } catch {
      return null
    }
  }

  /** 스냅샷 폴더의 절대 경로. 폴더명이 부적합하거나 루트를 벗어나면 null */
  private resolveSnapshot(snapshotId: string): string | null {
    if (
      snapshotId === '' ||
      snapshotId.includes('/') ||
      snapshotId.includes('\\') ||
      snapshotId === '.' ||
      snapshotId === '..'
    ) {
      return null
    }
    return resolveInside(this.root, snapshotId)
  }

  private async walk(base: string, rel: string, out: RawFile[]): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(path.join(base, rel), { withFileTypes: true })
    } catch {
      return // 권한 없는 폴더는 조용히 건너뛴다
    }

    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (SKIP_DIR_RE.test(childRel)) continue

      if (entry.isDirectory()) {
        await this.walk(base, childRel, out)
        continue
      }
      if (!entry.isFile()) continue // 심볼릭 링크 제외

      try {
        // checksum 은 null — 로컬에서 이걸 채우려면 파일을 통째로 한 번 더 읽어야 하는데,
        // 왕복 비용이 없는 로컬에서는 그게 순수한 손해다 (`source/types.ts` 참고)
        out.push({
          path: childRel,
          size: (await fs.stat(path.join(base, childRel))).size,
          checksum: null,
        })
      } catch {
        // 읽을 수 없는 파일은 목록에서 뺀다
      }
    }
  }
}

/** base 밖으로 벗어나지 않는 절대 경로를 만든다. 벗어나면 null */
function resolveInside(base: string, rel: string): string | null {
  const target = path.resolve(base, rel)
  if (target !== base && !target.startsWith(base + path.sep)) return null
  return target
}
