/**
 * 비교 대상을 어디서 읽는지를 감춘 계층.
 * 위 계층(snapshotRepository)은 로컬인지 SSH인지 모른 채 이 인터페이스만 쓴다.
 *
 * **전부 "여러 개를 한 번에" 모양이다.** SSH 소스는 호출 하나가 곧 접속 하나라
 * (다중화를 못 쓴다 — README 참고) 파일 단위 API 를 두면 왕복이 파일 수에 비례해 버린다.
 * 로컬 소스에는 의미 없는 제약이지만, 느린 쪽에 맞춰 두면 둘 다 이 모양으로 쓸 수 있다.
 */

export interface RawFile {
  /** 스냅샷 폴더 기준 상대 경로 (`/` 구분자) */
  path: string
  size: number
  /**
   * 본문을 읽지 않고 "내용이 같은지" 를 가리기 위한 값.
   * 소스가 **목록을 만들면서 덤으로** 낼 수 있을 때만 채운다. 없으면 null 이고,
   * 그때는 호출부가 예전처럼 양쪽 본문을 읽어 비교한다.
   */
  checksum: string | null
}

export interface SnapshotSource {
  /** 화면·로그에 보여줄 위치 표시 (예: `C:\rel` 또는 `user@host:/rel`) */
  describe(): string

  /** 루트 바로 아래 디렉터리 이름 목록 (= 날짜 스냅샷 후보). 루트가 없으면 ROOT_NOT_FOUND */
  listSnapshotDirs(): Promise<string[]>

  /**
   * 여러 스냅샷의 파일 목록(확장자·용량 필터 전)을 한 번에.
   * 없는 스냅샷은 결과에서 빠진다 (빈 배열이 아니라 키 자체가 없다).
   */
  listFilesIn(snapshotIds: readonly string[]): Promise<Map<string, RawFile[]>>

  /**
   * 한 스냅샷에서 여러 파일의 본문을 한 번에.
   * 없거나 읽을 수 없는 파일은 결과에서 빠진다 — 빈 파일(`''`)과 구분된다.
   */
  readFiles(snapshotId: string, relPaths: readonly string[]): Promise<Map<string, string>>

  /**
   * **스냅샷 밖에 있는** 텍스트 파일 한 건 (제외 목록 등).
   *
   * 경로를 푸는 방식은 구현마다 다르다 — 로컬은 상대 경로를 프로젝트 폴더 기준으로 풀고,
   * SSH 는 원격 경로를 그대로 쓴다. 여기서만 배치 모양이 아닌 이유는 이 파일이
   * 비교 한 번에 **하나뿐**이라 왕복을 묶을 것이 없어서다.
   *
   * @returns 본문. 파일이 없으면 null — 빈 파일(`''`)과 구분된다
   *          (읽을 수는 있는데 실패한 경우는 `SourceError` 를 던진다)
   */
  readTextFile(path: string): Promise<string | null>
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
