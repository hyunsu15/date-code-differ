/**
 * 비교 대상을 어디서 읽는지를 감춘 계층.
 * 위 계층(snapshotRepository)은 로컬인지 SSH인지 모른 채 이 인터페이스만 쓴다.
 */

export interface RawFile {
  /** 스냅샷 폴더 기준 상대 경로 (`/` 구분자) */
  path: string
  size: number
}

export interface SnapshotSource {
  /** 화면·로그에 보여줄 위치 표시 (예: `C:\rel` 또는 `user@host:/rel`) */
  describe(): string

  /** 루트가 실제로 존재하는지 */
  exists(): Promise<boolean>

  /** 루트 바로 아래 디렉터리 이름 목록 (= 날짜 스냅샷 후보) */
  listSnapshotDirs(): Promise<string[]>

  /** 한 스냅샷 안의 모든 파일 (확장자·용량 필터 전) */
  listFiles(snapshotId: string): Promise<RawFile[]>

  /** 파일 본문. 없거나 읽을 수 없으면 null */
  readFile(snapshotId: string, relPath: string): Promise<string | null>
}

/** 접속·경로 문제를 화면에 그대로 보여주기 위한 오류 */
export class SourceError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'SourceError'
    this.code = code
  }
}
